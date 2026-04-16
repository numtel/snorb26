import {
  GRID_W,
  GRID_H,
  buildingAt,
  mapSettings,
  appState,
  elevations,
  cubes,
  extrusions,
  lemmings,
} from './state.js';
import {
  uploadElevations,
  rebuildBuildingInstances,
  rebuildCubeBuffers,
  canvas,
} from './renderer.js';
import { getTileScreenPos } from './selectionTools.js';
import { saveMapToLocal } from './storage.js';

export const worker = new Worker('lemmingWorker.js');
export let workerBusy = false;
export function setWorkerBusy(value) { workerBusy = value }
export let currentSyncId = 0;

export function postTick(dtLemming) {
    if (dtLemming > 0 && !workerBusy) {
        setWorkerBusy(true);
        worker.postMessage({ type: 'tick', dt: dtLemming });
    }
}

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

  // Map internal canvas buffer coordinates perfectly to CSS logical pixels
  const cssX = (sx / canvas.width) * canvas.clientWidth;
  const cssY = (sy / canvas.height) * canvas.clientHeight;

  const container = document.createElement('div');
  container.className = 'event-effect-container';
  container.style.left = cssX + 'px';
  container.style.top = cssY + 'px';

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
      deathChance: appState.deathChance,
      maxAdditions: appState.maxAdditions,
      enableDestressShocks: appState.enableDestressShocks,
      enableDanceSmoothing: appState.enableDanceSmoothing,
    },
  });
}

