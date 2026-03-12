import { GRID_W, GRID_H, TILE_W, TILE_H, ELEV_STEP, clamp, elevations, buildingAt, paintStroke, brush, BUILD_SPRITES, selected, levelSel, camera, tileCenterWorld, customBuildingRegistry } from './state.js';
import { canvas, uploadElevations, rebuildBuildingInstances, requestPick, loadCustomTexture } from './renderer.js';
import { saveMapToLocal } from './state.js';

export function seedDemo() {
  const cx = GRID_W * 0.5, cy = GRID_H * 0.5;
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const r = Math.hypot((x - cx) / GRID_W, (y - cy) / GRID_H);
      let h = Math.floor(Math.max(0, 1.0 - (r * 2.35)) * 160);
      const n = (Math.sin(x * 0.09) * Math.cos(y * 0.07) + Math.sin((x + y) * 0.03) + Math.cos((x - y) * 0.05)) * 0.5;
      elevations[y * GRID_W + x] = clamp(h + Math.floor((n + 1) * 18), 0, 255);
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
export function rotateGrid(camera, clockwise = true) {
  const newElev = new Uint8Array(GRID_W * GRID_H);
  const newBuild = new Uint8Array(GRID_W * GRID_H);

  // 1. Identify the "Pivot Tile" currently at the center of the viewport
  // We reverse the isometric math to find the tile coordinates (floating point)
  // wx = (tx - ty) * (TILE_W / 2)
  // wy = (tx + ty) * (TILE_H / 2)
  const halfW = TILE_W * 0.5;
  const halfH = TILE_H * camera.tilt * 0.5;
  const tx = (camera.panY / halfH + camera.panX / halfW) * 0.5;
  const ty = (camera.panY / halfH - camera.panX / halfW) * 0.5;
  const tileInCenter = getTileInScreenCenter();

  // 2. Rotate the Data
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const oldIdx = y * GRID_W + x;
      const nx = clockwise ? (GRID_H - 1) - y : y;
      const ny = clockwise ? x : (GRID_W - 1) - x;
      const newIdx = ny * GRID_W + nx;
      newElev[newIdx] = elevations[oldIdx];
      newBuild[newIdx] = buildingAt[oldIdx];
    }
  }

  elevations.set(newElev);
  buildingAt.set(newBuild);
  uploadElevations();
  rebuildBuildingInstances();

  // 3. Calculate where the Pivot Tile moved to
  // We use the same coordinate transformation used in the loop above
  const ntx = clockwise ? (GRID_H - 1) - tileInCenter.y : tileInCenter.y;
  const nty = clockwise ? tileInCenter.x : (GRID_W - 1) - tileInCenter.x;
  setTileInCenter(ntx, nty);

  saveMapToLocal();
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

export function getTileInScreenCenter() {
  // Not efficient but tough to do with elevations
  // TODO binary search for efficiency
  let closeX, closeY, dist = canvas.width * canvas.height;
  for(let x = 0; x < GRID_W; x++) {
    for(let y = 0; y < GRID_H; y++) {
      const [wx, wy] = tileCenterWorld(x, y);
      const thisDist  = Math.hypot(wx - camera.panX, wy - camera.panY);
      if(thisDist < dist) {
        closeX = x; closeY = y;
        dist = thisDist;
      }
    }
  }

  return { x: closeX, y: closeY };
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
  const worldX = (tx - ty) * (TILE_W * 0.5);
  const worldY = (tx + ty) * (TILE_H * camera.tilt * 0.5);
  const h = elevations[ty * GRID_W + tx] || 0;
  const elevatedWorldY = worldY - (h * ELEV_STEP * camera.tilt);
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
