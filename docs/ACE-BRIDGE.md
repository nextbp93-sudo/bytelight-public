# ACE shared-continuity bridge

Bytelight can use the Ashen Continuity Engine as a shared, platform-independent
continuity service. Bytelight retains its own chats, rooms, settings, and local
memory features; ACE carries deliberately authored continuity between rooms.

## Managed server

Register one enabled managed MCP server named `ashen-continuity` whose URL is
the ACE `/mcp/bytelight-v1` endpoint and whose API key is a dedicated revocable
ACE service credential.

At the first turn of a new Bytelight session, the backend reads:

- `ash_wake_manifest` for compact factual orientation; and
- `ash_read_room_handoffs` for shared or Bytelight-addressed re-entry notes.

The resulting block is visibly labelled as attributed, non-authoritative ACE
material before it enters the turn context. If ACE is unavailable, the turn
continues without it.

The managed MCP catalog also gives the companion the ACE read tools and the
runtime-bound `ash_save_room_handoff` write. ACE, rather than the model, stamps
that write as `ash_bytelight_interactive`.

No full conversation is copied automatically. Handoffs are compact and
explicit: current position, decisions, open questions, possible next foothold,
and source reference.
