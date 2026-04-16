import {
  appState,
  cubes,
  extrusions,
  lemmings,
} from './state.js';
import {
  rebuildExtrusionBuffers,
  rebuildCubeBuffers,
} from './renderer.js';
import { saveMapToLocal } from './storage.js';
import { setTileInCenter } from './selectionTools.js';

const toHex = c => '#' + c.map(v => Math.round(v*255).toString(16).padStart(2,'0')).join('');
const fromHex = h => [parseInt(h.substr(1,2),16)/255, parseInt(h.substr(3,2),16)/255, parseInt(h.substr(5,2),16)/255];

export function openQueryDialog() {
    const target = appState.queryTarget;
    const content = document.getElementById('queryContent');
    const title = document.getElementById('queryTitle');
    let html = '';

    if (target.type === 'lemming') {
        const l = lemmings[target.index];
        title.textContent = "Edit Lemming";
        html += `<div class="row">`;
        html += `<label class="text"><span>ID:</span> <input type="text" id="q_id" value="${l.id || ''}"></label>`;
        html += `<label class="text"><span>Partner ID:</span> <input type="text" id="q_partner" value="${l.partnerId || ''}"></label>`;
        html += `</div>`;
        html += `<div class="row">`;
        html += `<label class="text"><span>Age:</span> <input type="text" id="q_age" value="${l.age}" ></label>`;
        html += `<label class="text"><span>Speed:</span> <input type="text" id="q_s" value="${l.s}" ></label>`;
        html += `</div>`;
        html += `<div class="row">`;
        html += `<label class="text"><span>X:</span> <input type="text" id="q_x" value="${l.x}" ></label>`;
        html += `<label class="text"><span>Y:</span> <input type="text" id="q_y" value="${l.y}" ></label>`;
        html += `</div>`;
        html += `<div class="row">`;
        html += `<label class="text"><span>Angle:</span> <input type="text" id="q_a" value="${l.a}" ></label>`;
        html += `<label class="text"><span>Color:</span> <input type="color" id="q_c" value="${toHex(l.c)}"></label>`;
        html += `<label class="text"><span>Stress:</span> <input type="text" id="q_stress" value="${(l.stress || 0).toFixed(1)}" ></label>`;
        html += `</div>`;
        html += `<div class="row">`;
        html += `<label class="radio"><input type="checkbox" id="q_grown" ${l.grownUp?'checked':''}> Grown Up</label>`;
        html += `<label class="radio"><input type="checkbox" id="q_thinking" ${l.isThinking?'checked':''}> Thinking</label>`;
        html += `</div>`;
        html += `<div class="row">`;
        html += `<label class="radio"><input type="checkbox" id="q_built" ${l.hasBuilt?'checked':''}> Has Built</label>`;
        html += `<label class="radio"><input type="checkbox" id="q_resource" ${l.hasResource?'checked':''}> Has Resource</label>`;
        html += `</div>`;
        html += `<div class="controls">`;
        html += `<button type="button" id="q_center_btn" class="button">Center Viewport</button>`;
        if (l.partnerId) {
            html += `<button type="button" id="q_partner_btn" class="button" style="margin-left: 5px;">Query Partner</button>`;
        }
        html += `</div>`;
    } else if (target.type === 'cube') {
        const c = cubes[target.index];
        title.textContent = "Edit Cube";
        html += `<p>Lemmings Inside: <span id="q_lemming_count">${target.lemmingCount}</span></p>`;
        html += `<div class="row">`;
        html += `<label class="text"><span>X:</span> <input type="text" id="q_x" value="${c.x}" ></label>`;
        html += `<label class="text"><span>Y:</span> <input type="text" id="q_y" value="${c.y}" ></label>`;
        html += `</div>`;
        html += `<div class="row">`;
        html += `<label class="text"><span>Width:</span> <input type="text" id="q_w" value="${c.w}" ></label>`;
        html += `<label class="text"><span>Length:</span> <input type="text" id="q_l" value="${c.l!==undefined?c.l:c.w}" ></label>`;
        html += `</div>`;
        html += `<div class="row">`;
        html += `<label class="text"><span>Height:</span> <input type="text" id="q_h" value="${c.h}" ></label>`;
        html += `<label class="text"><span>Rotation:</span> <input type="text" id="q_r" value="${c.r||0}" step="0.05"></label>`;
        html += `<label class="text"><span>Color:</span> <input type="color" id="q_c" value="${toHex(c.c)}"></label>`;
        html += `</div>`;
    } else if (target.type === 'path') {
        const p = extrusions[target.index];
        title.textContent = "Edit Path";
        html += `<div class="row">`;
        html += `<label class="text"><span>Width:</span> <input type="text" id="q_w" value="${p.width}" ></label>`;
        html += `<label class="text"><span>Height:</span> <input type="text" id="q_h" value="${p.height}" ></label>`;
        html += `</div>`;
        html += `<div class="row">`;
        html += `<label class="text"><span>Altitude:</span> <input type="text" id="q_alt" value="${p.altitude||0}" ></label>`;
        html += `<label class="text"><span>Color:</span> <input type="color" id="q_c" value="${toHex(p.color)}"></label>`;
        html += `</div>`;
    }

    content.innerHTML = `<fieldset>${html}</fieldset>`;
    const centerBtn = document.getElementById('q_center_btn');
    if (centerBtn) {
        centerBtn.addEventListener('click', () => {
            const l = lemmings[appState.queryTarget.index];
            setTileInCenter(Math.floor(l.x), Math.floor(l.y));
        });
    }

    const partnerBtn = document.getElementById('q_partner_btn');
    if (partnerBtn) {
        partnerBtn.addEventListener('click', () => {
            const l = lemmings[appState.queryTarget.index];
            const partnerIdx = lemmings.findIndex(lem => lem.id === l.partnerId);
            if (partnerIdx !== -1) {
                // Update the target and re-render the dialog!
                appState.queryTarget = { type: 'lemming', index: partnerIdx };
                openQueryDialog();
            } else {
                alert("Partner not found!");
            }
        });
    }

    const dialog = document.getElementById('queryDialog');
    if (!dialog.open) {
        dialog.showModal();
        document.getElementById('saveQueryBtn').focus();
    }
}

document.getElementById('cancelQueryBtn')?.addEventListener('click', () => {
    document.getElementById('queryDialog').close();
    appState.queryTarget = null;
});

document.querySelector('#queryDialog form')?.addEventListener('submit', () => {
    event.preventDefault();
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
        const wasThinking = l.isThinking;
        l.isThinking = document.getElementById('q_thinking').checked;
        // If the user forces a lemming to think, they must be given a time amount
        if(!wasThinking && l.isThinking) {
          // This is much longer than would naturally happen in lemmingWorker.js
          l.thinkTimer = 10 + Math.random() * 10;
        }
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

