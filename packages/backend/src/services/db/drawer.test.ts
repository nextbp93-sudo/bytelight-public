import test from 'node:test';
import assert from 'node:assert/strict';
import { initDb, getDb } from './init.js';
import { DrawerError, keepDrawerItem, listDrawerItems, removeDrawerItem } from './drawer.js';

function freshHouse(): void {
  initDb(':memory:');
  getDb().prepare('DELETE FROM companions').run();
  getDb().prepare("INSERT INTO companions (id, display_name, brain) VALUES ('companion-a', 'Ash', 'test')").run();
  getDb().prepare("INSERT INTO companions (id, display_name, brain) VALUES ('companion-b', 'Other', 'test')").run();
}

test('a companion can keep a sourced curiosity with a reason', () => {
  freshHouse();
  const item = keepDrawerItem({
    companion: 'companion-a', kind: 'thread', title: 'Fox fire',
    body: 'A question worth following.', url: 'https://example.com/fox-fire',
    whyKept: 'It joins folklore to living light.', collection: 'Strange light',
  }, new Date('2026-11-20T15:30:00.000Z'));
  assert.equal(item.companion, 'companion-a');
  assert.equal(item.why_kept, 'It joins folklore to living light.');
  assert.deepEqual(listDrawerItems('companion-a'), [item]);
  assert.deepEqual(listDrawerItems('companion-b'), []);
});

test('the drawer refuses anonymous, hollow, and unexplained things', () => {
  freshHouse();
  const attempts = [
    { companion: 'nobody', kind: 'pin', title: 'Stray', body: 'Words', whyKept: 'Reason' },
    { companion: 'companion-a', kind: 'unknown', title: 'Stray', body: 'Words', whyKept: 'Reason' },
    { companion: 'companion-a', kind: 'pin', title: 'Hollow', whyKept: 'Reason' },
    { companion: 'companion-a', kind: 'pin', title: 'Unexamined', body: 'Words' },
  ];
  for (const attempt of attempts) assert.throws(() => keepDrawerItem(attempt), DrawerError);
  assert.deepEqual(listDrawerItems(), []);
});

test('one companion cannot remove an item from another companion’s drawer', () => {
  freshHouse();
  const item = keepDrawerItem({ companion: 'companion-a', kind: 'scrap', title: 'Mine', body: 'A fragment.', whyKept: 'It is unfinished.' });
  assert.equal(removeDrawerItem(item.id, 'companion-b'), false);
  assert.equal(listDrawerItems().length, 1);
  assert.equal(removeDrawerItem(item.id, 'companion-a'), true);
  assert.deepEqual(listDrawerItems(), []);
});
