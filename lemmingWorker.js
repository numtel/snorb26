let GRID_W = 256, GRID_H = 256;
let elevations, buildingAt, mapSettings = { waterLevel: 86 };
let extrusions = [], cubes = [], lemmings = [];
let enableReproduction = true;
let currentSyncId = 0;

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
        if (lem.danceRestTimer > 0) lem.danceRestTimer -= dt;

        if (lem.isDancing) {
            lem.danceTimer -= dt;
            lem.danceAccumulator = (lem.danceAccumulator || 0) + dt;

            if (lem.danceAccumulator >= 0.5) {
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
                lem.isDancing = false;
                lem.danceRestTimer = 15.0 + Math.random() * 15.0;
            } else {
                for (let other of lemmings) {
                    if (lem === other) continue;
                    const dSq = (lem.x - other.x)**2 + (lem.y - other.y)**2;
                    if (dSq < 9.0) {
                        if (!other.isDancing && !other.isDigging && !other.isRaising && (other.danceRestTimer || 0) <= 0) {
                            other.isDancing = true;
                            other.danceTimer = 4.0 + Math.random() * 6.0;
                        }
                        if (other.isDancing) {
                            const diverge = 0.5 * dt;
                            lem.c[0] = (lem.c[0] - (other.c[0] - lem.c[0]) * diverge + 1) % 1;
                            lem.c[1] = (lem.c[1] - (other.c[1] - lem.c[1]) * diverge + 1) % 1;
                            lem.c[2] = (lem.c[2] - (other.c[2] - lem.c[2]) * diverge + 1) % 1;
                        }
                    }
                }
            }
            continue;
        }

        if (lem.isDigging) {
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

        if (nx < 0 || nx >= GRID_W - 1 || ny < 0 || ny >= GRID_H - 1) {
            lem.a += Math.PI;
            continue;
        }

        const cX = Math.floor(lem.x), cY = Math.floor(lem.y);
        const nX = Math.floor(nx), nY = Math.floor(ny);

        if (!lem.hasBuilt && !lem.hasResource && buildingAt[cY * GRID_W + cX] > 0) {
            lem.resourceId = buildingAt[cY * GRID_W + cX];
            buildingAt[cY * GRID_W + cX] = 0;
            lem.hasResource = true;
            buildingsChanged = true;
        }
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
            lem.a += (Math.random() * Math.PI) + Math.PI / 2;
        } else {
            lem.x = nx;
            lem.y = ny;
        }

        if (Math.random() < 0.05) lem.a += (Math.random() - 0.5);

        if (!lem.grownUp && Math.random() < 0.001 * dt) lem.grownUp = true;

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

    let needsBufferRebuild = cubesAdded;

    if(enableReproduction) {
      for (let cache of cubeCache) {
          let c = cache.c;
          if (cache.lemmingsInside >= 2) {
              c.reproduceTimer = (c.reproduceTimer || 0) + dt;
              if (c.reproduceTimer >= 30.0) {
                  c.reproduceTimer = 0;
                  c.h += 1.5;
                  needsBufferRebuild = true;

                  const maxDim = Math.max(c.w, c.l !== undefined ? c.l : c.w);
                  const spawnRadius = (maxDim / 2) + 0.5;
                  const angle = Math.random() * Math.PI * 2;

                  const spawnX = clamp(c.x + Math.cos(angle) * spawnRadius, 1, GRID_W - 2);
                  const spawnY = clamp(c.y + Math.sin(angle) * spawnRadius, 1, GRID_H - 2);

                  lemmings.push({
                      x: spawnX, y: spawnY, a: angle,
                      s: 1.5 + Math.random() * 2.5,
                      c: [Math.random(), Math.random(), Math.random()],
                      hasBuilt: false, hasResource: false, resourceId: 0,
                      isDigging: false, digTimer: 0, digAccumulator: 0,
                      isRaising: false, raiseTimer: 0, raiseAccumulator: 0,
                      isDancing: false, danceTimer: 0, danceAccumulator: 0,
                      grownUp: false,
                  });
              }
          } else {
              c.reproduceTimer = 0;
          }
      }
    }

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
