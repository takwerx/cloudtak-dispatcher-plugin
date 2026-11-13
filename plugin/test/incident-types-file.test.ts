// Proof test (ops #721): the Incident Types card refuses a file that is far too big for a list of incident
// types BEFORE it reads it, so a wrong file (a log, a picture) cannot freeze the admin's browser tab.
// Plain node, no CloudTAK and no database:
//   node --test plugin/test/incident-types-file.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    INCIDENT_TYPE_FILE_MAX_BYTES, INCIDENT_TYPE_CODE_MAX, INCIDENT_TYPE_NAME_MAX, INCIDENT_TYPES_MAX,
    incidentTypeFileProblem, parseIncidentTypeCsv,
} from '../lib/incident-types.ts';

test('the file limit is bigger than a full, legal list, and smaller than a runaway file', () => {
    // 300 types, each with the longest code and the longest name, one quoted comma and a CRLF
    const fullest = Array.from({ length: INCIDENT_TYPES_MAX }, (_, i) =>
        `${String(i).padStart(INCIDENT_TYPE_CODE_MAX, 'C')},"${String(i).padStart(INCIDENT_TYPE_NAME_MAX, 'N')}"`).join('\r\n');
    const full = Buffer.byteLength(fullest);
    assert.ok(full < INCIDENT_TYPE_FILE_MAX_BYTES / 4, `a full list is ${full} bytes, the limit ${INCIDENT_TYPE_FILE_MAX_BYTES}`);
    assert.equal(parseIncidentTypeCsv(fullest).errors.length, 0, 'the fullest legal list loads');
    assert.ok(INCIDENT_TYPE_FILE_MAX_BYTES <= 1024 * 1024);
});

test('a file over the limit is refused with a plain sentence, a file at the limit is not', () => {
    assert.equal(incidentTypeFileProblem(0), '');
    assert.equal(incidentTypeFileProblem(INCIDENT_TYPE_FILE_MAX_BYTES), '');
    assert.equal(
        incidentTypeFileProblem(INCIDENT_TYPE_FILE_MAX_BYTES + 1),
        'That file is too big (over 200 KB). A list of incident types has one short line per type.',
    );
    assert.match(incidentTypeFileProblem(500 * 1024 * 1024), /too big/);
});

test('wiring: the card checks the size before it reads the file', () => {
    const card = readFileSync(new URL('../components/IncidentTypesSettings.vue', import.meta.url), 'utf8');
    const check = card.indexOf('incidentTypeFileProblem(file.size)');
    const read = card.indexOf('await file.text()');
    assert.ok(check > 0, 'the card calls the size check');
    assert.ok(read > check, 'the size check comes before file.text()');
    assert.equal(card.split('file.text()').length - 1, 1, 'the file is read in one place');
});
