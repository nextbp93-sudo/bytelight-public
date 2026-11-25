import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseAntigravityUsage } from './subscription-usage.js';

describe('parseAntigravityUsage', () => {
  test('reads the structured /usage groups and converts remaining fractions', () => {
    const parsed = parseAntigravityUsage({
      status: 'SUCCESS',
      command: {
        name: 'usage',
        data: {
          groups: [
            {
              name: 'Gemini Models',
              description: 'Models within this group share limits.',
              buckets: [
                {
                  id: 'gemini-weekly',
                  name: 'Weekly Limit Remaining',
                  remaining_fraction: 0.34855,
                  reset_time: '2026-11-30T23:10:10Z',
                },
                {
                  id: 'gemini-5h',
                  name: 'Five Hour Limit Remaining',
                  remaining_fraction: 0.99933,
                  reset_time: '2026-11-25T23:44:36Z',
                },
              ],
            },
          ],
        },
      },
    }, '2026-11-25T20:00:00Z');

    assert.equal(parsed.capturedAt, '2026-11-25T20:00:00Z');
    assert.equal(parsed.groups.length, 1);
    assert.deepEqual(parsed.groups[0]?.buckets, [
      {
        id: 'gemini-weekly',
        name: 'Weekly Limit Remaining',
        remainingPercent: 35,
        usedPercent: 65,
        windowMinutes: 10_080,
        resetsAt: '2026-11-30T23:10:10.000Z',
      },
      {
        id: 'gemini-5h',
        name: 'Five Hour Limit Remaining',
        remainingPercent: 100,
        usedPercent: 0,
        windowMinutes: 300,
        resetsAt: '2026-11-25T23:44:36.000Z',
      },
    ]);
  });

  test('fails honestly when the CLI shape changes', () => {
    assert.throws(
      () => parseAntigravityUsage({ status: 'SUCCESS', response: 'plain text only' }),
      /structured usage data/,
    );
  });
});
