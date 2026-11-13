// Proof tests for changing an incident's location, the browser side. Plain node, no CloudTAK:
//   node --test plugin/test/*.test.ts
// (The server's note is tested in location-server.test.ts.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { joinAddress, splitAddress } from '../lib/address-form.ts';

test('splitAddress: the incident\'s one address line goes back into the boxes', () => {
    assert.deepEqual(splitAddress('100 MAIN ST, Springfield, OR'), { streetName: '100 MAIN ST', city: 'Springfield', state: 'OR' });
    assert.deepEqual(splitAddress('Mile 12, Lake Rd, Springfield, OR'), { streetName: 'Mile 12, Lake Rd', city: 'Springfield', state: 'OR' });
    assert.deepEqual(splitAddress('100 MAIN ST, Springfield'), { streetName: '100 MAIN ST', city: 'Springfield', state: '' });
    assert.deepEqual(splitAddress('100 MAIN ST'), { streetName: '100 MAIN ST', city: '', state: '' });
    assert.deepEqual(splitAddress(''), { streetName: '', city: '', state: '' });
});

test('an address read into the boxes and saved untouched is the same line (so Save with no change writes no note)', () => {
    for (const line of ['100 MAIN ST, Springfield, OR', 'Mile 12, Lake Rd, Springfield, OR', '100 MAIN ST, Springfield',
        '100 MAIN ST, OR', '100 MAIN ST', 'Main St & Oak Ave, Springfield, OR', '']) {
        const b = splitAddress(line);
        assert.equal(joinAddress(b.streetName, b.city, b.state), line, line);
    }
    assert.equal(joinAddress(' 100 MAIN ST ', '', ' OR '), '100 MAIN ST, OR', 'blank boxes leave no stray commas');
});

test('Change location: the detail opens the form\'s Location block, and saving sends only the new place', () => {
    const form = readFileSync(new URL('../components/IncidentForm.vue', import.meta.url), 'utf8');
    const detail = readFileSync(new URL('../components/IncidentDetail.vue', import.meta.url), 'utf8');
    // The form: filled with where the incident is now, and it hands the place back instead of creating.
    assert.ok(form.includes(`Object.assign(form, splitAddress(at.address ?? ''), { lat: at.lat, lon: at.lon, details: at.details ?? '' });`));
    assert.match(form, /if \(props\.relocate\) \{\s+emit\('relocated', \{ address, lat: form\.lat, lon: form\.lon, details: form\.details \}\);/);
    assert.equal(form.split(`!relocate'`).length - 1, 6, 'number, type, time, details, report number and caller are not part of a change of location');
    // The detail: one link beside the address, the editor under the facts, and one call to the server.
    assert.ok(detail.includes(`data-test='change-location'`));
    assert.match(detail, /<IncidentForm\s+server-mode='standalone'\s+:incident-types='\[\]'\s+:relocate='inc'\s+@relocated='slSaveLocation\(inc, \$event\)'/);
    const save = detail.slice(detail.indexOf('async function slSaveLocation'), detail.indexOf('// Callers: each add'));
    assert.ok(save.includes('address: to.address, lat: to.lat, lon: to.lon,'));
    assert.ok(save.includes('{ details: to.details }'), 'a chosen place puts its name on the details');
    assert.doesNotMatch(save, /notes/, 'the server writes the note; the browser does not send the notes list');
    // The marker moves (a closed one only where it still exists), the feed log and the units hear of it.
    assert.ok(save.includes(`updated.status === 'active' ? showIncident(mapStore, marker) : closeIncidentInField(mapStore, marker)`));
    assert.ok(save.includes('`LOCATION CHANGED: ${updated.number} | ${where}`'));
    assert.ok(save.includes('`Location changed to ${where}`'));
});
