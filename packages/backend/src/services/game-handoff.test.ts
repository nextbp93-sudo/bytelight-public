import assert from 'node:assert/strict';
import test from 'node:test';
import { gameHandoffContext } from './game-handoff.js';

const NOW = Date.parse('2026-11-12T02:00:00.000Z');

test('a recent game result crosses into another room with provenance', () => {
  const raw = JSON.stringify({
    game: 'battleship',
    gameId: 'game-1',
    room: 'The Fleet Room',
    sourceThreadId: 'fleet-thread',
    summary: 'Jaclyn won Battleship. Her final shot sank the Patrol Boat.',
    completedAt: '2026-11-12T01:59:16.000Z',
  });
  assert.equal(
    gameHandoffContext(raw, 'home-thread', NOW),
    '[GAME ROOM HANDOFF — The Fleet Room]\nJaclyn won Battleship. Her final shot sank the Patrol Boat.\nThis happened in a separate game thread through the same companion lane. The full conversation remains in The Fleet Room.',
  );
});

test('the source room does not receive its own handoff', () => {
  const raw = JSON.stringify({
    game: 'battleship', gameId: 'game-1', room: 'The Fleet Room', sourceThreadId: 'fleet-thread',
    summary: 'Jaclyn won.', completedAt: '2026-11-12T01:59:16.000Z',
  });
  assert.equal(gameHandoffContext(raw, 'fleet-thread', NOW), null);
});

test('stale and malformed handoffs stay out of live context', () => {
  const stale = JSON.stringify({
    game: 'battleship', gameId: 'game-1', room: 'The Fleet Room', sourceThreadId: 'fleet-thread',
    summary: 'Jaclyn won.', completedAt: '2026-11-11T01:00:00.000Z',
  });
  assert.equal(gameHandoffContext(stale, 'home-thread', NOW), null);
  assert.equal(gameHandoffContext('{nope', 'home-thread', NOW), null);
});
