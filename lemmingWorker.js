// lemmingWorker.js

function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }
function distToSegmentSq(p, v, w) {
    const l2 = (v.x - w.x)**2 + (v.y - w.y)**2;
    if (l2 === 0) return (p.x - v.x)**2 + (p.y - v.y)**2;
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return (p.x - (v.x + t * (w.x - v.x)))**2 + (p.y - (v.y + t * (w.y - v.y)))**2;
}

self.onmessage = function(e) {
    const { dt, start, end, lemmings, cubes, extrusions, elevations, buildingAt, mapSettings, GRID_W, GRID_H, enableReproduction } = e.data;

    let terrainChanges = [];
    let buildingChanges = [];
    let newCubes = [];
    let newLemmings = [];
    let cubeHeightChanges = [];

    // --- OPTIMIZATION 1: Cache Obstacle Data ---
    const cubeCache = cubes.map((c, i) => {
        const cosR = Math.cos(c.r || 0);
        const sinR = Math.sin(c.r || 0);
        const hw = c.w / 2;
        const hl = (c.l !== undefined ? c.l : c.w) / 2;
        const radius = Math.hypot(hw, hl);
        return { originalIndex: i, c, cosR, sinR, hw, hl, radius, lemmingsInside: 0 };
    });

    const extCache = extrusions.map(ext => {
        return { ext, minSqDist: Math.pow(ext.width / 2 + 0.2, 2) };
    });

    // Process only this worker's chunk
    for (let i = start; i < end; i++) {
        let lem = lemmings[i];

        // Tick Rest Timer
        if (lem.danceRestTimer > 0) lem.danceRestTimer -= dt;

        // Dancer State
        if (lem.isDancing) {
            lem.danceTimer -= dt;
            if (lem.danceTimer <= 0) {
                lem.isDancing = false;
                lem.danceRestTimer = 15.0 + Math.random() * 15.0;
            } else {
                for (let other of lemmings) {
                    if (lem === other) continue;
                    const dSq = (lem.x - other.x)**2 + (lem.y - other.y)**2;
                    if (dSq < 9.0 && !other.isDancing && !other.isDigging && !other.isRaising && (other.danceRestTimer || 0) <= 0) {
                        other.isDancing = true;
                        other.danceTimer = 4.0 + Math.random() * 6.0;
                    }
                    if (other.isDancing) {
                        const blend = 0.5 * dt;
                        lem.c[0] += (other.c[0] - lem.c[0]) * blend;
                        lem.c[1] += (other.c[1] - lem.c[1]) * blend;
                        lem.c[2] += (other.c[2] - lem.c[2]) * blend;
                    }
                }
            }
            continue;
        }

        // Digger State
        if (lem.isDigging) {
            lem.digTimer -= dt;
            lem.digAccumulator = (lem.digAccumulator || 0) + dt;
            if (lem.digAccumulator >= 0.5) {
                lem.digAccumulator = 0;
                const cX = Math.floor(lem.x), cY = Math.floor(lem.y);
                const idx = cY * GRID_W + cX;
                if (elevations[idx] > mapSettings.waterLevel) {
                    elevations[idx] = Math.max(0, elevations[idx] - 1);
                    terrainChanges.push({ idx, h: elevations[idx] });
                } else {
                    lem.digTimer = 0;
                }
            }
            if (lem.digTimer <= 0) lem.isDigging = false;
            continue;
        }

        // Raiser State
        if (lem.isRaising) {
            lem.raiseTimer -= dt;
            lem.raiseAccumulator = (lem.raiseAccumulator || 0) + dt;
            if (lem.raiseAccumulator >= 0.5) {
                lem.raiseAccumulator = 0;
                let nx = lem.x + Math.cos(lem.a), ny = lem.y + Math.sin(lem.a);
                if (nx >= 0 && nx < GRID_W - 1 && ny >= 0 && ny < GRID_H - 1) {
                    const cX = Math.floor(lem.x), cY = Math.floor(lem.y);
                    const nX = Math.floor(nx), nY = Math.floor(ny);
                    const currentIdx = cY * GRID_W + cX, nextIdx = nY * GRID_W + nX;
                    const targetH = Math.max(elevations[currentIdx], mapSettings.waterLevel + 1);

                    if (elevations[nextIdx] < targetH) {
                        elevations[nextIdx] = targetH;
                        terrainChanges.push({ idx: nextIdx, h: targetH });
                    } else if (elevations[nextIdx] - elevations[currentIdx] > 5) {
                        lem.isRaising = false; lem.a += Math.PI;
                        continue;
                    }
                    lem.x = nx; lem.y = ny;
                } else {
                    lem.a += Math.PI;
                }
            }
            if (lem.raiseTimer <= 0) lem.isRaising = false;
            continue;
        }

        // Normal Wandering Logic
        let nx = lem.x + Math.cos(lem.a) * lem.s * dt;
        let ny = lem.y + Math.sin(lem.a) * lem.s * dt;

        if (nx < 0 || nx >= GRID_W - 1 || ny < 0 || ny >= GRID_H - 1) {
            lem.a += Math.PI;
            continue;
        }

        const cX = Math.floor(lem.x), cY = Math.floor(lem.y);
        const nX = Math.floor(nx), nY = Math.floor(ny);
        const tileIdx = cY * GRID_W + cX;

        if (!lem.hasBuilt && !lem.hasResource && buildingAt[tileIdx] > 0) {
            lem.resourceId = buildingAt[tileIdx];
            buildingAt[tileIdx] = 0;
            buildingChanges.push({ idx: tileIdx, id: 0 });
            lem.hasResource = true;
        } else if (lem.hasResource && lem.resourceId > 0 && buildingAt[tileIdx] === 0) {
            if (Math.random() < 0.5 * dt) {
                buildingAt[tileIdx] = lem.resourceId;
                buildingChanges.push({ idx: tileIdx, id: lem.resourceId });
                lem.resourceId = 0;
            }
        }

        let hitObstacle = false;
        for (const cache of extCache) {
            for (let i = 0; i < cache.ext.points.length - 1; i++) {
                if (distToSegmentSq({x: nx, y: ny}, cache.ext.points[i], cache.ext.points[i+1]) < cache.minSqDist) { hitObstacle = true; break; }
            }
            if (hitObstacle) break;
        }

        if (!hitObstacle) {
            for (const cache of cubeCache) {
                if (Math.abs(nx - cache.c.x) > cache.radius + 1 || Math.abs(ny - cache.c.y) > cache.radius + 1) continue;
                const dx = nx - cache.c.x, dy = ny - cache.c.y;
                const lx = dx * cache.cosR + dy * cache.sinR, ly = -dx * cache.sinR + dy * cache.cosR;
                if (Math.abs(lx) <= cache.hw && Math.abs(ly) <= cache.hl) { hitObstacle = true; break; }
            }
        }

        if (hitObstacle || Math.abs(elevations[cY * GRID_W + cX] - elevations[nY * GRID_W + nX]) > 5 || elevations[nY * GRID_W + nX] <= mapSettings.waterLevel) {
            lem.a += (Math.random() * Math.PI) + Math.PI / 2;
        } else {
            lem.x = nx; lem.y = ny;
        }

        if (Math.random() < 0.05) lem.a += (Math.random() - 0.5);

        if (!lem.grownUp && Math.random() < 0.001 * dt) lem.grownUp = true;

        if (!lem.isDigging && !lem.isRaising && !lem.isDancing) {
            if (lem.danceRestTimer <= 0 && Math.random() < 0.01 * dt) {
                lem.isDancing = true; lem.danceTimer = 5.0 + Math.random() * 5.0;
            } else if (Math.random() < 0.02 * dt) {
                lem.isDigging = true; lem.digTimer = 4.0 + Math.random() * 4.0; lem.digAccumulator = 0;
            } else if (Math.random() < 0.02 * dt) {
                lem.isRaising = true; lem.raiseTimer = 4.0 + Math.random() * 4.0; lem.raiseAccumulator = 0;
            }
        }
    }

    // --- OPTIMIZATION 2: Spatial Partitioning for Builders ---
    const spatialGrid = new Map();
    for (let i = 0; i < lemmings.length; i++) {
        let lem = lemmings[i];
        if (lem.hasBuilt || !lem.hasResource) continue;
        const key = Math.floor(lem.x) + ',' + Math.floor(lem.y);
        let cell = spatialGrid.get(key);
        if (!cell) { cell = []; spatialGrid.set(key, cell); }
        cell.push({ lem, isLocal: i >= start && i < end }); 
    }

    for (const [key, cellData] of spatialGrid.entries()) {
        const [cx, cy] = key.split(',').map(Number);
        const neighborKeys = [key, (cx+1)+','+cy, cx+','+(cy+1), (cx+1)+','+(cy+1), (cx-1)+','+(cy+1)];

        for (let i = 0; i < cellData.length; i++) {
            let item1 = cellData[i];
            if (!item1.isLocal || item1.lem.hasBuilt) continue; // Only process pairs if the first lemming belongs to THIS core

            for (const nKey of neighborKeys) {
                const neighborData = spatialGrid.get(nKey);
                if (!neighborData) continue;

                for (let j = 0; j < neighborData.length; j++) {
                    let item2 = neighborData[j];
                    if (key === nKey && j <= i) continue;
                    if (item2.lem.hasBuilt) continue;

                    let dSq = (item1.lem.x - item2.lem.x)**2 + (item1.lem.y - item2.lem.y)**2;
                    if (dSq < 0.5) {
                        let mx = (item1.lem.x + item2.lem.x) / 2, my = (item1.lem.y + item2.lem.y) / 2;
                        let size = 1 + Math.random() * 2.5;
                        let a1 = item1.lem.a, a2 = item2.lem.a;

                        newCubes.push({
                            x: mx, y: my, w: size, l: size, h: 2 + Math.random() * 6, r: Math.random() * Math.PI,
                            c: [ (item1.lem.c[0]+item2.lem.c[0])/2, (item1.lem.c[1]+item2.lem.c[1])/2, (item1.lem.c[2]+item2.lem.c[2])/2 ],
                            customPts: [
                                -(size/2) + Math.cos(a1) * Math.random(), -(size/2) + Math.sin(a1) * Math.random(),
                                 (size/2) + Math.cos(a2) * Math.random(), -(size/2) + Math.sin(a2) * Math.random(),
                                -(size/2) + Math.cos(a2) * Math.random(),  (size/2) + Math.sin(a1) * Math.random(),
                                 (size/2) + Math.cos(a1) * Math.random(),  (size/2) + Math.sin(a2) * Math.random()
                            ]
                        });

                        item1.lem.a += Math.PI; item2.lem.a += Math.PI;
                        item1.lem.hasBuilt = true; item2.lem.hasBuilt = true;
                        break;
                    }
                }
                if (item1.lem.hasBuilt) break;
            }
        }
    }

    // --- OPTIMIZATION 3: Count Cube Occupancy ---
    // Instead of spawning here, we just tell the main thread how many
    // of THIS worker's lemmings are in each cube.
    let cubeOccupancy = {};

    for (let i = start; i < end; i++) {
        let lem = lemmings[i]; // Use the updated position
        for (const cache of cubeCache) {
            if (Math.abs(lem.x - cache.c.x) > cache.radius || Math.abs(lem.y - cache.c.y) > cache.radius) continue;
            const dx = lem.x - cache.c.x, dy = lem.y - cache.c.y;
            const lx = dx * cache.cosR + dy * cache.sinR, ly = -dx * cache.sinR + dy * cache.cosR;
            if (Math.abs(lx) <= cache.hw && Math.abs(ly) <= cache.hl) {
                cubeOccupancy[cache.originalIndex] = (cubeOccupancy[cache.originalIndex] || 0) + 1;
            }
        }
    }

    self.postMessage({
        start, end,
        updatedLemmings: lemmings.slice(start, end),
        terrainChanges, buildingChanges, newCubes, cubeOccupancy
    });
};
