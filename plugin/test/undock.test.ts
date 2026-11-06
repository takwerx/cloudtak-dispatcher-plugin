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

test('workspace cards: a dragged card keeps its title bar reachable', () => {
    const area = { width: 1200, height: 900 };
    const card = { width: 420 };
    assert.deepEqual(u.clampCard(100, 50, area, card), { x: 100, y: 50 });
    // Dragged far right / down: at least 80 px stays inside, and the top never leaves the area.
    assert.deepEqual(u.clampCard(5000, 5000, area, card), { x: 1120, y: 860 });
    // Dragged far left / up: most of the card may leave, but 80 px stays grabbable; the top stays at 0.
    assert.deepEqual(u.clampCard(-5000, -50, area, card), { x: -340, y: 0 });
    // Fractions are rounded.
    assert.deepEqual(u.clampCard(10.6, 20.4, area, card), { x: 11, y: 20 });
});

test('workspace cards: a tiny area never yields a negative maximum', () => {
    assert.deepEqual(u.clampCard(50, 50, { width: 10, height: 10 }, { width: 420 }), { x: 0, y: 0 });
});

test('workspace layout: panel width is sane', () => {
    assert.ok(u.WORKSPACE_PANEL_WIDTH >= 360 && u.WORKSPACE_PANEL_WIDTH <= 600);
});

// A maximized 1920x1080 workspace minus the 440 px Dispatcher panel; a 1080x1920 monitor on its side.
const wide = { width: 1480, height: 1040 };
const tall = { width: 640, height: 1880 };
const rects = (n: number, area: { width: number; height: number }) =>
    Array.from({ length: n }, (_, i) => u.workspaceTileRect(i, n, area));

test('workspace tiles: one card fills the whole workspace', () => {
    assert.deepEqual(u.workspaceTileRect(0, 1, wide), { x: 0, y: 0, w: 1480, h: 1040 });
    assert.deepEqual(u.workspaceTileRect(0, 1, tall), { x: 0, y: 0, w: 640, h: 1880 });
});

test('workspace tiles: two split it in half, three in thirds, flush with no gaps, first beside the panel', () => {
    const [a, b] = rects(2, wide);
    assert.deepEqual([a.x + a.w, a.w, b.x, b.x + b.w], [1480, 740, 0, a.x]);
    const three = rects(3, wide);
    assert.equal(three[0].x + three[0].w, wide.width, 'first card touches the panel');
    assert.equal(three[2].x, 0, 'last card reaches the left edge');
    for (let k = 1; k < 3; k++) assert.equal(three[k].x + three[k].w, three[k - 1].x, 'cards touch');
    assert.ok(three.every(r => Math.abs(r.w - 1480 / 3) <= 1 && r.y === 0 && r.h === 1040));
});

test('workspace tiles: a tall workspace splits one above the other, the first at the top', () => {
    const [a, b, c] = rects(3, tall);
    assert.deepEqual([a.y, b.y, c.y + c.h], [0, a.y + a.h, 1880]);
    assert.ok([a, b, c].every(r => r.x === 0 && r.w === 640));
});

test('workspace tiles: never smaller than an incident\'s default size; past that, cards share a spot', () => {
    assert.equal(u.workspaceTileCount(wide), 3);   // 1480 / 420
    assert.equal(u.workspaceTileCount(tall), 3);   // 1880 / 600
    const four = rects(4, wide);
    assert.ok(four.slice(0, 3).every(r => r.w >= u.WORKSPACE_MIN_CARD_WIDTH));
    // The fourth shares the first card's spot, full size: the tabs along the top switch between them.
    assert.deepEqual(four[3], four[0]);
    assert.equal(u.workspaceSpotOf(3, 4, wide), 0);
    assert.equal(u.workspaceSpotOf(4, 5, wide), 1);
    assert.deepEqual(rects(5, wide)[4], rects(5, wide)[1]);
    const tallFour = rects(4, tall);
    assert.ok(tallFour.slice(0, 3).every(r => r.h >= u.WORKSPACE_MIN_CARD_HEIGHT));
    assert.deepEqual(tallFour[3], tallFour[0]);
});

test('workspace tiles: shrinking the workspace puts the cards that no longer fit into shared spots', () => {
    // Three cards in a workspace that now fits two: the third joins the first card's spot.
    const narrow = { width: 900, height: 800 };
    assert.equal(u.workspaceTileCount(narrow), 2);
    const [a, b, c] = rects(3, narrow);
    assert.deepEqual(c, a);
    assert.notDeepEqual(b, a);
    assert.equal(u.workspaceSpotOf(2, 3, narrow), 0);
});

test('workspace tiles: a wide monitor fits more side by side', () => {
    const ultra = { width: 3000, height: 1400 };
    assert.equal(u.workspaceTileCount(ultra), 7);
    assert.ok(rects(7, ultra).every(r => r.w >= u.WORKSPACE_MIN_CARD_WIDTH && r.h === 1400));
});

test('workspace tiles: many cards still each get a whole spot', () => {
    for (const i of [0, 3, 50, 99]) {
        const r = u.workspaceTileRect(i, 100, wide);
        assert.ok(r.w >= u.WORKSPACE_MIN_CARD_WIDTH && r.h === wide.height);
    }
});

test('workspace tiles: a workspace smaller than one card gives the whole area to each card', () => {
    const small = { width: 300, height: 200 };
    assert.equal(u.workspaceTileCount(small), 1);
    assert.deepEqual(u.workspaceTileRect(0, 3, small), { x: 0, y: 0, w: 300, h: 200 });
    assert.deepEqual(u.workspaceTileRect(2, 3, small), { x: 0, y: 0, w: 300, h: 200 });
});

test('workspace tiles: bad input is clamped', () => {
    assert.deepEqual(u.workspaceTileRect(-1, 2, wide), u.workspaceTileRect(0, 2, wide));
    assert.deepEqual(u.workspaceTileRect(5, 2, wide), u.workspaceTileRect(1, 2, wide));
    assert.deepEqual(u.workspaceTileRect(0, 0, wide), u.workspaceTileRect(0, 1, wide));
});

test('window title: number and type, or a placeholder while the incident is not on the board', () => {
    assert.equal(u.incidentTitle({ number: 'INC-001', type: 'Fire' }), 'INC-001 Fire');
    assert.equal(u.incidentTitle({ number: 'INC-002', type: null }), 'INC-002');
    assert.equal(u.incidentTitle(undefined), 'Incident');
    assert.equal(u.incidentTitle(null), 'Incident');
});
