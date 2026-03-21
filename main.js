import {
  GRID_W,
  GRID_H,
  buildingAt,
  saveMapToLocal,
  uploadMapFile,
  downloadMapFile,
  mapSettings,
  extrusionSettings,
  clamp,
  camera,
  selected,
  levelSel,
  paintStroke,
  brush,
  appState,
  screenToWorld,
  tileCenterWorld,
  elevations,
  loadMapFromLocal,
  resizeMapState,
  cubeSettings,
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
} from './renderer.js';
import {
  seedDemo,
  brushApplyDelta,
  brushForest,
  brushSmoothTouched,
  commitLevelSelection,
  placeBuildingAtSelected,
  placeCustomBuildingAtSelected,
  removeBuildingAtSelected,
  setTileInCenter,
  appendExtrusionPoint,
  finishExtrusion,
  editPathDown,
  editPathDrag,
  syncExtrusionUI,
  placeCubeAt,
  removeCubeAt,
} from './tools.js';

// Setup Map & DOM Elements
const hud = document.getElementById('hud');
initWebGL(document.getElementById('scene'));
if (!loadMapFromLocal()) {
  seedDemo();
} else {
  // If we loaded from local, we must tell the renderer to update its buffers
  rebuildBuildingInstances();
}
uploadElevations();

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

function syncBrushFromUI() {
  const rEl = document.getElementById('brushSize');
  const sEl = document.getElementById('brushSmooth');
  if (rEl) brush.radius = parseInt(rEl.value, 10);
  if (sEl) brush.smooth = parseFloat(sEl.value);
}
syncBrushFromUI();

// --- MENU SYSTEM STATE ---
let activeMenu = null;
let dragStartedOnTrigger = false;
const activeCommands = new Set();
// Define which commands should be "held down" for fluid movement
const continuousCommands = ['pan-up', 'pan-down', 'pan-left', 'pan-right', 'rotate-left', 'rotate-right', 'tilt-up', 'tilt-down', 'zoom-in', 'zoom-out'];

const closeAllMenus = () => {
  document.querySelectorAll('.menubar .menu').forEach(m => m.close());
  document.querySelectorAll('.menu-trigger').forEach(b => b.classList.remove('active'));
  activeMenu = null;
  dragStartedOnTrigger = false;
};

const openMenu = (trigger) => {
  const menu = trigger.parentElement.querySelector('dialog');
  if (activeMenu === menu) return; // Already open

  closeAllMenus();
  trigger.classList.add('active');
  menu.show();
  activeMenu = menu;
};

// --- DEVICE ORIENTATION CONTROLS ---
let initialOrientation = null;

function handleOrientation(e) {
  // Only process if the orbit tool is active
  if (appState.toolMode !== 'orbit') {
    initialOrientation = null;
    return;
  }

  // Capture starting point to allow relative movement
  if (!initialOrientation) {
    initialOrientation = { beta: e.beta, gamma: e.gamma };
    return;
  }

  // Beta (Tilt: -180 to 180) -> Maps to Camera Tilt
  // We use a sensitivity multiplier (0.02)
  const deltaBeta = (e.beta - initialOrientation.beta) * 0.02;
  camera.targetTilt = clamp(camera.targetTilt + deltaBeta, camera.minTilt, camera.maxTilt);

  // Gamma (Left/Right: -90 to 90) -> Maps to Camera Rotation
  const deltaGamma = (e.gamma - initialOrientation.gamma) * 0.03;
  camera.targetRotation += deltaGamma;

  // Update initial to current to create a smooth "delta" flow
  initialOrientation = { beta: e.beta, gamma: e.gamma };
}

// Permission & Listener Setup
const enableOrientation = () => {
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    // iOS 13+ Requirement
    DeviceOrientationEvent.requestPermission()
      .then(response => {
        if (response === 'granted') {
          window.addEventListener('deviceorientation', handleOrientation);
        }
      })
      .catch(console.error);
  } else {
    // Android / Non-iOS
    window.addEventListener('deviceorientation', handleOrientation);
  }
};

// --- EVENT DELEGATION ---
const toolsElement = document.getElementById('tools');

toolsElement.addEventListener('pointerdown', (e) => {
  const trigger = e.target.closest('.menu-trigger');
  if (trigger) {
    e.preventDefault();
    e.stopPropagation();

    if (activeMenu && activeMenu === trigger.parentElement.querySelector('dialog')) {
      // If clicking the same button that is already open, close it
      closeAllMenus();
    } else {
      openMenu(trigger);
      dragStartedOnTrigger = true;
    }
  }
});

toolsElement.addEventListener('pointerover', (e) => {
  const trigger = e.target.closest('.menu-trigger');
  // Classic Windows behavior: If one menu is open, hovering over others opens them
  if (trigger && activeMenu) {
    openMenu(trigger);
  }
});

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const code = e.code.replace(/(Digit|Key)/, '');
  if(code === 'Escape') {
    closeAllMenus();
    return;
  }
  const tool = document.querySelector(`button[data-key="${code}"]`);
  if(tool) {
    const cmd = tool.dataset.command;
    const toolMode = tool.dataset.tool;

    // 1. Handle Tool Mode switches (e.g., 'B' for build)
    if (toolMode) {
      menuClicks(null, toolMode);
    }
    // 2. Handle Commands (e.g., 'G' for grid, 'Arrows' for pan)
    else if (cmd) {
      if (continuousCommands.includes(cmd)) {
        if (['rotate-left', 'rotate-right', 'tilt-up', 'tilt-down'].includes(cmd)) {
          if(!orbitPivot) {
            requestPick(canvas.width * 0.5, canvas.height * 0.5, (selected) => {
              if(selected.has) {
                orbitPivot = {x: selected.x, y: selected.y};
              }
            });
          }
        }
        activeCommands.add(cmd);
      } else {
        // This handles "one-shot" actions like toggle-grid and center-view
        menuClicks(cmd, null);
      }
    }
  }
});

window.addEventListener('keyup', (e) => {
  const code = e.code.replace(/(Digit|Key)/, '');
  const tool = document.querySelector(`button[data-key="${code}"]`);
  if (tool && tool.dataset.command) {
    activeCommands.delete(tool.dataset.command);
  }
});

function menuClicks(command, tool) {
  const moveSpeed =100 / camera.zoom;
  const zoomStep = 1.1;
  if(tool) {
    syncBrushFromUI();
    appState.toolMode = tool;
    if (tool !== 'extrude' && tool !== 'edit-path' && appState.activeExtrusion) finishExtrusion();
    if ((tool === 'edit-path' || tool === 'extrude') && appState.activeExtrusion) {
        syncExtrusionUI(appState.activeExtrusion);
    }
    document.querySelectorAll('button[data-tool]').forEach(b =>
      b.classList.toggle('active', b.dataset.tool === tool)
    );
    if(tool === 'orbit') {
//       enableOrientation();
    }
    return;
  }

  switch(command) {
    case 'reset':
      if (confirm("Are you sure you want to clear the city?")) {
        const nextW = parseInt(document.getElementById('newWidth').value, 10) || 256;
        const nextH = parseInt(document.getElementById('newHeight').value, 10) || 256;
        // 1. Clear local storage
        localStorage.removeItem('dencity_map_data');

        // 2. Re-seed the map elevations and clear buildings
        resizeMapState(nextW, nextH);
        seedDemo();
        buildingAt.fill(0);
        mapSettings.waterLevel = 86; // Reset to default
        const wEl = document.getElementById('waterLevel');
        if (wEl) wEl.value = mapSettings.waterLevel;

        // 3. Reset Camera: Center the view and zoom out completely
        setTileInCenter(GRID_W / 2, GRID_H / 2);
        camera.targetZoom = camera.minZoom;

        // 4. Update GPU and Save
        updatePaletteTexture();
        uploadElevations();
        rebuildBuildingInstances();
        rebuildExtrusionBuffers();
        saveMapToLocal();
      }
      break;
    case 'open-file': uploadMapFile(); break;
    case 'save-file': downloadMapFile(); break;
    case 'pan-up': camera.targetPanY -= moveSpeed * 0.5; break;
    case 'pan-down': camera.targetPanY += moveSpeed * 0.5; break;
    case 'pan-left': camera.targetPanX -= moveSpeed; break;
    case 'pan-right': camera.targetPanX += moveSpeed; break;
    case 'center-view': setTileInCenter(GRID_W/2, GRID_H/2); break;
    case 'center-selection': setTileInCenter(selected.x, selected.y); break;

    case 'zoom-in':
      camera.targetZoom = clamp(camera.targetZoom * zoomStep, camera.minZoom, camera.maxZoom);
      break;
    case 'zoom-out':
      camera.targetZoom = clamp(camera.targetZoom / zoomStep, camera.minZoom, camera.maxZoom);
      break;

    case 'rotate-left': camera.targetRotation -= Math.PI / 12; break;
    case 'rotate-right': camera.targetRotation += Math.PI / 12; break;
    case 'tilt-up': camera.targetTilt = clamp(camera.targetTilt * 1.05, camera.minTilt, camera.maxTilt); break;
    case 'tilt-down': camera.targetTilt = clamp(camera.targetTilt / 1.05, camera.minTilt, camera.maxTilt); break;
    case 'toggle-grid':
      appState.showGrid = !appState.showGrid;
      updateViewMenuUI();
      break;
    default:
      console.error('invalid menu item', command);
  }
  saveMapToLocal();
}

export function updateViewMenuUI() {
  const gridBtn = document.querySelector('button[data-command="toggle-grid"]');
  if (gridBtn) {
    gridBtn.classList.toggle('active', appState.showGrid);
  }
}

window.addEventListener('pointerup', (e) => {
  const item = e.target.closest('.menu button[data-tool], .menu button[data-command]');
  const isInsideTrigger = e.target.closest('.menu-trigger');
  const isInsideMenu = e.target.closest('.menu');

  if (item) {
    // Handle Item Selection
    menuClicks(item.dataset.command, item.dataset.tool);
    closeAllMenus();
  } else if (!isInsideTrigger && !isInsideMenu) {
    // Clicked outside entirely
    closeAllMenus();
  } else if (isInsideTrigger && !dragStartedOnTrigger) {
    // This handles the "second click" on the top level to close
    // but only if we didn't just open it via a drag
  }

  dragStartedOnTrigger = false;
});

Object.entries({
  waterLevel: e => {
    mapSettings.waterLevel = parseInt(e.target.value, 10);
    updatePaletteTexture();
  },
  brushSize: e => brush.radius = parseInt(e.target.value, 10),
  brushSmooth: e => brush.smooth = parseFloat(e.target.value),
  exWidth: e => extrusionSettings.width = parseFloat(e.target.value),
  exHeight: e => extrusionSettings.height = parseFloat(e.target.value),
  exColor: e => {
    const hex = e.target.value;
    extrusionSettings.color = [ parseInt(hex.substr(1,2), 16)/255, parseInt(hex.substr(3,2), 16)/255, parseInt(hex.substr(5,2), 16)/255 ];
  },
  cbWidth: e => cubeSettings.width = parseFloat(e.target.value),
  cbLength: e => cubeSettings.length = parseFloat(e.target.value),
  cbHeight: e => cubeSettings.height = parseFloat(e.target.value),
  cbColor: e => {
    const hex = e.target.value;
    cubeSettings.color = [ parseInt(hex.substr(1,2), 16)/255, parseInt(hex.substr(3,2), 16)/255, parseInt(hex.substr(5,2), 16)/255 ];
  },
}).forEach((entry) => {
  const el = document.getElementById(entry[0])
  entry[1]({ target: el });
  el.addEventListener('input', e => {
    entry[1](e);
    if (['exWidth', 'exHeight', 'exColor'].includes(entry[0]) && appState.activeExtrusion) {
      if (entry[0] === 'exWidth') appState.activeExtrusion.width = extrusionSettings.width;
      if (entry[0] === 'exHeight') appState.activeExtrusion.height = extrusionSettings.height;
      if (entry[0] === 'exColor') appState.activeExtrusion.color = [...extrusionSettings.color];

      // Instantly update the 3D geometry
      rebuildExtrusionBuffers();
    }
    saveMapToLocal();
  });
});

// Canvas Events
const pointers = new Map();
let dragPrimaryId = null, pinchStartDist = 0, pinchStartZoom = 1, pinchStartPan = [0, 0], pinchAnchorWorld = [0, 0], orbitPivot = null;
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
        
        // Optional: If you want it to snap instantly instead of gliding:
        // camera.panX = wx;
        // camera.panY = wy;
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

    if (appState.toolMode === 'build') {
      placeBuildingAtSelected();
    } else if (appState.toolMode === 'demolish') {
      paintStroke.active = true;
      paintStroke.pointerId = e.pointerId;
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
      paintStroke.active = true;
      paintStroke.pointerId = e.pointerId;
      const rawInput = document.getElementById('customUrl').value;
      if (rawInput.trim()) {
        brushForest(selected.x, selected.y, rawInput);
        paintStroke.lastX = selected.x;
        paintStroke.lastY = selected.y;
      }
    } else if (appState.toolMode === 'raise' || appState.toolMode === 'lower') {
      paintStroke.active = true;
      paintStroke.pointerId = e.pointerId;
      paintStroke.delta = appState.toolMode === 'raise' ? +1 : -1;
      brushApplyDelta(selected.x, selected.y, paintStroke.delta);
      paintStroke.lastX = selected.x; paintStroke.lastY = selected.y;
    } else if (appState.toolMode === 'smooth') {
      paintStroke.active = true;
      paintStroke.pointerId = e.pointerId;
      // We use a delta of 0 or a special flag to signify smoothing
      paintStroke.delta = 0;
      brushSmoothTouched(selected.x, selected.y);
      paintStroke.lastX = selected.x;
      paintStroke.lastY = selected.y;
    } else if (appState.toolMode === 'level') {
      levelSel.active = true;
      levelSel.pointerId = e.pointerId;
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
    } else if (appState.toolMode === 'remove-cube') {
      removeCubeAt(selected.x, selected.y);
    }
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

function tick(now) {
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

  draw(now);
  hud.textContent = `${appState.toolMode}\nzoom: ${Math.round(camera.zoom * 100)}%, tilt: ${Math.round(camera.tilt * 100)}%, rot: ${Math.round((camera.rotation * 180 / Math.PI) % 360)}°\ntile: (${selected.x}, ${selected.y})`;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

window.addEventListener('blur', () => {
  document.body.classList.add('window-inactive');
});

window.addEventListener('focus', () => {
  document.body.classList.remove('window-inactive');
});
