# AZ Tank Game — Design Spec

## Overview

AZ is a multiplayer LAN tank game. Players connect via browser to a Node.js server on port 55928. The game features procedurally generated grid-based arenas with edge walls, top-down 2D rendering, bouncing bullets, and last-man-standing rounds with rematch voting.

## Architecture

### Files

- `server.js` — Authoritative game server (Node.js + `ws` library)
- `index.html` — Self-contained client (HTML + JS + Canvas 2D), served by the server over HTTP

### Server Authority

The server is the single source of truth. Clients are input-only terminals:

- **Client sends**: Input state changes (`{type: "input", keys: {w, a, s, d, space}}`) on keydown/keyup
- **Server computes**: All movement, collisions, bullet physics, bounces, health, death
- **Server broadcasts**: Full game state every tick to all clients
- **Client renders**: Whatever the server tells it — no local simulation, no prediction

This makes client-side cheating impossible. Editing the HTML/JS can only change visuals or send malformed input (which the server ignores).

### Tick Rate

60 ticks/second (~16ms interval). On LAN, full round-trip latency should be under 5ms.

### Server Restart

The server listens for `R` keypress in the terminal to restart the game loop without killing the process.

## Map Generation

### Grid System

- Each cell is a square unit
- Walls exist on edges between cells (edge-wall system)
- Outer boundary is always fully walled (closed arena)

### Algorithm

1. Start with a full grid where every interior edge has a wall
2. Run recursive backtracker (depth-first search) to carve a perfect maze — guarantees every cell is reachable from every other cell
3. Remove ~30-35% of remaining interior walls randomly to create moderate density (mix of corridors and open areas)
4. Result: fully connected map with no isolated cells

### Scaling

| Players | Grid Size |
|---------|-----------|
| 2       | 12×12     |
| 3       | 15×15     |
| 4       | 18×18     |
| N       | (9 + 3N) × (9 + 3N) |

### Cell Pixel Size

Canvas targets ~800×800px. Cell pixel size = canvas size / grid dimension. Dynamically calculated.

### Spawn Placement

1. Pick a random open cell for each player
2. Raycast to all already-placed players, checking if wall edges block line-of-sight
3. If LOS exists with any placed player, retry with a new random cell
4. Up to 20 attempts per player
5. If all 20 fail, place at the candidate with the greatest BFS shortest-path cell count to the nearest already-placed player (graph distance through the maze)

## Tank Mechanics

### Movement

- Tanks use continuous float positions (x, y), not snapped to grid cells
- Tank body: rectangle with aspect ratio 1.4:1 (length:width). Width = ~50% of cell width, length = ~70% of cell width. Fits through corridors with margin.
- **W**: Move forward in facing direction at ~3 cells/second
- **S**: Move backward in facing direction at ~3 cells/second
- **A**: Rotate left at ~180°/second
- **D**: Rotate right at ~180°/second

### Wall Collision

Tank collision uses a circular hitbox (radius = half the tank width, ~25% of cell width) for wall collision detection. This avoids AABB inflation when the tank rotates and ensures consistent corridor navigation at any angle. Movement is resolved per-axis: try X movement first, clamp if collision; then try Y movement, clamp if collision. This gives natural wall-sliding behavior.

### Health

- 3 HP per player
- When HP reaches 0, tank is removed from play

### Death & Rounds

- Last-man-standing: round ends when only one player remains alive (or zero — see Tie below)
- 5-second countdown displayed to all players. During countdown, simulation is paused (no movement, no firing)
- New round starts with fresh map, fresh spawns, scores persist across rounds
- **Tie**: If the last two (or more) players die on the same tick, no one scores a win. The round still ends with the same 5-second countdown. `winnerId` is `null` in the `roundEnd` message.
- **Minimum players**: Game requires at least 2 connected players to start. Host cannot start with 1.

## Bullet Mechanics

### Firing

- **Spacebar** to fire
- One bullet active per player at a time — cannot fire again until current bullet is removed
- Bullet spawns at tank's barrel tip, traveling in the tank's facing direction
- If the barrel tip is inside a wall at spawn time, the bullet spawns at the tank's center instead
- When a player dies, their in-flight bullet continues traveling (it can still damage other players). The dead player's fire cooldown is irrelevant since they're dead.

### Physics

- Speed: ~6 cells/second (~2× tank speed)
- Size: small circle, ~15% of cell width

### Wall Bouncing

- On hitting a wall edge, bullet reflects (angle of incidence = angle of reflection)
- Bullet survives exactly 6 wall contacts (bounces). On the 7th wall contact, the bullet is destroyed.
- Player can then fire again

### Tank Hit

- Collision detection: circle (bullet) vs circle (tank hitbox, same radius used for wall collision)
- On hit: bullet disappears, target loses 1 HP, shooter can fire again
- Bullets can hit any tank, including the shooter's own tank

## Visuals & Rendering

### Color Palette

- **Floor/background**: Light silver-gray (`#C0C0C0` range)
- **Walls**: Dark gray (`#4A4A4A` range), drawn as thick lines on cell edges
- **Open edges** (no wall): No visible line — just the floor color. Only wall edges are drawn. This avoids visual clutter and the grid-line/wall-line overlap problem.

### Player Colors

Assigned in connection order:

1. Red
2. Blue
3. Green
4. Orange
5. Purple
6. Teal
7. Yellow
8. Pink

For 9+ players, colors are generated by evenly spacing hues around the HSL wheel (saturation 70%, lightness 50%), skipping hues within 30° of already-used preset colors.

### Tank Rendering

Top-down silhouette:
- Rectangular body filled in player color
- Darker shade turret/barrel extending from center-front
- Outlined for clarity against background

### Bullet Rendering

Small filled circle in shooter's color (slightly brighter/lighter variant).

### HUD

- Health pips per player (in their color), corner overlay
- Round score (wins per player)
- 5-second countdown overlay between rounds
- Player name/number labels above tanks

### Canvas

Single `<canvas>` element, sized to `min(800, viewport width, viewport height)` pixels square. Camera shows full map (no scrolling). Canvas scales responsively on window resize.

## Networking

### Connection Flow

1. Player opens `http://<host-lan-ip>:55928` in browser
2. Server serves `index.html` over HTTP
3. Client opens WebSocket to same host:port
4. Server assigns player ID and color, adds to lobby
5. Host starts game by pressing `S` in the terminal (requires at least 2 connected players)

### Message Protocol

**Client → Server:**
- `{type: "input", keys: {w: bool, a: bool, s: bool, d: bool, space: bool}}` — sent on key state change only

**Server → Client:**
- `{type: "init", playerId, colors}` — on connect (lobby state, no map yet)
- `{type: "state", players: [...], bullets: [...]}` — every tick during active round
- `{type: "newRound", map, spawns}` — sent to all clients at the start of each round (including the first). Delivers the fresh map. Client stores map locally for rendering until next `newRound`.
- `{type: "roundEnd", winnerId, scores}` — round over (`winnerId` is `null` on tie). Client starts a local 5-second countdown timer upon receiving this message. Server sends `newRound` after 5 seconds.
- `{type: "rematch", votes: {...}}` — rematch vote state

### Disconnection Handling

- When a player disconnects mid-round, their tank is immediately removed (treated as death)
- Their in-flight bullet continues traveling until it hits something or decays
- If this leaves one player alive, the round ends (that player wins)
- Disconnected player's score persists in the scoreboard for the session
- Disconnected players cannot reconnect to the same round; they rejoin as a new player in the next round
- If all players disconnect, the server resets to lobby state

### Anti-Cheat

- Server ignores malformed messages
- Server rate-limits input messages (drop messages if more than 120/second per client — well above legitimate play)
- No game logic in client — only rendering and input capture

## Rematch System

After a round ends and scores are displayed:

- Any player can vote for rematch via a button in the client
- **Host override**: If the host (first connected player) votes rematch, it happens immediately
- **Unanimous**: If all currently-connected non-host players vote rematch, it happens. Players who disconnect during the vote phase are removed from the voting pool.
- If no rematch vote passes within ~15 seconds, server stays on the score screen. The host can still start a new game from the terminal with `S`, or new players can connect.
- In a 2-player game, either player voting rematch is sufficient (host is one of the two, so the host-override rule applies; if the non-host votes, they are the only non-host, satisfying the unanimous condition)

## Dependencies

- **Runtime**: Node.js
- **npm package**: `ws` (WebSocket server library)
- **Client**: No dependencies (vanilla JS + Canvas 2D)

## File Structure

```
AZ/
├── server.js        # Game server
├── index.html       # Client (served by server)
├── package.json     # Node dependencies (ws)
└── docs/            # Design docs
```
