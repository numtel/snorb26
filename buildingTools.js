import {
  GRID_W,
  GRID_H,
  buildingAt,
  brush,
  BUILD_SPRITES,
  selected,
  customBuildingRegistry,
} from './state.js';
import {
  rebuildBuildingInstances,
  loadCustomTexture,
} from './renderer.js';
import { saveMapToLocal } from './storage.js';

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
