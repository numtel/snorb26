import {
  GRID_W,
  GRID_H,
  clamp,
  camera,
  selected,
  levelSel,
  paintStroke,
  appState,
  screenToWorld,
  tileCenterWorld,
  elevations,
  lemmings,
  customBuildingRegistry,
} from './state.js';
import {
  initWebGL,
  canvas,
  requestPick,
  rebuildPickResources,
  draw,
  uploadElevations,
  updatePaletteTexture,
  rebuildBuildingInstances,
  rebuildExtrusionBuffers,
  rebuildCubeBuffers,
  loadCustomTexture,
} from './renderer.js';

import {openQueryDialog} from './queryDialog.js';
import { saveMapToLocal, loadMapFromLocal, downloadMapFile, uploadMapFile } from './storage.js';
import { updateViewMenuUI, activeCommands } from './menuSystem.js';
import { syncWorkerState, currentSyncId, postTick } from './workerClient.js';

import { seedDemo, brushApplyDelta, brushSmoothTouched, commitLevelSelection } from './terrainTools.js';
import { brushForest, placeCustomBuildingAtSelected, removeBuildingAtSelected } from './buildingTools.js';
import { appendExtrusionPoint, finishExtrusion, editPathDown, editPathDrag, syncExtrusionUI } from './pathTools.js';
import { placeCubeAt, removeCubeAt, editCubeDown, editCubeDrag } from './cubeTools.js';
import { placeLemmingAt } from './lemmingTools.js';
import { setTileInCenter, queryDown, getTileScreenPos } from './selectionTools.js';

import * as stateAPI from './state.js';
import * as rendererAPI from './renderer.js';
import * as terrainAPI from './terrainTools.js';
import * as buildingAPI from './buildingTools.js';
import * as pathAPI from './pathTools.js';
import * as cubeAPI from './cubeTools.js';
import * as lemmingAPI from './lemmingTools.js';
import * as selectionAPI from './selectionTools.js';

window.snorb = {
  state: stateAPI,
  renderer: rendererAPI,
  tools: {
    ...terrainAPI,
    ...buildingAPI,
    ...pathAPI,
    ...cubeAPI,
    ...lemmingAPI,
    ...selectionAPI
  },
  syncWorkerState,
  saveMapToLocal,
  loadMapFromLocal,
  downloadMapFile,
  uploadMapFile
};

// Setup Map & DOM Elements
const hud = document.getElementById('hud');
initWebGL(document.getElementById('scene'));
if (!loadMapFromLocal()) {
  seedDemo();
  // Center the view and zoom out completely on first load
  setTileInCenter(GRID_W / 2, GRID_H / 2);
  camera.targetZoom = camera.minZoom;
} else {
  // If we loaded from local, we must tell the renderer to update its buffers
  updatePaletteTexture();
  updateViewMenuUI();
  uploadElevations();
  rebuildExtrusionBuffers();
  rebuildCubeBuffers();
  rebuildBuildingInstances();
  customBuildingRegistry.forEach(url => { if(url) loadCustomTexture(url); });
}
uploadElevations();
updateViewMenuUI();
syncWorkerState();

// Initial Camera 
camera.panX = 0;
camera.panY = 0;
let lastMoveTime = 0;
let velocityX = 0;
let velocityY = 0;
const friction = 0.92; // Controls how quickly the map stops sliding

function resize() {
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

  // Set the internal resolution
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);

  // Note: CSS size is handled by your "inset: 0" in style.css,
  // so we don't need to set canvas.style.width manually.

  rebuildPickResources();
}
window.addEventListener('resize', resize);
resize();


// Canvas Events
const pointers = new Map();
let dragPrimaryId = null, pinchStartDist = 0, pinchStartZoom = 1, pinchStartPan = [0, 0], pinchAnchorWorld = [0, 0];
export let orbitPivot = null;
export function setOrbitPivot(val) { orbitPivot = val }
let orbitDragX = 0;

canvas.addEventListener("contextmenu", e => e.preventDefault());

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  const sx = e.clientX * (canvas.width / innerWidth), sy = e.clientY * (canvas.height / innerHeight);
  pointers.set(e.pointerId, { x: sx, y: sy });

  if (e.button === 2) { // Right-click center
    if (appState.toolMode === 'extrude' && appState.activeExtrusion) {
      finishExtrusion();
      return;
    }
    // Handle Edit Path Right Clicks (Deletions)
    if (appState.toolMode === 'edit-path') {
      requestPick(sx, sy, (selected) => {
        if (selected.has) editPathDown(selected.x, selected.y, 2);
      });
      return;
    }
    if (appState.toolMode === 'cube') {
      requestPick(sx, sy, (selected) => {
        if (selected.has) removeCubeAt(selected.x, selected.y);
      });
      return;
    }
    requestPick(sx, sy, (selected) => {
      if (selected.has) { 
        const [wx, wy] = tileCenterWorld(selected.x, selected.y);
        // Update targets so the camera glides to the tile
        camera.targetPanX = wx;
        camera.targetPanY = wy;
      } 
    });
    return;
  }

  // Stop inertia on touch
  camera.velX = 0;
  camera.velY = 0;
  camera.isDragging = true;
  orbitDragX = 0;

  requestPick(sx, sy, () => {
    if (!selected.has) return;
    performTool(e);
  });

  if (pointers.size === 1) {
    dragPrimaryId = e.pointerId;

    if(appState.toolMode === 'orbit') {
      // This updates the 'selected' object in state.js via the pickProgram
      orbitPivot = null;
      requestPick(canvas.width * 0.5, canvas.height * 0.5, (selected) => {
        if(selected.has) {
          orbitPivot = {x: selected.x, y: selected.y};
        }
      });
    }
  }

  if (pointers.size === 2) {
    const pts = Array.from(pointers.values());
    pinchStartDist = Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y));
    pinchStartZoom = camera.zoom; pinchStartPan = [camera.panX, camera.panY];
    pinchAnchorWorld = screenToWorld((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2, canvas.width, canvas.height);
  }
});

export function performTool(e) {
  // If called by keyboard (Enter), 'e' will be undefined.
  const hasPointer = e && e.pointerId !== undefined;

  if (appState.toolMode === 'build') {
    placeBuildingAtSelected();
  } else if (appState.toolMode === 'demolish') {
    if (hasPointer) {
      paintStroke.active = true;
      paintStroke.pointerId = e.pointerId;
    }
    removeBuildingAtSelected(selected.x, selected.y);
    paintStroke.lastX = selected.x;
    paintStroke.lastY = selected.y;
  } else if (appState.toolMode === 'custom-build') {
    const rawInput = document.getElementById('customUrl').value;
    if (rawInput.trim()) {
      placeCustomBuildingAtSelected(rawInput);
    } else {
      alert("Please enter one or more custom HTTPS URLs (comma separated).");
    }
  } else if (appState.toolMode === 'forest') {
    if (hasPointer) {
      paintStroke.active = true;
      paintStroke.pointerId = e.pointerId;
    }
    const rawInput = document.getElementById('customUrl').value;
    if (rawInput.trim()) {
      brushForest(selected.x, selected.y, rawInput);
      paintStroke.lastX = selected.x;
      paintStroke.lastY = selected.y;
    }
  } else if (appState.toolMode === 'raise' || appState.toolMode === 'lower') {
    if (hasPointer) {
      paintStroke.active = true;
      paintStroke.pointerId = e.pointerId;
    }
    paintStroke.delta = appState.toolMode === 'raise' ? +1 : -1;
    brushApplyDelta(selected.x, selected.y, paintStroke.delta);
    paintStroke.lastX = selected.x; paintStroke.lastY = selected.y;
  } else if (appState.toolMode === 'smooth') {
    if (hasPointer) {
      paintStroke.active = true;
      paintStroke.pointerId = e.pointerId;
    }
    // We use a delta of 0 or a special flag to signify smoothing
    paintStroke.delta = 0;
    brushSmoothTouched(selected.x, selected.y);
    paintStroke.lastX = selected.x;
    paintStroke.lastY = selected.y;
  } else if (appState.toolMode === 'level') {
    if(hasPointer) {
      levelSel.active = true;
      levelSel.pointerId = e.pointerId;
    }
    levelSel.startX = levelSel.endX = selected.x;
    levelSel.startY = levelSel.endY = selected.y;
    levelSel.base = elevations[selected.id];
  } else if (appState.toolMode === 'extrude') {
    appendExtrusionPoint(selected.x, selected.y);
  } else if (appState.toolMode === 'edit-path') {
    // Begin Edit Action Sequence
    editPathDown(selected.x, selected.y, 0);
    paintStroke.active = true; // Use paint stroke to hijack dragging
    paintStroke.pointerId = e.pointerId;
    paintStroke.lastX = selected.x;
    paintStroke.lastY = selected.y;
  } else if (appState.toolMode === 'cube') {
    placeCubeAt(selected.x, selected.y);
  } else if (appState.toolMode === 'edit-cube') {
    editCubeDown(selected.x, selected.y, e.button);
    paintStroke.active = true;
    paintStroke.pointerId = e.pointerId;
  } else if (appState.toolMode === 'remove-cube') {
    removeCubeAt(selected.x, selected.y);
  } else if (appState.toolMode === 'plop-lemming') {
    placeLemmingAt(selected.x, selected.y);
  } else if (appState.toolMode === 'query') {
    const target = queryDown(selected.x, selected.y);
    if (target) openQueryDialog();
  }
}

canvas.addEventListener("pointermove", (e) => {
  const sx = e.clientX * (canvas.width / innerWidth), sy = e.clientY * (canvas.height / innerHeight);
  if (e.pointerType === "mouse" && e.buttons === 0) { requestPick(sx, sy); return; }
  if (!pointers.has(e.pointerId)) return;

  const prev = pointers.get(e.pointerId);
  const now = performance.now();
  const dt = Math.max(1, now - lastMoveTime);
  lastMoveTime = now;

  if (e.pointerType === "mouse") requestPick(sx, sy);

  // 1. TOOL PRIORITY: If a tool is active, do NOT pan
  if (appState.toolMode === 'level' && levelSel.active && levelSel.pointerId === e.pointerId) {
    requestPick(sx, sy); // Ensure we pick the tile under the current touch position
    levelSel.endX = selected.x;
    levelSel.endY = selected.y;
    return;
  }

  if (paintStroke.active && paintStroke.pointerId === e.pointerId) {
    requestPick(sx, sy);
    if (selected.has && (selected.x !== paintStroke.lastX || selected.y !== paintStroke.lastY)) {
      if (appState.toolMode === 'demolish') {
        removeBuildingAtSelected(selected.x, selected.y);
      } else if (appState.toolMode === 'edit-path') {
        editPathDrag(selected.x, selected.y);
      } else if (appState.toolMode === 'edit-cube') {
        editCubeDrag(selected.x, selected.y);
      } else if (appState.toolMode === 'forest') {
        const url = document.getElementById('customUrl').value.trim();
        brushForest(selected.x, selected.y, url);
      } else if (appState.toolMode === 'smooth') {
        brushSmoothTouched(selected.x, selected.y);
      } else {
        brushApplyDelta(selected.x, selected.y, paintStroke.delta);
      }
      paintStroke.lastX = selected.x;
      paintStroke.lastY = selected.y;
    }
    return;
  }

  // 2. PANNING & VELOCITY (Only if no tool is active)
  if (pointers.size === 1 && dragPrimaryId === e.pointerId && appState.toolMode === 'pan') {
    const dx = (sx - prev.x) / camera.zoom;
    const dy = (sy - prev.y) / camera.zoom;

    camera.panX -= dx;
    camera.panY -= dy;
    camera.targetPanX = camera.panX;
    camera.targetPanY = camera.panY;

    // Calculate instantaneous velocity for inertia
    velocityX = dx / dt;
    velocityY = dy / dt;
  }

  // 3. ORBIT (Tilt and Rotate)
  if (pointers.size === 1 && dragPrimaryId === e.pointerId && appState.toolMode === 'orbit') {
    const dx = sx - prev.x;
    const dy = sy - prev.y;

    // A. Vertical Drag -> Smooth Tilt
    const tiltSpeed = 0.005;
    camera.targetTilt = clamp(camera.targetTilt - dy * tiltSpeed, camera.minTilt, camera.maxTilt);

    // B. Horizontal Drag -> Smooth Rotation
    const rotSpeed = 0.01;
    camera.targetRotation -= dx * rotSpeed;
  }

  // PINCH ZOOM (Mobile Touch)
  if (pointers.size === 2) {
    const pts = Array.from(pointers.values());
    const currentDist = Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y));
    
    // Update targets based on pinch ratio
    camera.targetZoom = clamp(pinchStartZoom * (currentDist / pinchStartDist), camera.minZoom, camera.maxZoom);
    
    // Note: To prevent jumping, we also sync current zoom during the active pinch
    camera.zoom = camera.targetZoom; 

    const [wx, wy] = screenToWorld((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2, canvas.width, canvas.height);
    camera.targetPanX = pinchStartPan[0] + (pinchAnchorWorld[0] - wx);
    camera.targetPanY = pinchStartPan[1] + (pinchAnchorWorld[1] - wy);
    camera.panX = camera.targetPanX;
    camera.panY = camera.targetPanY;
  }
  
  pointers.set(e.pointerId, { x: sx, y: sy });
});

const pointerUpCancel = (e) => {
  if (levelSel.active && levelSel.pointerId === e.pointerId) commitLevelSelection();
  if (paintStroke.active && paintStroke.pointerId === e.pointerId) {
    // Clear out edit state when releasing the mouse
    if (appState.toolMode === 'edit-path') {
      appState.editPathNodeIndex = -1;
    }
    brushSmoothTouched();
    paintStroke.active = false;
    paintStroke.touched.clear();
  }
  saveMapToLocal();
  pointers.delete(e.pointerId); dragPrimaryId = pointers.size === 1 ? Array.from(pointers.keys())[0] : null;
};
canvas.addEventListener("pointerup", pointerUpCancel);
canvas.addEventListener("pointercancel", pointerUpCancel);
canvas.addEventListener("dblclick", (e) => {
  if (appState.toolMode !== 'pan') return;

  const sx = e.clientX * (canvas.width / innerWidth);
  const sy = e.clientY * (canvas.height / innerHeight);

  // Calculate where we are before zooming
  const [wxB, wyB] = screenToWorld(sx, sy, canvas.width, canvas.height);

  // Shift key toggles between 2x zoom and 0.5x zoom
  const factor = e.shiftKey ? 0.5 : 2.0;
  camera.targetZoom = clamp(camera.targetZoom * factor, camera.minZoom, camera.maxZoom);

  // Offset the target pan so we zoom toward the mouse cursor
  const oldZoom = camera.zoom;
  camera.zoom = camera.targetZoom;
  const [wxA, wyA] = screenToWorld(sx, sy, canvas.width, canvas.height);
  camera.targetPanX += wxB - wxA;
  camera.targetPanY += wyB - wyA;
  camera.zoom = oldZoom;
});

canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const zoomStep = Math.sign(e.deltaY) > 0 ? 0.8 : 1.2;
  camera.targetZoom = clamp(camera.targetZoom * zoomStep, camera.minZoom, camera.maxZoom);

  saveMapToLocal();
}, { passive: false });

requestPick(canvas.width * 0.5, canvas.height * 0.5); // Initial Selection

let lastTime = 0;

function tick(now) {
  const dtReal = lastTime ? (now - lastTime) : 0;
  lastTime = now;

  if (appState.isPlaying) {
    appState.gameTime += dtReal * appState.gameSpeed;
    const dtLemming = (dtReal / 1000) * appState.gameSpeed;
    postTick(dtLemming);
  }

  const l = camera.lerpFactor;

  // We need a way to map world back to tile index. Since we have 'selected',
  // let's use the current selection or the map center as the pivot.
  const pivotX = orbitPivot ? orbitPivot.x : GRID_W / 2;
  const pivotY = orbitPivot ? orbitPivot.y : GRID_H / 2;
  // Capture the world position of our pivot tile BEFORE rotation/tilt changes
  const [oldWx, oldWy] = tileCenterWorld(pivotX, pivotY);

  // Fluid Keyboard Movement Processing
  if (activeCommands.size > 0) {
    const moveSpeed = 12 / camera.zoom;
    const rotateSpeed = 0.04;
    const tiltFactor = 1.015;
    const zoomFactor = 1.03;

    if (activeCommands.has('pan-up')) camera.targetPanY -= moveSpeed * 0.5;
    if (activeCommands.has('pan-down')) camera.targetPanY += moveSpeed * 0.5;
    if (activeCommands.has('pan-left')) camera.targetPanX -= moveSpeed;
    if (activeCommands.has('pan-right')) camera.targetPanX += moveSpeed;
    if (activeCommands.has('rotate-left')) camera.targetRotation -= rotateSpeed;
    if (activeCommands.has('rotate-right')) camera.targetRotation += rotateSpeed;
    if (activeCommands.has('tilt-up')) camera.targetTilt = clamp(camera.targetTilt * tiltFactor, camera.minTilt, camera.maxTilt);
    if (activeCommands.has('tilt-down')) camera.targetTilt = clamp(camera.targetTilt / tiltFactor, camera.minTilt, camera.maxTilt);
    if (activeCommands.has('zoom-in')) camera.targetZoom = clamp(camera.targetZoom * zoomFactor, camera.minZoom, camera.maxZoom);
    if (activeCommands.has('zoom-out')) camera.targetZoom = clamp(camera.targetZoom / zoomFactor, camera.minZoom, camera.maxZoom);
  }

  // Apply Inertia if not dragging
  if (pointers.size === 0) {
    camera.targetPanX -= velocityX * 16; // 16 is a weight factor for feel
    camera.targetPanY -= velocityY * 16;

    // Decay velocity
    velocityX *= friction;
    velocityY *= friction;

    // Stop tiny drifts
    if (Math.abs(velocityX) < 0.01) velocityX = 0;
    if (Math.abs(velocityY) < 0.01) velocityY = 0;
  }

  // Interpolation logic
  camera.panX += (camera.targetPanX - camera.panX) * l;
  camera.panY += (camera.targetPanY - camera.panY) * l;
  camera.zoom += (camera.targetZoom - camera.zoom) * l;
  camera.tilt += (camera.targetTilt - camera.tilt) * l;
  camera.rotation += (camera.targetRotation - camera.rotation) * l;

  // --- STABILIZATION EXECUTION ---
  // Calculate where that same tile is in the world NOW with the new rotation/tilt
  const [newWx, newWy] = tileCenterWorld(pivotX, pivotY);

  // The difference between the two is the "drift" caused by the projection math.
  // We subtract this drift from the target pan to keep the tile stationary on screen.
  const driftX = newWx - oldWx;
  const driftY = newWy - oldWy;

  camera.targetPanX += driftX;
  camera.targetPanY += driftY;
  camera.panX += driftX;
  camera.panY += driftY;
  if (pointers.size === 0 && activeCommands.size === 0 && Math.abs(driftX) < 1 && Math.abs(driftY) < 1) {
    orbitPivot = null;
  };

  draw(appState.gameTime);
  hud.textContent = `${appState.toolMode}\nzoom: ${Math.round(camera.zoom * 100)}%, tilt: ${Math.round(camera.tilt * 100)}%, rot: ${Math.round((camera.rotation * 180 / Math.PI) % 360)}°\ntile: (${selected.x}, ${selected.y}), lemmings: ${lemmings.length}, syncId: ${currentSyncId}`;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

window.addEventListener('blur', () => {
  document.body.classList.add('window-inactive');
});

window.addEventListener('focus', () => {
  document.body.classList.remove('window-inactive');
});

