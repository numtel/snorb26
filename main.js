import { clamp, camera, selected, levelSel, paintStroke, brush, appState, screenToWorld, tileCenterWorld, elevations, loadMapFromLocal } from './state.js';
import { initWebGL, canvas, requestPick, rebuildPickResources, draw, uploadElevations, rebuildBuildingInstances } from './renderer.js';
import { seedDemo, brushApplyDelta, brushSmoothTouched, commitLevelSelection, placeBuildingAtSelected, rotateGrid } from './tools.js';
import { saveMapToLocal } from './state.js';

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
camera.panY = (256 + 256) * (32 * 0.25);
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

// UI Elements
document.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-command]');
  if (!btn) return;
  console.log(btn);
  switch(btn.attributes.getNamedItem('data-command').value) {
    case 'reset':
      if (confirm("Are you sure you want to clear the city? This cannot be undone.")) {
        // Remove the specific key used for city data
        localStorage.removeItem('dencity_map_data');

        // Reload the page to reset all state and run seedDemo()
        window.location.reload();
      }
      break;
  };
});

document.getElementById('tools').addEventListener('pointerdown', (e) => {
  const btn = e.target.closest('button[data-tool]');
  if (!btn) return;
  e.preventDefault(); e.stopPropagation();
  appState.toolMode = btn.dataset.tool;
  document.querySelectorAll('button[data-tool]').forEach(b => b.classList.toggle('active', b === btn));
});
document.getElementById('brushSize').addEventListener('input', e => brush.radius = parseInt(e.target.value, 10));
document.getElementById('brushSmooth').addEventListener('input', e => brush.smooth = parseFloat(e.target.value));

// Canvas Events
const pointers = new Map();
let dragPrimaryId = null, pinchStartDist = 0, pinchStartZoom = 1, pinchStartPan = [0, 0], pinchAnchorWorld = [0, 0];

canvas.addEventListener("contextmenu", e => e.preventDefault());

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  const sx = e.clientX * (canvas.width / innerWidth), sy = e.clientY * (canvas.height / innerHeight);
  pointers.set(e.pointerId, { x: sx, y: sy });

  if (e.button === 2) { // Right-click center
    requestPick(sx, sy);
    setTimeout(() => { 
      if (selected.has) { 
        const [wx, wy] = tileCenterWorld(selected.x, selected.y);
        // Update targets so the camera glides to the tile
        camera.targetPanX = wx;
        camera.targetPanY = wy;
        
        // Optional: If you want it to snap instantly instead of gliding:
        // camera.panX = wx;
        // camera.panY = wy;
      } 
    }, 20);
    return;
  }

  // Stop inertia on touch
  camera.velX = 0;
  camera.velY = 0;
  camera.isDragging = true;

  requestPick(sx, sy);
  setTimeout(() => {
    if (!selected.has) return;

    if (appState.toolMode === 'build') {
      placeBuildingAtSelected();
    } else if (appState.toolMode === 'raise' || appState.toolMode === 'lower') {
      paintStroke.active = true;
      paintStroke.pointerId = e.pointerId;
      paintStroke.delta = appState.toolMode === 'raise' ? +1 : -1;
      brushApplyDelta(selected.x, selected.y, paintStroke.delta);
      paintStroke.lastX = selected.x; paintStroke.lastY = selected.y;
    } else if (appState.toolMode === 'level') {
      levelSel.active = true;
      levelSel.pointerId = e.pointerId;
      levelSel.startX = levelSel.endX = selected.x;
      levelSel.startY = levelSel.endY = selected.y;
      levelSel.base = elevations[selected.id];
    }
  }, 30);

  if (pointers.size === 1) dragPrimaryId = e.pointerId;
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
      brushApplyDelta(selected.x, selected.y, paintStroke.delta);
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
  if (paintStroke.active && paintStroke.pointerId === e.pointerId) { brushSmoothTouched(); paintStroke.active = false; paintStroke.touched.clear(); }
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

window.addEventListener('keydown', (e) => {
  const moveSpeed =100 / camera.zoom;
  const zoomStep = 1.1;

  const tools = document.querySelectorAll('#tools button');
  console.log(e.code, tools.length);

  if(e.code.match(/Digit\d/)) {
    const digit = Number(e.code.slice(-1));
    if(digit <= tools.length) {
      const newTool = tools[digit - 1];
      const isCommand = 'command' in newTool.dataset;
      const isTool = 'tool' in newTool.dataset;
      newTool.click();
      if(isTool) {
        tools.forEach((tool, index) => { 'tool' in tool.dataset && tool.classList.toggle('active', index === digit - 1) });
        appState.toolMode = newTool.dataset.tool;
      }
    }
  }

  switch(e.code) {
    case 'KeyW': camera.targetPanY -= moveSpeed * 0.5; break;
    case 'KeyS': camera.targetPanY += moveSpeed * 0.5; break;
    case 'KeyA': camera.targetPanX -= moveSpeed; break;
    case 'KeyD': camera.targetPanX += moveSpeed; break;
    
    case 'KeyR': 
      camera.targetZoom = clamp(camera.targetZoom * zoomStep, camera.minZoom, camera.maxZoom); 
      break;
    case 'KeyF': 
      camera.targetZoom = clamp(camera.targetZoom / zoomStep, camera.minZoom, camera.maxZoom); 
      break;

    case 'KeyQ': rotateGrid(camera, false); break;
    case 'KeyE': rotateGrid(camera, true); break;
  }
});

function tick(now) {
const l = camera.lerpFactor;

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

  draw(now);
  hud.textContent = `dencity\nzoom: ${Math.round(camera.zoom * 100)}%\ntile: (${selected.x}, ${selected.y})`;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

window.addEventListener('blur', () => {
  document.body.classList.add('window-inactive');
});

window.addEventListener('focus', () => {
  document.body.classList.remove('window-inactive');
});
