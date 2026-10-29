// Calculs purs : dates locales "YYYY-MM-DD", heures "HH:MM", argent en centimes.

export const toMin = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  if (!m || +m[1] > 23 || +m[2] > 59) throw new Error(`heure invalide : ${hhmm}`);
  return +m[1] * 60 + +m[2];
};

// "7:30", "7h30", "7h", "7,5", "7.5" -> minutes ; vide -> null.
export const parseDuration = (s) => {
  const v = String(s ?? '').trim().toLowerCase();
  if (!v) return null;
  let m = /^(\d{1,2})\s*[:h]\s*(\d{0,2})$/.exec(v);
  if (m && (m[2] === '' || +m[2] < 60)) return +m[1] * 60 + (+m[2] || 0);
  m = /^(\d{1,2})(?:[.,](\d+))?$/.exec(v);
  if (m) return Math.round(parseFloat(`${m[1]}.${m[2] || 0}`) * 60);
  throw new Error(`durée invalide : ${s} (ex. 7:30 ou 7,5)`);
};

export const fmtHm = (min) => (min == null ? '' : `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`);

// Durée saisie à la main sur le type de shift, sinon calculée.
// Fin <= début : le shift passe minuit et compte pour le jour où il commence.
export const shiftMinutes = (t) => {
  if (t.durationMinutes != null) return t.durationMinutes;
  let d = toMin(t.end) - toMin(t.start);
  if (d <= 0) d += 1440;
  return Math.max(0, d - (t.breakMinutes || 0));
};

const hourlyCents = (t) => (t && t.pay && t.pay.mode === 'hourly' ? t.pay.cents : 0);

export const shiftPay = (t, minutes = shiftMinutes(t)) =>
  t.pay && t.pay.mode === 'fixed' ? t.pay.cents : Math.round((hourlyCents(t) * minutes) / 60);

// Durée d'un shift posé : valeur saisie pour ce jour (day.minutes[i]) sinon celle du type.
export const slotMinutes = (day, i, t) => {
  const v = day && day.minutes ? day.minutes[i] : null;
  return v != null ? v : shiftMinutes(t);
};

// Heures sup et départ anticipé ajustent les minutes, payées au taux horaire du premier shift du jour.
export const dayTotals = (day, typesById) => {
  const types = [];
  let minutes = 0, cents = 0;
  const perType = {};
  (day && day.shifts ? day.shifts : []).forEach((id, i) => {
    const t = typesById[id];
    if (!t) return;
    types.push(t);
    const m = slotMinutes(day, i, t), c = shiftPay(t, m);
    minutes += m; cents += c;
    const p = (perType[t.id] ||= { count: 0, minutes: 0, cents: 0 });
    p.count++; p.minutes += m; p.cents += c;
  });
  if (types.length) {
    const adj = (day.overtimeMinutes || 0) - (day.earlyExitMinutes || 0);
    minutes += adj;
    cents += Math.round((hourlyCents(types[0]) * adj) / 60);
  }
  cents += (day && day.extraCents) || 0;
  return { minutes: Math.max(0, minutes), cents, perType };
};

export const rangeTotals = (data, calendarId, from, to) => {
  const typesById = Object.fromEntries(data.shiftTypes.map((t) => [t.id, t]));
  const out = { minutes: 0, cents: 0, days: 0, perType: {} };
  for (const [key, day] of Object.entries(data.days)) {
    const [cal, date] = key.split('|');
    if (cal !== calendarId || date < from || date > to) continue;
    const r = dayTotals(day, typesById);
    if (r.minutes || r.cents) out.days++;
    out.minutes += r.minutes; out.cents += r.cents;
    for (const [id, p] of Object.entries(r.perType)) {
      const o = (out.perType[id] ||= { count: 0, minutes: 0, cents: 0 });
      o.count += p.count; o.minutes += p.minutes; o.cents += p.cents;
    }
  }
  return out;
};

export const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const parseIso = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const addDays = (s, n) => {
  const d = parseIso(s);
  d.setDate(d.getDate() + n);
  return iso(d);
};

export const daysBetween = (a, b) => Math.round((parseIso(b) - parseIso(a)) / 86400000);

export const monthBounds = (y, m) => [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))];

// Grille lundi-dimanche couvrant tout le mois (5 ou 6 semaines).
export const monthGrid = (y, m) => {
  const first = new Date(y, m, 1);
  const start = addDays(iso(first), -((first.getDay() + 6) % 7));
  const last = new Date(y, m + 1, 0);
  const cells = daysBetween(start, iso(last)) + 1;
  return Array.from({ length: Math.ceil(cells / 7) * 7 }, (_, i) => addDays(start, i));
};

export const fmtDuration = (min) => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;

export const fmtMoney = (cents) => (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
