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
