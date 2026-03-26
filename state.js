import {
  uploadElevations,
  rebuildBuildingInstances,
  loadCustomTexture,
  updatePaletteTexture,
  rebuildExtrusionBuffers,
  rebuildCubeBuffers,
} from './renderer.js';
import { updateViewMenuUI } from './main.js';
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
  // New target values for interpolation
  targetPanX: 0,
  targetPanY: (256 + 256) * (32 * 0.25),
  targetZoom: 1.0,
  targetTilt: 1.0,
  targetRotation: 0,

  minZoom: 0.1,
  maxZoom: 5.0,
  minTilt: 0.35,
  maxTilt: 2.0,
  lerpFactor: 0.15 // Adjust this for "slipperiness" (0.1 = slow, 0.3 = fast)
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
  editPathNodeIndex: -1, // Tracks the currently dragged node
  activeCubeIndex: -1,
  activeCubeHandle: -1, // 0: center, 1-4: corners
};

// Helpers
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function screenToWorld(sx, sy, canvasWidth, canvasHeight) {
  const wx = (sx - canvasWidth * 0.5) / camera.zoom + camera.panX;
  const wy = (sy - canvasHeight * 0.5) / camera.zoom + camera.panY;
  return [wx, wy];
}

export function tileCenterWorld(tx, ty, rotOverride = null) {
  // Use the same math as the vertex shader for consistency
  // We add 0.5 to tx and ty to get the center of the tile, not the top corner
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

// Convert Screen coordinates to "Anchor" coordinates
// relative to the center of the world, independent of current pan.
export function screenToWorldAtRotation(sx, sy, canvasWidth, canvasHeight, rot) {
  // This is effectively screenToWorld minus the camera.pan addition
  // but accounting for the rotation transform
  const x = (sx - canvasWidth * 0.5) / camera.zoom;
  const y = (sy - canvasHeight * 0.5) / camera.zoom;
  return [x, y];
}

// --- 1. Core Serialization ---
// This turns your live state into a clean JSON-serializable object
export function serializeMap() {
  return {
    version: 1,
    grid: { w: GRID_W, h: GRID_H },
    elevations: Array.from(elevations),
    buildingAt: Array.from(buildingAt),
    customBuildingRegistry: Array.from(customBuildingRegistry),
    extrusions,
    cubes,
    camera: {
      panX: camera.targetPanX,
      panY: camera.targetPanY,
      zoom: camera.targetZoom,
      tilt: camera.targetTilt,
      rotation: camera.rotation,
    },
    brush,
    showGrid: appState.showGrid,
    showUnderground: appState.showUnderground,
    waterLevel: mapSettings.waterLevel,
  };
}

// This applies a serialized object back to the live state
export function deserializeMap(data) {
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

    if (data.extrusions) {
      extrusions.length = 0;
      extrusions.push(...data.extrusions);
    }
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
    updatePaletteTexture();

    if (data.showGrid !== undefined) appState.showGrid = data.showGrid;
    else appState.showGrid = true;

    if (data.showUnderground !== undefined) appState.showUnderground = data.showUnderground;
    else appState.showUnderground = false;

    updateViewMenuUI();

    if (data.brush) {
      brush.radius = data.brush.radius;
      brush.smooth = data.brush.smooth;
      // UI update check
      const rEl = document.getElementById('brushSize');
      const sEl = document.getElementById('brushSmooth');
      if (rEl) rEl.value = brush.radius;
      if (sEl) sEl.value = brush.smooth;
    }
    uploadElevations();
    rebuildExtrusionBuffers();
    rebuildCubeBuffers();
    rebuildBuildingInstances();
    return true;
  } catch (e) {
    console.error("Failed to parse map data", e);
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

// --- 2. Local Storage Implementation ---
let saveTimeout = null;
export function saveMapToLocal() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    const data = serializeMap();
    localStorage.setItem('dencity_map_data', JSON.stringify(data));
    saveTimeout = null;
  }, 500);
}

export function loadMapFromLocal() {
  const saved = localStorage.getItem('dencity_map_data');
  if (!saved) return false;
  return deserializeMap(JSON.parse(saved));
}

// --- 3. File I/O (Download/Upload) ---
export function downloadMapFile() {
  const data = serializeMap();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `map_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Creates an internal file input, triggers the picker,
 * and processes the file upload.
 */
export function uploadMapFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';

    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) {
        resolve(false);
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const json = JSON.parse(event.target.result);
          const success = deserializeMap(json);
          saveMapToLocal();
          resolve(success);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = (err) => reject(err);
      reader.readAsText(file);
    };

    // Trigger the OS file picker
    input.click();
  });
}
