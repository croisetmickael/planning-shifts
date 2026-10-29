import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shiftMinutes, shiftPay, dayTotals, rangeTotals, monthGrid, addDays, toMin, parseDuration, fmtHm } from '../app/time.js';

const morning = { id: 'm', start: '06:00', end: '14:00', breakMinutes: 0, pay: { mode: 'hourly', cents: 1500 } };
const night = { id: 'n', start: '22:00', end: '06:00', breakMinutes: 30, pay: { mode: 'hourly', cents: 2000 } };
const split = { id: 's', start: '08:00', end: '19:00', breakMinutes: 180, pay: { mode: 'fixed', cents: 9000 } };
const types = { m: morning, n: night, s: split };

test('durées : jour, nuit qui passe minuit, coupure', () => {
  assert.equal(shiftMinutes(morning), 480);
  assert.equal(shiftMinutes(night), 450);
  assert.equal(shiftMinutes(split), 480);
  assert.equal(shiftMinutes({ start: '00:00', end: '00:00' }), 1440);
});

test('paie horaire et fixe', () => {
  assert.equal(shiftPay(morning), 12000);
  assert.equal(shiftPay(night), 15000);
  assert.equal(shiftPay(split), 9000);
});

test('jour avec 2 shifts, heures sup, départ anticipé et revenu extra', () => {
  const r = dayTotals({ shifts: ['m', 'n'], overtimeMinutes: 60, earlyExitMinutes: 30, extraCents: 500 }, types);
  assert.equal(r.minutes, 480 + 450 + 30);
  assert.equal(r.cents, 12000 + 15000 + 750 + 500);
  assert.equal(r.perType.m.count, 1);
});

test('jour vide et shift supprimé ignorés', () => {
  assert.deepEqual(dayTotals({ shifts: ['zz'], overtimeMinutes: 60 }, types).minutes, 0);
  assert.equal(dayTotals(undefined, types).cents, 0);
});

test('totaux sur une période, un seul calendrier', () => {
  const data = {
    shiftTypes: [morning, night],
    days: { 'c1|2026-10-01': { shifts: ['m'] }, 'c1|2026-10-31': { shifts: ['n'] }, 'c1|2026-11-01': { shifts: ['m'] }, 'c2|2026-10-02': { shifts: ['m'] } },
  };
  const r = rangeTotals(data, 'c1', '2026-10-01', '2026-10-31');
  assert.equal(r.days, 2);
  assert.equal(r.minutes, 930);
});

test('grille du mois commence un lundi et couvre le mois', () => {
  const g = monthGrid(2026, 1); // février 2026 : commence un dimanche
  assert.equal(g[0], '2026-01-26');
  assert.equal(g.length % 7, 0);
  assert.ok(g.includes('2026-02-28'));
  assert.equal(addDays('2026-03-29', 1), '2026-03-30'); // passage à l'heure d'été
});

test('saisie de durée : formats acceptés et refusés', () => {
  for (const [s, m] of [['7:30', 450], ['7h30', 450], ['7h', 420], ['7,5', 450], ['7.25', 435], ['8', 480], [' 0:45 ', 45], ['', null]]) assert.equal(parseDuration(s), m, s);
  for (const s of ['7:75', 'abc', '-2', '7h30m']) assert.throws(() => parseDuration(s), s);
  assert.equal(fmtHm(450), '7:30');
  assert.equal(fmtHm(null), '');
});

test('durée saisie sur le type : remplace horaires et pause, et la paie suit', () => {
  const t = { ...morning, breakMinutes: 60, durationMinutes: 420 };
  assert.equal(shiftMinutes(t), 420);
  assert.equal(shiftPay(t), 10500);
});

test('durée saisie pour un seul jour : ne touche que ce shift', () => {
  const r = dayTotals({ shifts: ['m', 'n'], minutes: [null, 300] }, types);
  assert.equal(r.minutes, 480 + 300);
  assert.equal(r.cents, 12000 + 10000);
  assert.equal(r.perType.n.minutes, 300);
  assert.equal(dayTotals({ shifts: ['m'], minutes: [0] }, types).minutes, 0);
});

test('heure invalide refusée', () => {
  assert.throws(() => toMin('25:00'));
});
