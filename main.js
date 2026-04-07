import {
  GRID_W,
  GRID_H,
  buildingAt,
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
  resizeMapState,
  cubes,
  cubeSettings,
  extrusions,
  lemmings,
  customBuildingRegistry,
  deserializeMap,
  serializeMap,
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
  editCubeDown,
  editCubeDrag,
  placeLemmingAt,
  queryDown,
  getTileScreenPos,
} from './tools.js';

export const worker = new Worker('lemmingWorker.js');
export let workerBusy = false;
let currentSyncId = 0;

worker.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'tick_result') {
    workerBusy = false;

    // Drop stale results from before a map reset/sync
    if (msg.syncId !== currentSyncId) return;

    lemmings.length = 0;
    lemmings.push(...msg.lemmings);

    if (msg.terrainChanged) {
      elevations.set(msg.elevations);
      uploadElevations();
    }
    if (msg.buildingsChanged) {
      buildingAt.set(msg.buildingAt);
      rebuildBuildingInstances();
    }
    if (msg.needsBufferRebuild) {
      cubes.length = 0;
      cubes.push(...msg.cubes);
      rebuildCubeBuffers();
    }
    if (msg.terrainChanged || msg.buildingsChanged || msg.needsBufferRebuild) {
      saveMapToLocal(true);
    }
  } else if(msg.type === 'true_love' || msg.type === 'rejection' || msg.type === 'birth' || msg.type === 'death') {
    console.info(msg);
    spawnEventEffect(msg);
  }
};

function spawnEventEffect(msg) {
  // Convert the tile coordinates where it happened to screen space
  const tx = Math.floor(msg.lem.x);
  const ty = Math.floor(msg.lem.y);
  const [sx, sy] = getTileScreenPos(tx, ty);

  const container = document.createElement('div');
  container.className = 'event-effect-container';
  container.style.left = sx + 'px';
  container.style.top = sy + 'px';

  // Create the main text
  const text = document.createElement('div');
  text.className = `event-text ${msg.type}`;
  let emojiChar;

  if (msg.type === 'true_love') {
    text.innerHTML = `💖 True Love! 💖<br>${msg.lem.id} & ${msg.other.id}`;
    emojiChar = '💖';
  } else if (msg.type === 'birth') {
    text.innerHTML = `🍼 Newborn! 🍼<br>${msg.lem.id}`;
    emojiChar = '🍼';
  } else if (msg.type === 'death') {
    text.innerHTML = `🪦 RIP 🪦<br>${msg.lem.id} at age ${Math.floor(msg.lem.age)}`;
    emojiChar = '💀';
  } else {
    text.innerHTML = `💔 Rejection! 💔<br>${msg.lem.id} & ${msg.other.id}`;
    emojiChar = '💔';
  }
  container.appendChild(text);

  // Spawn the exploding emojis
  for (let i = 0; i < 8; i++) {
    const emoji = document.createElement('div');
    emoji.className = 'event-emoji';
    emoji.textContent = emojiChar;

    // Calculate a random explosion trajectory
    const angle = Math.random() * Math.PI * 2;
    const dist = 40 + Math.random() * 60;
    const tx = Math.cos(angle) * dist;
    const ty = Math.sin(angle) * dist - 40; // Bias slightly upwards

    emoji.style.setProperty('--tx', `${tx}px`);
    emoji.style.setProperty('--ty', `${ty}px`);
    container.appendChild(emoji);
  }

  document.body.appendChild(container);

  // Clean up the DOM element after the animation finishes
  setTimeout(() => container.remove(), 3000);
}

export function syncWorkerState() {
  currentSyncId++;
  worker.postMessage({
    type: 'sync',
    syncId: currentSyncId,
    GRID_W, GRID_H,
    elevations, buildingAt, mapSettings,
    extrusions, cubes, lemmings,
    enableReproduction: appState.enableReproduction,
    simParams: {
      loveChance: appState.loveChance,
      ageGapPenalty: appState.ageGapPenalty,
      babyChance: appState.babyChance,
      babyCooldown: appState.babyCooldown,
      maxBirthAge: appState.maxBirthAge,
      deathAge: appState.deathAge,
      deathChance: appState.deathChance
    },
  });
}

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

// --- 2. Local Storage Implementation ---
let saveTimeout = null;
export function saveMapToLocal(fromWorker = false) {
  if (!fromWorker) syncWorkerState();
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    const dataText = serializeMap();
    localStorage.setItem('snorb_map_data', dataText);
    saveTimeout = null;
  }, 500);
}

export function loadMapFromLocal() {
  const saved = localStorage.getItem('snorb_map_data');
  if (!saved) return false;
  return deserializeMap(saved);
}

// --- 3. File I/O (Download/Upload) ---
export function downloadMapFile() {
  const dataText = serializeMap();
  const blob = new Blob([dataText], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `map_${new Date().toISOString().slice(0,10)}.snorb`;
  a.click();
  URL.revokeObjectURL(url);
}

export function uploadMapFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.json,.snorb,text/plain,application/json';

    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) {
        resolve(false);
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const success = deserializeMap(event.target.result);
          updatePaletteTexture();
          updateViewMenuUI();
          uploadElevations();
          rebuildExtrusionBuffers();
          rebuildCubeBuffers();
          rebuildBuildingInstances();
          customBuildingRegistry.forEach(url => { if(url) loadCustomTexture(url); });
          saveMapToLocal();
          resolve(success);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = (err) => reject(err);
      reader.readAsText(file);
    };

    input.click();
  });
}

// Initial Camera 
camera.panX = 0;
camera.panY = 0;
let lastMoveTime = 0;
let velocityX = 0;
let velocityY = 0;
let preOrbitSelection = null;
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
  trigger.focus(); // Prevent the dialog from auto-focusing the first item
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
toolsElement.addEventListener('pointermove', (e) => {
  // Classic Win98: Sync mouse hover with focus so keys and mouse share the same state
  if (activeMenu) {
    const item = e.target.closest('.menu button, .menu input');
    if (item && document.activeElement !== item) {
      item.focus();
    }
  }
});

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

toolsElement.addEventListener('keydown', (e) => {
  const target = e.target;

  // Only apply this to range sliders
  if (target.tagName === 'INPUT' && target.type === 'range') {

    // 1. Prevent arrow keys from moving the slider
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      // We don't use stopPropagation() here so the arrow keys
      // can still bubble up to your menu navigation script!
    }

    // 2. Use + / - to change the slider values instead
    else if (e.key === '+' || e.key === '=' || e.key === '-') {
      e.preventDefault();

      const step = parseFloat(target.step) || 1;
      const min = parseFloat(target.min) || 0;
      const max = parseFloat(target.max) || 100;
      let val = parseFloat(target.value);

      if (e.key === '+' || e.key === '=') val += step;
      if (e.key === '-') val -= step;

      // Keep it within bounds
      target.value = Math.max(min, Math.min(max, val));

      // Tell the rest of the app that the slider was moved
      target.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
});

function shiftMenu(direction) {
  const triggers = Array.from(document.querySelectorAll('.menu-trigger'));
  const currentTrigger = activeMenu.parentElement.querySelector('.menu-trigger');
  let newIndex = (triggers.indexOf(currentTrigger) + direction + triggers.length) % triggers.length;
  
  const nextTrigger = triggers[newIndex];
  openMenu(nextTrigger);
  
  // Logic to focus the first valid item in the new menu
  const firstItem = activeMenu.querySelector('button, input');
  if (firstItem) firstItem.focus();
}

window.addEventListener('keydown', (e) => {
  const code = e.code.replace(/(Digit|Key)/, '');
  if(code === 'Escape') {
    closeAllMenus();
    return;
  }
  if(document.querySelector('dialog:not(.menu)[open]') !== null) return;

  // 1. Handle Alt + Key shortcuts
  if (e.altKey) {
    e.preventDefault();
    const char = e.key.toLowerCase();

    // Map of Alt+Key to menu index or trigger
    const mnemonicMap = {
      'f': 0, // File
      'm': 1, // Map
      't': 2, // Tool
      'g': 3, // Game
      'v': 4, // View
      'h': 5  // Help
    };

    if (mnemonicMap[char] !== undefined) {
      const triggers = document.querySelectorAll('.menu-trigger');
      openMenu(triggers[mnemonicMap[char]]);
      // Focus the first button in the newly opened menu
      activeMenu.querySelector('button')?.focus();
      return;
    }
  }

  let tool, continuous = true;
  // 2. Navigation when a menu is already open
  // If a menu is open, handle navigation
  if (activeMenu) {
    // Select all buttons and inputs, but ignore the hidden range inputs' parent labels
    const items = Array.from(activeMenu.querySelectorAll('button, input'));
    const currentIndex = items.indexOf(document.activeElement);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIndex = (currentIndex + 1) % items.length;
      items[nextIndex].focus();
    }
    else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIndex = (currentIndex - 1 + items.length) % items.length;
      items[prevIndex].focus();
    }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      // Logic to switch between File, Map, Tool menus
      const direction = e.key === 'ArrowRight' ? 1 : -1;
      const triggers = Array.from(document.querySelectorAll('.menu-trigger'));
      const currentTrigger = activeMenu.parentElement.querySelector('.menu-trigger');
      const nextIdx = (triggers.indexOf(currentTrigger) + direction + triggers.length) % triggers.length;

      openMenu(triggers[nextIdx]);
      // Auto-focus the first item in the new menu
      const nextItems = activeMenu.querySelectorAll('button, input');
      if (nextItems.length) nextItems[0].focus();
    }
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      tool = activeMenu.querySelector('button:hover');
      if(!tool) tool = activeMenu.querySelector('button:focus');
      continuous = false;
    }
    else if (e.key === 'Escape') {
      closeAllMenus();
      canvas.focus();
    }
    if(!tool) return; // Block game shortcuts while menu is navigated
    if(tool) closeAllMenus();
  }

  if(!tool) tool = document.querySelector(`button[data-key="${code}"]`);

  if(tool) {
    if (e.repeat) return;
    const cmd = tool.dataset.command;
    const toolMode = tool.dataset.tool;

    // 1. Handle Tool Mode switches (e.g., 'B' for build)
    if (toolMode) {
      menuClicks(null, toolMode);
    }
    // 2. Handle Commands (e.g., 'G' for grid, 'Arrows' for pan)
    else if (cmd) {
      if (continuous && continuousCommands.includes(cmd)) {
        if (['rotate-left', 'rotate-right', 'tilt-up', 'tilt-down'].includes(cmd)) {
          if (!preOrbitSelection && selected.has) {
            preOrbitSelection = { x: selected.x, y: selected.y };
          }
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
  } else {
    if(selected.has) {
      let moved = false;
      
      if(e.key === 'ArrowDown' && selected.y < GRID_H - 1) {
        selected.y++; moved = true;
      }
      else if(e.key === 'ArrowUp' && selected.y > 0) {
        selected.y--; moved = true;
      }
      else if(e.key === 'ArrowLeft' && selected.x > 0) {
        selected.x--; moved = true;
      }
      else if(e.key === 'ArrowRight' && selected.x < GRID_W - 1) {
        selected.x++; moved = true;
      }
      else if(e.key === 'Enter') {
        e.preventDefault();
        performTool();
        return;
      }

      if (moved) {
        // 1. Manually update the flat array index ID
        selected.id = selected.y * GRID_W + selected.x;

        // 2. Get the screen position of the newly selected tile
        const [sx, sy] = getTileScreenPos(selected.x, selected.y);

        // 3. Convert screen (CSS) pixels to Canvas resolution pixels (WebGL space)
        const canvasSx = sx * (canvas.width / window.innerWidth);
        const canvasSy = sy * (canvas.height / window.innerHeight);

        // 4. Force a picking update at that coordinate
        requestPick(canvasSx, canvasSy);
      }
    }
  }
});

window.addEventListener('keyup', (e) => {
  const code = e.code.replace(/(Digit|Key)/, '');
  const tool = document.querySelector(`button[data-key="${code}"]`);
  if (tool && tool.dataset.command) {
    activeCommands.delete(tool.dataset.command);

    // Check if any orbit keys are still being held
    const orbitKeysStillHeld = [...activeCommands].some(cmd =>
      ['rotate-left', 'rotate-right', 'tilt-up', 'tilt-down'].includes(cmd)
    );

    if (!orbitKeysStillHeld && preOrbitSelection) {
      // Restore the coordinates
      selected.x = preOrbitSelection.x;
      selected.y = preOrbitSelection.y;
      selected.id = selected.y * GRID_W + selected.x;
      selected.has = true;

      // Force a pick update so the UI/GPU knows the selection moved back
      const [sx, sy] = getTileScreenPos(selected.x, selected.y);
      requestPick(sx * (canvas.width / window.innerWidth), sy * (canvas.height / window.innerHeight));

      preOrbitSelection = null; // Clear the cache
    }
  }
});

function updateToolSettingsUI(tool) {
  document.getElementById('brush-settings').classList.toggle('active', ['raise', 'lower', 'smooth', 'forest', 'demolish'].includes(tool));
  document.getElementById('custom-build-settings').classList.toggle('active', ['custom-build', 'forest'].includes(tool));
  document.getElementById('extrusion-settings').classList.toggle('active', ['extrude', 'edit-path'].includes(tool));
  document.getElementById('cube-settings').classList.toggle('active', ['cube', 'edit-cube'].includes(tool));
}

function menuClicks(command, tool) {
  const moveSpeed =100 / camera.zoom;
  const zoomStep = 1.1;
  if(tool) {
    syncBrushFromUI();
    appState.toolMode = tool;
    updateToolSettingsUI(tool);
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
    case 'toggle-play':
      appState.isPlaying = !appState.isPlaying;
      const playBtn = document.querySelector('button[data-command="toggle-play"]');
      if (playBtn) playBtn.textContent = appState.isPlaying ? 'Pause' : 'Play';
      break;
    case 'reset':
      document.getElementById('newMapDialog').showModal();
      break;
    case 'open-file': uploadMapFile(); break;
    case 'save-file': downloadMapFile(); break;
    case 'exit':
      document.body.classList.add('exit');
      setTimeout(() => {
        document.body.classList.remove('exit');
      }, 3000);
      break;
    case 'show-help': document.getElementById('helpDialog').showModal(); break;
    case 'show-about': document.getElementById('aboutDialog').showModal(); break;
    case 'open-reddit': window.open('https://reddit.com/r/snorb'); break;
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
    case 'toggle-underground':
      appState.showUnderground = !appState.showUnderground;
      updateViewMenuUI();
      break;
    case 'toggle-reproduction':
      appState.enableReproduction = !appState.enableReproduction;
      updateViewMenuUI();
      break;
    default:
      console.error('invalid menu item', command);
  }
  saveMapToLocal();
}

document.querySelectorAll('input[type="range"]').forEach(input => {
  // Create a span to hold the number value
  const valDisplay = document.createElement('span');
  valDisplay.textContent = input.value;
  valDisplay.style.minWidth = '3ch'; // Prevents layout jitter when numbers change digits
  valDisplay.style.textAlign = 'right';
  
  // Append it to the right of the input (inside the existing flexbox label)
  input.parentElement.appendChild(valDisplay);

  // Update the text whenever the slider is moved (via mouse or keyboard)
  input.addEventListener('input', (e) => {
    let val = e.target.value;
    if(e.target.id === 'setDeathChance') val = String(Number(val).toFixed(5));
    valDisplay.textContent = val;
  });
});

const rangeInputs = document.querySelectorAll('#newMapDialog input[type="range"]');
const mapForm = document.querySelector('#newMapDialog form');

rangeInputs.forEach(input => {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault(); // Prevent default browser behavior
      // Manually trigger the submit button's click
      // or call the form's submit handler directly
      document.getElementById('generateMapBtn').click();
    }
  });
});

document.getElementById('generateMapBtn')?.addEventListener('click', (e) => {
  e.preventDefault();
  const nextW = parseInt(document.getElementById('newWidth').value, 10) || 256;
  const nextH = parseInt(document.getElementById('newHeight').value, 10) || 256;

  const config = {
    islands: parseInt(document.getElementById('genIslands').value, 10),
    mountains: parseInt(document.getElementById('genMountains').value, 10),
    valleys: parseInt(document.getElementById('genValleys').value, 10),
    canyons: parseInt(document.getElementById('genCanyons').value, 10),
    deserts: parseInt(document.getElementById('genDeserts').value, 10),
    beaches: parseInt(document.getElementById('genBeaches').value, 10),
    erosion: parseInt(document.getElementById('genErosion').value, 10),
  };

  // Clear local storage
  localStorage.removeItem('snorb_map_data');

  // Re-seed the map elevations with new terrain features
  resizeMapState(nextW, nextH);
  seedDemo(config);

  // Clear map state
  buildingAt.fill(0);
  mapSettings.waterLevel = 86;
  const wEl = document.getElementById('waterLevel');
  if (wEl) wEl.value = mapSettings.waterLevel;

  // Reset Camera: Center the view and zoom out completely
  setTileInCenter(GRID_W / 2, GRID_H / 2);
  camera.targetZoom = camera.minZoom;

  // Update GPU and Save
  updatePaletteTexture();
  uploadElevations();
  rebuildBuildingInstances();
  rebuildExtrusionBuffers();
  rebuildCubeBuffers();
  updateViewMenuUI();
  saveMapToLocal();

  document.getElementById('newMapDialog').close();
  closeAllMenus();
});

document.getElementById('cancelMapBtn')?.addEventListener('click', () => {
  document.getElementById('newMapDialog').close();
});

export function updateViewMenuUI() {
  const gridBtn = document.querySelector('button[data-command="toggle-grid"]');
  if (gridBtn) {
    gridBtn.classList.toggle('active', appState.showGrid);
  }
  const ugBtn = document.querySelector('button[data-command="toggle-underground"]');
  if (ugBtn) {
    ugBtn.classList.toggle('active', appState.showUnderground);
  }
  const reproBtn = document.querySelector('button[data-command="toggle-reproduction"]');
  if (reproBtn) {
    reproBtn.classList.toggle('active', appState.enableReproduction);
  }
  const playBtn = document.querySelector('button[data-command="toggle-play"]');
  if (playBtn) playBtn.textContent = appState.isPlaying ? 'Pause' : 'Play';

  const updateVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  updateVal('gameSpeed', appState.gameSpeed);
  updateVal('setLoveChance', appState.loveChance);
  updateVal('setAgeGapPenalty', appState.ageGapPenalty);
  updateVal('setBabyChance', appState.babyChance);
  updateVal('setBabyCooldown', appState.babyCooldown);
  updateVal('setMaxBirthAge', appState.maxBirthAge);
  updateVal('setDeathAge', appState.deathAge);
  updateVal('setDeathChance', appState.deathChance);

  document.querySelectorAll('input[type="range"]').forEach(input => {
    if(input.nextElementSibling) {
      let val = input.value;
      if(input.id === 'setDeathChance') val = String(Number(val).toFixed(5));
      input.nextElementSibling.textContent = val;
    }
  });
}
updateToolSettingsUI('pan');

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
  exAltitude: e => extrusionSettings.altitude = parseFloat(e.target.value),
  exColor: e => {
    const hex = e.target.value;
    extrusionSettings.color = [ parseInt(hex.substr(1,2), 16)/255, parseInt(hex.substr(3,2), 16)/255, parseInt(hex.substr(5,2), 16)/255 ];
  },
  cbWidth: e => cubeSettings.width = parseFloat(e.target.value),
  cbLength: e => cubeSettings.length = parseFloat(e.target.value),
  cbHeight: e => cubeSettings.height = parseFloat(e.target.value),
  cbRotation: e => cubeSettings.rotation = parseFloat(e.target.value),
  cbColor: e => {
    const hex = e.target.value;
    cubeSettings.color = [ parseInt(hex.substr(1,2), 16)/255, parseInt(hex.substr(3,2), 16)/255, parseInt(hex.substr(5,2), 16)/255 ];
  },
  gameSpeed: e => appState.gameSpeed = parseFloat(e.target.value),
  setLoveChance: e => appState.loveChance = parseFloat(e.target.value),
  setAgeGapPenalty: e => appState.ageGapPenalty = parseFloat(e.target.value),
  setBabyChance: e => appState.babyChance = parseFloat(e.target.value),
  setBabyCooldown: e => appState.babyCooldown = parseFloat(e.target.value),
  setMaxBirthAge: e => appState.maxBirthAge = parseFloat(e.target.value),
  setDeathAge: e => appState.deathAge = parseFloat(e.target.value),
  setDeathChance: e => appState.deathChance = parseFloat(e.target.value),
}).forEach((entry) => {
  const el = document.getElementById(entry[0])
  entry[1]({ target: el });
  el.addEventListener('input', e => {
    entry[1](e);
    if (['cbWidth', 'cbLength', 'cbHeight', 'cbRotation', 'cbColor'].includes(entry[0]) && appState.toolMode === 'edit-cube' && appState.activeCubeIndex >= 0) {
        const c = cubes[appState.activeCubeIndex];
        if (entry[0] === 'cbWidth') c.w = cubeSettings.width;
        if (entry[0] === 'cbLength') c.l = cubeSettings.length;
        if (entry[0] === 'cbHeight') c.h = cubeSettings.height;
        if (entry[0] === 'cbRotation') c.r = cubeSettings.rotation;
        if (entry[0] === 'cbColor') c.c = [...cubeSettings.color];
        rebuildCubeBuffers();
    }
    if (['exWidth', 'exHeight', 'exAltitude', 'exColor'].includes(entry[0]) && appState.activeExtrusion) {
      if (entry[0] === 'exWidth') appState.activeExtrusion.width = extrusionSettings.width;
      if (entry[0] === 'exHeight') appState.activeExtrusion.height = extrusionSettings.height;
      if (entry[0] === 'exAltitude') appState.activeExtrusion.altitude = extrusionSettings.altitude;
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

function performTool(e) {
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
    if (dtLemming > 0 && !workerBusy) {
        workerBusy = true;
        worker.postMessage({ type: 'tick', dt: dtLemming });
    }
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

// --- QUERY DIALOG LOGIC ---
const toHex = c => '#' + c.map(v => Math.round(v*255).toString(16).padStart(2,'0')).join('');
const fromHex = h => [parseInt(h.substr(1,2),16)/255, parseInt(h.substr(3,2),16)/255, parseInt(h.substr(5,2),16)/255];

function openQueryDialog() {
    const target = appState.queryTarget;
    const content = document.getElementById('queryContent');
    const title = document.getElementById('queryTitle');
    let html = '';

    if (target.type === 'lemming') {
        const l = lemmings[target.index];
        title.textContent = "Edit Lemming";
        html += `<label class="text"><span>ID:</span> <input type="text" id="q_id" value="${l.id || ''}"></label>`;
        html += `<label class="text"><span>Partner ID:</span> <input type="text" id="q_partner" value="${l.partnerId || ''}"></label>`;
        html += `<label class="text"><span>Age:</span> <input type="number" id="q_age" value="${l.age}" step="0.1"></label>`;
        html += `<label class="text"><span>X:</span> <input type="number" id="q_x" value="${l.x}" step="0.1"></label>`;
        html += `<label class="text"><span>Y:</span> <input type="number" id="q_y" value="${l.y}" step="0.1"></label>`;
        html += `<label class="text"><span>Angle:</span> <input type="number" id="q_a" value="${l.a}" step="0.1"></label>`;
        html += `<label class="text"><span>Speed:</span> <input type="number" id="q_s" value="${l.s}" step="0.1"></label>`;
        html += `<label class="text"><span>Color:</span> <input type="color" id="q_c" value="${toHex(l.c)}"></label>`;
        html += `<label class="text"><span>Stress:</span> <input type="number" id="q_stress" value="${(l.stress || 0).toFixed(1)}" step="0.1"></label>`;
        html += `<label class="radio"><input type="checkbox" id="q_grown" ${l.grownUp?'checked':''}> Grown Up</label>`;
        html += `<label class="radio"><input type="checkbox" id="q_thinking" ${l.isThinking?'checked':''}> Thinking</label>`;
        html += `<label class="radio"><input type="checkbox" id="q_built" ${l.hasBuilt?'checked':''}> Has Built</label>`;
        html += `<label class="radio"><input type="checkbox" id="q_resource" ${l.hasResource?'checked':''}> Has Resource</label>`;
    } else if (target.type === 'cube') {
        const c = cubes[target.index];
        title.textContent = "Edit Cube";
        html += `<p>Lemmings Inside: <span id="q_lemming_count">${target.lemmingCount}</span></p>`;
        html += `<label class="text"><span>X:</span> <input type="number" id="q_x" value="${c.x}" step="0.1"></label>`;
        html += `<label class="text"><span>Y:</span> <input type="number" id="q_y" value="${c.y}" step="0.1"></label>`;
        html += `<label class="text"><span>Width:</span> <input type="number" id="q_w" value="${c.w}" step="0.1"></label>`;
        html += `<label class="text"><span>Length:</span> <input type="number" id="q_l" value="${c.l!==undefined?c.l:c.w}" step="0.1"></label>`;
        html += `<label class="text"><span>Height:</span> <input type="number" id="q_h" value="${c.h}" step="0.1"></label>`;
        html += `<label class="text"><span>Rotation:</span> <input type="number" id="q_r" value="${c.r||0}" step="0.05"></label>`;
        html += `<label class="text"><span>Color:</span> <input type="color" id="q_c" value="${toHex(c.c)}"></label>`;
    } else if (target.type === 'path') {
        const p = extrusions[target.index];
        title.textContent = "Edit Path";
        html += `<label class="text"><span>Width:</span> <input type="number" id="q_w" value="${p.width}" step="0.1"></label>`;
        html += `<label class="text"><span>Height:</span> <input type="number" id="q_h" value="${p.height}" step="0.1"></label>`;
        html += `<label class="text"><span>Altitude:</span> <input type="number" id="q_alt" value="${p.altitude||0}" step="0.1"></label>`;
        html += `<label class="text"><span>Color:</span> <input type="color" id="q_c" value="${toHex(p.color)}"></label>`;
    }

    content.innerHTML = `<fieldset>${html}</fieldset>`;
    document.getElementById('queryDialog').showModal();
}

document.getElementById('cancelQueryBtn')?.addEventListener('click', () => {
    document.getElementById('queryDialog').close();
    appState.queryTarget = null;
});

document.getElementById('saveQueryBtn')?.addEventListener('click', () => {
    const target = appState.queryTarget;
    if (!target) return;

    if (target.type === 'lemming') {
        const l = lemmings[target.index];
        l.id = document.getElementById('q_id').value || null;
        l.partnerId = document.getElementById('q_partner').value || null;
        l.age = parseFloat(document.getElementById('q_age').value);
        l.x = parseFloat(document.getElementById('q_x').value);
        l.y = parseFloat(document.getElementById('q_y').value);
        l.a = parseFloat(document.getElementById('q_a').value);
        l.s = parseFloat(document.getElementById('q_s').value);
        l.c = fromHex(document.getElementById('q_c').value);
        l.grownUp = document.getElementById('q_grown').checked;
        l.stress = parseFloat(document.getElementById('q_stress').value);
        l.isThinking = document.getElementById('q_thinking').checked;
        l.hasBuilt = document.getElementById('q_built').checked;
        l.hasResource = document.getElementById('q_resource').checked;
    } else if (target.type === 'cube') {
        const c = cubes[target.index];
        c.x = parseFloat(document.getElementById('q_x').value);
        c.y = parseFloat(document.getElementById('q_y').value);
        c.w = parseFloat(document.getElementById('q_w').value);
        c.l = parseFloat(document.getElementById('q_l').value);
        c.h = parseFloat(document.getElementById('q_h').value);
        c.r = parseFloat(document.getElementById('q_r').value);
        c.c = fromHex(document.getElementById('q_c').value);
        rebuildCubeBuffers();
    } else if (target.type === 'path') {
        const p = extrusions[target.index];
        p.width = parseFloat(document.getElementById('q_w').value);
        p.height = parseFloat(document.getElementById('q_h').value);
        p.altitude = parseFloat(document.getElementById('q_alt').value);
        p.color = fromHex(document.getElementById('q_c').value);
        rebuildExtrusionBuffers();
    }

    saveMapToLocal();
    document.getElementById('queryDialog').close();
    appState.queryTarget = null;
});
