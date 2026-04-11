import {
  extrusions,
  extrusionSettings,
  appState,
} from './state.js';
import {
  rebuildExtrusionBuffers,
} from './renderer.js';
import { saveMapToLocal } from './storage.js';

export function appendExtrusionPoint(x, y) {
    if (!appState.activeExtrusion) {
        appState.activeExtrusion = {
          points: [{x, y}],
          width: extrusionSettings.width,
          height: extrusionSettings.height,
          altitude: extrusionSettings.altitude || 0,
          color: [...extrusionSettings.color]
        };
        extrusions.push(appState.activeExtrusion);
    } else {
        const ext = appState.activeExtrusion;
        const pts = ext.points;
        if (pts[pts.length - 1].x !== x || pts[pts.length - 1].y !== y) {
            // Collision Check!
            if (isSegmentColliding(pts[pts.length - 1], {x, y}, ext, ext)) {
                return; // Abort appending this point due to overlap
            }
            pts.push({x, y});
        }
    }
    rebuildExtrusionBuffers();
    saveMapToLocal();
}

export function finishExtrusion() {
    appState.activeExtrusion = null;
}

// --- Edit Path Math Utilities & State ---
let lastNodeClickTime = 0;
let lastClickedNodeIndex = -1;

function distSq(p1, p2) { return (p1.x - p2.x)**2 + (p1.y - p2.y)**2; }
export function distToSegmentSq(p, v, w) {
    const l2 = distSq(v, w);
    if (l2 === 0) return distSq(p, v);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return distSq(p, { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) });
}

// Helper to determine if a newly proposed segment intersects or gets too close to an existing segment
function isSegmentColliding(pA, pB, extA, excludeExt) {
    return false; // Disable collision detection
    const altA = extA.altitude || 0;
    const hA = extA.height;
    const samples = Math.max(2, Math.ceil(Math.sqrt(distSq(pA, pB)) * 2));

    for (const extB of extrusions) {
        if (extB === excludeExt) continue;

        const altB = extB.altitude || 0;
        const hB = extB.height;
        // Z Overlap check. If they don't overlap vertically, they don't collide.
        if (Math.max(altA, altB) >= Math.min(altA + hA, altB + hB)) {
            continue;
        }

        const minDistSq = Math.pow((extA.width + extB.width) / 2 + 0.5, 2);
        for (let j = 0; j < extB.points.length - 1; j++) {
            for (let i = 0; i <= samples; i++) {
                const t = i / samples;
                const pt = { x: pA.x + t * (pB.x - pA.x), y: pA.y + t * (pB.y - pA.y) };
                if (distToSegmentSq(pt, extB.points[j], extB.points[j+1]) < minDistSq) {
                    return true;
                }
            }
        }
    }
    return false;
}

export function editPathDown(tx, ty, button) {
    const pt = {x: tx, y: ty};

    // Find the closest existing node first (Magnetic grab)
    let clickedNodeIdx = -1;
    let minNodeDist = 25.0; // 5-tile radius

    if (appState.activeExtrusion) {
        const pts = appState.activeExtrusion.points;
        for (let i = 0; i < pts.length; i++) {
            const d = distSq(pt, pts[i]);
            if (d < minNodeDist) {
                minNodeDist = d;
                clickedNodeIdx = i;
            }
        }
    }

    // Right Click: Deletion Logic (Desktop)
    if (button === 2) {
        if (appState.activeExtrusion && clickedNodeIdx !== -1) {
            const pts = appState.activeExtrusion.points;
            pts.splice(clickedNodeIdx, 1);
            // Remove entire path if 1 or 0 nodes are left
            if (pts.length < 2) {
                const extIdx = extrusions.indexOf(appState.activeExtrusion);
                if (extIdx > -1) extrusions.splice(extIdx, 1);
                appState.activeExtrusion = null;
            }
            rebuildExtrusionBuffers();
            saveMapToLocal();
        }
        return;
    }

    // Left Click / Tap: Interaction Logic
    if (appState.activeExtrusion) {
        const pts = appState.activeExtrusion.points;

        // 1. Check if clicking an existing node (Prioritize this over edge insertion)
        if (clickedNodeIdx !== -1) {
            const now = Date.now();

            // Double-tap deletion logic for Mobile (and Desktop alternative)
            if (clickedNodeIdx === lastClickedNodeIndex && now - lastNodeClickTime < 400) {
                pts.splice(clickedNodeIdx, 1);
                if (pts.length < 2) {
                    const extIdx = extrusions.indexOf(appState.activeExtrusion);
                    if (extIdx > -1) extrusions.splice(extIdx, 1);
                    appState.activeExtrusion = null;
                }
                lastClickedNodeIndex = -1; // reset
                appState.editPathNodeIndex = -1;
                rebuildExtrusionBuffers();
                saveMapToLocal();
                return;
            }

            // Normal selection for dragging
            lastClickedNodeIndex = clickedNodeIdx;
            lastNodeClickTime = now;
            appState.editPathNodeIndex = clickedNodeIdx;
            return;
        }

        // 2. Check if clicking on an edge (Insert new node)
        let insertIdx = -1;
        let minEdgeDist = 2.0; // Tolerance for edge insertion
        for (let i = 0; i < pts.length - 1; i++) {
            const d = distToSegmentSq(pt, pts[i], pts[i+1]);
            if (d < minEdgeDist) {
                minEdgeDist = d;
                insertIdx = i + 1;
            }
        }

        if (insertIdx !== -1) {
            pts.splice(insertIdx, 0, {x: tx, y: ty});
            appState.editPathNodeIndex = insertIdx;

            // Register this as the last clicked node so rapid clicking doesn't accidentally delete it
            lastClickedNodeIndex = insertIdx;
            lastNodeClickTime = Date.now();

            rebuildExtrusionBuffers();
            return;
        }

        // 3. Check if clicking near the absolute start/end to extend
        if (pts.length > 0) {
            const dStart = distSq(pt, pts[0]);
            const dEnd = distSq(pt, pts[pts.length - 1]);
            if (dStart <= 16 || dEnd <= 16) { // 4 tiles radius limit to append
                if (dStart < dEnd) {
                    if (isSegmentColliding({x: tx, y: ty}, pts[0], appState.activeExtrusion, appState.activeExtrusion)) return;
                    pts.unshift({x: tx, y: ty});
                    appState.editPathNodeIndex = 0;
                } else {
                    if (isSegmentColliding(pts[pts.length - 1], {x: tx, y: ty}, appState.activeExtrusion, appState.activeExtrusion)) return;
                    pts.push({x: tx, y: ty});
                    appState.editPathNodeIndex = pts.length - 1;
                }
                rebuildExtrusionBuffers();
                return;
            }
        }
    }

    // 4. Clicked away from active path. Try selecting a new path!
    let closestExt = null;
    let closestDist = 4.0;
    for (const ext of extrusions) {
        for (let i = 0; i < ext.points.length - 1; i++) {
            const d = distToSegmentSq(pt, ext.points[i], ext.points[i+1]);
            if (d < closestDist) {
                closestDist = d;
                closestExt = ext;
            }
        }
    }

    appState.activeExtrusion = closestExt;
    appState.editPathNodeIndex = -1;
    lastClickedNodeIndex = -1;

    if (closestExt) {
        syncExtrusionUI(closestExt);
    }
}

export function editPathDrag(tx, ty) {
    if (appState.activeExtrusion && appState.editPathNodeIndex >= 0) {
        const ext = appState.activeExtrusion;
        const pts = ext.points;
        const idx = appState.editPathNodeIndex;

        if (pts[idx].x !== tx || pts[idx].y !== ty) {
            const oldX = pts[idx].x;
            const oldY = pts[idx].y;
            pts[idx].x = tx;
            pts[idx].y = ty;

            // Enforce Collision while dragging
            let collides = false;
            if (idx > 0 && isSegmentColliding(pts[idx-1], pts[idx], ext, ext)) collides = true;
            if (!collides && idx < pts.length - 1 && isSegmentColliding(pts[idx], pts[idx+1], ext, ext)) collides = true;

            if (collides) {
                pts[idx].x = oldX;
                pts[idx].y = oldY; // Revert Drag
            } else {
                rebuildExtrusionBuffers();
            }
        }
    }
}

export function syncExtrusionUI(ext) {
    if (!ext) return;

    // 1. Update internal state
    extrusionSettings.width = ext.width;
    extrusionSettings.height = ext.height;
    extrusionSettings.altitude = ext.altitude || 0;
    extrusionSettings.color = [...ext.color];

    // 2. Update DOM elements
    const wEl = document.getElementById('exWidth');
    const hEl = document.getElementById('exHeight');
    const aEl = document.getElementById('exAltitude');
    const cEl = document.getElementById('exColor');

    if (wEl) wEl.value = ext.width;
    if (hEl) hEl.value = ext.height;
    if (aEl) aEl.value = ext.altitude || 0;
    if (cEl) {
        // Convert Float RGB to Hex for the color input
        const r = Math.round(ext.color[0] * 255).toString(16).padStart(2, '0');
        const g = Math.round(ext.color[1] * 255).toString(16).padStart(2, '0');
        const b = Math.round(ext.color[2] * 255).toString(16).padStart(2, '0');
        cEl.value = `#${r}${g}${b}`;
    }
}
