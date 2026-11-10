// Proof test for the marker's caller phone (ops #403). Plain node, no CloudTAK needed:
//   node --test plugin/test/
// Fails without commit 5217524 ("always send contact"): the phone stayed on the marker after it
// was cleared or Caller Details was switched off, so field units kept seeing the old number.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dialablePhone, callersRemark, markerContact, markerContactFor, primaryCaller } from '../lib/marker-contact.ts';

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
    assert.equal(callersRemark([{ name: 'Pat', phone: '555-010-2000' }]), 'Caller: Pat · 555-010-2000');
    assert.equal(callersRemark([{ name: 'Pat', phone: '' }]), 'Caller: Pat');
    assert.equal(callersRemark([{ name: '', phone: '' }]), '');
    assert.equal(callersRemark([]), '');
    assert.equal(callersRemark(undefined), '');
    assert.equal(dialablePhone('abc'), '');
});

// ── Several callers (ops #403, reporter's request) ──────────────────────────────

const three = [
    { name: 'Jane Doe', phone: '(555) 555-0123', note: null, primary: false },
    { name: 'Bob Smith', phone: '555-0199', note: 'reports smoke from rear', primary: true },
    { name: null, phone: '555-0142', note: null, primary: false },
];

test('the primary caller supplies the dialable phone, not the first one in the list', () => {
    assert.equal(primaryCaller(three)?.name, 'Bob Smith');
    assert.deepEqual(markerContactFor('26-001 Fire', three), { callsign: '26-001 Fire', phone: '5550199' });
});

test('with no caller marked primary the first caller is the primary', () => {
    const list = [{ name: 'A', phone: '111' }, { name: 'B', phone: '222' }];
    assert.equal(primaryCaller(list)?.name, 'A');
    assert.deepEqual(markerContactFor('x', list), { callsign: 'x', phone: '111' });
});

test('the remarks list every caller, primary first, with notes', () => {
    assert.equal(
        callersRemark(three),
        'Callers: Bob Smith · 555-0199 — reports smoke from rear (primary); Jane Doe · (555) 555-0123; 555-0142',
    );
});

test('Caller Details off (empty list) puts no caller, note or phone on the marker', () => {
    // slMarkerFor passes [] when the switch is off. Nothing about callers may come out of it.
    assert.equal(callersRemark([]), '');
    assert.deepEqual(markerContactFor('26-001 Fire', []), { callsign: '26-001 Fire' });
    const stored = resend({ contact: markerContactFor('26-001 Fire', three) }, { contact: markerContactFor('26-001 Fire', []) }) as { contact: { phone?: string } };
    assert.equal(stored.contact.phone, undefined, 'the old primary phone must not stay on the marker');
});

test('changing the primary caller moves the phone on the marker CloudTAK holds', () => {
    const before = three;
    const after = three.map(c => ({ ...c, primary: c.name === 'Jane Doe' }));
    const stored = resend({ contact: markerContactFor('c', before) }, { contact: markerContactFor('c', after) }) as { contact: { phone?: string } };
    assert.equal(stored.contact.phone, '5555550123');
});

test('removing the only phone-bearing primary clears the marker phone', () => {
    const only = [{ name: 'Pat', phone: '555-010-2000', primary: true }];
    const removed = [{ name: 'Lee', phone: '', primary: true }];
    const stored = resend({ contact: markerContactFor('c', only) }, { contact: markerContactFor('c', removed) }) as { contact: { phone?: string } };
    assert.equal(stored.contact.phone, undefined);
});

test('the incident detail (panel and undocked cards) sends no callers to the marker when Caller Details is off', () => {
    const src = readFileSync(new URL('../components/IncidentDetail.vue', import.meta.url), 'utf8');
    assert.match(src, /callers:\s+dispatcherStore\.callerOnMarkers \? \(inc\.callers \?\? \[\]\) : \[\]/);
});

test('dropIncidentMarker always sets contact through markerContact', () => {
    const src = readFileSync(new URL('../lib/map-marker.ts', import.meta.url), 'utf8');
    assert.match(src, /norm\.properties\.contact = markerContactFor\(/);
    assert.doesNotMatch(src, /if \(dial\) norm\.properties\.contact/);
});
