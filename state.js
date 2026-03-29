export let GRID_W = 256;
export let GRID_H = 256;
export const TILE_W = 64;
export const TILE_H = 32;
export const ELEV_STEP = 6;
export const BUILD_SPRITES = 4;

export let elevations = new Uint8Array(GRID_W * GRID_H);
export let buildingAt = new Uint8Array(GRID_W * GRID_H);
export const customBuildingRegistry = [];
export const extrusions = [];
export const extrusionSettings = { width: 0.5, height: 2.0, altitude: 0.0, color: [0.5, 0.5, 0.5] };

export const cubes = [];
export const cubeSettings = { width: 4.0, length: 4.0, height: 10.0, rotation: 0.0, color: [1.0, 0.26, 0.26] };

export const SC3K_COLOR_STOPS = [
  { t:   0, c:[  0/255,  20/255,  60/255] },
  { t:  28, c:[  0/255,  55/255, 110/255] },
  { t:  50, c:[  0/255, 105/255, 165/255] },
  { t:  70, c:[ 62/255, 150/255, 185/255] },
  { t:  86, c:[195/255, 176/255, 120/255] },
  { t: 100, c:[ 70/255, 150/255,  70/255] },
  { t: 140, c:[ 50/255, 125/255,  55/255] },
  { t: 170, c:[120/255, 105/255,  70/255] },
  { t: 200, c:[110/255, 110/255, 110/255] },
  { t: 230, c:[170/255, 170/255, 175/255] },
  { t: 255, c:[240/255, 240/255, 242/255] },
];

export const mapSettings = {
  waterLevel: 86
};

export const camera = {
  panX: 0,
  panY: (256 + 256) * (32 * 0.25),
  zoom: 1.0,
  tilt: 1.0,
  rotation: 0,
  targetPanX: 0,
  targetPanY: (256 + 256) * (32 * 0.25),
  targetZoom: 1.0,
  targetTilt: 1.0,
  targetRotation: 0,
  minZoom: 0.1,
  maxZoom: 5.0,
  minTilt: 0.35,
  maxTilt: 2.0,
  lerpFactor: 0.15
};
export const selected = { has: false, x: 0, y: 0, id: 0 };
export const levelSel = { active: false, startX: 0, startY: 0, endX: 0, endY: 0, base: 0, pointerId: null };

export const paintStroke = {
  active: false,
  pointerId: null,
  delta: 0,
  lastX: -9999,
  lastY: -9999,
  touched: new Set(),
};

export const brush = { radius: 2, smooth: 0.25 };
export const appState = {
  toolMode: 'pan',
  showGrid: true,
  showUnderground: false,
  activeExtrusion: null,
  editPathNodeIndex: -1,
  activeCubeIndex: -1,
  activeCubeHandle: -1,
};

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function screenToWorld(sx, sy, canvasWidth, canvasHeight) {
  const wx = (sx - canvasWidth * 0.5) / camera.zoom + camera.panX;
  const wy = (sy - canvasHeight * 0.5) / camera.zoom + camera.panY;
  return [wx, wy];
}

export function tileCenterWorld(tx, ty, rotOverride = null) {
  const px = (tx + 0.5) - GRID_W * 0.5;
  const py = (ty + 0.5) - GRID_H * 0.5;
  const angle = rotOverride !== null ? rotOverride : camera.rotation;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const rx = px * c - py * s;
  const ry = px * s + py * c;

  const wx = (rx - ry) * (TILE_W * 0.5);
  const wy = (rx + ry) * (TILE_H * camera.tilt * 0.5);
  const h = elevations[ty * GRID_W + tx] || 0;
  const parallaxScalar = 0.5 + (0.5 / camera.tilt);
  return [wx, wy - (h * ELEV_STEP * parallaxScalar)];
}

export function screenToWorldAtRotation(sx, sy, canvasWidth, canvasHeight, rot) {
  const x = (sx - canvasWidth * 0.5) / camera.zoom;
  const y = (sy - canvasHeight * 0.5) / camera.zoom;
  return [x, y];
}

export function compileMath(expr) {
  if (!expr) return null;

  // 1. Character Whitelist: Only allow alphanumeric, spaces, and safe math symbols.
  // This explicitly blocks brackets [], braces {}, quotes "", and equals = to stop injection.
  const safeCharRegex = /^[a-zA-Z0-9_\s+\-*/%(),.]*$/;
  if (!safeCharRegex.test(expr)) {
    console.warn(`Snorb math compilation blocked due to unsafe characters in: "${expr}"`);
    return null;
  }

  // 2. Word Whitelist: Extract all letter-based identifiers.
  const words = expr.match(/\b[a-zA-Z_]\w*\b/g) || [];

  // Get all standard properties on the Math object (sin, cos, PI, E, etc.)
  const mathProps = Object.getOwnPropertyNames(Math);
  const allowedKeywords = new Set(['t', 'pi']);
  mathProps.forEach(p => allowedKeywords.add(p.toLowerCase()));

  // Ensure every single word typed belongs strictly to our approved whitelist
  for (const word of words) {
    if (!allowedKeywords.has(word.toLowerCase())) {
      console.warn(`Snorb math compilation blocked unsafe or unknown identifier: "${word}"`);
      return null;
    }
  }

  // 3. Transform shorthand math functions and constants into Math.xxxx
  const jsExpr = expr.replace(/\b[a-zA-Z_]\w*\b/g, (match) => {
    const lower = match.toLowerCase();
    if (lower === 't') return 't';
    if (lower === 'pi') return 'Math.PI';

    // Find the exact property in Math, respecting its original casing
    const mathProp = mathProps.find(p => p.toLowerCase() === lower);
    if (mathProp) {
      return `Math.${mathProp}`;
    }
    return match;
  });

  try {
    // Now that it's sanitized and verified, it is safe to evaluate
    return new Function('t', `try { return ${jsExpr}; } catch(e) { return 0; }`);
  } catch(e) {
    console.warn("Snorb math compilation failed for:", expr, e);
    return null;
  }
}

// --- 1. Core Serialization (Custom CSS-Like Format) ---

export function serializeMap() {
  let out = `map {\n  version: 2;\n  width: ${GRID_W};\n  height: ${GRID_H};\n  waterLevel: ${mapSettings.waterLevel};\n  showGrid: ${appState.showGrid};\n  showUnderground: ${appState.showUnderground};\n}\n\n`;

  out += `camera {\n  panX: ${camera.targetPanX};\n  panY: ${camera.targetPanY};\n  zoom: ${camera.targetZoom};\n  tilt: ${camera.targetTilt};\n  rotation: ${camera.rotation};\n}\n\n`;

  out += `brush {\n  radius: ${brush.radius};\n  smooth: ${brush.smooth};\n}\n\n`;

  if (customBuildingRegistry.length > 0) {
    out += `customBuildings {\n`;
    customBuildingRegistry.forEach((url, i) => { out += `  ${i}: ${url};\n`; });
    out += `}\n\n`;
  }

  cubes.forEach(c => {
    out += `cube {\n  x: ${c.x};\n  y: ${c.y};\n  w: ${c.w};\n  l: ${c.l !== undefined ? c.l : c.w};\n  h: ${c.h};\n  r: ${c.r || 0};\n  c: ${c.c.join(', ')};\n`;
    if (c.rawDeltas) {
      if (c.rawDeltas.x) out += `  dx: ${c.rawDeltas.x};\n`;
      if (c.rawDeltas.y) out += `  dy: ${c.rawDeltas.y};\n`;
      if (c.rawDeltas.w) out += `  dw: ${c.rawDeltas.w};\n`;
      if (c.rawDeltas.l) out += `  dl: ${c.rawDeltas.l};\n`;
      if (c.rawDeltas.h) out += `  dh: ${c.rawDeltas.h};\n`;
      if (c.rawDeltas.r) out += `  dr: ${c.rawDeltas.r};\n`;
      if (c.rawDeltas.c) out += `  dc: ${c.rawDeltas.c};\n`;
    }
    out += `}\n\n`;
  });

  extrusions.forEach(ext => {
    out += `path {\n  width: ${ext.width};\n  height: ${ext.height};\n  altitude: ${ext.altitude || 0};\n  color: ${ext.color.join(', ')};\n  points: ${ext.points.map(p => `${p.x},${p.y}`).join(' | ')};\n`;
    if (ext.rawDeltas) {
      if (ext.rawDeltas.w) out += `  dw: ${ext.rawDeltas.w};\n`;
      if (ext.rawDeltas.h) out += `  dh: ${ext.rawDeltas.h};\n`;
      if (ext.rawDeltas.a) out += `  da: ${ext.rawDeltas.a};\n`;
      if (ext.rawDeltas.c) out += `  dc: ${ext.rawDeltas.c};\n`;
      if (ext.rawDeltas.p) out += `  dp: ${ext.rawDeltas.p};\n`;
    }
    out += `}\n\n`;
  });

  out += `__DATA__\n`;

  // Pack elevations and buildingAt into a single binary buffer for compression
  const binLen = GRID_W * GRID_H;
  const combined = new Uint8Array(binLen * 2);
  combined.set(elevations, 0);
  combined.set(buildingAt, binLen);

  // Fast Uint8Array to Base64 in chunks (avoids stack overflow)
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < combined.length; i += chunk) {
    binary += String.fromCharCode.apply(null, combined.subarray(i, i + chunk));
  }
  out += btoa(binary);

  return out;
}

export function deserializeMap(text) {
  if (!text || typeof text !== 'string') return false;

  // Backward compatibility for old JSON saves
  if (text.trim().startsWith('{')) {
      try {
          return deserializeMapJSON(JSON.parse(text));
      } catch(e) { return false; }
  }

  try {
    const parts = text.split('__DATA__');
    const blocksText = parts[0];
    const b64 = parts[1] ? parts[1].trim() : '';

    const data = { extrusions: [], cubes: [], customBuildingRegistry: [], camera: {}, map: {}, brush: {} };
    const blockRegex = /(\w+)\s*{([^}]+)}/g;
    let match;
    
    // Parse the CSS-like text blocks
    while ((match = blockRegex.exec(blocksText)) !== null) {
      const type = match[1];
      const content = match[2];
      const props = {};

      // Strip out comments like `// Fluctuate the redness` so they don't corrupt properties
      const cleanContent = content.replace(/\/\/.*$/gm, '');
      cleanContent.split(';').forEach(line => {
        const colon = line.indexOf(':');
        if (colon === -1) return;
        props[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
      });

      if (type === 'map') Object.assign(data.map, props);
      else if (type === 'camera') Object.assign(data.camera, props);
      else if (type === 'brush') Object.assign(data.brush, props);
      else if (type === 'customBuildings') {
        Object.keys(props).forEach(k => { data.customBuildingRegistry[parseInt(k)] = props[k]; });
      }
      else if (type === 'cube') {
        const cube = {
          x: parseFloat(props.x), y: parseFloat(props.y),
          w: parseFloat(props.w), l: parseFloat(props.l), h: parseFloat(props.h),
          r: parseFloat(props.r), c: props.c.split(',').map(Number)
        };
        const rawDeltas = {};
        const fns = {};
        let hasAnim = false;

        if (props.dx) { rawDeltas.x = props.dx; fns.x = compileMath(props.dx); hasAnim = true; }
        if (props.dy) { rawDeltas.y = props.dy; fns.y = compileMath(props.dy); hasAnim = true; }
        if (props.dw) { rawDeltas.w = props.dw; fns.w = compileMath(props.dw); hasAnim = true; }
        if (props.dl) { rawDeltas.l = props.dl; fns.l = compileMath(props.dl); hasAnim = true; }
        if (props.dh) { rawDeltas.h = props.dh; fns.h = compileMath(props.dh); hasAnim = true; }
        if (props.dr) { rawDeltas.r = props.dr; fns.r = compileMath(props.dr); hasAnim = true; }
        if (props.dc) {
            rawDeltas.c = props.dc;
            fns.c = props.dc.split(',').map(s => compileMath(s.trim()));
            hasAnim = true;
        }

        if (hasAnim) {
            cube.rawDeltas = rawDeltas;
            cube.fns = fns;
        }

        data.cubes.push(cube);
      }
      else if (type === 'path') {
        const pathObj = {
          width: parseFloat(props.width), height: parseFloat(props.height), altitude: parseFloat(props.altitude),
          color: props.color.split(',').map(Number),
          points: props.points.split('|').map(p => {
              const [x,y] = p.split(',').map(Number);
              return {x, y};
          })
        };

        const rawDeltas = {};
        const fns = {};
        let hasAnim = false;

        if (props.dw) { rawDeltas.w = props.dw; fns.w = compileMath(props.dw); hasAnim = true; }
        if (props.dh) { rawDeltas.h = props.dh; fns.h = compileMath(props.dh); hasAnim = true; }
        if (props.da) { rawDeltas.a = props.da; fns.a = compileMath(props.da); hasAnim = true; }
        if (props.dc) {
            rawDeltas.c = props.dc;
            fns.c = props.dc.split(',').map(s => compileMath(s.trim()));
            hasAnim = true;
        }
        if (props.dp) {
            rawDeltas.p = props.dp;
            fns.p = props.dp.split('|').map(p => {
                const parts = p.split(',');
                return {
                    x: parts[0] && parts[0].trim() ? compileMath(parts[0].trim()) : null,
                    y: parts[1] && parts[1].trim() ? compileMath(parts[1].trim()) : null
                };
            });
            hasAnim = true;
        }

        if (hasAnim) {
            pathObj.rawDeltas = rawDeltas;
            pathObj.fns = fns;
        }

        data.extrusions.push(pathObj);
      }
    }

    const gw = parseInt(data.map.width || 256);
    const gh = parseInt(data.map.height || 256);
    resizeMapState(gw, gh);

    // Unpack Binary Data
    if (b64) {
      const binary = atob(b64);
      const binLen = gw * gh;
      for (let i = 0; i < binLen; i++) {
          elevations[i] = binary.charCodeAt(i);
          buildingAt[i] = binary.charCodeAt(binLen + i);
      }
    }

    // Restore Collections
    if (data.customBuildingRegistry) {
       customBuildingRegistry.length = 0;
       customBuildingRegistry.push(...data.customBuildingRegistry);
    }

    extrusions.length = 0;
    extrusions.push(...data.extrusions);
    cubes.length = 0;
    cubes.push(...data.cubes);

    // Restore Camera
    if (data.camera.zoom) {
      camera.panX = camera.targetPanX = parseFloat(data.camera.panX);
      camera.panY = camera.targetPanY = parseFloat(data.camera.panY);
      camera.zoom = camera.targetZoom = parseFloat(data.camera.zoom);
      camera.tilt = camera.targetTilt = parseFloat(data.camera.tilt || 1.0);
      camera.rotation = camera.targetRotation = parseFloat(data.camera.rotation || 0);
    }

    // Restore Settings
    mapSettings.waterLevel = parseInt(data.map.waterLevel || 86);
    const wEl = document.getElementById('waterLevel');
    if (wEl) wEl.value = mapSettings.waterLevel;

    appState.showGrid = data.map.showGrid !== 'false';
    appState.showUnderground = data.map.showUnderground === 'true';

    if (data.brush.radius) {
      brush.radius = parseInt(data.brush.radius);
      brush.smooth = parseFloat(data.brush.smooth);
      const rEl = document.getElementById('brushSize');
      const sEl = document.getElementById('brushSmooth');
      if (rEl) rEl.value = brush.radius;
      if (sEl) sEl.value = brush.smooth;
    }
    return true;
  } catch (e) {
    console.error("Failed to parse map text data", e);
    return false;
  }
}

// Backward Compatibility for loading older maps
function deserializeMapJSON(data) {
  if (!data || !data.elevations) return false;
  try {
    resizeMapState(data.grid.w, data.grid.h);
    elevations.set(data.elevations);
    buildingAt.set(data.buildingAt);

    if (data.customBuildingRegistry) {
       customBuildingRegistry.length = 0;
       customBuildingRegistry.push(...data.customBuildingRegistry);
       customBuildingRegistry.forEach(url => loadCustomTexture(url));
    }

    if (data.extrusions) { extrusions.length = 0; extrusions.push(...data.extrusions); }
    if (data.cubes) { cubes.length = 0; cubes.push(...data.cubes); }

    if (data.camera) {
      camera.panX = camera.targetPanX = data.camera.panX;
      camera.panY = camera.targetPanY = data.camera.panY;
      camera.zoom = camera.targetZoom = data.camera.zoom;
      camera.tilt = camera.targetTilt = data.camera.tilt !== undefined ? data.camera.tilt : 1.0;
      camera.rotation = camera.targetRotation = data.camera.rotation || 0;
    }

    mapSettings.waterLevel = data.waterLevel || 86;
    const wEl = document.getElementById('waterLevel');
    if (wEl) wEl.value = mapSettings.waterLevel;

    if (data.showGrid !== undefined) appState.showGrid = data.showGrid;
    if (data.showUnderground !== undefined) appState.showUnderground = data.showUnderground;

    if (data.brush) {
      brush.radius = data.brush.radius;
      brush.smooth = data.brush.smooth;
      const rEl = document.getElementById('brushSize');
      const sEl = document.getElementById('brushSmooth');
      if (rEl) rEl.value = brush.radius;
      if (sEl) sEl.value = brush.smooth;
    }

    return true;
  } catch (e) {
    console.error("Failed to parse map data JSON", e);
    return false;
  }
}

export function resizeMapState(width, height) {
  GRID_W = width;
  GRID_H = height;
  elevations = new Uint8Array(GRID_W * GRID_H);
  buildingAt = new Uint8Array(GRID_W * GRID_H);
  extrusions.length = 0;
  cubes.length = 0;
  appState.activeExtrusion = null;
}

