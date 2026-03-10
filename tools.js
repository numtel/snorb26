import { GRID_W, GRID_H, TILE_W, TILE_H, ELEV_STEP, clamp, elevations, buildingAt, paintStroke, brush, BUILD_SPRITES, selected, levelSel, camera, tileCenterWorld } from './state.js';
import { canvas, uploadElevations, rebuildBuildingInstances, requestPick } from './renderer.js';
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

export function brushSmoothTouched() {
  if (brush.smooth <= 0 || paintStroke.touched.size === 0) return;
  const touched = Array.from(paintStroke.touched);
  const tmp = new Uint8Array(touched.length);
  for (let k = 0; k < touched.length; k++) {
    const i = touched[k], x = i % GRID_W, y = (i / GRID_W) | 0;
    let sum = 0, n = 0;
    if (x > 0) { sum += elevations[i - 1]; n++; }
    if (x < GRID_W - 1) { sum += elevations[i + 1]; n++; }
    if (y > 0) { sum += elevations[i - GRID_W]; n++; }
    if (y < GRID_H - 1) { sum += elevations[i + GRID_W]; n++; }
    tmp[k] = clamp(Math.round(elevations[i] * (1.0 - brush.smooth) + ((n > 0 ? sum / n : elevations[i]) * brush.smooth)), 0, 255);
  }
  for (let k = 0; k < touched.length; k++) elevations[touched[k]] = tmp[k];
  uploadElevations();
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
  const halfH = TILE_H * 0.5;
  const tx = (camera.panY / halfH + camera.panX / halfW) * 0.5;
  const ty = (camera.panY / halfH - camera.panX / halfW) * 0.5;
  const tileInCenter = getTileInScreenCenter();
  let fnx, fny;

  // 2. Rotate the Data
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const oldIdx = y * GRID_W + x;
      const nx = clockwise ? (GRID_H - 1) - y : y;
      const ny = clockwise ? x : (GRID_W - 1) - x;
      const newIdx = ny * GRID_W + nx;
      if(tileInCenter && x === tileInCenter.x && y === tileInCenter.y) {
        fnx = nx; fny = ny;
      }
      newElev[newIdx] = elevations[oldIdx];
      newBuild[newIdx] = buildingAt[oldIdx];
    }
  }

  elevations.set(newElev);
  buildingAt.set(newBuild);
  uploadElevations();
  rebuildBuildingInstances();
  saveMapToLocal();

  // 3. Calculate where the Pivot Tile moved to
  // We use the same coordinate transformation used in the loop above
  const ntx = !clockwise ? (GRID_H - 1) - ty : ty;
  const nty = clockwise ? tx : (GRID_W - 1) - tx;
  const center = getTileInScreenCenter();
  console.log(tx, ty, ntx, nty, fnx, fny, JSON.stringify(center));
  if(fnx !== undefined) {
    setTileInCenter(fnx, fny);
  }
  console.log(JSON.stringify(getTileInScreenCenter()));
// 
//   // 4. Move camera to the new world position of that tile
//   camera.targetPanX = (fnx - fny) * halfW;
//   camera.targetPanY = (fnx + fny) * halfH;
// 
//   // Snap current pan to target to prevent a massive frame jump/slide
//   camera.panX = camera.targetPanX;
//   camera.panY = camera.targetPanY;
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
  const centerX = canvas.width * 0.5;
  const centerY = canvas.height * 0.5;

  // Since requestPick is asynchronous (GPU-based), we return the
  // current selection if it's already centered, otherwise we
  // calculate it using the camera's current pan values.
  const halfW = 64 * 0.5; // TILE_W
  const halfH = 32 * 0.5; // TILE_H

  // Reverse isometric projection math based on current camera pan
  const tx = Math.floor((camera.panY / halfH + camera.panX / halfW) * 0.5);
  const ty = Math.floor((camera.panY / halfH - camera.panX / halfW) * 0.5);

  if (tx < 0 || tx >= GRID_W || ty < 0 || ty >= GRID_W) return null;

  return { x: tx, y: ty };
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
  camera.targetPanX = targetPanX;
  camera.targetPanY = targetPanY;

  // 4. Update the selection highlight to this tile immediately
  requestPick(sx, sy);
}

export function getTileScreenPos(tx, ty) {
  // 1. Calculate World Position (Isometric)
  // This matches the isoPoint logic in vsTerrain
  const worldX = (tx - ty) * (TILE_W * 0.5);
  const worldY = (tx + ty) * (TILE_H * 0.5);

  // 2. Adjust for Elevation
  // Fetch height from the elevation texture array
  const h = elevations[ty * GRID_W + tx] || 0;
  const elevatedWorldY = worldY - (h * ELEV_STEP);

  // 3. Transform World to Screen
  // Apply zoom and pan, then offset by half the canvas size (center of screen)
  const screenX = (worldX - camera.panX) * camera.zoom + (canvas.width * 0.5);
  const screenY = (elevatedWorldY - camera.panY) * camera.zoom + (canvas.height * 0.5);

  return [screenX, screenY];
}

export function setTileInCenter(tx, ty) {
  console.log('necenter', tx, ty, canvas.width, canvas.height);
  setTileScreenPosition(tx, ty, canvas.width * 0.5, canvas.height * 0.5);
  // 1. Get the world-space center of the target tile
//   const [wx, wy] = tileCenterWorld(tx, ty);
// 
//   // 2. Set the camera's target pan to this world position.
//   // Since the camera centers (wx, wy) on the screen by default
//   // in the renderer's uniform calculation, we simply pan to the world point.
//   console.log(wx,wy, camera);
// //   const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
// //   console.log(window.innerHeight * dpr, window.innerWidth * dpr);
//   // TODO fix where to pan
//   camera.targetPanX = wx;
//   camera.targetPanY = wy;
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
