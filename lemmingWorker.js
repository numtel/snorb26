let GRID_W = 256, GRID_H = 256;
let elevations, buildingAt, mapSettings = { waterLevel: 86 };
let extrusions = [], cubes = [], lemmings = [];
let enableReproduction = true;
let simParams = { loveChance: 0.3, ageGapPenalty: 0.01, babyChance: 0.2, babyCooldown: 60.0, maxBirthAge: 50.0, deathAge: 60.0, deathChance: 0.0001 };
let currentSyncId = 0;
let shockwaves = []; // Keep track of active healing shockwaves

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function distSq(p1, p2) { return (p1.x - p2.x)**2 + (p1.y - p2.y)**2; }
function distToSegmentSq(p, v, w) {
    const l2 = distSq(v, w);
    if (l2 === 0) return distSq(p, v);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return distSq(p, { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) });
}

self.onmessage = function(e) {
    if (e.data.type === 'sync') {
        currentSyncId = e.data.syncId;
        GRID_W = e.data.GRID_W;
        GRID_H = e.data.GRID_H;
        elevations = e.data.elevations;
        buildingAt = e.data.buildingAt;
        mapSettings = e.data.mapSettings;
        extrusions = e.data.extrusions;
        cubes = e.data.cubes;
        lemmings = e.data.lemmings;
        enableReproduction = e.data.enableReproduction;
        if (e.data.simParams) simParams = e.data.simParams;
    } else if (e.data.type === 'tick') {
        if (!lemmings || lemmings.length === 0) {
            self.postMessage({ type: 'tick_result', syncId: currentSyncId, lemmings: [] });
            return;
        }
        updateLemmings(e.data.dt);
    }
};

function updateLemmings(dt) {
    let buildingsChanged = false;
    let terrainChanged = false;

    // Build a quick dictionary so lemmings can find their partners efficiently
    const lemmingsById = new Map();
    for (let l of lemmings) lemmingsById.set(l.id, l);

    // Process Healing Shockwaves
    for (let i = shockwaves.length - 1; i >= 0; i--) {
        let sw = shockwaves[i];
        let oldR = sw.r;
        sw.r += dt * sw.speed;

        let cx = Math.floor(sw.x), cy = Math.floor(sw.y);
        let rCeil = Math.ceil(sw.r);

        const affectedIndices = [];
        for (let oy = -rCeil; oy <= rCeil; oy++) {
            for (let ox = -rCeil; ox <= rCeil; ox++) {
                let dist = Math.hypot(ox, oy);
                if (dist >= oldR && dist < sw.r) {
                    let x = cx + ox, y = cy + oy;
                    if (x >= 0 && y >= 0 && x < GRID_W && y < GRID_H) {
                        affectedIndices.push(y * GRID_W + x);
                    }
                }
            }
        }

        if (affectedIndices.length > 0) {
            const newValues = new Map();
            const strength = 0.6; // Shockwave smoothing strength
            for (const idx of affectedIndices) {
                const x = idx % GRID_W, y = (idx / GRID_W) | 0;
                let sum = 0, count = 0;
                // Average against all 8 neighbors for a strong smoothing effect
                const neighbors = [[0,1], [0,-1], [1,0], [-1,0], [1,1], [-1,-1], [1,-1], [-1,1]];
                for (const [nx, ny] of neighbors) {
                    const tx = x + nx, ty = y + ny;
                    if (tx >= 0 && tx < GRID_W && ty >= 0 && ty < GRID_H) {
                        sum += elevations[ty * GRID_W + tx];
                        count++;
                    }
                }
                const avg = count > 0 ? sum / count : elevations[idx];
                newValues.set(idx, Math.round(elevations[idx] * (1 - strength) + (avg * strength)));
            }

            for (const [idx, val] of newValues) {
                if (elevations[idx] !== val) {
                    elevations[idx] = clamp(val, 0, 255);
                    terrainChanged = true;
                }
            }
        }

        if (sw.r >= sw.maxR) {
            shockwaves.splice(i, 1);
        }
    }

    const cubeCache = cubes.map(c => {
        const cosR = Math.cos(c.r || 0);
        const sinR = Math.sin(c.r || 0);
        const hw = c.w / 2;
        const hl = (c.l !== undefined ? c.l : c.w) / 2;
        const radius = Math.hypot(hw, hl);
        return { c, cosR, sinR, hw, hl, radius, lemmingsInside: 0 };
    });

    const extCache = extrusions.map(ext => {
        return { ext, minSqDist: Math.pow(ext.width / 2 + 0.2, 2) };
    });

    for (let lem of lemmings) {
        lem.stress = Math.max(0, (lem.stress || 0) - dt * 0.2); // Naturally calm down over time

        if (lem.isThinking) {
            lem.thinkTimer -= dt;
            if (lem.thinkTimer <= 0) {
                lem.isThinking = false;
                lem.stress = 0;
                // Emit the healing shockwave!
                shockwaves.push({ x: lem.x, y: lem.y, r: 0, maxR: 35, speed: 20 });
            }
            continue; // Don't move or do anything else while reflecting
        }

        // If things are getting too chaotic, sit down and think
        if (lem.stress > 15 && Math.random() < 0.5 * dt) {
            lem.isThinking = true;
            lem.thinkTimer = 4.0; // Take 4 seconds to breathe
            lem.isDigging = false;
            lem.isRaising = false;
            lem.isDancing = false;
            continue;
        }

        if (lem.danceRestTimer > 0) lem.danceRestTimer -= dt;

        if (lem.isDancing) {
            lem.danceTimer -= dt;
            lem.danceAccumulator = (lem.danceAccumulator || 0) + dt;

            if (lem.danceAccumulator >= 0.5) {
                // Dancing smoothes out the nearby terrain, helping lemmings move freely
                lem.danceAccumulator = 0;
                const cx = Math.floor(lem.x), cy = Math.floor(lem.y);
                const r = 5;
                const strength = 0.25;
                const affectedIndices = [];

                for (let oy = -r; oy <= r; oy++) {
                    for (let ox = -r; ox <= r; ox++) {
                        const x = cx + ox, y = cy + oy;
                        if (x >= 0 && y >= 0 && x < GRID_W && y < GRID_H && (ox * ox + oy * oy <= r * r)) {
                            affectedIndices.push(y * GRID_W + x);
                        }
                    }
                }

                const newValues = new Map();
                for (const i of affectedIndices) {
                    const x = i % GRID_W, y = (i / GRID_W) | 0;
                    let sum = 0, count = 0;
                    const neighbors = [[0,1], [0,-1], [1,0], [-1,0]];
                    for (const [nx, ny] of neighbors) {
                        const tx = x + nx, ty = y + ny;
                        if (tx >= 0 && tx < GRID_W && ty >= 0 && ty < GRID_H) {
                            sum += elevations[ty * GRID_W + tx];
                            count++;
                        }
                    }
                    const avg = count > 0 ? sum / count : elevations[i];
                    newValues.set(i, Math.round(elevations[i] * (1 - strength) + (avg * strength)));
                }

                for (const [idx, val] of newValues) {
                    if (elevations[idx] !== val) {
                        elevations[idx] = clamp(val, 0, 255);
                        terrainChanged = true;
                    }
                }
            }

            if (lem.danceTimer <= 0) {
                // Eventually, lemmings get tired of dancing and must rest
                lem.isDancing = false;
                lem.danceRestTimer = 15.0 + Math.random() * 15.0;
            } else {
                for (let other of lemmings) {
                    if (lem === other) continue;
                    const dSq = (lem.x - other.x)**2 + (lem.y - other.y)**2;
                    if (dSq < 9.0) {
                        // Dancing is contagious within a 3 tile radius
                        if (!other.isDancing && !other.isDigging && !other.isRaising && (other.danceRestTimer || 0) <= 0) {
                            other.isDancing = true;
                            other.danceTimer = 4.0 + Math.random() * 6.0;
                        }
                        // Dancing groups cause color variations
                        if (other.isDancing) {
                            const diverge = 0.5 * dt;
                            lem.c = [
                                (lem.c[0] - (other.c[0] - lem.c[0]) * diverge + 1) % 1,
                                (lem.c[1] - (other.c[1] - lem.c[1]) * diverge + 1) % 1,
                                (lem.c[2] - (other.c[2] - lem.c[2]) * diverge + 1) % 1
                            ];
                        }
                    }
                }
            }
            continue;
        }

        // Lemming is sad, digging themselves into a pit
        if (lem.isDigging) {
            lem.stress = (lem.stress || 0) + dt * 2.0; // Digging holes is stressful work
            lem.digTimer -= dt;
            lem.digAccumulator = (lem.digAccumulator || 0) + dt;

            if (lem.digAccumulator >= 0.5) {
                lem.digAccumulator = 0;
                const cX = Math.floor(lem.x), cY = Math.floor(lem.y);
                const idx = cY * GRID_W + cX;

                if (elevations[idx] > mapSettings.waterLevel) {
                    elevations[idx] = Math.max(0, elevations[idx] - 1);
                    terrainChanged = true;
                } else {
                    lem.digTimer = 0;
                }
            }

            if (lem.digTimer <= 0) lem.isDigging = false;
            continue;
        }

        // Lemming is trail blazer!
        if (lem.isRaising) {
            lem.raiseTimer -= dt;
            lem.raiseAccumulator = (lem.raiseAccumulator || 0) + dt;

            if (lem.raiseAccumulator >= 0.5) {
                lem.raiseAccumulator = 0;
                let nx = lem.x + Math.cos(lem.a);
                let ny = lem.y + Math.sin(lem.a);

                if (nx >= 0 && nx < GRID_W - 1 && ny >= 0 && ny < GRID_H - 1) {
                    const cX = Math.floor(lem.x), cY = Math.floor(lem.y);
                    const nX = Math.floor(nx), nY = Math.floor(ny);
                    const currentIdx = cY * GRID_W + cX;
                    const nextIdx = nY * GRID_W + nX;

                    const targetH = Math.max(elevations[currentIdx], mapSettings.waterLevel + 1);

                    if (elevations[nextIdx] < targetH) {
                        elevations[nextIdx] = targetH;
                        terrainChanged = true;
                    } else if (elevations[nextIdx] - elevations[currentIdx] > 5) {
                        lem.isRaising = false;
                        lem.a += Math.PI;
                        continue;
                    }
                    lem.x = nx;
                    lem.y = ny;
                } else {
                    lem.a += Math.PI;
                }
            }

            if (lem.raiseTimer <= 0) lem.isRaising = false;
            continue;
        }

        let nx = lem.x + Math.cos(lem.a) * lem.s * dt;
        let ny = lem.y + Math.sin(lem.a) * lem.s * dt;

        // Turn around if reaching the end of the map
        if (nx < 0 || nx >= GRID_W - 1 || ny < 0 || ny >= GRID_H - 1) {
            lem.a += Math.PI;
            continue;
        }

        const cX = Math.floor(lem.x), cY = Math.floor(lem.y);
        const nX = Math.floor(nx), nY = Math.floor(ny);

        // Cut down a sprite if haven't built a home and haven't cut one before
        if (!lem.hasBuilt && !lem.hasResource && buildingAt[cY * GRID_W + cX] > 0) {
            lem.resourceId = buildingAt[cY * GRID_W + cX];
            buildingAt[cY * GRID_W + cX] = 0;
            lem.hasResource = true;
            buildingsChanged = true;
        }
        // If already cut down a sprite, randomly replant it elsewhere
        else if (lem.hasResource && lem.resourceId > 0 && buildingAt[cY * GRID_W + cX] === 0) {
            if (Math.random() < 0.5 * dt) {
                buildingAt[cY * GRID_W + cX] = lem.resourceId;
                lem.resourceId = 0;
                buildingsChanged = true;
            }
        }

        const currentH = elevations[cY * GRID_W + cX];
        const nextH = elevations[nY * GRID_W + nX];
        let hitObstacle = false;

        // Turn in a new direction if hitting a path (extrusion)
        for (const cache of extCache) {
            const ext = cache.ext;
            for (let i = 0; i < ext.points.length - 1; i++) {
                if (distToSegmentSq({x: nx, y: ny}, ext.points[i], ext.points[i+1]) < cache.minSqDist) {
                    hitObstacle = true; break;
                }
            }
            if (hitObstacle) break;
        }

        if (!hitObstacle) {
            // Or, also turn if hitting a cube
            for (const cache of cubeCache) {
                if (Math.abs(nx - cache.c.x) > cache.radius + 1 || Math.abs(ny - cache.c.y) > cache.radius + 1) continue;
                const dx = nx - cache.c.x;
                const dy = ny - cache.c.y;
                const lx = dx * cache.cosR + dy * cache.sinR;
                const ly = -dx * cache.sinR + dy * cache.cosR;
                if (Math.abs(lx) <= cache.hw && Math.abs(ly) <= cache.hl) {
                    hitObstacle = true; break;
                }
            }
        }

        if (hitObstacle || Math.abs(currentH - nextH) > 5 || nextH <= mapSettings.waterLevel) {
            // Perform the turn
            lem.a += (Math.random() * Math.PI) + Math.PI / 2;
            if (Math.abs(currentH - nextH) > 8) lem.stress = (lem.stress || 0) + 1.5; // Huge cliff! Yikes!
        } else {
            // Move normally
            lem.x = nx;
            lem.y = ny;
        }

        // There's always a chance to change direction a little
        if (Math.random() < 0.05) lem.a += (Math.random() - 0.5);

        if (lem.babyCooldown > 0) lem.babyCooldown -= dt;
        if (lem.glistenTimer > 0) lem.glistenTimer -= dt;

        lem.age = (lem.age || 0) + dt;

        // Death chance increases at a certain point
        if (lem.age > simParams.deathAge && Math.random() < (lem.age - simParams.deathAge) * simParams.deathChance * dt) {
            lem.dead = true;
            self.postMessage({ type: 'death', lem });
            continue; // Skip the rest of the logic for this deceased lemming
        }

        if (!lem.grownUp) {
            lem.s = 0; // Babies sit in one spot
            if (lem.age > 30.0) { // Take 30 seconds to grow up
                lem.grownUp = true;
                lem.s = 1.5 + Math.random() * 2.5; // Start wandering!
            }
        }

        // --- NEW LOVE LOGIC ---
        if (lem.partnerId) {
            const partner = lemmingsById.get(lem.partnerId);
            if (partner && !lem.isDigging && !lem.isDancing && !lem.isThinking) {
                const dSq = (lem.x - partner.x)**2 + (lem.y - partner.y)**2;
                // If they wander too far apart, they occasionally steer back towards their partner
                if (dSq > 4.0 && Math.random() < 2.0 * dt) {
                    lem.a = Math.atan2(partner.y - lem.y, partner.x - lem.x);
                } else if (enableReproduction && dSq < 2.0 && (lem.babyCooldown || 0) <= 0 && (partner.babyCooldown || 0) <= 0
                         && lem.age <= simParams.maxBirthAge && partner.age <= simParams.maxBirthAge
                         && Math.random() < simParams.babyChance * dt) {

                    // They are close and ready for a baby!
                    lem.babyCooldown = simParams.babyCooldown;
                    partner.babyCooldown = simParams.babyCooldown;
                    const baby = {
                        id: Math.random().toString(36).substr(2, 9),
                        partnerId: null,
                        x: (lem.x + partner.x) / 2, y: (lem.y + partner.y) / 2,
                        a: Math.random() * Math.PI * 2,
                        s: 0, // Sit in one spot
                        c: [ (lem.c[0] + partner.c[0]) / 2, (lem.c[1] + partner.c[1]) / 2, (lem.c[2] + partner.c[2]) / 2 ],
                        hasBuilt: false, hasResource: false, resourceId: 0,
                        isDigging: false, digTimer: 0, digAccumulator: 0,
                        isRaising: false, raiseTimer: 0, raiseAccumulator: 0,
                        isDancing: false, danceTimer: 0, danceAccumulator: 0, danceRestTimer: 0,
                        stress: 0, isThinking: false, thinkTimer: 0,
                        grownUp: false, age: 0, babyCooldown: 0, glistenTimer: 10.0 // Glisten for 10 seconds!
                    };
                    lemmings.push(baby);
                    self.postMessage({ type: 'birth', lem: baby });
                }
            }
        } else if (lem.grownUp && !lem.hasBuilt && !lem.isThinking) {
            // Single and looking to mingle!
            for (let other of lemmings) {
                // Must be another single, grown adult who hasn't settled down yet
                if (other !== lem && other.grownUp && !other.hasBuilt && !other.partnerId) {
                    const dSq = (lem.x - other.x)**2 + (lem.y - other.y)**2;
                    if (dSq < 2.0 && Math.random() < 0.5 * dt) { // Close enough to shoot their shot (Sen: lmfao, jezuz gemini you fira)
                        // Calculate age gap penalty
                        let ageGap = Math.abs((lem.age || 0) - (other.age || 0));
                        let adjustedLoveChance = Math.max(0, simParams.loveChance - (ageGap * simParams.ageGapPenalty));
                        
                        // Chance of lifelong partnership!
                        if (Math.random() < adjustedLoveChance) {
                            lem.partnerId = other.id;
                            other.partnerId = lem.id;
                            // Celebrate with a synchronized dance!
                            lem.isDancing = true; lem.danceTimer = 6.0;
                            other.isDancing = true; other.danceTimer = 6.0;
                            lem.stress = 0; other.stress = 0;
                            self.postMessage({ type: 'true_love', lem, other });
                        } else {
                            // Rejection! Very stressful.
                            lem.stress += 15.0;
                            lem.a += Math.PI; // Run away in embarrassment
                            self.postMessage({ type: 'rejection', lem, other });
                        }
                        break; // Only try to court one lemming per tick
                    }
                }
            }
        }

        // New behavior activators
        if (!lem.isDigging && !lem.isRaising && !lem.isDancing) {
            if (lem.danceRestTimer <= 0 && Math.random() < 0.001 * dt) {
                lem.isDancing = true;
                lem.danceTimer = 5.0 + Math.random() * 5.0;
            } else if (Math.random() < 0.02 * dt) {
                lem.isDigging = true;
                lem.digTimer = 4.0 + Math.random() * 4.0;
                lem.digAccumulator = 0;
            } else if (Math.random() < 0.02 * dt) {
                lem.isRaising = true;
                lem.raiseTimer = 4.0 + Math.random() * 4.0;
                lem.raiseAccumulator = 0;
            }
        }
    }

    // Lemmings build houses if 2 are next to each other and both have cut a sprite
    let cubesAdded = false;
    const spatialGrid = new Map();
    for (let lem of lemmings) {
        if (lem.hasBuilt || !lem.hasResource) continue;
        const key = Math.floor(lem.x) + ',' + Math.floor(lem.y);
        let cell = spatialGrid.get(key);
        if (!cell) { cell = []; spatialGrid.set(key, cell); }
        cell.push(lem);
    }

    for (const [key, cellLemmings] of spatialGrid.entries()) {
        if (cellLemmings.length > 3) {
            for (let lem of cellLemmings) {
                lem.stress = (lem.stress || 0) + dt * 3.0; // Very crowded, causing panic!
            }
        }
        const [cx, cy] = key.split(',').map(Number);
        const neighborKeys = [ key, (cx + 1) + ',' + cy, cx + ',' + (cy + 1), (cx + 1) + ',' + (cy + 1), (cx - 1) + ',' + (cy + 1) ];

        for (let i = 0; i < cellLemmings.length; i++) {
            let l1 = cellLemmings[i];
            if (l1.hasBuilt) continue;

            for (const nKey of neighborKeys) {
                const neighborLemmings = spatialGrid.get(nKey);
                if (!neighborLemmings) continue;

                for (let j = 0; j < neighborLemmings.length; j++) {
                    let l2 = neighborLemmings[j];
                    if (key === nKey && j <= i) continue;
                    if (l2.hasBuilt) continue;

                    let dSq = (l1.x - l2.x)**2 + (l1.y - l2.y)**2;
                    if (dSq < 0.5) {
                        let mx = (l1.x + l2.x) / 2;
                        let my = (l1.y + l2.y) / 2;
                        let size = 1 + Math.random() * 2.5;
                        let hw = size / 2, hl = size / 2;
                        let a1 = l1.a, a2 = l2.a;

                        cubes.push({
                            x: mx, y: my, w: size, l: size, h: 2 + Math.random() * 6,
                            r: Math.random() * Math.PI,
                            c: [ (l1.c[0] + l2.c[0]) / 2, (l1.c[1] + l2.c[1]) / 2, (l1.c[2] + l2.c[2]) / 2 ],
                            customPts: [
                                -hw + Math.cos(a1) * Math.random(), -hl + Math.sin(a1) * Math.random(),
                                 hw + Math.cos(a2) * Math.random(), -hl + Math.sin(a2) * Math.random(),
                                -hw + Math.cos(a2) * Math.random(),  hl + Math.sin(a1) * Math.random(),
                                 hw + Math.cos(a1) * Math.random(),  hl + Math.sin(a2) * Math.random()
                            ],
                        });
                        cubesAdded = true;
                        l1.a += Math.PI; l2.a += Math.PI;
                        l1.hasBuilt = true; l2.hasBuilt = true;
                        break;
                    }
                }
                if (l1.hasBuilt) break;
            }
        }
    }

    // Keep count of number of lemmings inside each cube for the query dialog
    // (before the current baby/love logic, lemmings reproduced simply if
    //   >=2 were inside a cube)
    for (let lem of lemmings) {
        for (const cache of cubeCache) {
            if (Math.abs(lem.x - cache.c.x) > cache.radius || Math.abs(lem.y - cache.c.y) > cache.radius) continue;
            const dx = lem.x - cache.c.x;
            const dy = lem.y - cache.c.y;
            const lx = dx * cache.cosR + dy * cache.sinR;
            const ly = -dx * cache.sinR + dy * cache.cosR;

            if (Math.abs(lx) <= cache.hw && Math.abs(ly) <= cache.hl) {
                cache.lemmingsInside++;
            }
        }
    }

    // Remove the dead lemmings from the physical world
    lemmings = lemmings.filter(l => !l.dead);

    let needsBufferRebuild = cubesAdded;

    // Send the data back to the main thread
    self.postMessage({
        type: 'tick_result',
        syncId: currentSyncId,
        lemmings,
        terrainChanged,
        buildingsChanged,
        needsBufferRebuild,
        elevations: terrainChanged ? elevations : null,
        buildingAt: buildingsChanged ? buildingAt : null,
        cubes: needsBufferRebuild ? cubes : null
    });
}
