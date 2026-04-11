import {
  customBuildingRegistry,
  deserializeMap,
  serializeMap,
} from './state.js';
import {
  uploadElevations,
  updatePaletteTexture,
  rebuildBuildingInstances,
  rebuildExtrusionBuffers,
  rebuildCubeBuffers,
  loadCustomTexture,
} from './renderer.js';
import { updateViewMenuUI } from './menuSystem.js';
import { syncWorkerState } from './workerClient.js';

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
