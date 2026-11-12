// The "unit is busy" refusal on an assignment (one incident per unit): which failures clear by
// themselves, and how the incident view wires it. Plain node, no CloudTAK:
//   node --test plugin/test/*.test.ts
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ASSIGN_REFUSAL_MS, isBusyRefusal, makeFlash } from '../lib/assign-refusal.ts';

// What CloudTAK's std() throws: an Error with the server's response body attached.
const stdError = (status: number, message: string) => Object.assign(new Error(message), { body: { status, message, messages: [] } });

test('only the server\'s 409 is the busy-unit refusal', () => {
    assert.equal(isBusyRefusal(stdError(409, 'E12 is on 014. Clear it there first.')), true);
    assert.equal(isBusyRefusal(stdError(400, 'This incident is closed. Reopen it to change its units.')), false);
    assert.equal(isBusyRefusal(stdError(500, 'Internal Server Error')), false);
    assert.equal(isBusyRefusal(new Error('Request timed out after 30000ms')), false, 'no body: a network failure');
    assert.equal(isBusyRefusal(Object.assign(new Error('x'), { body: 'details text' })), false);
    assert.equal(isBusyRefusal(null), false);
    assert.equal(isBusyRefusal('E12 is on 014'), false);
});

test('the refusal message clears after 10 s, unless something else replaced it', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        let shown = '';
        const flash = makeFlash(() => shown, (t) => { shown = t; }, ASSIGN_REFUSAL_MS);
        assert.equal(ASSIGN_REFUSAL_MS, 10_000);

        flash.show('E12 is on 014. Clear it there first.');
        mock.timers.tick(9_999);
        assert.equal(shown, 'E12 is on 014. Clear it there first.', 'still there just before 10 s');
        mock.timers.tick(1);
        assert.equal(shown, '', 'gone at 10 s');

        flash.show('E12 is on 014. Clear it there first.');
        shown = 'Note is too long';  // another error came in meanwhile
        mock.timers.tick(10_000);
        assert.equal(shown, 'Note is too long', 'a newer message is left alone');

        flash.show('M4 is on 011. Clear it there first.');
        mock.timers.tick(6_000);
        flash.show('E12 is on 014. Clear it there first.');  // a second refusal restarts the 10 s
        mock.timers.tick(6_000);
        assert.equal(shown, 'E12 is on 014. Clear it there first.');
        mock.timers.tick(4_000);
        assert.equal(shown, '');

        flash.show('E12 is on 014. Clear it there first.');
        flash.stop();  // the incident view closed
        mock.timers.tick(10_000);
        assert.equal(shown, 'E12 is on 014. Clear it there first.', 'no timer left running after stop');
    } finally {
        mock.timers.reset();
    }
});

test('the incident view: both assign paths use it, keep the picks and the search text, re-read the board', () => {
    const src = readFileSync(new URL('../components/IncidentDetail.vue', import.meta.url), 'utf8');
    const fn = (name: string) => src.slice(src.indexOf(`async function ${name}(`), src.indexOf('\n}\n', src.indexOf(`async function ${name}(`)));
    const picker = fn('slAssignSelected');
    assert.match(picker, /catch \(e\) \{[\s\S]*slAssignFailed\(e\);\s+await loadIncidents\(\);\s+pickerSelected\.value = toAdd\.map\(c => c\.uid\);\s+showContactPicker\.value = true;/);
    const search = fn('slAssignContact');
    assert.match(search, /const typed = slContactSearch\.value;\s+slContactSearch\.value = '';/);
    assert.match(search, /catch \(e\) \{\s+slAssignFailed\(e\);\s+slContactSearch\.value = typed;/);
    assert.match(src, /if \(isBusyRefusal\(e\)\) slRefusal\.show\(msg\);\s+else slDetailError\.value = msg;/, 'only the refusal clears by itself');
    assert.match(src, /onBeforeUnmount\(\(\) => slRefusal\.stop\(\)\);/);
    // A unit that became busy after it was ticked is never sent.
    assert.match(picker, /const chosen = allContacts\.value\.filter\(c => pickerChosen\.value\.includes\(c\.uid\)\);/);
});
