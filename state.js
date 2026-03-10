export const GRID_W = 256;
export const GRID_H = 256;
export const TILE_W = 64;
export const TILE_H = 32;
export const ELEV_STEP = 6;
export const WATER_LEVEL = 86;
export const BUILD_SPRITES = 4;

export const elevations = new Uint8Array(GRID_W * GRID_H);
export const buildingAt = new Uint8Array(GRID_W * GRID_H);

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


export const camera = {
  panX: 0,
  panY: (256 + 256) * (32 * 0.25),
  zoom: 1.0,
  // New target values for interpolation
  targetPanX: 0,
  targetPanY: (256 + 256) * (32 * 0.25),
  targetZoom: 1.0,

  minZoom: 0.1,
  maxZoom: 5.0,
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
  rotation: 0 // 0: 0°, 1: 90°, 2: 180°, 3: 270°
};

// Helpers
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function screenToWorld(sx, sy, canvasWidth, canvasHeight) {
  const wx = (sx - canvasWidth * 0.5) / camera.zoom + camera.panX;
  const wy = (sy - canvasHeight * 0.5) / camera.zoom + camera.panY;
  return [wx, wy];
}

export function tileCenterWorld(tx, ty) {
  // Use the same math as the vertex shader for consistency
  const wx = (tx - ty) * (TILE_W * 0.5);
  // We add 0.5 to tx and ty to get the center of the tile, not the top corner
  const wy = (tx + ty + 1.0) * (TILE_H * 0.5);

  const h = elevations[ty * GRID_W + tx] || 0;
  // Subtract height because higher elevation moves the tile "up" (negative Y)
 return [wx, wy - (h * ELEV_STEP)];
}
let saveTimeout = null;

export function saveMapToLocal() {
  // Clear existing timer to reset the throttle window
  if (saveTimeout) clearTimeout(saveTimeout);

  // Delay saving by 500ms after the last interaction
  saveTimeout = setTimeout(() => {
    const data = {
      elevations: Array.from(elevations),
      buildingAt: Array.from(buildingAt),
      camera: {
        panX: camera.targetPanX,
        panY: camera.targetPanY,
        zoom: camera.targetZoom
      },
      rotation: appState.rotation
    };
    localStorage.setItem('dencity_map_data', JSON.stringify(data));
    console.log("Map saved to local storage.");
    saveTimeout = null;
  }, 500);
}

export function loadMapFromLocal() {
  const saved = localStorage.getItem('dencity_map_data');
  if (!saved) return false;

  try {
    const data = JSON.parse(saved);
    elevations.set(data.elevations);
    buildingAt.set(data.buildingAt);

    if (data.camera) {
      camera.panX = camera.targetPanX = data.camera.panX;
      camera.panY = camera.targetPanY = data.camera.panY;
      camera.zoom = camera.targetZoom = data.camera.zoom;
    }

    if (data.rotation !== undefined) appState.rotation = data.rotation;
    return true;
  } catch (e) {
    return false;
  }
}

