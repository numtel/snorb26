import {
  GRID_W,
  GRID_H,
  clamp,
  elevations,
  paintStroke,
  brush,
  levelSel,
} from './state.js';
import {
  uploadElevations,
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

