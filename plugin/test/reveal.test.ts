// Proof tests for revealing part of an incident in its own scroll box (lib/reveal.ts, no imports, loaded as it ships):
//   node --test plugin/test/*.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { revealScrollTop } from '../lib/reveal.ts';

// A scroll box showing screen y 100..600 (500 tall), scrolled 1000 px down.
const view = { top: 100, bottom: 600, scrollTop: 1000 };

test('nearest: a box already in view does not move', () => {
    assert.equal(revealScrollTop(view, { top: 200, bottom: 400 }), 1000);
});

test('nearest: a box hanging off the bottom scrolls just far enough to show its bottom', () => {
    // The Disposition box under a long incident: 550..750 needs 150 px more.
    assert.equal(revealScrollTop(view, { top: 550, bottom: 750 }), 1150);
});

test('nearest: a box above the view scrolls up to its top', () => {
    assert.equal(revealScrollTop(view, { top: 50, bottom: 150 }), 950);
});

test('a box taller than the view shows its top, so its first options are on screen', () => {
    assert.equal(revealScrollTop(view, { top: 450, bottom: 1050 }), 1350);
    assert.equal(revealScrollTop(view, { top: 450, bottom: 1050 }, 'center'), 1350);
});

test('center: the box ends up in the middle of the view', () => {
    // 100 tall in a 500 tall view: 200 px above it.
    const top = revealScrollTop(view, { top: 700, bottom: 800 }, 'center');
    assert.equal(700 - (top - view.scrollTop), view.top + 200);
});

test('never scrolls above the top', () => {
    assert.equal(revealScrollTop({ top: 0, bottom: 500, scrollTop: 0 }, { top: -80, bottom: 20 }), 0);
    assert.equal(revealScrollTop({ top: 0, bottom: 500, scrollTop: 10 }, { top: 20, bottom: 60 }, 'center'), 0);
});
