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
  resizeMapState,
  cubes,
  cubeSettings,
  extrusions,
  lemmings,
  customBuildingRegistry,
} from './state.js';
import {
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
import { getTileScreenPos, setTileInCenter } from './selectionTools.js';
import { syncExtrusionUI, finishExtrusion } from './pathTools.js';
import { seedDemo } from './terrainTools.js';
import { saveMapToLocal, downloadMapFile, uploadMapFile } from './storage.js';
import { orbitPivot, setOrbitPivot, performTool } from './main.js';

let activeMenu = null;
let dragStartedOnTrigger = false;
export const activeCommands = new Set();
export let preOrbitSelection = null;
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

function syncBrushFromUI() {
  const rEl = document.getElementById('brushSize');
  const sEl = document.getElementById('brushSmooth');
  if (rEl) brush.radius = parseInt(rEl.value, 10);
  if (sEl) brush.smooth = parseFloat(sEl.value);
}
syncBrushFromUI();

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
                setOrbitPivot({x: selected.x, y: selected.y});
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

document.querySelector('#newMapDialog form')?.addEventListener('submit', (e) => {
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
  updateVal('setMaxAdditions', appState.maxAdditions);

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
  setMaxAdditions: e => appState.maxAdditions = parseFloat(e.target.value),
}).forEach((entry) => {
  const el = document.getElementById(entry[0])
//   entry[1]({ target: el });
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
