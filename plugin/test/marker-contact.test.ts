// Proof test for the marker's caller phone (ops #403). Plain node, no CloudTAK needed:
//   node --test plugin/test/
// Fails without commit 5217524 ("always send contact"): the phone stayed on the marker after it
// was cleared or Caller Details was switched off, so field units kept seeing the old number.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dialablePhone, callerRemark, markerContact } from '../lib/marker-contact.ts';

// CloudTAK merges a resent marker's properties into the stored one key by key (Object.assign)
// and never removes a key (ops #403 lesson). This is the whole update path in miniature.
const resend = (stored: Record<string, unknown>, update: Record<string, unknown>) => Object.assign({}, stored, update);

test('a caller with a phone gives a dialable contact', () => {
    assert.deepEqual(markerContact('26-001 Fire', '(555) 010-2000 x14'), { callsign: '26-001 Fire', phone: '5550102000' });
    assert.deepEqual(markerContact('26-001 Fire', '+1 555 010 2000'), { callsign: '26-001 Fire', phone: '+15550102000' });
});

test('no phone gives a contact with only the callsign, never a phone key', () => {
    for (const none of [undefined, null, '', '   ', 'no number', 'x14']) {
        const c = markerContact('26-001 Fire', none);
        assert.deepEqual(c, { callsign: '26-001 Fire' });
        assert.ok(!('phone' in c));
    }
});

test('clearing the phone removes it from the marker CloudTAK holds', () => {
    const first  = { callsign: '26-001 Fire', contact: markerContact('26-001 Fire', '555-010-2000') };
    const second = { callsign: '26-001 Fire', contact: markerContact('26-001 Fire', '') };
    const stored = resend(first, second) as { contact: { phone?: string } };
    assert.equal(stored.contact.phone, undefined);
});

test('turning Caller Details off (phone not sent) removes it from the marker CloudTAK holds', () => {
    const on  = { contact: markerContact('26-001 Fire', '555-010-2000') };
    const off = { contact: markerContact('26-001 Fire', undefined) };
    assert.equal((resend(on, off) as { contact: { phone?: string } }).contact.phone, undefined);
});

test('the remark leaves out whichever caller part is blank', () => {
    assert.equal(callerRemark('Pat', '555-010-2000'), 'Caller: Pat · 555-010-2000');
    assert.equal(callerRemark('Pat', ''), 'Caller: Pat');
    assert.equal(callerRemark('', ''), '');
    assert.equal(dialablePhone('abc'), '');
});

test('dropIncidentMarker always sets contact through markerContact', () => {
    const src = readFileSync(new URL('../lib/map-marker.ts', import.meta.url), 'utf8');
    assert.match(src, /norm\.properties\.contact = markerContact\(/);
    assert.doesNotMatch(src, /if \(dial\) norm\.properties\.contact/);
});
