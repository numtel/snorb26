import {
  GRID_W,
  GRID_H,
  TILE_W,
  TILE_H,
  ELEV_STEP,
  elevations,
  selected,
  camera,
  tileCenterWorld,
  extrusions,
  appState,
  cubes,
  lemmings,
} from './state.js';
import {
  canvas,
  requestPick,
} from './renderer.js';
import { isInsideCube } from './cubeTools.js';
import { distToSegmentSq } from './pathTools.js';

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


export function queryDown(tx, ty) {
    // 1. Check Lemmings (2 tile radius)
    // We use distance squared for performance: 2.0 * 2.0 = 4.0
    let minDist = 4.0;
    let foundLemming = -1;

    for (let i = 0; i < lemmings.length; i++) {
        const l = lemmings[i];
        const d = (l.x - tx)**2 + (l.y - ty)**2;

        // If this lemming is within the 2-tile radius AND closer than any previously found lemming
        if (d < minDist) {
            minDist = d;
            foundLemming = i;
        }
    }
    if (foundLemming !== -1) {
        appState.queryTarget = { type: 'lemming', index: foundLemming };
        return appState.queryTarget;
    }

    // 2. Check Cubes
    for (let i = cubes.length - 1; i >= 0; i--) {
        if (isInsideCube(tx, ty, cubes[i])) {
            let count = 0;
            for (let j = 0; j < lemmings.length; j++) {
                if (isInsideCube(lemmings[j].x, lemmings[j].y, cubes[i])) {
                    count++;
                }
            }
            appState.queryTarget = { type: 'cube', index: i, lemmingCount: count };
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
