# AZ Tank Game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a multiplayer LAN tank game with procedurally generated maze arenas, bouncing bullets, and last-man-standing rounds.

**Architecture:** Two-file project: `server.js` (authoritative Node.js game server with `ws`) and `index.html` (Canvas 2D client served by the server). Server runs at 60Hz, clients send only input, server broadcasts full state.

**Tech Stack:** Node.js, `ws` (WebSocket library), vanilla JS, Canvas 2D API

**Spec:** `docs/superpowers/specs/2026-03-22-az-tank-game-design.md`

---

### Task 1: Project Scaffolding & Server Skeleton

**Files:**
- Create: `package.json`
- Create: `server.js` (skeleton)

- [ ] **Step 1: Create package.json**

```json
{
  "name": "az-tank-game",
  "version": "1.0.0",
  "description": "AZ - Multiplayer LAN tank game",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "ws": "^8.18.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, `package-lock.json` generated

- [ ] **Step 3: Create server.js skeleton**

Create `server.js` with:
- HTTP server on port 55928 that serves `index.html` for GET `/` requests
- WebSocket server (`ws`) attached to the HTTP server
- Terminal keypress listener: `S` to start game, `R` to restart
- Player connection/disconnection tracking (assign ID, color from preset list of 8 colors; for 9+ players generate via HSL wheel: saturation 70%, lightness 50%, evenly spaced hues skipping within 30° of preset hues)
- Game state machine: `lobby` → `playing` → `roundEnd` → `playing`/`lobby`
- 60Hz game loop via `setInterval(tick, 1000/60)` (only ticks during `playing` state)
- On connect: send `{type: "init", playerId, colors}` message
- On message: parse JSON, validate, store input state per player (rate-limit at 120 msg/s)
- On disconnect: remove from lobby or treat as death during play
- Console logs for: player connected/disconnected, game started, round ended

The server skeleton should have placeholder functions for `generateMap()`, `spawnPlayers()`, `tick()`, `broadcastState()` that will be filled in subsequent tasks.

- [ ] **Step 4: Create minimal index.html**

Create `index.html` with:
- Basic HTML page with dark background and centered "Waiting for game..." text
- WebSocket connection to `ws://${window.location.host}`
- Message handler that logs received messages to console
- Input handler that tracks W/A/S/D/Space keydown/keyup state and sends `{type: "input", keys: {...}}` on change
- No rendering yet — just verify the connection works

- [ ] **Step 5: Test the skeleton**

Run: `node server.js`
Open browser to `http://localhost:55928`
Expected: Console shows "Player connected", browser shows waiting text, typing keys sends input messages to server

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json server.js index.html
git commit -m "feat: project scaffolding with server skeleton and basic client"
```

---

### Task 2: Map Generation

**Files:**
- Modify: `server.js` (implement `generateMap()`)

- [ ] **Step 1: Implement the edge-wall grid data structure**

In `server.js`, represent the map as:
- `cols` and `rows` integers (grid dimensions)
- `hWalls`: 2D array `[rows+1][cols]` of booleans — horizontal wall segments (top/bottom edges of cells)
- `vWalls`: 2D array `[rows][cols+1]` of booleans — vertical wall segments (left/right edges of cells)

Grid size formula (from spec table, which overrides the spec's narrative formula): `size = 6 + 3 * playerCount`. This gives 12 for 2 players, 15 for 3, 18 for 4.

- [ ] **Step 2: Implement recursive backtracker maze generation**

`generateMap(playerCount)` function:
1. Calculate grid size: `size = 6 + 3 * playerCount`
2. Initialize all `hWalls` and `vWalls` to `true` (all walls present)
3. Outer boundary walls stay permanently `true`
4. Run recursive backtracker starting from cell (0,0):
   - Mark cell as visited
   - Shuffle neighbors randomly
   - For each unvisited neighbor: remove the wall between current and neighbor, recurse into neighbor
5. Count remaining interior walls. Remove ~30-35% of them randomly to open up the maze.
6. Return `{rows: size, cols: size, hWalls, vWalls}`

- [ ] **Step 3: Implement spawn placement**

`spawnPlayers(map, players)` function:
1. For each player:
   - Try up to 20 random cell positions
   - For each candidate, check LOS to all already-placed players using line-of-sight raycast
   - LOS raycast: step from cell A to cell B checking if any wall edge intersects the line segment between cell centers
   - If no LOS with any placed player, accept the position
   - If all 20 fail, run BFS from each candidate to find the one with greatest shortest-path distance to the nearest placed player
2. Set player position to center of assigned cell, random facing angle

- [ ] **Step 4: Test map generation**

Add a temporary debug endpoint or console log that prints the generated map as ASCII art to verify:
- All cells are reachable (maze is valid)
- Outer walls are intact
- Some interior walls have been removed (not a pure maze)
- Spawns are placed without LOS

Run: `node server.js`, press `S` with 2+ simulated test
Expected: Console shows a valid maze grid with spawn positions

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat: procedural maze generation with edge walls and spawn placement"
```

---

### Task 3: Server Game Physics

**Files:**
- Modify: `server.js` (implement `tick()` function with movement, collision, bullets)

- [ ] **Step 1: Implement tank movement in tick()**

Each tick (dt = 1/60):
- For each alive player with stored input:
  - If `keys.a`: subtract `Math.PI * dt` from `angle` (180°/s = π rad/s)
  - If `keys.d`: add `Math.PI * dt` to `angle`
  - Calculate velocity: `speed = 3 * cellSize` (3 cells/second in world units, but internally use cell units so speed = 3)
  - If `keys.w`: `dx = Math.cos(angle) * speed * dt`, `dy = Math.sin(angle) * speed * dt`
  - If `keys.s`: reverse direction (negate dx, dy)
  - Apply movement per-axis with wall collision (see next step)

Note: positions are in cell units (0 to gridSize). Cell (0,0) occupies x=[0,1], y=[0,1].

- [ ] **Step 2: Implement circular wall collision**

Tank hitbox: circle centered at (x, y) with radius = 0.25 (25% of cell width in cell units).

Per-axis collision resolution:
1. Try moving X: `newX = x + dx`
2. Check circle at `(newX, y)` against all nearby wall segments:
   - Horizontal walls: line segment from `(wx, wy)` to `(wx+1, wy)` — check circle-vs-line-segment distance
   - Vertical walls: line segment from `(wx, wy)` to `(wx, wy+1)` — same check
   - Only check walls within 1 cell of the tank position for performance
3. If collision: clamp `newX` so circle doesn't penetrate (push back to wall surface)
4. Update `x = newX`
5. Repeat for Y axis: `newY = y + dy`, check `(x, newY)`, clamp if needed
6. Also clamp to stay within outer boundary (0 + radius to gridSize - radius)

Helper function `circleCollidesWallSegment(cx, cy, r, x1, y1, x2, y2)`:
- Find closest point on line segment to circle center
- Return `true` if distance < radius

- [ ] **Step 3: Implement bullet firing**

When `keys.space` is true and player has no active bullet:
- Create bullet: `{ownerId, x, y, dx, dy, bouncesLeft: 6}`
- Position: barrel tip = tank center + `(cos(angle) * 0.35, sin(angle) * 0.35)` (front of tank)
- Check if barrel tip is inside a wall — if so, spawn at tank center instead
- Velocity: `dx = cos(angle) * bulletSpeed`, `dy = sin(angle) * bulletSpeed` where `bulletSpeed = 6` (cells/second, so per tick multiply by dt)
- Mark `space` as consumed (don't fire again until space is released and re-pressed) — use a `spacePrev` flag per player

- [ ] **Step 4: Implement bullet movement and wall bouncing**

Each tick, for each bullet:
1. Move: `x += dx * dt`, `y += dy * dt`
2. Check collision with wall segments (circle-vs-segment, bullet radius = 0.075 cell units, ~15% of cell width / 2):
   - If hitting a horizontal wall: reflect `dy = -dy`, decrement `bouncesLeft`
   - If hitting a vertical wall: reflect `dx = -dx`, decrement `bouncesLeft`
   - Corner hit (both H and V wall in same tick): reflect both `dx` and `dy`, decrement `bouncesLeft` by 1 (counts as a single bounce)
   - Push bullet out of wall to prevent sticking
3. Bounce counting: decrement `bouncesLeft` on each wall contact. If after decrementing `bouncesLeft < 0`, the bullet is destroyed (do NOT reflect it — it dies on contact). This means `bouncesLeft: 6` allows 6 successful bounces; the 7th contact destroys it without reflecting. Mark owner as able to fire again.

- [ ] **Step 5: Implement bullet-tank collision**

Each tick, after moving bullets, for each bullet vs each alive player:
- Circle-vs-circle: distance between bullet center and tank center < bullet radius + tank radius (0.075 + 0.25 = 0.325)
- On hit:
  - Destroy bullet, mark owner as able to fire again
  - Reduce target HP by 1
  - If HP ≤ 0: mark player as dead (alive = false)

- [ ] **Step 6: Implement broadcastState()**

Every tick, send to all connected clients:
```json
{
  "type": "state",
  "players": [
    {"id": 0, "x": 5.2, "y": 3.1, "angle": 1.57, "hp": 3, "alive": true, "color": "#FF0000"}
  ],
  "bullets": [
    {"x": 2.1, "y": 4.5, "ownerId": 0}
  ]
}
```

- [ ] **Step 7: Commit**

```bash
git add server.js
git commit -m "feat: server-side tank movement, wall collision, bullet physics"
```

---

### Task 4: Game Flow (Rounds, Death, Rematch)

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Implement round lifecycle**

Game states: `lobby`, `playing`, `roundEnd`

State transitions:
- `lobby` → `playing`: Host presses `S` with 2+ players. Call `generateMap()`, `spawnPlayers()`, broadcast `{type: "newRound", map, spawns}`, start tick loop.
- `playing` → `roundEnd`: Check at end of each tick if ≤1 player alive. If so, determine winner (or null for tie). Broadcast `{type: "roundEnd", winnerId, scores}`. Set a 5-second timer.
- `roundEnd` auto-restart: Server sets a 5-second timer. When it fires, automatically generate new map, new spawns, broadcast `newRound`, transition to `playing`. This is the default path — the round auto-continues.
- `roundEnd` → `lobby`: Only if all players disconnect during the 5-second countdown or the rematch vote window. Or if the rematch vote window (15 seconds after the 5-second countdown) expires with no votes.
- Rematch vote flow: After the round-end 5-second countdown, if rematch conditions are met (host vote OR unanimous non-host vote), start immediately. Otherwise wait up to 15 seconds. Host can always press `S` in terminal.

The `map` in `newRound` message should serialize as: `{rows, cols, hWalls, vWalls}` where walls are arrays of arrays of booleans. The `spawns` field includes initial player positions so clients can render tanks immediately without waiting for the first `state` tick. The `init` message has no map — clients show the lobby screen until they receive `newRound`.

- [ ] **Step 2: Implement scoring**

- `scores` object: `{playerId: wins}` — persists across rounds within a session
- Increment winner's score on round end (skip if tie/null winner)
- Include full scores in `roundEnd` message

- [ ] **Step 3: Implement rematch voting**

On receiving `{type: "rematch"}` from a client during `roundEnd` state:
- Record that player's vote
- Check conditions:
  - Host voted → trigger rematch immediately
  - All connected non-host players voted → trigger rematch
- Broadcast `{type: "rematch", votes: {playerId: true/false}}` to all clients so they see vote state
- 15-second timeout: if no rematch triggered, stay on score screen (state remains `roundEnd`, host can still use `S`)

- [ ] **Step 4: Implement disconnection handling during all states**

- During `lobby`: remove player from player list, log it
- During `playing`: mark player as dead (alive=false), leave their bullet in play. Check if round should end. Disconnected player's score entry persists in the scoreboard for the session.
- During `roundEnd`: remove from voting pool, re-evaluate rematch conditions (unanimous is over currently-connected non-host players). If all players disconnect, reset to lobby.
- Reconnecting players always join as a new player (new ID, new color). They do not resume a previous session.

- [ ] **Step 5: Implement server terminal controls**

Using `process.stdin` in raw mode:
- `S`: Start game (only in `lobby` or `roundEnd` state, requires 2+ connected players)
- `R`: Full restart — reset all state, disconnect all players, return to lobby

Log to console: current state, player count, available commands.

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "feat: round lifecycle, scoring, rematch voting, disconnection handling"
```

---

### Task 5: Client Rendering & HUD

**Files:**
- Modify: `index.html` (full client implementation)

- [ ] **Step 1: Implement canvas setup and resize**

- Create `<canvas>` element, centered on page
- Size: `Math.min(800, window.innerWidth - 20, window.innerHeight - 20)` pixels square
- Recalculate on `window.resize`
- Dark background for the page (`#1a1a1a`), canvas sits centered

- [ ] **Step 2: Implement WebSocket message handling**

Handle all message types:
- `init`: Store `playerId`, `colors`. Show lobby screen ("Waiting for host to start... N players connected")
- `newRound`: Store `map` data. Calculate `cellSize = canvasSize / map.rows`. Switch to game rendering mode.
- `state`: Store latest `players` and `bullets` arrays. Trigger render.
- `roundEnd`: Store `winnerId`, `scores`. Switch to score screen rendering. Start local 5-second countdown.
- `rematch`: Update vote display.

- [ ] **Step 3: Implement map rendering**

`drawMap(ctx, map, cellSize)`:
- Fill canvas with silver-gray background (`#C0C0C0`)
- Draw wall segments as thick lines (`#4A4A4A`, lineWidth = 3px):
  - Iterate `hWalls[row][col]`: if true, draw line from `(col*cs, row*cs)` to `((col+1)*cs, row*cs)`
  - Iterate `vWalls[row][col]`: if true, draw line from `(col*cs, row*cs)` to `(col*cs, (row+1)*cs)`

- [ ] **Step 4: Implement tank rendering**

`drawTank(ctx, player, cellSize)`:
- Save context, translate to `(player.x * cs, player.y * cs)`, rotate by `player.angle`
- Draw rectangular body (width = `0.5 * cs`, length = `0.7 * cs`) centered at origin, filled with player color
- Draw turret: darker shade rectangle extending from center toward front (`0.15 * cs` wide, `0.4 * cs` long)
- Draw outline (2px stroke, slightly darker than fill)
- Restore context
- Draw player label above tank ("P1", "P2", etc.)

- [ ] **Step 5: Implement bullet rendering**

`drawBullet(ctx, bullet, cellSize, colors)`:
- Draw filled circle at `(bullet.x * cs, bullet.y * cs)` with radius `0.075 * cs`
- Color: owner's player color, slightly brighter (increase lightness)

- [ ] **Step 6: Implement HUD**

Draw on top of game canvas:
- **Health display** (top-left): For each player, draw their color swatch + health pips (filled/empty circles)
- **Score display** (top-right): "Wins: P1: 2 | P2: 1" in player colors
- **Countdown overlay** (center): Large text "3... 2... 1..." during roundEnd countdown
- **Winner announcement** (center): "Player N wins!" or "Tie!" above countdown

- [ ] **Step 7: Implement lobby and score screens**

- **Lobby screen**: Dark canvas with centered text "Waiting for host to start..." and player count. List connected players with their colors.
- **Score screen** (roundEnd): Show final scores, winner announcement, rematch button. Show vote status for each player. "Rematch" button sends `{type: "rematch"}` to server.

- [ ] **Step 8: Implement input handling**

- Track key state for W, A, S, D, Space via `keydown`/`keyup`
- On any key state change, send `{type: "input", keys: {w, a, s, d, space}}` to server
- Use `event.code` (e.g., `KeyW`, `KeyA`) not `event.key` (avoids layout issues)
- Prevent default on game keys to avoid scrolling
- Add `{type: "rematch"}` button click handler for score screen

- [ ] **Step 9: Implement render loop**

Use `requestAnimationFrame` for smooth rendering:
- If in `playing` state: clear canvas, draw map, draw all tanks, draw all bullets, draw HUD
- If in `lobby` state: draw lobby screen
- If in `roundEnd` state: draw last game frame (map + final positions), draw score overlay, draw countdown

- [ ] **Step 10: Commit**

```bash
git add index.html
git commit -m "feat: full client with canvas rendering, HUD, lobby, and score screens"
```

---

### Task 6: Integration, Polish & Final Testing

**Files:**
- Modify: `server.js` (fixes from testing)
- Modify: `index.html` (fixes from testing)

- [ ] **Step 1: Test 2-player game flow end-to-end**

Run: `node server.js`
Open two browser tabs to `http://localhost:55928`
Press `S` in terminal.
Expected: Both tabs show maze, tanks spawn without LOS, movement works, bullets fire and bounce, damage registers, round ends on death, scores shown, rematch works.

Fix any issues found.

- [ ] **Step 2: Test edge cases**

- Fire bullet while touching wall (should spawn at center)
- Bullet bouncing 6 times then being destroyed on 7th
- Self-damage (bullet bouncing back and hitting own tank)
- Simultaneous death (tie scenario)
- Player disconnect mid-round
- Rematch voting (host vote, unanimous vote)
- Server restart with `R` key

Fix any issues found.

- [ ] **Step 3: Performance check**

- Verify tick loop stays under 16ms per tick (add timing measurement)
- Verify WebSocket message sizes are reasonable (not sending excessive data)
- If state messages are too large, optimize by sending only changed fields or using shorter keys

- [ ] **Step 4: Final commit**

```bash
git add server.js index.html
git commit -m "fix: integration fixes and polish from end-to-end testing"
```
