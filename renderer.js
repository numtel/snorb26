  import {
    GRID_W,
    GRID_H,
    TILE_W,
    TILE_H,
    ELEV_STEP,
    BUILD_SPRITES,
    elevations,
    SC3K_COLOR_STOPS,
    buildingAt,
    camera,
    selected,
    appState,
    levelSel,
    customBuildingRegistry,
    mapSettings,
    extrusions,
    cubes,
  } from './state.js';
  import * as shaders from './shaders.js';

  export let gl, canvas;
  let program, waterProgram, buildProgram, pickProgram, skyProgram, extrudeProgram, editorProgram;
  let vao, buildVao, buildInstanceBuf, extrudeVao, extrudeBuf, editorVao, editorBuf, cubeVao, cubeBuf;
  let elevTex, paletteTex, buildingTex;
  let U, WU, BU, PU, SU, EU, EDU;
  let buildInstanceCount = 0;
  export let extrudeVertCount = 0;
  export let cubeVertCount = 0;

  export const buildBuffers = new Map();
  const typeBuffers = new Map();
  export const customTextures = new Map();

  const pickState = { fbo: null, colorTex: null, depthRb: null };
  let pendingPick = null, pendingPickCb = [];
  const pickPixel = new Uint8Array(4);

  export function loadCustomTexture(url) {
    if (customTextures.has(url)) return;

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // Default 1x1 transparent pixel until image loads
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,0]));

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      customTextures.get(url).width = img.width;
      customTextures.get(url).height = img.height;
    };
    img.src = url;
    customTextures.set(url, { tex, width: 32, height: 64 });
  }

  export function updatePaletteTexture() {
    const palData = new Uint8Array(256 * 4);
    const waterLevel = mapSettings.waterLevel;
    const originalPivot = 86; // The original T value for the 5th stop

    // 1. Create a dynamic version of the stops based on current water level
    const dynamicStops = SC3K_COLOR_STOPS.map((stop, i) => {
      let newT = stop.t;
      if (stop.t <= originalPivot) {
        // Scale underwater stops: map [0, 86] to [0, waterLevel]
        newT = (stop.t / originalPivot) * waterLevel;
      } else {
        // Scale above-water stops: map [86, 255] to [waterLevel, 255]
        newT = waterLevel + ((stop.t - originalPivot) / (255 - originalPivot)) * (255 - waterLevel);
      }
      return { t: newT, c: stop.c };
    });

    // 2. Fill the palette data using the dynamic stops
    for (let i = 0; i < 256; i++) {
      let a = dynamicStops[0], b = dynamicStops[dynamicStops.length - 1];

      for (let s = 0; s < dynamicStops.length - 1; s++) {
        if (i >= dynamicStops[s].t && i <= dynamicStops[s + 1].t) {
          a = dynamicStops[s];
          b = dynamicStops[s + 1];
          break;
        }
      }

      const range = b.t - a.t;
      const u = range <= 0 ? 0 : (i - a.t) / range;

      palData[i * 4]     = Math.round((a.c[0] + (b.c[0] - a.c[0]) * u) * 255);
      palData[i * 4 + 1] = Math.round((a.c[1] + (b.c[1] - a.c[1]) * u) * 255);
      palData[i * 4 + 2] = Math.round((a.c[2] + (b.c[2] - a.c[2]) * u) * 255);
      palData[i * 4 + 3] = 255;
    }

    gl.bindTexture(gl.TEXTURE_2D, paletteTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, palData);
  }

  export function initWebGL(canvasEl) {
    canvas = canvasEl;
    gl = canvas.getContext('webgl2', { antialias: true, alpha: false, depth: true, stencil: false });
    if (!gl) throw new Error("WebGL2 required");

    gl.clearColor(0, 0, 0, 1);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    program = linkProgram(shaders.vsTerrain, shaders.fsTerrain);
    waterProgram = linkProgram(shaders.vsWater, shaders.fsWater);
    buildProgram = linkProgram(shaders.vsBuild, shaders.fsBuild);
    pickProgram = linkProgram(shaders.vsPick, shaders.fsPick);
    skyProgram = linkProgram(shaders.vsSky, shaders.fsSky);
    extrudeProgram = linkProgram(shaders.vsExtrude, shaders.fsExtrude);
    editorProgram = linkProgram(shaders.vsEditor, shaders.fsEditor);

    U = getUniforms(program, ["u_viewSize", "u_pan", "u_zoom", "u_tileW", "u_tileH", "u_elevStep", "u_gridW", "u_gridH", "u_rotation", "u_elevTex", "u_paletteTex", "u_selectedId", "u_hasSelection", "u_outlinePx", "u_levelActive", "u_levelMin", "u_levelMax"]);
    WU = getUniforms(waterProgram, ["u_viewSize", "u_pan", "u_zoom", "u_tileW", "u_tileH", "u_elevStep", "u_gridW", "u_gridH", "u_rotation", "u_elevTex", "u_paletteTex", "u_waterLevel", "u_alpha", "u_time"]);
    BU = getUniforms(buildProgram, ["u_viewSize", "u_pan", "u_zoom", "u_tileW", "u_tileH", "u_elevStep", "u_gridW", "u_gridH", "u_rotation", "u_elevTex", "u_sheet", "u_spritePx", "u_sheetCols"]);
    PU = getUniforms(pickProgram, ["u_viewSize", "u_pan", "u_zoom", "u_tileW", "u_tileH", "u_elevStep", "u_gridW", "u_gridH", "u_rotation", "u_elevTex"]);
    SU = getUniforms(skyProgram, ["u_tilt", "u_rotation", "u_pan"]);
    EU = getUniforms(extrudeProgram, ["u_viewSize", "u_pan", "u_zoom", "u_tileW", "u_tileH", "u_elevStep", "u_gridW", "u_gridH", "u_rotation", "u_elevTex"]);
    EDU = getUniforms(editorProgram, ["u_viewSize", "u_pan", "u_zoom", "u_tileW", "u_tileH", "u_elevStep", "u_gridW", "u_gridH", "u_rotation", "u_elevTex"]);

    setupGeometry();
    setupTextures();

    editorVao = gl.createVertexArray();
    editorBuf = gl.createBuffer();
    gl.bindVertexArray(editorVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, editorBuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
  }

  function compileShader(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  }

  function linkProgram(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compileShader(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compileShader(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  function getUniforms(prog, names) {
    return names.reduce((acc, n) => ({ ...acc, [n.replace('u_', '')]: gl.getUniformLocation(prog, n) }), {});
  }

  function setupGeometry() {
    const corners = new Float32Array([0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0]);
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const buildQuad = new Float32Array([-0.5, 1.0, 0.0, 0.0, 0.5, 1.0, 1.0, 0.0, 0.5, 0.0, 1.0, 1.0, -0.5, 1.0, 0.0, 0.0, 0.5, 0.0, 1.0, 1.0, -0.5, 0.0, 0.0, 1.0]);
    buildVao = gl.createVertexArray();
    gl.bindVertexArray(buildVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, buildQuad, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);

    // Enable attributes but don't bind pointers yet (we do this in draw)
    gl.enableVertexAttribArray(2); gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3); gl.vertexAttribDivisor(3, 1);

    buildInstanceBuf = gl.createBuffer();

    extrudeVao = gl.createVertexArray();
    extrudeBuf = gl.createBuffer();
    gl.bindVertexArray(extrudeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, extrudeBuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 36, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 36, 8);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 36, 12);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 36, 24);

    // Set up Cube geometry buffer (matches Extrude layout)
    cubeVao = gl.createVertexArray();
    cubeBuf = gl.createBuffer();
    gl.bindVertexArray(cubeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 36, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 36, 8);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 36, 12);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 36, 24);
  }

  function setupTextures() {
    elevTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, elevTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, GRID_W, GRID_H, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, elevations);

    paletteTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, paletteTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    updatePaletteTexture();

    // Buildings sprite sheet
    const sprW = 32, sprH = 64; // Increased from 40 to 64
    const sheet = document.createElement('canvas');
    sheet.width = sprW * BUILD_SPRITES;
    sheet.height = sprH;
    const ctx = sheet.getContext('2d');

    // Clear the canvas to ensure alpha is 0
    ctx.clearRect(0, 0, sheet.width, sheet.height);

    for (let i = 0; i < BUILD_SPRITES; i++) {
      const x = i * sprW;
      const hue = (i * 137.5) % 360;
      const h = 12 + Math.random() * 25; // Random height

      // We anchor the building at the bottom of our 64px tall sprite
      const cx = x + 16;
      const cy = sprH - 2;

      // Draw Right Face
      ctx.fillStyle = `hsl(${hue}, 40%, 30%)`;
      ctx.beginPath();
      ctx.moveTo(cx, cy); ctx.lineTo(cx + 16, cy - 8);
      ctx.lineTo(cx + 16, cy - 8 - h); ctx.lineTo(cx, cy - h);
      ctx.fill();

      // Draw Left Face
      ctx.fillStyle = `hsl(${hue}, 40%, 45%)`;
      ctx.beginPath();
      ctx.moveTo(cx, cy); ctx.lineTo(cx - 16, cy - 8);
      ctx.lineTo(cx - 16, cy - 8 - h); ctx.lineTo(cx, cy - h);
      ctx.fill();

      // Draw Top Face
      ctx.fillStyle = `hsl(${hue}, 50%, 65%)`;
      ctx.beginPath();
      ctx.moveTo(cx, cy - h); ctx.lineTo(cx + 16, cy - 8 - h);
      ctx.lineTo(cx, cy - 16 - h); ctx.lineTo(cx - 16, cy - 8 - h);
      ctx.fill();
    }

    buildingTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, buildingTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sheet);
  }

export function uploadElevations() {
  gl.bindTexture(gl.TEXTURE_2D, elevTex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, GRID_W, GRID_H, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, elevations);
}

export function rebuildBuildingInstances() {
  const groups = new Map(); // Map 'type' to array of ints [x, y, spr]

  for (let i = 0; i < buildingAt.length; i++) {
    const val = buildingAt[i];
    if (val === 0) continue;

    let type = 0;
    let spr = val - 1;

    // Custom buildings start at ID (BUILD_SPRITES + 1)
    if (val > BUILD_SPRITES) {
      type = val - BUILD_SPRITES;
      spr = 0; // Custom files are typically single sprite
    }

    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push(i % GRID_W, (i / GRID_W) | 0, spr);
  }

  buildBuffers.clear();

  for (const [type, data] of groups.entries()) {
    const count = data.length / 3;
    const bufData = new ArrayBuffer(count * 12);
    const i16 = new Int16Array(bufData), f32 = new Float32Array(bufData);

    for (let k = 0, off = 0; k < count; k++, off += 12) {
      i16[(off >> 1) + 0] = data[k * 3];
      i16[(off >> 1) + 1] = data[k * 3 + 1];
      f32[(off >> 2) + 1] = data[k * 3 + 2];
      f32[(off >> 2) + 2] = 0.0;
    }

    let glBuf = typeBuffers.get(type);
    if (!glBuf) {
        glBuf = gl.createBuffer();
        typeBuffers.set(type, glBuf);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, glBuf);
    gl.bufferData(gl.ARRAY_BUFFER, bufData, gl.DYNAMIC_DRAW);

    buildBuffers.set(type, { count, buf: glBuf });
  }
}

export function rebuildExtrusionBuffers() {
    const verts = [];
    const pushVert = (x, y, zOffset, nx, ny, nz, r, g, b) => verts.push(x, y, zOffset, nx, ny, nz, r, g, b);
    
    const catmullRom = (p0, p1, p2, p3, t) => {
        const t2 = t * t, t3 = t2 * t;
        const f0 = -0.5*t3 + t2 - 0.5*t; 
        const f1 = 1.5*t3 - 2.5*t2 + 1.0;
        const f2 = -1.5*t3 + 2.0*t2 + 0.5*t; 
        const f3 = 0.5*t3 - 0.5*t2;
        return { x: p0.x*f0 + p1.x*f1 + p2.x*f2 + p3.x*f3, y: p0.y*f0 + p1.y*f1 + p2.y*f2 + p3.y*f3 };
    };

    for (const ext of extrusions) {
        if (ext.points.length < 2) continue;
        
        // 1. Generate the dense, smooth path points
        const dense = [];
        const steps = 12;
        const pts = [ext.points[0], ...ext.points, ext.points[ext.points.length-1]];
        for (let i = 1; i < pts.length - 2; i++) {
            const iterations = (i === pts.length - 3) ? steps + 1 : steps;
            for (let s = 0; s < iterations; s++) {
                dense.push(catmullRom(pts[i-1], pts[i], pts[i+1], pts[i+2], s / steps));
            }
        }

        // 2. Generate "Rings" at each point (pre-calculate cross-sections)
        const rings = [];
        const w = ext.width / 2;
        const h = ext.height;

        for (let i = 0; i < dense.length; i++) {
            const p = dense[i];
            const pPrev = dense[Math.max(0, i - 1)];
            const pNext = dense[Math.min(dense.length - 1, i + 1)];
            
            // Calculate the average tangent direction at this point
            let dx = pNext.x - pPrev.x;
            let dy = pNext.y - pPrev.y;
            let len = Math.hypot(dx, dy);
            
            // Fallback for overlapping points
            if (len < 0.0001 && i < dense.length - 2) {
                const pNextNext = dense[i+2];
                dx = pNextNext.x - p.x; dy = pNextNext.y - p.y;
                len = Math.hypot(dx, dy);
            }
            
            const nx = -dy / (len || 1), ny = dx / (len || 1);
            rings.push({
                p, nx, ny,
                TL: { x: p.x + nx * w, y: p.y + ny * w }, // Top Left
                TR: { x: p.x - nx * w, y: p.y - ny * w }  // Top Right
            });
        }

        // 3. Stitch the rings together into triangles
        const c = ext.color;
        for (let i = 0; i < rings.length - 1; i++) {
            const r0 = rings[i], r1 = rings[i+1];

            // Top Face (Shared vertices = no gaps)
            pushVert(r0.TL.x, r0.TL.y, h, 0,0,1, c[0], c[1], c[2]);
            pushVert(r0.TR.x, r0.TR.y, h, 0,0,1, c[0], c[1], c[2]);
            pushVert(r1.TR.x, r1.TR.y, h, 0,0,1, c[0], c[1], c[2]);
            
            pushVert(r0.TL.x, r0.TL.y, h, 0,0,1, c[0], c[1], c[2]);
            pushVert(r1.TR.x, r1.TR.y, h, 0,0,1, c[0], c[1], c[2]);
            pushVert(r1.TL.x, r1.TL.y, h, 0,0,1, c[0], c[1], c[2]);

            // Left Wall
            pushVert(r0.TL.x, r0.TL.y, 0, r0.nx, r0.ny, 0, c[0]*0.8, c[1]*0.8, c[2]*0.8);
            pushVert(r1.TL.x, r1.TL.y, 0, r1.nx, r1.ny, 0, c[0]*0.8, c[1]*0.8, c[2]*0.8);
            pushVert(r1.TL.x, r1.TL.y, h, r1.nx, r1.ny, 0, c[0]*0.8, c[1]*0.8, c[2]*0.8);

            pushVert(r0.TL.x, r0.TL.y, 0, r0.nx, r0.ny, 0, c[0]*0.8, c[1]*0.8, c[2]*0.8);
            pushVert(r1.TL.x, r1.TL.y, h, r1.nx, r1.ny, 0, c[0]*0.8, c[1]*0.8, c[2]*0.8);
            pushVert(r0.TL.x, r0.TL.y, h, r0.nx, r0.ny, 0, c[0]*0.8, c[1]*0.8, c[2]*0.8);

            // Right Wall
            pushVert(r0.TR.x, r0.TR.y, 0, -r0.nx, -r0.ny, 0, c[0]*0.6, c[1]*0.6, c[2]*0.6);
            pushVert(r0.TR.x, r0.TR.y, h, -r0.nx, -r0.ny, 0, c[0]*0.6, c[1]*0.6, c[2]*0.6);
            pushVert(r1.TR.x, r1.TR.y, h, -r1.nx, -r1.ny, 0, c[0]*0.6, c[1]*0.6, c[2]*0.6);

            pushVert(r0.TR.x, r0.TR.y, 0, -r0.nx, -r0.ny, 0, c[0]*0.6, c[1]*0.6, c[2]*0.6);
            pushVert(r1.TR.x, r1.TR.y, h, -r1.nx, -r1.ny, 0, c[0]*0.6, c[1]*0.6, c[2]*0.6);
            pushVert(r1.TR.x, r1.TR.y, 0, -r1.nx, -r1.ny, 0, c[0]*0.6, c[1]*0.6, c[2]*0.6);
        }

        // 4. End Caps (closing the start and end of the ribbon)
        if (rings.length > 1) {
            const first = rings[0], last = rings[rings.length-1];
            // Start
            const fdx = rings[1].p.x - first.p.x, fdy = rings[1].p.y - first.p.y;
            const fl = Math.hypot(fdx, fdy);
            const fnx = -fdx/(fl||1), fny = -fdy/(fl||1);
            pushVert(first.TL.x, first.TL.y, 0, fnx, fny, 0, c[0]*0.7, c[1]*0.7, c[2]*0.7);
            pushVert(first.TR.x, first.TR.y, 0, fnx, fny, 0, c[0]*0.7, c[1]*0.7, c[2]*0.7);
            pushVert(first.TL.x, first.TL.y, h, fnx, fny, 0, c[0]*0.7, c[1]*0.7, c[2]*0.7);
            pushVert(first.TR.x, first.TR.y, 0, fnx, fny, 0, c[0]*0.7, c[1]*0.7, c[2]*0.7);
            pushVert(first.TR.x, first.TR.y, h, fnx, fny, 0, c[0]*0.7, c[1]*0.7, c[2]*0.7);
            pushVert(first.TL.x, first.TL.y, h, fnx, fny, 0, c[0]*0.7, c[1]*0.7, c[2]*0.7);
            
            // End
            const bdx = last.p.x - rings[rings.length-2].p.x, bdy = last.p.y - rings[rings.length-2].p.y;
            const bl = Math.hypot(bdx, bdy);
            const bnx = bdx/(bl||1), bny = bdy/(bl||1);
            pushVert(last.TL.x, last.TL.y, 0, bnx, bny, 0, c[0]*0.7, c[1]*0.7, c[2]*0.7);
            pushVert(last.TL.x, last.TL.y, h, bnx, bny, 0, c[0]*0.7, c[1]*0.7, c[2]*0.7);
            pushVert(last.TR.x, last.TR.y, 0, bnx, bny, 0, c[0]*0.7, c[1]*0.7, c[2]*0.7);
            pushVert(last.TR.x, last.TR.y, 0, bnx, bny, 0, c[0]*0.7, c[1]*0.7, c[2]*0.7);
            pushVert(last.TL.x, last.TL.y, h, bnx, bny, 0, c[0]*0.7, c[1]*0.7, c[2]*0.7);
            pushVert(last.TR.x, last.TR.y, h, bnx, bny, 0, c[0]*0.7, c[1]*0.7, c[2]*0.7);
        }
    }

    extrudeVertCount = verts.length / 9;
    gl.bindBuffer(gl.ARRAY_BUFFER, extrudeBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.DYNAMIC_DRAW);
}

export function requestPick(sx, sy, callback) {
  pendingPick = { x: Math.max(0, Math.min(canvas.width - 1, Math.round(sx))), y: Math.max(0, Math.min(canvas.height - 1, Math.round(sy))) };
  if(typeof callback === 'function') {
    pendingPickCb.push(callback);
  }
}

export function rebuildPickResources() {
  if (pickState.fbo) gl.deleteFramebuffer(pickState.fbo);
  if (pickState.colorTex) gl.deleteTexture(pickState.colorTex);
  if (pickState.depthRb) gl.deleteRenderbuffer(pickState.depthRb);

  pickState.fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, pickState.fbo);

  pickState.colorTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, pickState.colorTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pickState.colorTex, 0);

  pickState.depthRb = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, pickState.depthRb);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, canvas.width, canvas.height);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, pickState.depthRb);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

export function draw(now) {
  const parallaxScalar = 0.5 + (0.5 / camera.tilt);
  gl.viewport(0, 0, canvas.width, canvas.height);
  if (pendingPick) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, pickState.fbo);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(pickProgram);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, elevTex); gl.uniform1i(PU.elevTex, 0);
    gl.uniform2f(PU.viewSize, canvas.width, canvas.height);
    gl.uniform2f(PU.pan, camera.panX, camera.panY);
    gl.uniform1f(PU.zoom, camera.zoom);
    gl.uniform1f(PU.rotation, camera.rotation);
    gl.uniform1f(PU.tileW, TILE_W); gl.uniform1f(PU.tileH, TILE_H);
    gl.uniform1f(PU.elevStep, ELEV_STEP); gl.uniform1i(PU.gridW, GRID_W); gl.uniform1i(PU.gridH, GRID_H);
    gl.uniform1f(PU.tileW, TILE_W); gl.uniform1f(PU.tileH, TILE_H * camera.tilt);
    gl.uniform1f(PU.elevStep, ELEV_STEP * parallaxScalar);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, GRID_W * GRID_H);

    gl.readPixels(pendingPick.x, (canvas.height - 1) - pendingPick.y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pickPixel);
    const id = (pickPixel[0] + (pickPixel[1] << 8) + (pickPixel[2] << 16)) - 1;
    
    // FIX: Click off map properly resets
    if (id < 0 || id >= GRID_W * GRID_H) { selected.has = false; } 
    else { selected.has = true; selected.id = id; selected.x = id % GRID_W; selected.y = Math.floor(id / GRID_W); }
    if(pendingPickCb.length > 0) {
      pendingPickCb.splice(0, pendingPickCb.length).forEach(fun => fun(selected));
    }
    
    pendingPick = null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // DRAW SKYBOX
  gl.useProgram(skyProgram);
  gl.bindVertexArray(vao); // Reusing the standard quad VAO
  gl.depthMask(false);    // Don't write to depth buffer

  gl.uniform1f(SU.tilt, camera.tilt);
  gl.uniform1f(SU.rotation, camera.rotation);
  gl.uniform2f(SU.pan, camera.panX, camera.panY);

  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.depthMask(true);     // Re-enable depth for terrain

  // DRAW TERRAIN
  gl.useProgram(program);
  gl.bindVertexArray(vao);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, elevTex); gl.uniform1i(U.elevTex, 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, paletteTex); gl.uniform1i(U.paletteTex, 1);
  gl.uniform2f(U.viewSize, canvas.width, canvas.height); gl.uniform2f(U.pan, camera.panX, camera.panY);
  gl.uniform1f(U.zoom, camera.zoom); gl.uniform1f(U.tileW, TILE_W); gl.uniform1f(U.tileH, TILE_H);
  gl.uniform1f(U.rotation, camera.rotation);
  gl.uniform1f(U.elevStep, ELEV_STEP * parallaxScalar); gl.uniform1i(U.gridW, GRID_W); gl.uniform1i(U.gridH, GRID_H);
  gl.uniform1f(U.tileW, TILE_W); gl.uniform1f(U.tileH, TILE_H * camera.tilt);
  gl.uniform1f(U.elevStep, ELEV_STEP * parallaxScalar);

  gl.uniform1i(U.hasSelection, selected.has ? 1 : 0); gl.uniform1i(U.selectedId, selected.id);
  
  if (levelSel.active) {
    gl.uniform1i(U.levelActive, 1);
    gl.uniform2i(U.levelMin, Math.min(levelSel.startX, levelSel.endX), Math.min(levelSel.startY, levelSel.endY));
    gl.uniform2i(U.levelMax, Math.max(levelSel.startX, levelSel.endX), Math.max(levelSel.startY, levelSel.endY));
  } else {
    gl.uniform1i(U.levelActive, 0); gl.uniform2i(U.levelMin, 0, 0); gl.uniform2i(U.levelMax, -1, -1);
  }
  
  gl.uniform1f(U.outlinePx, 1.25);
  gl.uniform1i(gl.getUniformLocation(program, "u_showGrid"), appState.showGrid ? 1 : 0);
  gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, GRID_W * GRID_H);

  // Buildings (If applicable)
  if (buildBuffers.size > 0) {
      gl.useProgram(buildProgram);
      gl.bindVertexArray(buildVao);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, elevTex); gl.uniform1i(BU.elevTex, 0);

      gl.uniform2f(BU.viewSize, canvas.width, canvas.height); gl.uniform2f(BU.pan, camera.panX, camera.panY);
      gl.uniform1f(BU.zoom, camera.zoom); gl.uniform1f(BU.tileW, TILE_W); gl.uniform1f(BU.tileH, TILE_H * camera.tilt);
      gl.uniform1f(BU.rotation, camera.rotation);
      gl.uniform1f(BU.elevStep, ELEV_STEP * camera.tilt); gl.uniform1i(BU.gridW, GRID_W); gl.uniform1i(BU.gridH, GRID_H);
      gl.uniform1f(BU.tileW, TILE_W); gl.uniform1f(BU.tileH, TILE_H * camera.tilt);
      gl.uniform1f(BU.elevStep, ELEV_STEP * parallaxScalar);

      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(true);

      for (const [type, info] of buildBuffers.entries()) {
          if (info.count === 0) continue;

          // Re-bind instance attributes for this specific buffer loop
          gl.bindBuffer(gl.ARRAY_BUFFER, info.buf);
          gl.vertexAttribIPointer(2, 2, gl.SHORT, 12, 0);
          gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 12, 4);

          if (type === 0) {
              gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, buildingTex); gl.uniform1i(BU.sheet, 1);
              gl.uniform2f(BU.spritePx, 32, 64 * parallaxScalar); gl.uniform1f(BU.sheetCols, BUILD_SPRITES);
          } else {
              const urlIndex = type - 1;
              const url = customBuildingRegistry[urlIndex];
              const customInfo = customTextures.get(url);

              if (customInfo && customInfo.tex) {
                  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, customInfo.tex); gl.uniform1i(BU.sheet, 1);
                  gl.uniform2f(BU.spritePx, customInfo.width, customInfo.height * parallaxScalar); gl.uniform1f(BU.sheetCols, 1.0);
              } else {
                  continue; // Skip rendering if missing
              }
          }
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, info.count);
      }
      gl.depthMask(true); gl.disable(gl.BLEND);
  }

  // DRAW EXTRUSIONS
  if (extrudeVertCount > 0) {
      gl.useProgram(extrudeProgram);
      gl.bindVertexArray(extrudeVao);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, elevTex); gl.uniform1i(EU.elevTex, 0);

      gl.uniform2f(EU.viewSize, canvas.width, canvas.height); gl.uniform2f(EU.pan, camera.panX, camera.panY);
      gl.uniform1f(EU.zoom, camera.zoom); gl.uniform1f(EU.tileW, TILE_W); gl.uniform1f(EU.tileH, TILE_H * camera.tilt);
      gl.uniform1f(EU.rotation, camera.rotation);
      gl.uniform1f(EU.elevStep, ELEV_STEP * parallaxScalar); gl.uniform1i(EU.gridW, GRID_W); gl.uniform1i(EU.gridH, GRID_H);

      gl.enable(gl.BLEND); gl.depthMask(true);
      gl.drawArrays(gl.TRIANGLES, 0, extrudeVertCount);
  }

  // DRAW EDITOR NODES (Over the extrusions)
  if (appState.toolMode === 'edit-path' && appState.activeExtrusion && appState.activeExtrusion.points.length > 0) {
      const pts = appState.activeExtrusion.points;
      const arr = new Float32Array(pts.length * 2);
      for (let i = 0; i < pts.length; i++) { arr[i*2] = pts[i].x; arr[i*2+1] = pts[i].y; }

      gl.bindBuffer(gl.ARRAY_BUFFER, editorBuf);
      gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);

      gl.useProgram(editorProgram);
      gl.bindVertexArray(editorVao);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, elevTex); gl.uniform1i(EDU.elevTex, 0);

      gl.uniform2f(EDU.viewSize, canvas.width, canvas.height); gl.uniform2f(EDU.pan, camera.panX, camera.panY);
      gl.uniform1f(EDU.zoom, camera.zoom); gl.uniform1f(EDU.tileW, TILE_W); gl.uniform1f(EDU.tileH, TILE_H * camera.tilt);
      gl.uniform1f(EDU.rotation, camera.rotation);

      // Pass parallax scalar so nodes float properly matching perspective
      const parallaxScalar = 0.5 + (0.5 / camera.tilt);
      gl.uniform1f(EDU.elevStep, ELEV_STEP * parallaxScalar); gl.uniform1i(EDU.gridW, GRID_W); gl.uniform1i(EDU.gridH, GRID_H);

      gl.disable(gl.DEPTH_TEST); // Draw perfectly on top of structures
      gl.drawArrays(gl.POINTS, 0, pts.length);
      gl.enable(gl.DEPTH_TEST);
  }

  // DRAW CUBES
  if (cubeVertCount > 0) {
      gl.useProgram(extrudeProgram);
      gl.bindVertexArray(cubeVao);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, elevTex); gl.uniform1i(EU.elevTex, 0);

      gl.uniform2f(EU.viewSize, canvas.width, canvas.height); gl.uniform2f(EU.pan, camera.panX, camera.panY);
      gl.uniform1f(EU.zoom, camera.zoom); gl.uniform1f(EU.tileW, TILE_W); gl.uniform1f(EU.tileH, TILE_H * camera.tilt);
      gl.uniform1f(EU.rotation, camera.rotation);
      gl.uniform1f(EU.elevStep, ELEV_STEP * parallaxScalar); gl.uniform1i(EU.gridW, GRID_W); gl.uniform1i(EU.gridH, GRID_H);

      gl.enable(gl.BLEND); gl.depthMask(true);
      gl.drawArrays(gl.TRIANGLES, 0, cubeVertCount);
  }

  // DRAW CUBE EDITOR NODES
  if (appState.toolMode === 'edit-cube' && appState.activeCubeIndex >= 0 && cubes[appState.activeCubeIndex]) {
      const c = cubes[appState.activeCubeIndex];
      const hw = c.w / 2, hl = (c.l !== undefined ? c.l : c.w) / 2;
      const c_rot = Math.cos(c.r || 0), s_rot = Math.sin(c.r || 0);
      const rot = (lx, ly) => [c.x + lx*c_rot - ly*s_rot, c.y + lx*s_rot + ly*c_rot];

      const pts = [ rot(0,0), rot(-hw, -hl), rot(hw, -hl), rot(-hw, hl), rot(hw, hl) ];
      const arr = new Float32Array(10);
      for (let i = 0; i < 5; i++) { arr[i*2] = pts[i][0]; arr[i*2+1] = pts[i][1]; }

      gl.bindBuffer(gl.ARRAY_BUFFER, editorBuf);
      gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);

      gl.useProgram(editorProgram);
      gl.bindVertexArray(editorVao);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, elevTex); gl.uniform1i(EDU.elevTex, 0);

      gl.uniform2f(EDU.viewSize, canvas.width, canvas.height); gl.uniform2f(EDU.pan, camera.panX, camera.panY);
      gl.uniform1f(EDU.zoom, camera.zoom); gl.uniform1f(EDU.tileW, TILE_W); gl.uniform1f(EDU.tileH, TILE_H * camera.tilt);
      gl.uniform1f(EDU.rotation, camera.rotation);

      const parallaxScalar = 0.5 + (0.5 / camera.tilt);
      gl.uniform1f(EDU.elevStep, ELEV_STEP * parallaxScalar); gl.uniform1i(EDU.gridW, GRID_W); gl.uniform1i(EDU.gridH, GRID_H);

      gl.disable(gl.DEPTH_TEST);
      gl.drawArrays(gl.POINTS, 0, 5);
      gl.enable(gl.DEPTH_TEST);
  }

  // Water Program
  gl.useProgram(waterProgram);
  gl.bindVertexArray(vao);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, elevTex); gl.uniform1i(WU.elevTex, 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, paletteTex); gl.uniform1i(WU.paletteTex, 1);
  gl.uniform2f(WU.viewSize, canvas.width, canvas.height); gl.uniform2f(WU.pan, camera.panX, camera.panY);
  gl.uniform1f(WU.zoom, camera.zoom); gl.uniform1f(WU.tileW, TILE_W); gl.uniform1f(WU.tileH, TILE_H);
  gl.uniform1f(WU.rotation, camera.rotation);
  gl.uniform1f(WU.elevStep, ELEV_STEP); gl.uniform1i(WU.gridW, GRID_W); gl.uniform1i(WU.gridH, GRID_H);
  gl.uniform1f(WU.waterLevel, mapSettings.waterLevel); gl.uniform1f(WU.alpha, 0.48); gl.uniform1f(WU.time, (now || 0) * 0.001);
  gl.uniform1f(WU.tileW, TILE_W); gl.uniform1f(WU.tileH, TILE_H * camera.tilt);
  gl.uniform1f(WU.elevStep, ELEV_STEP * parallaxScalar);

  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
  gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, GRID_W * GRID_H);
  gl.depthMask(true); gl.disable(gl.BLEND);

}

export function rebuildCubeBuffers() {
    const verts = [];
    const pushVert = (x, y, zOffset, nx, ny, nz, r, g, b) => verts.push(x, y, zOffset, nx, ny, nz, r, g, b);

    for (const cube of cubes) {
        const hw = cube.w / 2;
        const hl = (cube.l !== undefined ? cube.l : cube.w) / 2;
        const h = cube.h;
        const cx = cube.x, cy = cube.y;
        const c = cube.c;

        const c_rot = Math.cos(cube.r || 0);
        const s_rot = Math.sin(cube.r || 0);

        // Helper to rotate local vertex coordinates
        const rot = (lx, ly) => ({
            x: cx + lx * c_rot - ly * s_rot,
            y: cy + lx * s_rot + ly * c_rot
        });

        // Helper to rotate normals
        const rotN = (nx, ny) => ({
            x: nx * c_rot - ny * s_rot,
            y: nx * s_rot + ny * c_rot
        });

        // 4 Corners in world space
        const p00 = rot(-hw, -hl); // Top Left
        const p10 = rot(hw, -hl);  // Top Right
        const p01 = rot(-hw, hl);  // Bottom Left
        const p11 = rot(hw, hl);   // Bottom Right

        // Top Face
        pushVert(p00.x, p00.y, h,  0,0,1,  c[0], c[1], c[2]);
        pushVert(p10.x, p10.y, h,  0,0,1,  c[0], c[1], c[2]);
        pushVert(p01.x, p01.y, h,  0,0,1,  c[0], c[1], c[2]);
        pushVert(p10.x, p10.y, h,  0,0,1,  c[0], c[1], c[2]);
        pushVert(p11.x, p11.y, h,  0,0,1,  c[0], c[1], c[2]);
        pushVert(p01.x, p01.y, h,  0,0,1,  c[0], c[1], c[2]);

        // Left Face (Normal: -1, 0)
        const nl = rotN(-1, 0);
        const lc = [c[0]*0.8, c[1]*0.8, c[2]*0.8];
        pushVert(p00.x, p00.y, 0, nl.x, nl.y, 0, lc[0], lc[1], lc[2]);
        pushVert(p01.x, p01.y, 0, nl.x, nl.y, 0, lc[0], lc[1], lc[2]);
        pushVert(p00.x, p00.y, h, nl.x, nl.y, 0, lc[0], lc[1], lc[2]);
        pushVert(p01.x, p01.y, 0, nl.x, nl.y, 0, lc[0], lc[1], lc[2]);
        pushVert(p01.x, p01.y, h, nl.x, nl.y, 0, lc[0], lc[1], lc[2]);
        pushVert(p00.x, p00.y, h, nl.x, nl.y, 0, lc[0], lc[1], lc[2]);

        // Right Face (Normal: 1, 0)
        const nr = rotN(1, 0);
        const rc = [c[0]*0.6, c[1]*0.6, c[2]*0.6];
        pushVert(p11.x, p11.y, 0, nr.x, nr.y, 0, rc[0], rc[1], rc[2]);
        pushVert(p10.x, p10.y, 0, nr.x, nr.y, 0, rc[0], rc[1], rc[2]);
        pushVert(p11.x, p11.y, h, nr.x, nr.y, 0, rc[0], rc[1], rc[2]);
        pushVert(p10.x, p10.y, 0, nr.x, nr.y, 0, rc[0], rc[1], rc[2]);
        pushVert(p10.x, p10.y, h, nr.x, nr.y, 0, rc[0], rc[1], rc[2]);
        pushVert(p11.x, p11.y, h, nr.x, nr.y, 0, rc[0], rc[1], rc[2]);

        // Front Face (Normal: 0, 1)
        const nf = rotN(0, 1);
        const fc = [c[0]*0.7, c[1]*0.7, c[2]*0.7];
        pushVert(p01.x, p01.y, 0, nf.x, nf.y, 0, fc[0], fc[1], fc[2]);
        pushVert(p11.x, p11.y, 0, nf.x, nf.y, 0, fc[0], fc[1], fc[2]);
        pushVert(p01.x, p01.y, h, nf.x, nf.y, 0, fc[0], fc[1], fc[2]);
        pushVert(p11.x, p11.y, 0, nf.x, nf.y, 0, fc[0], fc[1], fc[2]);
        pushVert(p11.x, p11.y, h, nf.x, nf.y, 0, fc[0], fc[1], fc[2]);
        pushVert(p01.x, p01.y, h, nf.x, nf.y, 0, fc[0], fc[1], fc[2]);

        // Back Face (Normal: 0, -1)
        const nb = rotN(0, -1);
        const bc = [c[0]*0.9, c[1]*0.9, c[2]*0.9];
        pushVert(p10.x, p10.y, 0, nb.x, nb.y, 0, bc[0], bc[1], bc[2]);
        pushVert(p00.x, p00.y, 0, nb.x, nb.y, 0, bc[0], bc[1], bc[2]);
        pushVert(p10.x, p10.y, h, nb.x, nb.y, 0, bc[0], bc[1], bc[2]);
        pushVert(p00.x, p00.y, 0, nb.x, nb.y, 0, bc[0], bc[1], bc[2]);
        pushVert(p00.x, p00.y, h, nb.x, nb.y, 0, bc[0], bc[1], bc[2]);
        pushVert(p10.x, p10.y, h, nb.x, nb.y, 0, bc[0], bc[1], bc[2]);
    }

    cubeVertCount = verts.length / 9;
    gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.DYNAMIC_DRAW);
}
