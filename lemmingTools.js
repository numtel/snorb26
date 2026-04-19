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
        danceProclivity: Math.random(),
        parentIds: [],
    });
    saveMapToLocal();
}

export function cleaveLemmingAt(x, y) {
    let closest = null;
    let minDist = Infinity;
    let idx = -1;

    // Find the closest lemming to the click
    for (let i = 0; i < lemmings.length; i++) {
        let lem = lemmings[i];
        let distSq = (lem.x - x)**2 + (lem.y - y)**2;
        if (distSq < minDist) {
            minDist = distSq;
            closest = lem;
            idx = i;
        }
    }

    // Only cleave if we actually hit somewhat close to a lemming (e.g. within 3 tiles)
    if (closest && minDist < 9) {
        // Slice the original lemming out of existence!
        lemmings.splice(idx, 1);

        // Spurt out 8 to 12 pieces in a circular burst
        const numPieces = 8 + Math.floor(Math.random() * 5);
        for (let i = 0; i < numPieces; i++) {
            let angle = (i / numPieces) * Math.PI * 2 + (Math.random() * 0.5); // Radial spread with slight chaos
            lemmings.push({
                id: Math.random().toString(36).substr(2, 9),
                partnerId: null,
                x: closest.x,
                y: closest.y,
                a: angle,
                s: 15.0 + Math.random() * 10.0, // Hilarious speed burst ("spurt and go")
                c: closest.c,       // Inherit the original lemming's color
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
                age: 0,             // Start at age 0 to "grow" into their own lemming
                babyCooldown: 0,
                glistenTimer: 0,
                danceProclivity: Math.random(),
                parentIds: [closest.id], // Make the cleaved clones children of the original
            });
        }
        saveMapToLocal();
    }
}
