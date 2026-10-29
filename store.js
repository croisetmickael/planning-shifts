// Données sur l'appareil + import / export (JSON, CSV, ICS).
import { dayTotals, toMin, addDays, slotMinutes } from './time.js';

const KEY = 'planning-shifts:v1';
export const MAX_CALENDARS = 10;

export const newId = () => Math.random().toString(36).slice(2, 10);

export const emptyData = () => {
  const id = newId();
  return { version: 1, activeCalendarId: id, calendars: [{ id, name: 'Mon planning', color: '#2f6fed' }], shiftTypes: [], days: {} };
};

export const load = () => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? validate(JSON.parse(raw)) : emptyData();
  } catch {
    return emptyData();
  }
};

// Renvoie false si le navigateur refuse l'écriture (stockage plein ou bloqué).
export const save = (data) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
};

// Validation stricte des données importées : on ne garde que les champs connus, au bon type.
const str = (v, max = 80) => (typeof v === 'string' ? v.slice(0, max) : '');
const int = (v) => (Number.isFinite(v) ? Math.round(v) : 0);
const color = (v) => (/^#[0-9a-f]{6}$/i.test(v) ? v : '#888888');
const hhmm = (v) => { toMin(v); return v; };
const dur = (v) => (Number.isFinite(v) && v >= 0 && v <= 1440 ? Math.round(v) : null);

export const validate = (d) => {
  if (!d || d.version !== 1 || !Array.isArray(d.calendars) || !Array.isArray(d.shiftTypes) || typeof d.days !== 'object')
    throw new Error("Ce fichier n'est pas une sauvegarde Planning Shifts.");
  const calendars = d.calendars.slice(0, MAX_CALENDARS).map((c) => ({ id: str(c.id, 20), name: str(c.name) || 'Planning', color: color(c.color) }));
  if (!calendars.length) throw new Error('La sauvegarde ne contient aucun calendrier.');
  const calIds = new Set(calendars.map((c) => c.id));
  const shiftTypes = d.shiftTypes.filter((t) => calIds.has(t.calendarId)).map((t) => ({
    id: str(t.id, 20), calendarId: t.calendarId, name: str(t.name) || 'Shift', abbr: str(t.abbr, 4), color: color(t.color),
    start: hhmm(t.start), end: hhmm(t.end), breakMinutes: Math.max(0, int(t.breakMinutes)),
    ...(dur(t.durationMinutes) != null && { durationMinutes: dur(t.durationMinutes) }),
    pay: { mode: t.pay && t.pay.mode === 'fixed' ? 'fixed' : 'hourly', cents: Math.max(0, int(t.pay && t.pay.cents)) },
  }));
  const typeIds = new Set(shiftTypes.map((t) => t.id));
  const days = {};
  for (const [k, v] of Object.entries(d.days)) {
    const [cal, date] = k.split('|');
    if (!calIds.has(cal) || !/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !v) continue;
    // Les durées par jour suivent leur shift : on filtre les deux tableaux ensemble.
    const slots = (Array.isArray(v.shifts) ? v.shifts : [])
      .map((id, i) => [id, dur(Array.isArray(v.minutes) ? v.minutes[i] : null)])
      .filter(([id]) => typeIds.has(id)).slice(0, 2);
    days[k] = {
      shifts: slots.map(([id]) => id),
      ...(slots.some(([, m]) => m != null) && { minutes: slots.map(([, m]) => m) }),
      overtimeMinutes: Math.max(0, int(v.overtimeMinutes)), earlyExitMinutes: Math.max(0, int(v.earlyExitMinutes)),
      extraCents: int(v.extraCents), note: str(v.note, 2000),
    };
  }
  const active = calIds.has(d.activeCalendarId) ? d.activeCalendarId : calendars[0].id;
  return { version: 1, activeCalendarId: active, calendars, shiftTypes, days };
};

export const isEmptyDay = (day) =>
  !day || (!day.shifts.length && !day.overtimeMinutes && !day.earlyExitMinutes && !day.extraCents && !day.note);

// --- export ---

export const download = (name, text, type) => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const exportJson = (data) => JSON.stringify(data, null, 2);

const csvCell = (v) => {
  const s = String(v ?? '');
  // Neutralise les formules quand le fichier est ouvert dans un tableur.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

// Une ligne par jour renseigné ; séparateur « ; » pour Excel en français.
export const exportCsv = (data, calendarId) => {
  const types = Object.fromEntries(data.shiftTypes.map((t) => [t.id, t]));
  const rows = [['date', 'shift 1', 'shift 2', 'heures', 'heures sup (min)', 'départ anticipé (min)', 'note']];
  for (const key of Object.keys(data.days).sort()) {
    const [cal, date] = key.split('|');
    if (cal !== calendarId) continue;
    const d = data.days[key];
    const r = dayTotals(d, types);
    rows.push([date, types[d.shifts[0]]?.name, types[d.shifts[1]]?.name, (r.minutes / 60).toFixed(2).replace('.', ','),
      d.overtimeMinutes, d.earlyExitMinutes, d.note]);
  }
  return '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n');
};

const icsText = (s) => String(s).replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
const icsDate = (date, hm) => date.replace(/-/g, '') + 'T' + hm.replace(':', '') + '00';

// Événements à heure locale « flottante » : Google Agenda les place dans le fuseau de l'utilisateur.
export const exportIcs = (data, calendarId) => {
  const types = Object.fromEntries(data.shiftTypes.map((t) => [t.id, t]));
  const cal = data.calendars.find((c) => c.id === calendarId);
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Planning Shifts//FR', `X-WR-CALNAME:${icsText(cal ? cal.name : 'Planning')}`];
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  for (const key of Object.keys(data.days).sort()) {
    const [c, date] = key.split('|');
    if (c !== calendarId) continue;
    const day = data.days[key];
    day.shifts.forEach((id, i) => {
      const t = types[id];
      if (!t) return;
      // Durée saisie (type ou jour) : la fin = début + durée ; sinon l'heure de fin du type.
      const manual = t.durationMinutes != null || (day.minutes && day.minutes[i] != null);
      let endMin = toMin(t.end);
      if (manual) endMin = toMin(t.start) + slotMinutes(day, i, t);
      else if (endMin <= toMin(t.start)) endMin += 1440;
      const endHm = `${String(Math.floor(endMin % 1440 / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
      out.push('BEGIN:VEVENT', `UID:${calendarId}-${date}-${i}@planning-shifts`, `DTSTAMP:${stamp}`,
        `DTSTART:${icsDate(date, t.start)}`, `DTEND:${icsDate(addDays(date, Math.floor(endMin / 1440)), endHm)}`,
        `SUMMARY:${icsText(t.name)}`, 'END:VEVENT');
    });
    const note = data.days[key].note;
    if (note) out.push('BEGIN:VEVENT', `UID:${calendarId}-${date}-note@planning-shifts`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${date.replace(/-/g, '')}`, `SUMMARY:${icsText(note.split('\n')[0])}`, `DESCRIPTION:${icsText(note)}`, 'END:VEVENT');
  }
  out.push('END:VCALENDAR');
  return out.join('\r\n');
};

// --- import ---

export const importJson = (text) => validate(JSON.parse(text));

// ICS -> [{ date, title }] : jours fériés ou événements d'un autre agenda, ajoutés en notes.
export const parseIcs = (text) => {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') cur = {};
    else if (line === 'END:VEVENT') {
      if (cur && cur.date) events.push({ date: cur.date, title: cur.title || '(sans titre)' });
      cur = null;
    } else if (cur) {
      const i = line.indexOf(':');
      const name = line.slice(0, i).split(';')[0];
      const val = line.slice(i + 1);
      if (name === 'DTSTART') {
        const m = /^(\d{4})(\d{2})(\d{2})/.exec(val);
        if (m) cur.date = `${m[1]}-${m[2]}-${m[3]}`;
      } else if (name === 'SUMMARY') cur.title = val.replace(/\\([\\;,])/g, '$1').replace(/\\n/gi, ' ').slice(0, 200);
    }
  }
  return events;
};

// Ajoute les événements en notes sans écraser l'existant ; renvoie le nombre de jours touchés.
export const mergeIcsNotes = (data, calendarId, events) => {
  let n = 0;
  for (const { date, title } of events) {
    const key = `${calendarId}|${date}`;
    const day = (data.days[key] ||= { shifts: [], overtimeMinutes: 0, earlyExitMinutes: 0, extraCents: 0, note: '' });
    if (day.note.split('\n').includes(title)) continue;
    day.note = (day.note ? day.note + '\n' : '') + title;
    n++;
  }
  return n;
};
