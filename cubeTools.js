import {
  selected,
  appState,
  cubes,
  cubeSettings,
} from './state.js';
import {
  rebuildCubeBuffers,
} from './renderer.js';
import { saveMapToLocal } from './storage.js';


export function placeCubeAt(x, y) {
    if (!selected.has) return;
    cubes.push({
        x, y,
        w: cubeSettings.width,
        l: cubeSettings.length,
        h: cubeSettings.height,
        r: cubeSettings.rotation,
        c: [...cubeSettings.color]
    });
    rebuildCubeBuffers();
    saveMapToLocal();
}

// Helper: Check if point tx,ty is inside a rotated cube
function isInsideCube(tx, ty, c) {
    const dx = tx - c.x;
    const dy = ty - c.y;
    const cosR = Math.cos(c.r || 0);
    const sinR = Math.sin(c.r || 0);
    const lx = dx * cosR + dy * sinR;
    const ly = -dx * sinR + dy * cosR;
    return Math.abs(lx) <= c.w / 2 && Math.abs(ly) <= (c.l !== undefined ? c.l : c.w) / 2;
}

export function removeCubeAt(x, y) {
    let closestIdx = -1;
    for (let i = 0; i < cubes.length; i++) {
        if (isInsideCube(x, y, cubes[i])) {
            closestIdx = i;
            break;
        }
    }

    if (closestIdx !== -1) {
        cubes.splice(closestIdx, 1);
        if (appState.activeCubeIndex === closestIdx) appState.activeCubeIndex = -1;
        rebuildCubeBuffers();
        saveMapToLocal();
    }
}

export function editCubeDown(tx, ty, button) {
    appState.activeCubeHandle = -1;

    // Right Click: Deletion
    if (button === 2) {
        if (appState.activeCubeIndex >= 0 && isInsideCube(tx, ty, cubes[appState.activeCubeIndex])) {
            cubes.splice(appState.activeCubeIndex, 1);
            appState.activeCubeIndex = -1;
            rebuildCubeBuffers();
            saveMapToLocal();
        }
        return;
    }

    let clickedIdx = -1;
    let handleIdx = -1;
    let minDist = 25.0; // 5-tile radius

    // 1. Check if clicking handles of the currently active cube
    if (appState.activeCubeIndex >= 0 && cubes[appState.activeCubeIndex]) {
        const c = cubes[appState.activeCubeIndex];
        const hw = c.w / 2, hl = (c.l !== undefined ? c.l : c.w) / 2;
        const c_rot = Math.cos(c.r || 0), s_rot = Math.sin(c.r || 0);
        const rot = (lx, ly) => ({ x: c.x + lx*c_rot - ly*s_rot, y: c.y + lx*s_rot + ly*c_rot });

        const handles = [
            rot(0, 0),       // 0: Center
            rot(-hw, -hl),   // 1: Top-Left
            rot(hw, -hl),    // 2: Top-Right
            rot(-hw, hl),    // 3: Bottom-Left
            rot(hw, hl)      // 4: Bottom-Right
        ];

        for (let i = 0; i < handles.length; i++) {
            const dSq = (tx - handles[i].x)**2 + (ty - handles[i].y)**2;
            if (dSq < minDist) {
                minDist = dSq;
                clickedIdx = appState.activeCubeIndex;
                handleIdx = i;
            }
        }
    }

    // 2. If no handle clicked, check if clicking inside ANY cube to select it
    if (handleIdx === -1) {
        for (let i = cubes.length - 1; i >= 0; i--) {
            if (isInsideCube(tx, ty, cubes[i])) {
                clickedIdx = i;
                handleIdx = 0; // Default to moving it if clicked inside
                break;
            }
        }
    }

    appState.activeCubeIndex = clickedIdx;
    appState.activeCubeHandle = handleIdx;

    if (clickedIdx !== -1) {
        syncCubeUI(cubes[clickedIdx]);
    }
}

export function editCubeDrag(tx, ty) {
    if (appState.activeCubeIndex >= 0 && appState.activeCubeHandle >= 0) {
        const c = cubes[appState.activeCubeIndex];
        
        if (appState.activeCubeHandle === 0) {
            // Moving the center
            c.x = tx;
            c.y = ty;
        } else {
            // Resizing from a corner (symmetrical scale around center)
            const dx = tx - c.x;
            const dy = ty - c.y;
            const cosR = Math.cos(c.r || 0);
            const sinR = Math.sin(c.r || 0);
            // Project mouse back into local unrotated space
            const lx = dx * cosR + dy * sinR;
            const ly = -dx * sinR + dy * cosR;
            
            c.w = Math.max(1.0, Math.abs(lx) * 2);
            c.l = Math.max(1.0, Math.abs(ly) * 2);
        }
        
        syncCubeUI(c);
        rebuildCubeBuffers();
    }
}

export function syncCubeUI(cube) {
    if (!cube) return;
    cubeSettings.width = cube.w;
    cubeSettings.length = cube.l !== undefined ? cube.l : cube.w;
    cubeSettings.height = cube.h;
    cubeSettings.rotation = cube.r || 0;
    cubeSettings.color = [...cube.c];

    const wEl = document.getElementById('cbWidth');
    const lEl = document.getElementById('cbLength');
    const hEl = document.getElementById('cbHeight');
    const rEl = document.getElementById('cbRotation');
    const cEl = document.getElementById('cbColor');

    if (wEl) wEl.value = cube.w;
    if (lEl) lEl.value = cubeSettings.length;
    if (hEl) hEl.value = cube.h;
    if (rEl) rEl.value = cubeSettings.rotation;
    if (cEl) {
        const r = Math.round(cube.c[0] * 255).toString(16).padStart(2, '0');
        const g = Math.round(cube.c[1] * 255).toString(16).padStart(2, '0');
        const b = Math.round(cube.c[2] * 255).toString(16).padStart(2, '0');
        cEl.value = `#${r}${g}${b}`;
    }
}
