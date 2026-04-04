import {
  GRID_W,
  GRID_H,
  TILE_W,
  TILE_H,
  ELEV_STEP,
  clamp,
  elevations,
  buildingAt,
  paintStroke,
  brush,
  BUILD_SPRITES,
  selected,
  levelSel,
  camera,
  tileCenterWorld,
  customBuildingRegistry,
  extrusions,
  extrusionSettings,
  appState,
  cubes,
  cubeSettings,
  lemmings,
  mapSettings,
} from './state.js';
import {
  canvas,
  uploadElevations,
  rebuildBuildingInstances,
  requestPick,
  loadCustomTexture,
  rebuildExtrusionBuffers,
  rebuildCubeBuffers,
} from './renderer.js';
import { saveMapToLocal } from './main.js';

export function seedDemo(config = null) {
  const cx = Math.floor(GRID_W * 0.5), cy = Math.floor(GRID_H * 0.5);

  // Default to the original island look if no config is provided
  const cfg = config || { canyons: 0, islands: 80, valleys: 0, beaches: 0, deserts: 0, mountains: 0, erosion: 0 };

  const c_canyon = cfg.canyons / 100;
  const c_island = cfg.islands / 100;
  const c_valley = cfg.valleys / 100;
  const c_beach = cfg.beaches / 100;
  const c_desert = cfg.deserts / 100;
  const c_mountain = cfg.mountains / 100;
  const c_erosion = cfg.erosion / 100;

  // Random offsets ensure a unique map every time
  const ox = Math.random() * 10000;
  const oy = Math.random() * 10000;

  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const nx = x + ox;
      const ny = y + oy;

      // Base island falloff (distance from center)
      const r = Math.hypot((x - cx) / GRID_W, (y - cy) / GRID_H);
      const islandFactor = c_island > 0 ? 1.0 - (r * (3.0 - c_island * 1.5)) : 1.0;
      let h = c_island > 0 ? Math.max(0, islandFactor) * 120 : 86;

      // Noise layers for structural variety
      const nLow = (Math.sin(nx * 0.03) * Math.cos(ny * 0.02) + Math.sin((nx + ny) * 0.015)) * 0.5;
      const nMid = (Math.sin(nx * 0.09) * Math.cos(ny * 0.07) + Math.sin((nx - ny) * 0.05)) * 0.5;
      const nHigh = (Math.sin(nx * 0.2) * Math.cos(ny * 0.15)) * 0.5;

      // Mountains (High amplitude, low frequency)
      h += Math.max(0, nLow) * c_mountain * 200;
      h += nMid * c_mountain * 50;

      // Valleys (Carve out low-frequency trenches)
      h -= Math.max(0, nLow) * c_valley * 100;

      // Canyons (Sharp inverted ridges)
      const canyonRidge = Math.abs(nMid);
      if (c_canyon > 0 && canyonRidge < 0.15) {
        h -= (0.15 - canyonRidge) * 10 * c_canyon * 120;
      }

      // Deserts (High frequency dunes)
      if (c_desert > 0) {
         h += nHigh * c_desert * 25;
      }

      // Beaches (Flatten out terrain near the water line)
      if (c_beach > 0) {
         const distToWater = Math.abs(h - 86);
         if (distToWater < 30 * c_beach) {
             h = 86 + (Math.sign(h - 86) * distToWater * (1.0 - c_beach));
         }
      }

      // Erosion (Finer detail, following contours via domain warping)
      if (c_erosion > 0 && h > 86) {
         const altitudeFactor = (h - 86) / 100;

         // Warp the coordinates using the underlying mountain noise to make gullies curve with the terrain
         const wx = nx + (nMid * 25);
         const wy = ny + (nLow * 25);

         // Sample a higher frequency noise for finer grained detail
         const nFine = Math.sin(wx * 0.55) * Math.cos(wy * 0.55);

         // Create sharp, narrow crevices by squaring the inverted absolute noise
         const gully = 1.0 - Math.abs(nFine);

         // Subtract the gully depth, scaling by altitude and erosion slider
         h -= (gully * gully) * altitudeFactor * c_erosion * 65;
      }

      // Base surface texture (From original)
      h += (nMid + 1) * 18;

      elevations[y * GRID_W + x] = clamp(Math.floor(h), 0, 255);
    }
  }
}

export function brushApplyDelta(cx, cy, delta) {
  const r = Math.max(1, brush.radius | 0);
  const step = Math.max(1, Math.abs(delta) | 0);
  for (let oy = -r; oy <= r; oy++) {
    for (let ox = -r; ox <= r; ox++) {
      const x = cx + ox, y = cy + oy;
      if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) continue;
      if (ox * ox + oy * oy > r * r) continue;
      const i = y * GRID_W + x;
      const w = Math.max(0.15, 1.0 - (Math.sqrt(ox * ox + oy * oy) / (r + 0.0001)));
      elevations[i] = clamp(elevations[i] + (delta >= 0 ? 1 : -1) * Math.max(1, Math.round(step * w)), 0, 255);
      paintStroke.touched.add(i);
    }
  }
  uploadElevations();
  saveMapToLocal();
}

export function brushSmoothTouched(cx, cy) {
  const r = Math.max(1, brush.radius | 0);
  const strength = brush.smooth || 0.25;

  // 1. Identify all tiles in the brush radius
  const affectedIndices = [];
  for (let oy = -r; oy <= r; oy++) {
    for (let ox = -r; ox <= r; ox++) {
      const x = cx + ox, y = cy + oy;
      if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) continue;
      if (ox * ox + oy * oy > r * r) continue;
      affectedIndices.push(y * GRID_W + x);
    }
  }

  // 2. Calculate new smoothed values for these tiles
  const newValues = new Map();
  for (const i of affectedIndices) {
    const x = i % GRID_W, y = (i / GRID_W) | 0;
    let sum = 0, count = 0;

    // Look at 4-neighbors
    const neighbors = [[0,1], [0,-1], [1,0], [-1,0]];
    for (const [nx, ny] of neighbors) {
      const tx = x + nx, ty = y + ny;
      if (tx >= 0 && tx < GRID_W && ty >= 0 && ty < GRID_H) {
        sum += elevations[ty * GRID_W + tx];
        count++;
      }
    }

    const avg = count > 0 ? sum / count : elevations[i];
    // Blend current elevation with neighbor average based on brush smoothness
    newValues.set(i, Math.round(elevations[i] * (1 - strength) + (avg * strength)));
  }

  // 3. Apply changes
  for (const [idx, val] of newValues) {
    elevations[idx] = clamp(val, 0, 255);
  }

  uploadElevations();
  saveMapToLocal();
}

export function commitLevelSelection() {
  if (!levelSel.active) return;
  const h = clamp(levelSel.base, 0, 255);
  for (let y = Math.min(levelSel.startY, levelSel.endY); y <= Math.max(levelSel.startY, levelSel.endY); y++) {
    for (let x = Math.min(levelSel.startX, levelSel.endX); x <= Math.max(levelSel.startX, levelSel.endX); x++) {
      elevations[y * GRID_W + x] = h;
    }
  }
  uploadElevations();
  saveMapToLocal();
  levelSel.active = false;
  levelSel.pointerId = null;
}

export function placeBuildingAtSelected() {
  if (selected.has) {
    buildingAt[selected.id] = ((Math.random() * BUILD_SPRITES) | 0) + 1;
    rebuildBuildingInstances();
    saveMapToLocal();
  }
}

export function getHighlightedTile() {
  if (!selected.has) return null;

  // Get world position of the tile center
  const [wx, wy] = tileCenterWorld(selected.x, selected.y);

  // Convert world position to screen pixels (reverse of screenToWorld)
  const screenX = (wx - camera.panX) * camera.zoom + canvas.width * 0.5;
  const screenY = (wy - camera.panY) * camera.zoom + canvas.height * 0.5;

  return { 
    x: selected.x, 
    y: selected.y, 
    screenX, 
    screenY 
  };
}

export function setTileScreenPosition(tx, ty, sx, sy) {
  // 1. Find the world-space center of the target tile
  const [wx, wy] = tileCenterWorld(tx, ty);

  // 2. Determine where that world point needs to be relative to the camera
  // to result in the desired screen pixel (sx, sy).
  // Formula: sx = (wx - panX) * zoom + (canvasWidth / 2)
  // Rearranged for panX: panX = wx - (sx - canvasWidth / 2) / zoom
  const targetPanX = wx - (sx - canvas.width * 0.5) / camera.zoom;
  const targetPanY = wy - (sy - canvas.height * 0.5) / camera.zoom;

  // 3. Update camera targets to glide to the new position
  camera.targetPanX = camera.panX = targetPanX;
  camera.targetPanY = camera.panY = targetPanY;

  // 4. Update the selection highlight to this tile immediately
  requestPick(sx, sy);
}

export function getTileScreenPos(tx, ty) {
  const px = (tx + 0.5) - GRID_W * 0.5;
  const py = (ty + 0.5) - GRID_H * 0.5;
  const c = Math.cos(camera.rotation);
  const s = Math.sin(camera.rotation);
  const rx = px * c - py * s;
  const ry = px * s + py * c;

  const worldX = (rx - ry) * (TILE_W * 0.5);
  const worldY = (rx + ry) * (TILE_H * camera.tilt * 0.5);
  const h = elevations[ty * GRID_W + tx] || 0;

  const parallaxScalar = 0.5 + (0.5 / camera.tilt);
  const elevatedWorldY = worldY - (h * ELEV_STEP * parallaxScalar);
  const screenX = (worldX - camera.panX) * camera.zoom + (canvas.width * 0.5);
  const screenY = (elevatedWorldY - camera.panY) * camera.zoom + (canvas.height * 0.5);
  return [screenX, screenY];
}

export function setTileInCenter(tx, ty) {
  setTileScreenPosition(tx, ty, canvas.width * 0.5, canvas.height * 0.5);
}

export function setHighlightedTile(x, y) {
  const { tileCenterWorld, camera, canvas } = require('./state.js');
  const { requestPick } = require('./renderer.js');

  // 1. Find the world position of this tile
  const [wx, wy] = tileCenterWorld(x, y);

  // 2. Convert that world position back to screen coordinates (pixels)
  // Inverse of: screenToWorld = (sx - canvasWidth * 0.5) / camera.zoom + camera.panX
  const sx = (wx - camera.panX) * camera.zoom + canvas.width * 0.5;
  const sy = (wy - camera.panY) * camera.zoom + canvas.height * 0.5;

  // 3. Trigger the GPU-based picking logic at those coordinates
  requestPick(sx, sy);
}

export function placeCustomBuildingAtSelected(input) {
  if (!selected.has) return;

  // Split input by commas and pick one random URL
  const urls = input.split(',').map(u => u.trim()).filter(u => u.length > 0);
  if (urls.length === 0) return;

  const url = urls[Math.floor(Math.random() * urls.length)];

  // Add the specific URL to the registry if it doesn't exist yet
  let idx = customBuildingRegistry.indexOf(url);
  if (idx === -1) {
    customBuildingRegistry.push(url);
    idx = customBuildingRegistry.length - 1;
    loadCustomTexture(url);
  }

  buildingAt[selected.id] = BUILD_SPRITES + 1 + idx;
  rebuildBuildingInstances();
  saveMapToLocal();
}

export function removeBuildingAtSelected(cx, cy) {
  const r = Math.max(0, (brush.radius - 1) | 0); // Use brush radius
  for (let oy = -r; oy <= r; oy++) {
    for (let ox = -r; ox <= r; ox++) {
      const x = cx + ox, y = cy + oy;
      if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) continue;
      if (ox * ox + oy * oy > r * r) continue;

      const idx = y * GRID_W + x;
      buildingAt[idx] = 0; // Clear building
    }
  }
  rebuildBuildingInstances(); // Update GPU
  saveMapToLocal(); // Persist changes
}

export function brushForest(cx, cy, input) {
  const r = Math.max(1, brush.radius | 0);
  const density = brush.smooth || 0.25;

  // Parse URLs once before the loop for efficiency
  const urls = input.split(',').map(u => u.trim()).filter(u => u.length > 0);
  if (urls.length === 0) return;

  for (let oy = -r; oy <= r; oy++) {
    for (let ox = -r; ox <= r; ox++) {
      const x = cx + ox, y = cy + oy;

      if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) continue;
      if (ox * ox + oy * oy > r * r) continue;

      if (Math.random() < density) {
        // Randomly pick a URL for this specific tile
        const url = urls[Math.floor(Math.random() * urls.length)];

        let idx = customBuildingRegistry.indexOf(url);
        if (idx === -1) {
          customBuildingRegistry.push(url);
          idx = customBuildingRegistry.length - 1;
          loadCustomTexture(url);
        }

        buildingAt[y * GRID_W + x] = BUILD_SPRITES + 1 + idx;
      }
    }
  }

  rebuildBuildingInstances();
  saveMapToLocal();
}

export function appendExtrusionPoint(x, y) {
    if (!appState.activeExtrusion) {
        appState.activeExtrusion = {
          points: [{x, y}],
          width: extrusionSettings.width,
          height: extrusionSettings.height,
          altitude: extrusionSettings.altitude || 0,
          color: [...extrusionSettings.color]
        };
        extrusions.push(appState.activeExtrusion);
    } else {
        const ext = appState.activeExtrusion;
        const pts = ext.points;
        if (pts[pts.length - 1].x !== x || pts[pts.length - 1].y !== y) {
            // Collision Check!
            if (isSegmentColliding(pts[pts.length - 1], {x, y}, ext, ext)) {
                return; // Abort appending this point due to overlap
            }
            pts.push({x, y});
        }
    }
    rebuildExtrusionBuffers();
    saveMapToLocal();
}

export function finishExtrusion() {
    appState.activeExtrusion = null;
}

// --- Edit Path Math Utilities & State ---
let lastNodeClickTime = 0;
let lastClickedNodeIndex = -1;

function distSq(p1, p2) { return (p1.x - p2.x)**2 + (p1.y - p2.y)**2; }
function distToSegmentSq(p, v, w) {
    const l2 = distSq(v, w);
    if (l2 === 0) return distSq(p, v);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return distSq(p, { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) });
}

// Helper to determine if a newly proposed segment intersects or gets too close to an existing segment
function isSegmentColliding(pA, pB, extA, excludeExt) {
    return false; // Disable collision detection
    const altA = extA.altitude || 0;
    const hA = extA.height;
    const samples = Math.max(2, Math.ceil(Math.sqrt(distSq(pA, pB)) * 2));

    for (const extB of extrusions) {
        if (extB === excludeExt) continue;

        const altB = extB.altitude || 0;
        const hB = extB.height;
        // Z Overlap check. If they don't overlap vertically, they don't collide.
        if (Math.max(altA, altB) >= Math.min(altA + hA, altB + hB)) {
            continue;
        }

        const minDistSq = Math.pow((extA.width + extB.width) / 2 + 0.5, 2);
        for (let j = 0; j < extB.points.length - 1; j++) {
            for (let i = 0; i <= samples; i++) {
                const t = i / samples;
                const pt = { x: pA.x + t * (pB.x - pA.x), y: pA.y + t * (pB.y - pA.y) };
                if (distToSegmentSq(pt, extB.points[j], extB.points[j+1]) < minDistSq) {
                    return true;
                }
            }
        }
    }
    return false;
}

export function editPathDown(tx, ty, button) {
    const pt = {x: tx, y: ty};

    // Find the closest existing node first (Magnetic grab)
    let clickedNodeIdx = -1;
    let minNodeDist = 25.0; // 5-tile radius

    if (appState.activeExtrusion) {
        const pts = appState.activeExtrusion.points;
        for (let i = 0; i < pts.length; i++) {
            const d = distSq(pt, pts[i]);
            if (d < minNodeDist) {
                minNodeDist = d;
                clickedNodeIdx = i;
            }
        }
    }

    // Right Click: Deletion Logic (Desktop)
    if (button === 2) {
        if (appState.activeExtrusion && clickedNodeIdx !== -1) {
            const pts = appState.activeExtrusion.points;
            pts.splice(clickedNodeIdx, 1);
            // Remove entire path if 1 or 0 nodes are left
            if (pts.length < 2) {
                const extIdx = extrusions.indexOf(appState.activeExtrusion);
                if (extIdx > -1) extrusions.splice(extIdx, 1);
                appState.activeExtrusion = null;
            }
            rebuildExtrusionBuffers();
            saveMapToLocal();
        }
        return;
    }

    // Left Click / Tap: Interaction Logic
    if (appState.activeExtrusion) {
        const pts = appState.activeExtrusion.points;

        // 1. Check if clicking an existing node (Prioritize this over edge insertion)
        if (clickedNodeIdx !== -1) {
            const now = Date.now();

            // Double-tap deletion logic for Mobile (and Desktop alternative)
            if (clickedNodeIdx === lastClickedNodeIndex && now - lastNodeClickTime < 400) {
                pts.splice(clickedNodeIdx, 1);
                if (pts.length < 2) {
                    const extIdx = extrusions.indexOf(appState.activeExtrusion);
                    if (extIdx > -1) extrusions.splice(extIdx, 1);
                    appState.activeExtrusion = null;
                }
                lastClickedNodeIndex = -1; // reset
                appState.editPathNodeIndex = -1;
                rebuildExtrusionBuffers();
                saveMapToLocal();
                return;
            }

            // Normal selection for dragging
            lastClickedNodeIndex = clickedNodeIdx;
            lastNodeClickTime = now;
            appState.editPathNodeIndex = clickedNodeIdx;
            return;
        }

        // 2. Check if clicking on an edge (Insert new node)
        let insertIdx = -1;
        let minEdgeDist = 2.0; // Tolerance for edge insertion
        for (let i = 0; i < pts.length - 1; i++) {
            const d = distToSegmentSq(pt, pts[i], pts[i+1]);
            if (d < minEdgeDist) {
                minEdgeDist = d;
                insertIdx = i + 1;
            }
        }

        if (insertIdx !== -1) {
            pts.splice(insertIdx, 0, {x: tx, y: ty});
            appState.editPathNodeIndex = insertIdx;

            // Register this as the last clicked node so rapid clicking doesn't accidentally delete it
            lastClickedNodeIndex = insertIdx;
            lastNodeClickTime = Date.now();

            rebuildExtrusionBuffers();
            return;
        }

        // 3. Check if clicking near the absolute start/end to extend
        if (pts.length > 0) {
            const dStart = distSq(pt, pts[0]);
            const dEnd = distSq(pt, pts[pts.length - 1]);
            if (dStart <= 16 || dEnd <= 16) { // 4 tiles radius limit to append
                if (dStart < dEnd) {
                    if (isSegmentColliding({x: tx, y: ty}, pts[0], appState.activeExtrusion, appState.activeExtrusion)) return;
                    pts.unshift({x: tx, y: ty});
                    appState.editPathNodeIndex = 0;
                } else {
                    if (isSegmentColliding(pts[pts.length - 1], {x: tx, y: ty}, appState.activeExtrusion, appState.activeExtrusion)) return;
                    pts.push({x: tx, y: ty});
                    appState.editPathNodeIndex = pts.length - 1;
                }
                rebuildExtrusionBuffers();
                return;
            }
        }
    }

    // 4. Clicked away from active path. Try selecting a new path!
    let closestExt = null;
    let closestDist = 4.0;
    for (const ext of extrusions) {
        for (let i = 0; i < ext.points.length - 1; i++) {
            const d = distToSegmentSq(pt, ext.points[i], ext.points[i+1]);
            if (d < closestDist) {
                closestDist = d;
                closestExt = ext;
            }
        }
    }

    appState.activeExtrusion = closestExt;
    appState.editPathNodeIndex = -1;
    lastClickedNodeIndex = -1;

    if (closestExt) {
        syncExtrusionUI(closestExt);
    }
}

export function editPathDrag(tx, ty) {
    if (appState.activeExtrusion && appState.editPathNodeIndex >= 0) {
        const ext = appState.activeExtrusion;
        const pts = ext.points;
        const idx = appState.editPathNodeIndex;

        if (pts[idx].x !== tx || pts[idx].y !== ty) {
            const oldX = pts[idx].x;
            const oldY = pts[idx].y;
            pts[idx].x = tx;
            pts[idx].y = ty;

            // Enforce Collision while dragging
            let collides = false;
            if (idx > 0 && isSegmentColliding(pts[idx-1], pts[idx], ext, ext)) collides = true;
            if (!collides && idx < pts.length - 1 && isSegmentColliding(pts[idx], pts[idx+1], ext, ext)) collides = true;

            if (collides) {
                pts[idx].x = oldX;
                pts[idx].y = oldY; // Revert Drag
            } else {
                rebuildExtrusionBuffers();
            }
        }
    }
}

export function syncExtrusionUI(ext) {
    if (!ext) return;

    // 1. Update internal state
    extrusionSettings.width = ext.width;
    extrusionSettings.height = ext.height;
    extrusionSettings.altitude = ext.altitude || 0;
    extrusionSettings.color = [...ext.color];

    // 2. Update DOM elements
    const wEl = document.getElementById('exWidth');
    const hEl = document.getElementById('exHeight');
    const aEl = document.getElementById('exAltitude');
    const cEl = document.getElementById('exColor');

    if (wEl) wEl.value = ext.width;
    if (hEl) hEl.value = ext.height;
    if (aEl) aEl.value = ext.altitude || 0;
    if (cEl) {
        // Convert Float RGB to Hex for the color input
        const r = Math.round(ext.color[0] * 255).toString(16).padStart(2, '0');
        const g = Math.round(ext.color[1] * 255).toString(16).padStart(2, '0');
        const b = Math.round(ext.color[2] * 255).toString(16).padStart(2, '0');
        cEl.value = `#${r}${g}${b}`;
    }
}

export function placeCubeAt(x, y) {
    if (!selected.has) return;
    cubes.push({
        x, y,
        w: cubeSettings.width,
        l: cubeSettings.length,
        h: cubeSettings.height,
        r: cubeSettings.rotation,
        c: [...cubeSettings.color]
    });
    rebuildCubeBuffers();
    saveMapToLocal();
}

// Helper: Check if point tx,ty is inside a rotated cube
function isInsideCube(tx, ty, c) {
    const dx = tx - c.x;
    const dy = ty - c.y;
    const cosR = Math.cos(c.r || 0);
    const sinR = Math.sin(c.r || 0);
    const lx = dx * cosR + dy * sinR;
    const ly = -dx * sinR + dy * cosR;
    return Math.abs(lx) <= c.w / 2 && Math.abs(ly) <= (c.l !== undefined ? c.l : c.w) / 2;
}

export function removeCubeAt(x, y) {
    let closestIdx = -1;
    for (let i = 0; i < cubes.length; i++) {
        if (isInsideCube(x, y, cubes[i])) {
            closestIdx = i;
            break;
        }
    }

    if (closestIdx !== -1) {
        cubes.splice(closestIdx, 1);
        if (appState.activeCubeIndex === closestIdx) appState.activeCubeIndex = -1;
        rebuildCubeBuffers();
        saveMapToLocal();
    }
}

export function editCubeDown(tx, ty, button) {
    appState.activeCubeHandle = -1;

    // Right Click: Deletion
    if (button === 2) {
        if (appState.activeCubeIndex >= 0 && isInsideCube(tx, ty, cubes[appState.activeCubeIndex])) {
            cubes.splice(appState.activeCubeIndex, 1);
            appState.activeCubeIndex = -1;
            rebuildCubeBuffers();
            saveMapToLocal();
        }
        return;
    }

    let clickedIdx = -1;
    let handleIdx = -1;
    let minDist = 25.0; // 5-tile radius

    // 1. Check if clicking handles of the currently active cube
    if (appState.activeCubeIndex >= 0 && cubes[appState.activeCubeIndex]) {
        const c = cubes[appState.activeCubeIndex];
        const hw = c.w / 2, hl = (c.l !== undefined ? c.l : c.w) / 2;
        const c_rot = Math.cos(c.r || 0), s_rot = Math.sin(c.r || 0);
        const rot = (lx, ly) => ({ x: c.x + lx*c_rot - ly*s_rot, y: c.y + lx*s_rot + ly*c_rot });

        const handles = [
            rot(0, 0),       // 0: Center
            rot(-hw, -hl),   // 1: Top-Left
            rot(hw, -hl),    // 2: Top-Right
            rot(-hw, hl),    // 3: Bottom-Left
            rot(hw, hl)      // 4: Bottom-Right
        ];

        for (let i = 0; i < handles.length; i++) {
            const dSq = (tx - handles[i].x)**2 + (ty - handles[i].y)**2;
            if (dSq < minDist) {
                minDist = dSq;
                clickedIdx = appState.activeCubeIndex;
                handleIdx = i;
            }
        }
    }

    // 2. If no handle clicked, check if clicking inside ANY cube to select it
    if (handleIdx === -1) {
        for (let i = cubes.length - 1; i >= 0; i--) {
            if (isInsideCube(tx, ty, cubes[i])) {
                clickedIdx = i;
                handleIdx = 0; // Default to moving it if clicked inside
                break;
            }
        }
    }

    appState.activeCubeIndex = clickedIdx;
    appState.activeCubeHandle = handleIdx;

    if (clickedIdx !== -1) {
        syncCubeUI(cubes[clickedIdx]);
    }
}

export function editCubeDrag(tx, ty) {
    if (appState.activeCubeIndex >= 0 && appState.activeCubeHandle >= 0) {
        const c = cubes[appState.activeCubeIndex];
        
        if (appState.activeCubeHandle === 0) {
            // Moving the center
            c.x = tx;
            c.y = ty;
        } else {
            // Resizing from a corner (symmetrical scale around center)
            const dx = tx - c.x;
            const dy = ty - c.y;
            const cosR = Math.cos(c.r || 0);
            const sinR = Math.sin(c.r || 0);
            // Project mouse back into local unrotated space
            const lx = dx * cosR + dy * sinR;
            const ly = -dx * sinR + dy * cosR;
            
            c.w = Math.max(1.0, Math.abs(lx) * 2);
            c.l = Math.max(1.0, Math.abs(ly) * 2);
        }
        
        syncCubeUI(c);
        rebuildCubeBuffers();
    }
}

export function syncCubeUI(cube) {
    if (!cube) return;
    cubeSettings.width = cube.w;
    cubeSettings.length = cube.l !== undefined ? cube.l : cube.w;
    cubeSettings.height = cube.h;
    cubeSettings.rotation = cube.r || 0;
    cubeSettings.color = [...cube.c];

    const wEl = document.getElementById('cbWidth');
    const lEl = document.getElementById('cbLength');
    const hEl = document.getElementById('cbHeight');
    const rEl = document.getElementById('cbRotation');
    const cEl = document.getElementById('cbColor');

    if (wEl) wEl.value = cube.w;
    if (lEl) lEl.value = cubeSettings.length;
    if (hEl) hEl.value = cube.h;
    if (rEl) rEl.value = cubeSettings.rotation;
    if (cEl) {
        const r = Math.round(cube.c[0] * 255).toString(16).padStart(2, '0');
        const g = Math.round(cube.c[1] * 255).toString(16).padStart(2, '0');
        const b = Math.round(cube.c[2] * 255).toString(16).padStart(2, '0');
        cEl.value = `#${r}${g}${b}`;
    }
}

export function placeLemmingAt(x, y) {
    lemmings.push({
        x: x + 0.5,
        y: y + 0.5,
        a: Math.random() * Math.PI * 2,           // Angle
        s: 1.5 + Math.random() * 2.5,             // Speed
        c: [Math.random(), Math.random(), Math.random()], // Color
        hasBuilt: false,
        hasResource: false,
        resourceId: 0,
        isDigging: false,
        digTimer: 0,
        digAccumulator: 0,
        isRaising: false,
        raiseTimer: 0,
        raiseAccumulator: 0,
        isDancing: false,
        danceTimer: 0,
        danceRestTimer: 0,
        grownUp: false,
    });
}

export function updateLemmings(dt) {
    let buildingsChanged = false;
    let terrainChanged = false;

    // --- OPTIMIZATION 1: Cache Obstacle Data ---
    // Precalculate trig and bounding boxes for cubes once per frame
    // rather than calculating them inside the lemming loop.
    const cubeCache = cubes.map(c => {
        const cosR = Math.cos(c.r || 0);
        const sinR = Math.sin(c.r || 0);
        const hw = c.w / 2;
        const hl = (c.l !== undefined ? c.l : c.w) / 2;
        const radius = Math.hypot(hw, hl); // For quick circle intersection rejection
        return { c, cosR, sinR, hw, hl, radius, lemmingsInside: 0 };
    });

    const extCache = extrusions.map(ext => {
        return { ext, minSqDist: Math.pow(ext.width / 2 + 0.2, 2) };
    });

    for (let lem of lemmings) {
        // --- TICK REST TIMER ---
        if (lem.danceRestTimer > 0) {
            lem.danceRestTimer -= dt;
        }
        // --- DANCER STATE LOGIC ---
        if (lem.isDancing) {
            lem.danceTimer -= dt;
            if (lem.danceTimer <= 0) {
                lem.isDancing = false;
                // Give them a 15-30 second break before they can dance again
                lem.danceRestTimer = 15.0 + Math.random() * 15.0;
            } else {
                // Infect nearby lemmings with the groove and merge colors
                for (let other of lemmings) {
                    if (lem === other) continue;
                    const dSq = (lem.x - other.x)**2 + (lem.y - other.y)**2;
                    if (dSq < 9.0) {
                        // Only infect if they are NOT resting
                        if (!other.isDancing && !other.isDigging && !other.isRaising && (other.danceRestTimer || 0) <= 0) {
                            other.isDancing = true;
                            other.danceTimer = 4.0 + Math.random() * 6.0;
                        }
                        if (other.isDancing) {
                            const blend = 0.5 * dt;
                            lem.c[0] += (other.c[0] - lem.c[0]) * blend;
                            lem.c[1] += (other.c[1] - lem.c[1]) * blend;
                            lem.c[2] += (other.c[2] - lem.c[2]) * blend;
                        }
                    }
                }
            }
            continue;
        }
        // --- DIGGER STATE LOGIC ---
        if (lem.isDigging) {
            lem.digTimer -= dt;
            lem.digAccumulator = (lem.digAccumulator || 0) + dt;

            // Lower the terrain every 0.5 seconds
            if (lem.digAccumulator >= 0.5) {
                lem.digAccumulator = 0;
                const cX = Math.floor(lem.x), cY = Math.floor(lem.y);
                const idx = cY * GRID_W + cX;

                // Dig down until they hit water
                if (elevations[idx] > mapSettings.waterLevel) {
                    elevations[idx] = Math.max(0, elevations[idx] - 1);
                    terrainChanged = true;
                } else {
                    lem.digTimer = 0; // Stop digging if they hit the water table
                }
            }

            if (lem.digTimer <= 0) {
                lem.isDigging = false;
            }
            continue; // Skip movement while digging
        }
        // --- PATH MAKER / RAISER STATE LOGIC ---
        if (lem.isRaising) {
            lem.raiseTimer -= dt;
            lem.raiseAccumulator = (lem.raiseAccumulator || 0) + dt;

            if (lem.raiseAccumulator >= 0.5) {
                lem.raiseAccumulator = 0;

                // Calculate the tile 1 unit forward
                let nx = lem.x + Math.cos(lem.a);
                let ny = lem.y + Math.sin(lem.a);

                if (nx >= 0 && nx < GRID_W - 1 && ny >= 0 && ny < GRID_H - 1) {
                    const cX = Math.floor(lem.x), cY = Math.floor(lem.y);
                    const nX = Math.floor(nx), nY = Math.floor(ny);
                    const currentIdx = cY * GRID_W + cX;
                    const nextIdx = nY * GRID_W + nX;

                    // Target height is either current height or just above water, whichever is higher
                    const targetH = Math.max(elevations[currentIdx], mapSettings.waterLevel + 1);

                    if (elevations[nextIdx] < targetH) {
                        elevations[nextIdx] = targetH;
                        terrainChanged = true;
                    } else if (elevations[nextIdx] - elevations[currentIdx] > 5) {
                        // Stop building and turn around if they hit a massive cliff
                        lem.isRaising = false;
                        lem.a += Math.PI;
                        continue;
                    }

                    // Step forward onto the newly created path
                    lem.x = nx;
                    lem.y = ny;
                } else {
                    lem.a += Math.PI; // Turn around if hitting the world edge
                }
            }

            if (lem.raiseTimer <= 0) {
                lem.isRaising = false;
            }
            continue; // Skip normal movement
        }

        // --- NORMAL WANDERING LOGIC ---
        let nx = lem.x + Math.cos(lem.a) * lem.s * dt;
        let ny = lem.y + Math.sin(lem.a) * lem.s * dt;

        if (nx < 0 || nx >= GRID_W - 1 || ny < 0 || ny >= GRID_H - 1) {
            lem.a += Math.PI;
            continue;
        }

        const cX = Math.floor(lem.x), cY = Math.floor(lem.y);
        const nX = Math.floor(nx), nY = Math.floor(ny);

        // Demolish logic
        if (!lem.hasBuilt && !lem.hasResource && buildingAt[cY * GRID_W + cX] > 0) {
            lem.resourceId = buildingAt[cY * GRID_W + cX]; // Save exactly what they picked up
            buildingAt[cY * GRID_W + cX] = 0;
            lem.hasResource = true;
            buildingsChanged = true;
        }
        // Recreate logic (Random chance to drop the resource if they are holding one)
        else if (lem.hasResource && lem.resourceId > 0 && buildingAt[cY * GRID_W + cX] === 0) {
            if (Math.random() < 0.5 * dt) {
                buildingAt[cY * GRID_W + cX] = lem.resourceId;
                lem.resourceId = 0; // Consume the stored block so they only place it once
                // Note: we do NOT reset lem.hasResource = false, so they still retain their ability to build a house!
                buildingsChanged = true;
            }
        }

        const currentH = elevations[cY * GRID_W + cX];
        const nextH = elevations[nY * GRID_W + nX];

        let hitObstacle = false;

        // Optimized Path check
        for (const cache of extCache) {
            const ext = cache.ext;
            for (let i = 0; i < ext.points.length - 1; i++) {
                if (distToSegmentSq({x: nx, y: ny}, ext.points[i], ext.points[i+1]) < cache.minSqDist) {
                    hitObstacle = true; break;
                }
            }
            if (hitObstacle) break;
        }

        // Optimized Cube check
        if (!hitObstacle) {
            for (const cache of cubeCache) {
                // Quick bounding radius rejection
                if (Math.abs(nx - cache.c.x) > cache.radius + 1 || Math.abs(ny - cache.c.y) > cache.radius + 1) continue;

                // Detailed rotated check
                const dx = nx - cache.c.x;
                const dy = ny - cache.c.y;
                const lx = dx * cache.cosR + dy * cache.sinR;
                const ly = -dx * cache.sinR + dy * cache.cosR;
                if (Math.abs(lx) <= cache.hw && Math.abs(ly) <= cache.hl) {
                    hitObstacle = true; break;
                }
            }
        }

        if (hitObstacle || Math.abs(currentH - nextH) > 5 || nextH <= mapSettings.waterLevel) {
            lem.a += (Math.random() * Math.PI) + Math.PI / 2;
        } else {
            lem.x = nx;
            lem.y = ny;
        }

        if (Math.random() < 0.05) lem.a += (Math.random() - 0.5);

        // --- THE SPINE AWAKENS (Very Rare Growth Spurt) ---
        if (!lem.grownUp && Math.random() < 0.001 * dt) {
            lem.grownUp = true;
        }

        // --- CHANCE TO BECOME A DIGGER, RAISER, OR DANCER ---
        if (!lem.isDigging && !lem.isRaising && !lem.isDancing) {
            // Check the rest timer before spontaneously dancing
            if (lem.danceRestTimer <= 0 && Math.random() < 0.01 * dt) { // 1% chance to start a dance
                lem.isDancing = true;
                lem.danceTimer = 5.0 + Math.random() * 5.0; // Dance for 5 to 10 seconds
            } else if (Math.random() < 0.02 * dt) { // 2% chance to start digging
                lem.isDigging = true;
                lem.digTimer = 4.0 + Math.random() * 4.0; // Dig for 4 to 8 seconds
                lem.digAccumulator = 0;
            } else if (Math.random() < 0.02 * dt) { // 2% chance to start raising
                lem.isRaising = true;
                lem.raiseTimer = 4.0 + Math.random() * 4.0; // Raise path for 4 to 8 seconds
                lem.raiseAccumulator = 0;
            }
        }
    }

    let cubesAdded = false;

    // --- OPTIMIZATION 2: Spatial Partitioning for Builders ---
    // Drastically reduces O(N^2) pairs check to O(N) by grouping lemmings into a 1x1 tile grid
    const spatialGrid = new Map();
    for (let lem of lemmings) {
        if (lem.hasBuilt || !lem.hasResource) continue;
        const key = Math.floor(lem.x) + ',' + Math.floor(lem.y);
        let cell = spatialGrid.get(key);
        if (!cell) { cell = []; spatialGrid.set(key, cell); }
        cell.push(lem);
    }

    for (const [key, cellLemmings] of spatialGrid.entries()) {
        const [cx, cy] = key.split(',').map(Number);

        // Only check the current cell and right/bottom neighbors to avoid double-checking
        const neighborKeys = [
            key,
            (cx + 1) + ',' + cy,
            cx + ',' + (cy + 1),
            (cx + 1) + ',' + (cy + 1),
            (cx - 1) + ',' + (cy + 1)
        ];

        for (let i = 0; i < cellLemmings.length; i++) {
            let l1 = cellLemmings[i];
            if (l1.hasBuilt) continue;

            for (const nKey of neighborKeys) {
                const neighborLemmings = spatialGrid.get(nKey);
                if (!neighborLemmings) continue;

                for (let j = 0; j < neighborLemmings.length; j++) {
                    let l2 = neighborLemmings[j];

                    // If scanning the identical cell, prevent duplicate pair checking
                    if (key === nKey && j <= i) continue;
                    if (l2.hasBuilt) continue;

                    let dSq = (l1.x - l2.x)**2 + (l1.y - l2.y)**2;
                    if (dSq < 0.5) {
                        let mx = (l1.x + l2.x) / 2;
                        let my = (l1.y + l2.y) / 2;
                        let size = 1 + Math.random() * 2.5;
                        let hw = size / 2, hl = size / 2;
                        let a1 = l1.a, a2 = l2.a;

                        cubes.push({
                            x: mx, y: my,
                            w: size, l: size,
                            h: 2 + Math.random() * 6,
                            r: Math.random() * Math.PI,
                            c: [ (l1.c[0] + l2.c[0]) / 2, (l1.c[1] + l2.c[1]) / 2, (l1.c[2] + l2.c[2]) / 2 ],
                            // Store uniquely generated corners based on their collision angles
                            customPts: [
                                -hw + Math.cos(a1) * Math.random(), -hl + Math.sin(a1) * Math.random(),
                                 hw + Math.cos(a2) * Math.random(), -hl + Math.sin(a2) * Math.random(),
                                -hw + Math.cos(a2) * Math.random(),  hl + Math.sin(a1) * Math.random(),
                                 hw + Math.cos(a1) * Math.random(),  hl + Math.sin(a2) * Math.random()
                            ],
                        });
                        cubesAdded = true;

                        l1.a += Math.PI; l2.a += Math.PI;
                        l1.hasBuilt = true; l2.hasBuilt = true;
                        break; // Stop looking for a partner for l1
                    }
                }
                if (l1.hasBuilt) break; // Break out of neighbor loop if they found a partner
            }
        }
    }

    // Check for lemmings reproducing inside cubes
    // --- OPTIMIZATION 3: Single-Pass Reproduction Bounds Checking ---
    // Collect reproduction data in one pass over the lemmings using the cached collision data
    for (let lem of lemmings) {
        for (const cache of cubeCache) {
            // Broad-phase circle reject
            if (Math.abs(lem.x - cache.c.x) > cache.radius || Math.abs(lem.y - cache.c.y) > cache.radius) continue;

            const dx = lem.x - cache.c.x;
            const dy = lem.y - cache.c.y;
            const lx = dx * cache.cosR + dy * cache.sinR;
            const ly = -dx * cache.sinR + dy * cache.cosR;

            if (Math.abs(lx) <= cache.hw && Math.abs(ly) <= cache.hl) {
                cache.lemmingsInside++;
            }
        }
    }

    let needsBufferRebuild = cubesAdded;

    if(appState.enableReproduction) {
      for (let cache of cubeCache) {
          let c = cache.c;
          if (cache.lemmingsInside >= 2) {
              c.reproduceTimer = (c.reproduceTimer || 0) + dt;
              if (c.reproduceTimer >= 30.0) { // Produces a new lemming every 30 seconds
                  c.reproduceTimer = 0;
                  c.h += 1.5; // Increase the cube's height
                  needsBufferRebuild = true;

                  // Calculate a position just outside the cube's bounds
                  const maxDim = Math.max(c.w, c.l !== undefined ? c.l : c.w);
                  const spawnRadius = (maxDim / 2) + 0.5;
                  const angle = Math.random() * Math.PI * 2;

                  const spawnX = clamp(c.x + Math.cos(angle) * spawnRadius, 1, GRID_W - 2);
                  const spawnY = clamp(c.y + Math.sin(angle) * spawnRadius, 1, GRID_H - 2);

                  lemmings.push({
                      x: spawnX,
                      y: spawnY,
                      a: angle,
                      s: 1.5 + Math.random() * 2.5,
                      c: [Math.random(), Math.random(), Math.random()],
                      hasBuilt: false,
                      hasResource: false,
                      resourceId: 0,
                      isDigging: false,
                      digTimer: 0,
                      digAccumulator: 0,
                      isRaising: false,
                      raiseTimer: 0,
                      raiseAccumulator: 0,
                      isDancing: false,
                      danceTimer: 0,
                      grownUp: false,
                  });
              }
          } else {
              c.reproduceTimer = 0;
          }
      }
    }

    if (terrainChanged) uploadElevations();

    if (needsBufferRebuild || buildingsChanged || terrainChanged) {
        if (needsBufferRebuild) rebuildCubeBuffers();
        if (buildingsChanged) rebuildBuildingInstances();
        saveMapToLocal();
    }
}

export function queryDown(tx, ty) {
    // 1. Check Lemmings (1 tile radius)
    let minDist = 1.0;
    let foundLemming = -1;
    for (let i = 0; i < lemmings.length; i++) {
        const l = lemmings[i];
        const d = (l.x - tx)**2 + (l.y - ty)**2;
        if (d < minDist) { minDist = d; foundLemming = i; }
    }
    if (foundLemming !== -1) {
        appState.queryTarget = { type: 'lemming', index: foundLemming };
        return appState.queryTarget;
    }

    // 2. Check Cubes
    for (let i = cubes.length - 1; i >= 0; i--) {
        if (isInsideCube(tx, ty, cubes[i])) {
            appState.queryTarget = { type: 'cube', index: i };
            return appState.queryTarget;
        }
    }

    // 3. Check Paths
    for (let i = 0; i < extrusions.length; i++) {
        const ext = extrusions[i];
        for (let j = 0; j < ext.points.length - 1; j++) {
            if (distToSegmentSq({x: tx, y: ty}, ext.points[j], ext.points[j+1]) < 2.0) {
                appState.queryTarget = { type: 'path', index: i };
                return appState.queryTarget;
            }
        }
    }

    appState.queryTarget = null;
    return null;
}
