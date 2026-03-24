'use strict';

const { C, cfg: getCfg } = require('./config');
const state = require('./state');
const { resolveTankCollision, findFirstWallCollision, raycastBulletSpawn } = require('./physics');
const { bfsNextWaypoint, selectMissileTarget, bfsFullPath } = require('./pathfinding');
const { spawnPowerUp } = require('./powerups');
const { broadcastState } = require('./broadcast');

function createTick(endRound) {
  return function tick() {
    if (!state.currentMap) return;
    const now = performance.now();
    const DT = state.lastTickTime ? Math.min((now - state.lastTickTime) / 1000, 0.05) : 1 / 60; // cap at 50ms
    state.lastTickTime = now;
    const map = state.currentMap;
    state.frameHits = [];
    state.frameDeaths = [];

    const { players, bullets, missiles, wirelessMissiles, landmines, iceTraps, powerUps } = state;

    // --- Tank Movement ---
    for (const [id, player] of players) {
      if (!player.alive) continue;
      if (player.fireCooldown > 0) player.fireCooldown -= DT;
      if (player.pilotingMissileId !== null) {
        const keys = player.input;
        if (keys.space && !player.spacePrev) {
          // Self-destruct the missile and regain tank control
          const wmIdx = wirelessMissiles.findIndex(wm => wm.id === player.pilotingMissileId);
          if (wmIdx !== -1) {
            const wm = wirelessMissiles[wmIdx];
            state.frameDeaths.push({ x: wm.x, y: wm.y, color: player.color });
            wirelessMissiles.splice(wmIdx, 1);
          }
          player.pilotingMissileId = null;
        }
        player.spacePrev = keys.space;
        continue; // Input is consumed by wireless missile tick
      }
      const keys = player.input;

      // Desired rotation and movement
      let desiredAngVel = 0;
      if (keys.a) desiredAngVel = -C.ROTATION_SPEED;
      if (keys.d) desiredAngVel = C.ROTATION_SPEED;

      let desiredVx = 0, desiredVy = 0;
      if (keys.w) {
        desiredVx = Math.cos(player.angle) * C.TANK_SPEED;
        desiredVy = Math.sin(player.angle) * C.TANK_SPEED;
      } else if (keys.s) {
        desiredVx = -Math.cos(player.angle) * C.TANK_SPEED;
        desiredVy = -Math.sin(player.angle) * C.TANK_SPEED;
      }

      if (player.iceTimer > 0) {
        player.iceTimer -= DT;
        // Preserve velocity (very low traction = barely slows down)
        player.vx += (desiredVx - player.vx) * C.ICE_TRACTION * DT;
        player.vy += (desiredVy - player.vy) * C.ICE_TRACTION * DT;
        // Turn speed is slow but responsive enough to be controllable
        player.angularVel += (desiredAngVel - player.angularVel) * C.ICE_TURN_TRACTION * DT;
      } else {
        player.vx = desiredVx;
        player.vy = desiredVy;
        player.angularVel = desiredAngVel;
      }

      player.angle += player.angularVel * DT;

      const dx = player.vx * DT;
      const dy = player.vy * DT;

      if (dx !== 0 || dy !== 0) {
        const resolved = resolveTankCollision(player.x + dx, player.y + dy, C.TANK_RADIUS, map);
        player.x = resolved.x;
        player.y = resolved.y;
      }

      // --- Firing (edge trigger) ---
      if (keys.space && !player.spacePrev) {
        const cfg = getCfg();
        if (player.powerUp === 'missile') {
          const cosA = Math.cos(player.angle);
          const sinA = Math.sin(player.angle);
          const spawnDist = cfg.barrelLength + 0.15;
          missiles.push({
            id: state.nextMissileId++,
            ownerId: id,
            x: player.x + cosA * spawnDist,
            y: player.y + sinA * spawnDist,
            vx: cosA * C.MISSILE_ARM_SPEED,
            vy: sinA * C.MISSILE_ARM_SPEED,
            targetId: null,
            retargetTimer: 0,
            lifetime: C.MISSILE_LIFETIME,
            armTimer: C.MISSILE_ARM_TIME,
          });
          player.powerUp = null;
        } else if (player.powerUp === 'landmine') {
          landmines.push({
            id: state.nextLandmineId++,
            x: player.x,
            y: player.y,
            ownerId: id,
            armTimer: C.LANDMINE_ARM_TIME,
            fadeTimer: C.LANDMINE_FADE_TIME,
          });
          player.powerUp = null;
        } else if (player.powerUp === 'ice') {
          iceTraps.push({
            id: state.nextIceTrapId++,
            x: player.x,
            y: player.y,
            ownerId: id,
            armTimer: C.ICE_ARM_TIME,
            fadeTimer: C.ICE_FADE_TIME,
          });
          player.powerUp = null;
        } else if (player.powerUp === 'wirelessMissile') {
          const cosA = Math.cos(player.angle);
          const sinA = Math.sin(player.angle);
          const spawnDist = cfg.barrelLength + 0.15;
          const wm = {
            id: state.nextWirelessMissileId++,
            pilotId: id,
            x: player.x + cosA * spawnDist,
            y: player.y + sinA * spawnDist,
            angle: player.angle,
            lifetime: C.WIRELESS_MISSILE_LIFETIME,
            pathfindTick: C.PATHFIND_INTERVAL, // compute immediately on first tick
            paths: [],
          };
          wirelessMissiles.push(wm);
          player.pilotingMissileId = wm.id;
          player.powerUp = null;
        } else {
          // Check if player has no active bullet and cooldown has expired
          const hasActiveBullet = bullets.some(b => b.ownerId === id);
          if (!hasActiveBullet && player.fireCooldown <= 0) {
            const cosA = Math.cos(player.angle);
            const sinA = Math.sin(player.angle);
            let bdx = cosA * C.BULLET_SPEED;
            let bdy = sinA * C.BULLET_SPEED;

            // Raycast from tank center toward barrel tip to find first wall hit
            const spawnDist = cfg.barrelLength;
            const tipX = player.x + cosA * spawnDist;
            const tipY = player.y + sinA * spawnDist;
            const hit = raycastBulletSpawn(player.x, player.y, tipX, tipY, C.BULLET_RADIUS, map);

            let bx, by;
            if (hit) {
              bx = hit.x;
              by = hit.y;
              if (hit.type === 'h') {
                bdy = -bdy;
              } else {
                bdx = -bdx;
              }
            } else {
              bx = tipX;
              by = tipY;
            }

            bullets.push({
              ownerId: id,
              x: bx,
              y: by,
              dx: bdx,
              dy: bdy,
              bouncesLeft: hit ? C.MAX_BOUNCES - 1 : C.MAX_BOUNCES,
            });
            player.fireCooldown = C.FIRE_COOLDOWN;

            if (hit) {
              state.frameHits.push({ x: bx, y: by });
            }
          }
        }
      }
      player.spacePrev = keys.space;
    }

    // --- Bullet Movement & Wall Bouncing (substep + normal-based reflection) ---
    // Wall segments are inset at perpendicular corners so bullets hit the flat
    // face of the wall rather than the shared corner point (which would reflect
    // back toward the shooter instead of at the correct angle).
    const WALL_INSET = 0.06;

    // Find closest point on segment to circle center, return {cx, cy, dist}
    function closestPointOnSeg(px, py, x1, y1, x2, y2) {
      const abx = x2 - x1, aby = y2 - y1;
      const acx = px - x1, acy = py - y1;
      const ab2 = abx * abx + aby * aby;
      const t = ab2 === 0 ? 0 : Math.max(0, Math.min(1, (acx * abx + acy * aby) / ab2));
      const cx = x1 + t * abx, cy = y1 + t * aby;
      return { cx, cy, dist: Math.hypot(px - cx, py - cy) };
    }

    // Check if a perpendicular wall exists at a horizontal wall's endpoint
    function hWallHasCorner(row, col, hWalls, vWalls, rows, cols) {
      // col is the x-coordinate of the endpoint. Check vertical walls meeting there.
      if (col >= 0 && col <= cols) {
        // vWall above: vWalls[row-1][col] spans (col, row-1) to (col, row)
        if (row > 0 && vWalls[row - 1] && vWalls[row - 1][col]) return true;
        // vWall below: vWalls[row][col] spans (col, row) to (col, row+1)
        if (row < rows && vWalls[row] && vWalls[row][col]) return true;
      }
      return false;
    }

    // Check if a perpendicular wall exists at a vertical wall's endpoint
    function vWallHasCorner(row, col, hWalls, vWalls, rows, cols) {
      // row is the y-coordinate of the endpoint. Check horizontal walls meeting there.
      if (row >= 0 && row <= rows) {
        // hWall to left: hWalls[row][col-1] spans (col-1, row) to (col, row)
        if (col > 0 && hWalls[row] && hWalls[row][col - 1]) return true;
        // hWall to right: hWalls[row][col] spans (col, row) to (col+1, row)
        if (col < cols && hWalls[row] && hWalls[row][col]) return true;
      }
      return false;
    }

    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      const { rows, cols, hWalls, vWalls } = map;

      // Substep: steps no larger than ~90% of bullet radius
      const moveX = b.dx * DT;
      const moveY = b.dy * DT;
      const moveDist = Math.sqrt(moveX * moveX + moveY * moveY);
      const maxStep = C.BULLET_RADIUS * 0.9;
      const numSteps = Math.max(1, Math.ceil(moveDist / maxStep));
      const stepX = moveX / numSteps;
      const stepY = moveY / numSteps;

      let destroyed = false;
      for (let step = 0; step < numSteps; step++) {
        b.x += stepX;
        b.y += stepY;

        // Find the deepest penetrating wall collision
        let bestDist = Infinity;
        let bestCx = 0, bestCy = 0; // closest point on wall to bullet center

        const minRow = Math.max(0, Math.floor(b.y - 1));
        const maxRow = Math.min(rows, Math.floor(b.y + 1) + 1);
        const minCol = Math.max(0, Math.floor(b.x - 1));
        const maxCol = Math.min(cols, Math.floor(b.x + 1) + 1);

        // Horizontal walls
        for (let row = minRow; row <= maxRow; row++) {
          for (let c = minCol; c <= Math.min(cols - 1, maxCol); c++) {
            if (row > rows || c >= cols) continue;
            if (!hWalls[row] || !hWalls[row][c]) continue;
            // Inset at corners with perpendicular walls
            const li = hWallHasCorner(row, c, hWalls, vWalls, rows, cols) ? WALL_INSET : 0;
            const ri = hWallHasCorner(row, c + 1, hWalls, vWalls, rows, cols) ? WALL_INSET : 0;
            const cp = closestPointOnSeg(b.x, b.y, c + li, row, c + 1 - ri, row);
            if (cp.dist < C.BULLET_RADIUS && cp.dist < bestDist) {
              bestDist = cp.dist;
              bestCx = cp.cx;
              bestCy = cp.cy;
            }
          }
        }

        // Vertical walls
        for (let c = minCol; c <= maxCol; c++) {
          for (let row = minRow; row <= Math.min(rows - 1, maxRow); row++) {
            if (c > cols || row >= rows) continue;
            if (!vWalls[row] || !vWalls[row][c]) continue;
            // Inset at corners with perpendicular walls
            const ti = vWallHasCorner(row, c, hWalls, vWalls, rows, cols) ? WALL_INSET : 0;
            const bi = vWallHasCorner(row + 1, c, hWalls, vWalls, rows, cols) ? WALL_INSET : 0;
            const cp = closestPointOnSeg(b.x, b.y, c, row + ti, c, row + 1 - bi);
            if (cp.dist < C.BULLET_RADIUS && cp.dist < bestDist) {
              bestDist = cp.dist;
              bestCx = cp.cx;
              bestCy = cp.cy;
            }
          }
        }

        if (bestDist < C.BULLET_RADIUS) {
          state.frameHits.push({ x: b.x, y: b.y });
          b.bouncesLeft--;
          if (b.bouncesLeft < 0) {
            bullets.splice(i, 1);
            destroyed = true;
            break;
          }

          // Normal: from closest wall point toward bullet center
          let nx = b.x - bestCx;
          let ny = b.y - bestCy;
          const nLen = Math.hypot(nx, ny);
          if (nLen > 0.0001) {
            nx /= nLen;
            ny /= nLen;
          } else {
            // Bullet center is exactly on the wall — use velocity to determine push direction
            nx = -b.dx;
            ny = -b.dy;
            const vLen = Math.hypot(nx, ny);
            if (vLen > 0) { nx /= vLen; ny /= vLen; }
          }

          // Reflect velocity: v' = v - 2(v·n)n
          const dot = b.dx * nx + b.dy * ny;
          b.dx -= 2 * dot * nx;
          b.dy -= 2 * dot * ny;

          // Push bullet out of wall along normal
          b.x = bestCx + nx * C.BULLET_RADIUS;
          b.y = bestCy + ny * C.BULLET_RADIUS;

          // After a bounce, skip remaining substeps (prevents double-bounce glitches)
          break;
        }
      }
      if (destroyed) continue;

      // Safety clamp
      b.x = Math.max(C.BULLET_RADIUS, Math.min(map.cols - C.BULLET_RADIUS, b.x));
      b.y = Math.max(C.BULLET_RADIUS, Math.min(map.rows - C.BULLET_RADIUS, b.y));
    }

    // --- Bullet-Tank Collision ---
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      for (const [id, player] of players) {
        if (!player.alive) continue;
        const dist = Math.hypot(b.x - player.x, b.y - player.y);
        if (dist < C.BULLET_RADIUS + C.TANK_RADIUS) {
          // Hit!
          state.frameHits.push({ x: b.x, y: b.y });
          player.hp--;
          if (player.hp <= 0) {
            player.alive = false;
            state.frameDeaths.push({ x: player.x, y: player.y, color: player.color });
          }
          bullets.splice(i, 1);
          break; // bullet is gone, move to next
        }
      }
    }

    // --- Power-up spawning ---
    state.powerUpSpawnTimer -= DT;
    if (state.powerUpSpawnTimer <= 0 && powerUps.length < C.MAX_POWERUPS) {
      spawnPowerUp(map);
      state.powerUpSpawnTimer = C.POWERUP_SPAWN_INTERVAL;
    }

    // --- Power-up pickup ---
    for (let i = powerUps.length - 1; i >= 0; i--) {
      const pu = powerUps[i];
      for (const [id, player] of players) {
        if (!player.alive) continue;
        if (player.powerUp) continue; // already holding one
        const dist = Math.hypot(pu.x - player.x, pu.y - player.y);
        if (dist < C.POWERUP_RADIUS + C.TANK_RADIUS) {
          player.powerUp = pu.type;
          powerUps.splice(i, 1);
          break;
        }
      }
    }

    // --- Missile update ---
    for (let i = missiles.length - 1; i >= 0; i--) {
      const m = missiles[i];
      m.lifetime -= DT;
      if (m.lifetime <= 0) {
        state.frameDeaths.push({ x: m.x, y: m.y, color: '#888888' });
        missiles.splice(i, 1);
        continue;
      }

      // Arm timer — travel straight like a bullet before activating
      const armed = m.armTimer <= 0;
      if (!armed) {
        m.armTimer -= DT;
      }

      if (armed) {
        // Retarget
        m.retargetTimer -= DT;
        if (m.retargetTimer <= 0 || m.targetId === null) {
          m.targetId = selectMissileTarget(m, map);
          m.retargetTimer = C.MISSILE_RETARGET_INTERVAL;
        }

        // Validate target
        if (m.targetId !== null) {
          const target = players.get(m.targetId);
          if (!target || !target.alive) {
            m.targetId = selectMissileTarget(m, map);
            m.retargetTimer = C.MISSILE_RETARGET_INTERVAL;
          }
        }

        // No targets left — self-destruct
        if (m.targetId === null) {
          state.frameDeaths.push({ x: m.x, y: m.y, color: '#888888' });
          missiles.splice(i, 1);
          continue;
        }

        // Steer toward target via BFS pathfinding with min turn radius
        const target = players.get(m.targetId);
        if (target) {
          const waypoint = bfsNextWaypoint(map, m.x, m.y, target.x, target.y);
          const dx = waypoint.x - m.x;
          const dy = waypoint.y - m.y;
          if (Math.hypot(dx, dy) > 0.01) {
            const desiredAngle = Math.atan2(dy, dx);
            const currentAngle = Math.atan2(m.vy, m.vx);
            let angleDiff = desiredAngle - currentAngle;
            while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
            while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
            // Max turn rate from min turn radius: ω = v / r
            const maxDelta = (C.MISSILE_SPEED / C.MISSILE_MIN_TURN_RADIUS) * DT;
            const newAngle = currentAngle + Math.max(-maxDelta, Math.min(maxDelta, angleDiff));
            const spd = Math.hypot(m.vx, m.vy);
            m.vx = Math.cos(newAngle) * spd;
            m.vy = Math.sin(newAngle) * spd;
          }
        }
      }

      // Normalize to target speed (arm phase uses arm speed, homing uses missile speed)
      const speed = Math.hypot(m.vx, m.vy);
      if (speed > 0) {
        const targetSpeed = armed ? C.MISSILE_SPEED : C.MISSILE_ARM_SPEED;
        m.vx = m.vx / speed * targetSpeed;
        m.vy = m.vy / speed * targetSpeed;
      }

      // Move
      m.x += m.vx * DT;
      m.y += m.vy * DT;

      // Wall collision (bounce while unarmed, resolve while armed)
      if (!armed) {
        // Bounce off walls like a bullet during arm phase
        const wallHit = findFirstWallCollision(m.x, m.y, C.MISSILE_RADIUS, map);
        if (wallHit) {
          if (wallHit.type === 'h') m.vy = -m.vy;
          else m.vx = -m.vx;
          const resolved = resolveTankCollision(m.x, m.y, C.MISSILE_RADIUS, map);
          m.x = resolved.x;
          m.y = resolved.y;
        }
      } else {
        const oldMx = m.x, oldMy = m.y;
        const resolved = resolveTankCollision(m.x, m.y, C.MISSILE_RADIUS, map);
        m.x = resolved.x;
        m.y = resolved.y;

        // If wall pushed the missile, cancel velocity going into that wall
        const pushX = m.x - oldMx;
        const pushY = m.y - oldMy;
        const pushDist = Math.hypot(pushX, pushY);
        if (pushDist > 0.001) {
          const nx = pushX / pushDist;
          const ny = pushY / pushDist;
          const vDot = m.vx * nx + m.vy * ny;
          if (vDot < 0) {
            m.vx -= vDot * nx;
            m.vy -= vDot * ny;
          }
        }
      }

      // Tank collision (only when armed)
      let missileDestroyed = false;
      if (armed) {
        for (const [id, player] of players) {
          if (!player.alive) continue;
          const dist = Math.hypot(m.x - player.x, m.y - player.y);
          if (dist < C.MISSILE_RADIUS + C.TANK_RADIUS) {
            player.hp--;
            if (player.hp <= 0) {
              player.alive = false;
              state.frameDeaths.push({ x: player.x, y: player.y, color: player.color });
            }
            state.frameHits.push({ x: m.x, y: m.y });
            missiles.splice(i, 1);
            missileDestroyed = true;
            break;
          }
        }
      }
      if (missileDestroyed) continue;
    }

    // --- Landmine update ---
    for (let i = landmines.length - 1; i >= 0; i--) {
      const lm = landmines[i];
      if (lm.armTimer > 0) {
        lm.armTimer -= DT;
        continue; // Still arming, not yet dangerous
      }
      // Armed — count down fade timer
      if (lm.fadeTimer > 0) lm.fadeTimer -= DT;
      // Check tank collision (always armed, even when invisible)
      let destroyed = false;
      for (const [id, player] of players) {
        if (!player.alive) continue;
        const dist = Math.hypot(lm.x - player.x, lm.y - player.y);
        if (dist < C.LANDMINE_RADIUS + C.TANK_RADIUS) {
          player.hp--;
          if (player.hp <= 0) {
            player.alive = false;
            state.frameDeaths.push({ x: player.x, y: player.y, color: player.color });
          }
          state.frameHits.push({ x: lm.x, y: lm.y });
          state.frameDeaths.push({ x: lm.x, y: lm.y, color: '#888888' });
          landmines.splice(i, 1);
          destroyed = true;
          break;
        }
      }
      if (destroyed) continue;
    }

    // --- Ice trap update ---
    for (let i = iceTraps.length - 1; i >= 0; i--) {
      const it = iceTraps[i];
      if (it.armTimer > 0) {
        it.armTimer -= DT;
        continue; // Still deploying, not yet active
      }
      // Armed — count down fade timer
      if (it.fadeTimer > 0) it.fadeTimer -= DT;
      // Check tank collision (always active, even when invisible)
      let destroyed = false;
      for (const [id, player] of players) {
        if (!player.alive) continue;
        const dist = Math.hypot(it.x - player.x, it.y - player.y);
        if (dist < C.ICE_RADIUS + C.TANK_RADIUS) {
          player.iceTimer = C.ICE_EFFECT_DURATION;
          iceTraps.splice(i, 1);
          destroyed = true;
          break;
        }
      }
      if (destroyed) continue;
    }

    // --- Wireless Missile update ---
    for (let i = wirelessMissiles.length - 1; i >= 0; i--) {
      const wm = wirelessMissiles[i];
      wm.lifetime -= DT;
      const pilot = players.get(wm.pilotId);

      // Destroy if pilot gone/dead or lifetime expired
      if (!pilot || !pilot.alive || wm.lifetime <= 0) {
        state.frameDeaths.push({ x: wm.x, y: wm.y, color: pilot ? pilot.color : '#888888' });
        if (pilot) pilot.pilotingMissileId = null;
        wirelessMissiles.splice(i, 1);
        continue;
      }

      // Steer from pilot input — instant, no inertia
      const keys = pilot.input;
      const turnRadius = C.WIRELESS_MISSILE_TURN_DIAMETER / 2;
      const maxTurnRate = C.WIRELESS_MISSILE_SPEED / turnRadius; // rad/s
      if (keys.a) wm.angle -= maxTurnRate * DT;
      if (keys.d) wm.angle += maxTurnRate * DT;

      // Move forward
      wm.x += Math.cos(wm.angle) * C.WIRELESS_MISSILE_SPEED * DT;
      wm.y += Math.sin(wm.angle) * C.WIRELESS_MISSILE_SPEED * DT;

      // No bouncing — slide along walls like a tank
      const wmResolved = resolveTankCollision(wm.x, wm.y, C.MISSILE_RADIUS, map);
      wm.x = wmResolved.x;
      wm.y = wmResolved.y;

      // Pathfinding — recompute paths every PATHFIND_INTERVAL ticks
      wm.pathfindTick++;
      if (wm.pathfindTick >= C.PATHFIND_INTERVAL) {
        wm.pathfindTick = 0;
        // Find nearest N living enemies (not the pilot) by BFS distance
        const enemies = [];
        for (const [tid, target] of players) {
          if (tid === wm.pilotId || !target.alive) continue;
          const d = Math.hypot(wm.x - target.x, wm.y - target.y);
          enemies.push({ id: tid, color: target.color, x: target.x, y: target.y, d });
        }
        enemies.sort((a, b) => a.d - b.d);
        wm.paths = [];
        for (let ei = 0; ei < Math.min(C.PATHFIND_ENEMY_COUNT, enemies.length); ei++) {
          const e = enemies[ei];
          const cells = bfsFullPath(map, wm.x, wm.y, e.x, e.y);
          if (cells) wm.paths.push({ color: e.color, cells });
        }
      }

      // Tank collision — skip pilot
      let wmDestroyed = false;
      for (const [tid, target] of players) {
        if (tid === wm.pilotId || !target.alive) continue;
        if (Math.hypot(wm.x - target.x, wm.y - target.y) < C.MISSILE_RADIUS + C.TANK_RADIUS) {
          target.hp--;
          if (target.hp <= 0) {
            target.alive = false;
            state.frameDeaths.push({ x: target.x, y: target.y, color: target.color });
          }
          state.frameHits.push({ x: wm.x, y: wm.y });
          state.frameDeaths.push({ x: wm.x, y: wm.y, color: pilot.color });
          pilot.pilotingMissileId = null;
          wirelessMissiles.splice(i, 1);
          wmDestroyed = true;
          break;
        }
      }
      if (wmDestroyed) continue;
    }

    // --- Round End Check ---
    let aliveCount = 0;
    let lastAliveId = null;
    for (const [id, player] of players) {
      if (player.alive) {
        aliveCount++;
        lastAliveId = id;
      }
    }

    if (aliveCount <= 1) {
      const winnerId = aliveCount === 1 ? lastAliveId : null;
      broadcastState(); // send final state showing the killing blow
      endRound(winnerId);
      return;
    }

    broadcastState();
  };
}

module.exports = { createTick };
