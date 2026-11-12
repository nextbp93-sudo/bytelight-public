export const LAST_GAME_HANDOFF_KEY = 'games.last_handoff';

export interface GameRoomHandoff {
  game: string;
  gameId: string;
  room: string;
  sourceThreadId: string;
  summary: string;
  completedAt: string;
}

const MAX_HANDOFF_AGE_MS = 12 * 60 * 60 * 1000;

/**
 * A compact doorway from a game's private room back into the ordinary chat.
 * The game transcript stays in its room; this only carries the outcome and
 * makes the separate-thread / same-lane provenance explicit.
 */
export function gameHandoffContext(
  raw: string | null | undefined,
  currentThreadId: string,
  nowMs = Date.now(),
): string | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<GameRoomHandoff>;
    if (!value.gameId || !value.room || !value.sourceThreadId || !value.summary || !value.completedAt) return null;
    if (value.sourceThreadId === currentThreadId) return null;
    const completedAt = Date.parse(value.completedAt);
    if (!Number.isFinite(completedAt) || nowMs < completedAt || nowMs - completedAt > MAX_HANDOFF_AGE_MS) return null;
    return [
      `[GAME ROOM HANDOFF — ${value.room}]`,
      value.summary,
      `This happened in a separate game thread through the same companion lane. The full conversation remains in ${value.room}.`,
    ].join('\n');
  } catch {
    return null;
  }
}
