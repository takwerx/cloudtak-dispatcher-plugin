// Proof tests for undocked incident cards (lib/undock.ts, no imports, loaded as it ships):
//   node --test plugin/test/*.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as u from '../lib/undock.ts';

const base = { x: 56, y: 76 };
const vp = { width: 1500, height: 900 };

test('cards tile side by side while a whole card fits left of the panel', () => {
    // 1500 wide, base 56, card 420 + 8 gap: three fit (56..1340), a fourth would not.
    assert.deepEqual(u.cardPosition(0, base, vp), { x: 56, y: 76 });
    assert.deepEqual(u.cardPosition(1, base, vp), { x: 56 + 428, y: 76 });
    assert.deepEqual(u.cardPosition(2, base, vp), { x: 56 + 856, y: 76 });
    assert.ok(56 + 856 + u.UNDOCK_CARD_WIDTH <= vp.width, 'third card is fully left of the panel');
});

test('a full row starts the next row one cascade step down and right', () => {
    assert.deepEqual(u.cardPosition(3, base, vp), { x: 88, y: 108 });
    assert.deepEqual(u.cardPosition(4, base, vp), { x: 88 + 428, y: 108 });
    assert.deepEqual(u.cardPosition(6, base, vp), { x: 120, y: 140 });
});

test('rows wrap back to the top before a card would leave the bottom of the viewport', () => {
    // 900 tall, base 76, card 600: (900-76-600)/32 = 7 steps fit, so 8 rows of 3 = 24 cards per cycle.
    const last = u.cardPosition(23, base, vp);
    assert.ok(last.y + u.UNDOCK_CARD_HEIGHT <= vp.height, 'last row is fully on screen');
    assert.deepEqual(u.cardPosition(24, base, vp), base);
    assert.deepEqual(u.cardPosition(25, base, vp), u.cardPosition(1, base, vp));
});

test('a viewport narrower than one card still places every card at the base column', () => {
    const small = { width: 300, height: 300 };
    assert.deepEqual(u.cardPosition(0, base, small), base);
    assert.deepEqual(u.cardPosition(1, base, small), base);
    assert.deepEqual(u.cardPosition(5, base, small), base);
});

test('a new card takes the first free slot, not the slot after the last one', () => {
    const s0 = u.cardPosition(0, base, vp), s1 = u.cardPosition(1, base, vp), s2 = u.cardPosition(2, base, vp);
    assert.deepEqual(u.firstFreeSlot([], base, vp), s0);
    assert.deepEqual(u.firstFreeSlot([s0, s1], base, vp), s2);
    // Slot 0 closed, slots 1 and 2 still open: the new card goes to slot 0, never on top of slot 2.
    assert.deepEqual(u.firstFreeSlot([s1, s2], base, vp), s0);
    // A card dragged elsewhere frees its slot.
    assert.deepEqual(u.firstFreeSlot([{ x: 700, y: 300 }, s1], base, vp), s0);
});

test('first free slot never returns a taken slot while any slot in the cycle is free', () => {
    const taken = Array.from({ length: 10 }, (_, n) => u.cardPosition(n, base, vp));
    const p = u.firstFreeSlot(taken, base, vp);
    assert.ok(!taken.some(t => t.x === p.x && t.y === p.y));
});

test('negative or fractional counts are clamped', () => {
    assert.deepEqual(u.cardPosition(-3, base, vp), base);
    assert.deepEqual(u.cardPosition(1.9, base, vp), u.cardPosition(1, base, vp));
});

test('open set: add keeps order and ignores duplicates, remove is by id', () => {
    let open: string[] = [];
    open = u.addUndocked(open, 'a');
    open = u.addUndocked(open, 'b');
    open = u.addUndocked(open, 'a');
    assert.deepEqual(open, ['a', 'b']);
    assert.ok(u.isUndocked(open, 'b'));
    open = u.removeUndocked(open, 'a');
    assert.deepEqual(open, ['b']);
    assert.ok(!u.isUndocked(open, 'a'));
    assert.deepEqual(u.removeUndocked(open, 'zzz'), ['b']);
});

test('add and remove return new arrays (the store is replaced, never mutated in place)', () => {
    const open = ['a'];
    const next = u.addUndocked(open, 'b');
    assert.notEqual(next, open);
    assert.deepEqual(open, ['a']);
    assert.notEqual(u.removeUndocked(open, 'a'), open);
});

test('restore keeps only ids still on the board, in saved order, without duplicates', () => {
    assert.deepEqual(u.restorable(['c', 'gone', 'a', 'c'], ['a', 'b', 'c']), ['c', 'a']);
    assert.deepEqual(u.restorable([], ['a']), []);
    assert.deepEqual(u.restorable(['a'], []), []);
});

test('saved list parsing is forgiving', () => {
    assert.deepEqual(u.parseSavedUndocked(null), []);
    assert.deepEqual(u.parseSavedUndocked(''), []);
    assert.deepEqual(u.parseSavedUndocked('not json'), []);
    assert.deepEqual(u.parseSavedUndocked('{"a":1}'), []);
    assert.deepEqual(u.parseSavedUndocked('["a", 2, null, "b"]'), ['a', 'b']);
});

test('storage key is per Event', () => {
    assert.notEqual(u.undockStorageKey('ev1'), u.undockStorageKey('ev2'));
    assert.ok(u.undockStorageKey('ev1').endsWith('ev1'));
});
