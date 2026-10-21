# Multiplayer — plan (needs owner decisions)

The simulation was built multiplayer-ready: `src/sim` is deterministic, DOM-free and runs in Node;
`ControlInput` is an explicit struct; `serializeWorld` is a complete, versioned world snapshot.

## The hard problem: time
Single-player time warp doesn't work when several people share one universe. Options:
1. **Shared clock, warp by consensus** — everyone sees the same UT; warp only when all players agree (or the
   slowest player's limit wins). Simple, true shared universe. Best for 2–4 friends.
2. **Subspaces** (the approach used by community mods of the genre) — each player has their own UT; vessels are
   visible across subspaces as "ghosts"; players can "sync forward" to the latest subspace. Scales better,
   more complex.

Recommendation: start with **(1) co-op with consensus warp**, 2–4 players.

## Architecture (recommended)
- **Authoritative server** (Node, reusing `src/sim` unchanged) owns the World and ticks at 50 Hz.
- Clients send `ControlInput` for vessels they control (one controller per vessel, lockable/transferable).
- Server broadcasts vessel state snapshots at 10–20 Hz (+ events: stage, dock, destroyed); clients interpolate
  and locally predict their own vessel (reconcile on snapshot).
- Vessels off-screen / on rails: only orbit elements are sent (tiny).
- Transport: WebSocket first (simple, works everywhere); WebRTC data channels later for lower latency.
- Persistence: server writes the save file; same `SavedWorld` format.

## Phases
1. Headless server running World + WebSocket protocol; two browser clients flying separate vessels in one universe.
2. Interpolation/prediction, vessel ownership, chat, player list, consensus warp.
3. Shared docking/rendezvous across players, shared career (optional), dedicated hosting.

## Decisions for the owner
- Hosting: run the server on your own machine/LAN, a cheap VPS, or a serverless/edge platform?
- Co-op only, or competitive/separate agencies?
- Max players you care about (2–4 vs. 10+), which decides consensus warp vs. subspaces.
- Accounts/auth needed, or just "share a room code"?

## Prototype status / how to run

The experimental LAN prototype is implemented and **off by default**. Single-player does not open a
socket. Select **LAN co-op (experimental)** from the main menu to opt in. Rooms use standard-scale
sandbox worlds and a shared clock, with at most four pilots and 32 vessels.

1. Install dependencies with `npm install`.
2. On the host, run `npm run server` (WebSocket server on `0.0.0.0:8787`). Optional environment variables:
   `HOST=127.0.0.1 PORT=8788 npm run server`.
3. In another terminal run `npm run dev -- --host 0.0.0.0`. Open the printed HTTP URL on the host and
   other LAN devices; allow the Vite and server ports through the host firewall.
4. Choose LAN co-op, enter `ws://<host-LAN-IP>:8787` and a display name, and leave the room code empty
   to create a room. Share the displayed six-character code with the other pilots. They enter that
   code and the same host URL. An HTTPS frontend requires a `wss://` endpoint with TLS termination.
5. Launch a stock craft, the current editor craft, or an imported craft JSON. Pad and runway each have
   a FIFO queue; launches wait for 200 m clearance plus the occupying vessel's bounding radius.
   Launching claims the new vessel and releases your previous vessel. Claim/release controls also let
   pilots transfer a vessel. A room starts empty, so request a launch before flying.
6. Fly with the normal controls (Space stages, Shift/Ctrl throttle, WASD/QE attitude, T SAS, R RCS).
   The panel lists players and ownership, chat, your warp request, the effective shared rate, and the
   pilots holding warp at its minimum. Everyone, including spectators, must raise their request to
   accelerate time. Fleet safety may reduce it further; encounter stops reset consent to 1×.
   Escape suspends your controls while the shared clock continues. Disconnect returns to the menu.

Implementation: `server/index.ts` starts the `ws` transport; `server/server.ts` manages sockets/rooms;
`server/room.ts` runs authoritative `World` steps at 50 Hz. Protocol v1 in `src/net/protocol.ts`
carries validated commands, full snapshots at join/topology changes, events, and 10 Hz vessel deltas.
Rails deltas contain orbit elements, landed deltas contain body-fixed transforms. Inputs transmit at
about 30 Hz (one-shot commands transmit immediately); stale controls go neutral after 500 ms.
The controlled vessel predicts at 50 Hz at 1× and reconciles with authoritative states, replaying
recent local steps and smoothing small visual corrections. Other vessels interpolate with a 100 ms
buffer; name tags identify pilots. Staging, docking, destruction, EVA, boarding, flags and undocking
are authoritative. The renderer retains floating-origin coordinates.

Limits: intended for trusted LAN friends; no accounts, authentication, TLS server, automatic reconnect,
server persistence, shared career, or multiplayer autopilot/maneuver planning. Rooms disappear on
server restart or within a minute after everyone leaves. Rejoining creates a new player; claim your
released vessel manually. Prediction assumes low LAN latency, caps its horizon at 300 ms, and disables
physics prediction above 1×; high-latency links and high warp can visibly step. Full topology snapshots
can be large. Packed vessels retain the existing simulation's unattended-vessel behavior. Client-side
save/load, revert, recovery, science and assist panels are unavailable in multiplayer so the room stays
authoritative. Local single-player saves are not overwritten.

Verification: `npx tsc --noEmit` and `npx vitest run --maxWorkers=2`. Focused tests are
`tests/multiplayer.test.ts` (protocol, two replicas, ownership, input timeout, queue, consensus/safety
warp, docking and reconciliation error under 60 ms snapshot latency) and
`tests/multiplayer-socket.test.ts` (two real WebSocket connections against an in-process LAN server).
