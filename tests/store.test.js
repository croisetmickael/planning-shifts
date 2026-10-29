import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, exportJson, importJson, exportCsv, exportIcs, parseIcs, mergeIcsNotes } from '../app/store.js';

const data = {
  version: 1,
  activeCalendarId: 'c1',
  calendars: [{ id: 'c1', name: 'Moi', color: '#112233' }],
  shiftTypes: [
    { id: 'n', calendarId: 'c1', name: 'Nuit', abbr: 'N', color: '#000000', start: '22:00', end: '06:00', breakMinutes: 0, pay: { mode: 'hourly', cents: 2000 } },
  ],
  days: { 'c1|2026-10-30': { shifts: ['n'], overtimeMinutes: 0, earlyExitMinutes: 0, extraCents: 0, note: '=SOMME(A1); "test"' } },
};

test('sauvegarde JSON : aller-retour identique', () => {
  assert.deepEqual(importJson(exportJson(data)), data);
});

test('validation : refuse un fichier étranger, nettoie les champs inconnus', () => {
  assert.throws(() => validate({ hello: 1 }), /sauvegarde/);
  assert.throws(() => validate({ ...data, shiftTypes: [{ ...data.shiftTypes[0], start: '99:00' }] }));
  const dirty = validate({ ...data, days: { 'c1|2026-10-30': { shifts: ['n', 'inconnu', 'n', 'n'], evil: '<script>' }, 'cX|2026-01-01': { shifts: [] } } });
  assert.deepEqual(Object.keys(dirty.days), ['c1|2026-10-30']);
  assert.deepEqual(dirty.days['c1|2026-10-30'].shifts, ['n', 'n']);
  assert.equal(dirty.days['c1|2026-10-30'].evil, undefined);
});

test('CSV : séparateur ;, formule neutralisée, guillemets échappés', () => {
  const csv = exportCsv(data, 'c1');
  const line = csv.split('\r\n')[1];
  assert.ok(line.startsWith('2026-10-30;Nuit;;8,00;'));
  assert.ok(line.endsWith(`"'=SOMME(A1); ""test"""`));
});

test('ICS : la nuit finit le lendemain, et se relit', () => {
  const ics = exportIcs(data, 'c1');
  assert.match(ics, /DTSTART:20261030T220000/);
  assert.match(ics, /DTEND:20261031T060000/);
  const ev = parseIcs(ics);
  assert.deepEqual(ev[0], { date: '2026-10-30', title: 'Nuit' });
});

test('durées saisies : gardées à l\'import, alignées sur leur shift, et dans l\'ICS', () => {
  const d = structuredClone(data);
  d.shiftTypes.push({ ...d.shiftTypes[0], id: 'm', name: 'Matin', start: '06:00', end: '14:00', durationMinutes: 420 });
  d.days['c1|2026-10-30'] = { ...d.days['c1|2026-10-30'], shifts: ['inconnu', 'n'], minutes: [999, 300] };
  d.days['c1|2026-10-29'] = { shifts: ['m'], overtimeMinutes: 0, earlyExitMinutes: 0, extraCents: 0, note: '' };
  const v = validate(d);
  assert.equal(v.shiftTypes[1].durationMinutes, 420);
  assert.deepEqual(v.days['c1|2026-10-30'].shifts, ['n']);
  assert.deepEqual(v.days['c1|2026-10-30'].minutes, [300]);
  assert.equal(v.days['c1|2026-10-29'].minutes, undefined);
  assert.equal(validate({ ...d, shiftTypes: [{ ...d.shiftTypes[0], durationMinutes: 5000 }] }).shiftTypes[0].durationMinutes, undefined);
  const ics = exportIcs(v, 'c1');
  assert.match(ics, /DTSTART:20261030T220000\r\nDTEND:20261031T030000/); // nuit de 5 h ce jour-là
  assert.match(ics, /DTSTART:20261029T060000\r\nDTEND:20261029T130000/); // matin saisi à 7 h
});

test('import ICS en notes, sans doublon', () => {
  const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261101\r\nSUMMARY:Toussaint\r\nEND:VEVENT\r\nEND:VCALENDAR';
  const d = structuredClone(data);
  assert.equal(mergeIcsNotes(d, 'c1', parseIcs(ics)), 1);
  assert.equal(mergeIcsNotes(d, 'c1', parseIcs(ics)), 0);
  assert.equal(d.days['c1|2026-11-01'].note, 'Toussaint');
});
