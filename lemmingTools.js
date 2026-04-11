import {
  lemmings,
} from './state.js';
import { saveMapToLocal } from './storage.js';

export function placeLemmingAt(x, y) {
    lemmings.push({
        id: Math.random().toString(36).substr(2, 9),
        partnerId: null,
        x: x + 0.5,
        y: y + 0.5,
        a: Math.random() * Math.PI * 2,           // Angle
        s: 1.5 + Math.random() * 2.5,             // Speed
        c: [Math.random(), Math.random(), Math.random()], // Color
        hasBuilt: false,
        hasResource: false,
        resourceId: 0,
        isDigging: false,
        digTimer: 0,
        digAccumulator: 0,
        isRaising: false,
        raiseTimer: 0,
        raiseAccumulator: 0,
        isDancing: false,
        danceTimer: 0,
        danceRestTimer: 0,
        danceAccumulator: 0,
        stress: 0,
        isThinking: false,
        thinkTimer: 0,
        grownUp: false,
        age: 0,
        babyCooldown: 0,
        glistenTimer: 0,
    });
    saveMapToLocal();
}

