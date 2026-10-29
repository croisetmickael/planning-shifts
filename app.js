import { shiftMinutes, slotMinutes, parseDuration, fmtHm, dayTotals, rangeTotals, monthGrid, monthBounds, iso, addDays, daysBetween, fmtDuration, toMin } from './time.js';
import { load, save, newId, MAX_CALENDARS, isEmptyDay, download, exportJson, importJson, exportCsv, exportIcs, parseIcs, mergeIcsNotes } from './store.js';

const app = document.getElementById('app');
const dlg = document.getElementById('dlg');
const toastEl = document.getElementById('toast');
const fileInput = document.getElementById('file');

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const DOW = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const PALETTE = ['#2f6fed', '#e8590c', '#2b8a3e', '#c2255c', '#7048e8', '#0c8599', '#f08c00', '#495057'];

let data = load();
const now = new Date();
const today = iso(now);
const ui = { y: now.getFullYear(), m: now.getMonth(), mode: 'view', brush: null, sel: new Set(), clip: null };
const undoStack = [];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ink = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 150 ? '#111' : '#fff';
};
const cal = () => data.calendars.find((c) => c.id === data.activeCalendarId);
const types = () => data.shiftTypes.filter((t) => t.calendarId === data.activeCalendarId);
const typesById = () => Object.fromEntries(data.shiftTypes.map((t) => [t.id, t]));
const key = (date) => `${data.activeCalendarId}|${date}`;
const getDay = (date) => data.days[key(date)];
const blankDay = () => ({ shifts: [], overtimeMinutes: 0, earlyExitMinutes: 0, extraCents: 0, note: '' });
const ensureDay = (date) => (data.days[key(date)] ||= blankDay());
const setDay = (date, day) => {
  if (isEmptyDay(day)) delete data.days[key(date)];
  else data.days[key(date)] = day;
};

// --- état, annulation, enregistrement ---

const snapshot = () => {
  undoStack.push(JSON.stringify(data));
  if (undoStack.length > 30) undoStack.shift();
};

const commit = (message, undoable = true) => {
  if (!save(data)) toast("Impossible d'enregistrer : stockage du navigateur plein ou bloqué. Exportez une sauvegarde.");
  else if (message) toast(message, undoable && undoStack.length ? undo : null);
  render();
};

function undo() {
  const prev = undoStack.pop();
  if (!prev) return;
  data = JSON.parse(prev);
  save(data);
  toast('Annulé');
  render();
}

let toastTimer;
function toast(text, action) {
  toastEl.innerHTML = `<span>${esc(text)}</span>${action ? '<button type="button">Annuler</button>' : ''}`;
  toastEl.hidden = false;
  if (action) toastEl.querySelector('button').onclick = () => { toastEl.hidden = true; action(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), 4000);
}

// --- rendu principal ---

// « * » : durée saisie pour ce jour.
function chips(day) {
  const byId = typesById();
  return (day ? day.shifts : []).map((id, i) => {
    const t = byId[id];
    if (!t) return '';
    const own = day.minutes && day.minutes[i] != null;
    return `<span class="chip" style="background:${t.color};color:${ink(t.color)}" title="${esc(t.name)} · ${fmtHm(slotMinutes(day, i, t))}${own ? ' (ce jour)' : ''}">${esc(t.abbr || t.name)}${own ? '*' : ''}</span>`;
  }).join('');
}

// Garde day.minutes aligné sur day.shifts ; le supprime s'il ne contient aucune durée saisie.
const setSlots = (day, slots) => {
  day.shifts = slots.map(([id]) => id);
  if (slots.some(([, m]) => m != null)) day.minutes = slots.map(([, m]) => m ?? null);
  else delete day.minutes;
};
const slotsOf = (day) => day.shifts.map((id, i) => [id, day.minutes ? day.minutes[i] : null]);

function render() {
  const [from, to] = monthBounds(ui.y, ui.m);
  const tot = rangeTotals(data, data.activeCalendarId, from, to);
  const ts = types();
  if (ui.brush && ui.brush !== 'erase' && !ts.some((t) => t.id === ui.brush)) ui.brush = null;
  const title = `${MONTHS[ui.m]} ${ui.y}`;

  const bar = ui.mode === 'paint'
    ? (ts.length
      ? ts.map((t) => `<button type="button" class="brush" data-brush="${t.id}" aria-pressed="${ui.brush === t.id}" style="background:${t.color};color:${ink(t.color)};border-color:${t.color}">${esc(t.name)}</button>`).join('')
        + `<button type="button" class="brush" data-brush="erase" aria-pressed="${ui.brush === 'erase'}">Gomme</button>`
        + (ui.brush ? '' : '<span class="hint">Choisissez un shift, puis touchez les jours.</span>')
      : '<span class="hint">Aucun shift.</span> <button type="button" data-action="shifts" class="primary">Créer un shift</button>')
    : ui.mode === 'edit'
      ? `<span class="hint">${ui.sel.size} jour(s)</span>
         <button type="button" data-action="copy" ${ui.sel.size ? '' : 'disabled'}>Copier</button>
         <button type="button" data-action="paste" ${ui.clip && ui.sel.size === 1 ? '' : 'disabled'} title="Sélectionnez le jour de départ">Coller</button>
         <button type="button" data-action="repeat" ${ui.sel.size ? '' : 'disabled'}>Répéter</button>
         <button type="button" data-action="clear" class="danger" ${ui.sel.size ? '' : 'disabled'}>Effacer</button>
         <button type="button" data-action="unselect" ${ui.sel.size ? '' : 'disabled'}>Désélectionner</button>`
      : '<span class="hint">Touchez un jour pour le détail. Glissez pour changer de mois.</span>';

  const cells = monthGrid(ui.y, ui.m).map((date) => {
    const d = getDay(date);
    const cls = ['cell', date.slice(5, 7) - 1 !== ui.m && 'out', date === today && 'today', ui.sel.has(date) && 'sel'].filter(Boolean).join(' ');
    const label = `${+date.slice(8)} ${MONTHS[+date.slice(5, 7) - 1]}${d && d.shifts.length ? ', ' + d.shifts.map((id) => typesById()[id]?.name).join(' et ') : ''}`;
    return `<button type="button" class="${cls}" data-date="${date}" aria-label="${esc(label)}">
      <span class="n">${+date.slice(8)}${d && d.note ? '<span class="dot" title="Note"></span>' : ''}</span>${chips(d)}</button>`;
  }).join('');

  app.innerHTML = `
    <header class="top" data-title="${esc(cal().name)} – ${esc(title)}">
      <label class="sr" for="calsel">Calendrier</label>
      <select id="calsel">${data.calendars.map((c) => `<option value="${c.id}" ${c.id === data.activeCalendarId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <nav class="menu" aria-label="Menu">
        <button type="button" data-action="shifts">Shifts</button>
        <button type="button" data-action="stats">Stats</button>
        <button type="button" data-action="year">Année</button>
        <button type="button" data-action="theme" aria-label="${isDark() ? 'Passer en thème clair' : 'Passer en thème sombre'}">${isDark() ? '☀︎' : '☾'}</button>
        <button type="button" data-action="settings" aria-label="Réglages et sauvegarde">⚙︎</button>
      </nav>
    </header>
    <div class="month">
      <button type="button" data-action="prev" aria-label="Mois précédent">‹</button>
      <h1>${title}</h1>
      <button type="button" data-action="next" aria-label="Mois suivant">›</button>
    </div>
    <div class="modes" role="group" aria-label="Mode">
      ${[['view', 'Voir'], ['paint', 'Peindre'], ['edit', 'Éditer']].map(([m, l]) => `<button type="button" data-mode="${m}" aria-pressed="${ui.mode === m}">${l}</button>`).join('')}
    </div>
    <div class="bar">${bar}</div>
    <div class="grid" id="grid">${DOW.map((d) => `<div class="dow" aria-hidden="true">${d}</div>`).join('')}${cells}</div>
    <div class="totals"><span>Total du mois · ${tot.days} jour(s)</span><strong>${fmtDuration(tot.minutes)}</strong></div>`;
  document.title = `Planning Shifts – ${title}`;
}

// --- interactions sur la page ---

app.addEventListener('change', (e) => {
  if (e.target.id === 'calsel') {
    data.activeCalendarId = e.target.value;
    ui.sel.clear();
    commit();
  }
});

app.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.date) return onDay(b.dataset.date);
  if (b.dataset.mode) { ui.mode = b.dataset.mode; ui.sel.clear(); return render(); }
  if (b.dataset.brush) { ui.brush = b.dataset.brush; return render(); }
  const a = b.dataset.action;
  if (a === 'prev' || a === 'next') return shiftMonth(a === 'prev' ? -1 : 1);
  actions[a]?.();
});

function shiftMonth(n) {
  const d = new Date(ui.y, ui.m + n, 1);
  ui.y = d.getFullYear();
  ui.m = d.getMonth();
  render();
}

let touch = null;
app.addEventListener('touchstart', (e) => { if (e.target.closest('#grid')) touch = e.touches[0]; }, { passive: true });
app.addEventListener('touchend', (e) => {
  if (!touch) return;
  const t = e.changedTouches[0], dx = t.clientX - touch.clientX, dy = t.clientY - touch.clientY;
  touch = null;
  if (Math.abs(dx) > 60 && Math.abs(dy) < 40) shiftMonth(dx < 0 ? 1 : -1);
});

function onDay(date) {
  if (ui.mode === 'view') return dayDialog(date);
  if (ui.mode === 'edit') {
    ui.sel.has(date) ? ui.sel.delete(date) : ui.sel.add(date);
    return render();
  }
  if (!ui.brush) return toast('Choisissez d’abord un shift dans la barre.');
  snapshot();
  const day = { ...blankDay(), ...getDay(date) };
  const slots = slotsOf(day);
  if (ui.brush === 'erase') setSlots(day, []);
  else if (day.shifts.includes(ui.brush)) setSlots(day, slots.filter(([id]) => id !== ui.brush));
  else setSlots(day, slots.length < 2 ? [...slots, [ui.brush, null]] : [[ui.brush, null]]);
  setDay(date, day);
  commit();
}

const sortedSel = () => [...ui.sel].sort();

const THEME = 'planning-shifts:theme';
const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
};
const applyThemeColor = () => document.querySelector('meta[name=theme-color]').setAttribute('content', isDark() ? '#0b0d12' : '#d32f2f');
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { applyThemeColor(); render(); });

const actions = {
  shifts: shiftsDialog,
  stats: statsDialog,
  year: yearDialog,
  settings: settingsDialog,
  unselect() { ui.sel.clear(); render(); },
  theme() {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME, next); } catch { /* le choix ne sera pas retenu */ }
    applyThemeColor();
    render();
  },
  copy() {
    const sel = sortedSel(), start = sel[0];
    ui.clip = sel.map((date) => ({ offset: daysBetween(start, date), day: structuredClone(getDay(date) || blankDay()) }));
    toast(`${sel.length} jour(s) copiés. Sélectionnez le jour de départ puis Coller.`);
    ui.sel.clear();
    render();
  },
  paste() {
    const start = sortedSel()[0];
    snapshot();
    for (const { offset, day } of ui.clip) setDay(addDays(start, offset), structuredClone(day));
    ui.sel.clear();
    commit(`${ui.clip.length} jour(s) collés`);
  },
  clear() {
    snapshot();
    for (const date of ui.sel) delete data.days[key(date)];
    const n = ui.sel.size;
    ui.sel.clear();
    commit(`${n} jour(s) effacés`);
  },
  repeat: repeatDialog,
};

// --- dialogues ---

function openDialog(html, onSubmit) {
  dlg.innerHTML = `<form method="dialog" class="form">${html}</form>`;
  const form = dlg.querySelector('form');
  form.addEventListener('submit', (e) => {
    const btn = e.submitter;
    if (btn && btn.value === 'cancel') return;
    if (onSubmit) {
      e.preventDefault();
      if (onSubmit(new FormData(form), btn && btn.value) !== false) dlg.close();
    }
  });
  dlg.showModal();
  return form;
}

const closeBtn = (label = 'Fermer') => `<button value="cancel" formnovalidate>${label}</button>`;
const minField = (name, label, v) => `<label>${label}<input name="${name}" type="number" min="0" step="5" inputmode="numeric" value="${v || 0}"></label>`;
const shortDate = (date) => new Date(date + 'T12:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });

function dayDialog(date) {
  const d = { ...blankDay(), ...getDay(date) };
  const byId = typesById();
  const opts = (sel) => `<option value="">—</option>` + types().map((t) => `<option value="${t.id}" ${t.id === sel ? 'selected' : ''}>${esc(t.name)} (${t.start}–${t.end})</option>`).join('');
  const label = new Date(date + 'T12:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const slot = (i) => `
    <div class="row">
      <label>Shift ${i + 1}<select name="s${i}">${opts(d.shifts[i])}</select></label>
      <label>Durée ce jour<input name="d${i}" inputmode="decimal" value="${fmtHm(d.minutes ? d.minutes[i] : null)}"></label>
    </div>`;
  const form = openDialog(`
    <h2 style="text-transform:capitalize">${label}</h2>
    ${slot(0)}${slot(1)}
    <p class="hint">Durée ce jour : laisser vide pour garder la durée du shift. Ex. 7:30 ou 7,5.</p>
    <div class="row">${minField('ot', 'Heures sup (min)', d.overtimeMinutes)}${minField('ee', 'Départ anticipé (min)', d.earlyExitMinutes)}</div>
    <label>Note<textarea name="note" rows="3" maxlength="2000">${esc(d.note)}</textarea></label>
    <p>Ce jour : <strong id="daytot"></strong></p>
    <div class="actions">${closeBtn('Annuler')}<button class="primary" value="save">Enregistrer</button></div>`,
  () => {
    let next;
    try { next = read(); } catch (err) { toast(err.message); return false; }
    snapshot();
    setDay(date, next);
    commit('Jour enregistré');
  });
  function read() {
    const day = {
      overtimeMinutes: Math.max(0, +form.ot.value || 0), earlyExitMinutes: Math.max(0, +form.ee.value || 0),
      extraCents: d.extraCents, note: form.note.value.trim(),
    };
    setSlots(day, [0, 1].map((i) => [form[`s${i}`].value, parseDuration(form[`d${i}`].value)]).filter(([id]) => id));
    return day;
  }
  // Rappel de la durée par défaut du shift choisi, et total du jour en direct.
  const upd = () => {
    for (const i of [0, 1]) {
      const t = byId[form[`s${i}`].value];
      form[`d${i}`].placeholder = t ? fmtHm(shiftMinutes(t)) : '';
      form[`d${i}`].disabled = !t;
    }
    try {
      const r = dayTotals(read(), byId);
      form.querySelector('#daytot').textContent = fmtDuration(r.minutes);
    } catch { form.querySelector('#daytot').textContent = 'durée invalide'; }
  };
  form.addEventListener('input', upd);
  upd();
}

function shiftsDialog() {
  const ts = types();
  const list = ts.length
    ? `<ul class="list">${ts.map((t, i) => `
        <li><span class="swatch" style="background:${t.color}"></span>
          <span class="grow">${esc(t.name)} <small>${t.start}–${t.end} · ${fmtDuration(shiftMinutes(t))}</small></span>
          <button value="up:${t.id}" aria-label="Monter ${esc(t.name)}" ${i ? '' : 'disabled'}>↑</button>
          <button value="edit:${t.id}">Modifier</button></li>`).join('')}</ul>`
    : '<p class="empty">Aucun shift. Créez vos types de shifts (matin, après-midi, nuit…), puis peignez-les sur le calendrier.</p>';
  openDialog(`<h2>Shifts de « ${esc(cal().name)} »</h2>${list}
    <div class="actions">${closeBtn()}<button class="primary" value="new">Nouveau shift</button></div>`,
  (f, v) => {
    const [cmd, id] = v.split(':');
    if (cmd === 'new') { setTimeout(() => shiftEditor(null)); return; }
    if (cmd === 'edit') { setTimeout(() => shiftEditor(data.shiftTypes.find((t) => t.id === id))); return; }
    if (cmd === 'up') {
      snapshot();
      const all = data.shiftTypes, i = all.findIndex((t) => t.id === id);
      let j = i - 1;
      while (j >= 0 && all[j].calendarId !== data.activeCalendarId) j--;
      if (j >= 0) [all[i], all[j]] = [all[j], all[i]];
      commit();
      setTimeout(shiftsDialog);
    }
  });
}

function shiftEditor(t) {
  const isNew = !t;
  t ||= { name: '', abbr: '', color: PALETTE[types().length % PALETTE.length], start: '06:00', end: '14:00', breakMinutes: 0, pay: { mode: 'hourly', cents: 0 } };
  const form = openDialog(`
    <h2>${isNew ? 'Nouveau shift' : 'Modifier le shift'}</h2>
    <div class="row">
      <label>Nom<input name="name" required maxlength="40" value="${esc(t.name)}" placeholder="Matin"></label>
      <label>Abréviation<input name="abbr" maxlength="4" value="${esc(t.abbr)}" placeholder="M"></label>
    </div>
    <div class="row">
      <label>Début<input name="start" type="time" required value="${t.start}"></label>
      <label>Fin<input name="end" type="time" required value="${t.end}"></label>
    </div>
    ${minField('brk', 'Pause non payée (min) — pour un shift coupé', t.breakMinutes)}
    <label>Durée saisie à la main (vide = calculée avec les horaires et la pause)<input name="dur" inputmode="decimal" value="${fmtHm(t.durationMinutes)}"></label>
    <p class="hint" id="dur"></p>
    <label>Couleur<input name="color" type="color" value="${t.color}"></label>
    <div class="actions">
      ${isNew ? '' : '<button value="delete" class="danger" formnovalidate>Supprimer</button>'}
      ${closeBtn('Annuler')}<button class="primary" value="save">Enregistrer</button>
    </div>`,
  (f, v) => {
    if (v === 'delete') {
      if (!confirm(`Supprimer « ${t.name} » ? Il sera retiré de tous les jours du calendrier.`)) return false;
      snapshot();
      data.shiftTypes = data.shiftTypes.filter((x) => x.id !== t.id);
      for (const [k, day] of Object.entries(data.days)) {
        setSlots(day, slotsOf(day).filter(([id]) => id !== t.id));
        if (isEmptyDay(day)) delete data.days[k];
      }
      commit('Shift supprimé');
      setTimeout(shiftsDialog);
      return;
    }
    let manual;
    try { manual = parseDuration(f.get('dur')); } catch (err) { toast(err.message); return false; }
    snapshot();
    const next = {
      ...(manual != null && { durationMinutes: manual }),
      id: t.id || newId(), calendarId: t.calendarId || data.activeCalendarId,
      name: f.get('name').trim(), abbr: f.get('abbr').trim() || f.get('name').trim().slice(0, 2),
      color: f.get('color'), start: f.get('start'), end: f.get('end'),
      breakMinutes: Math.max(0, +f.get('brk') || 0),
      pay: t.pay, // plus affichée ni modifiable ; conservée pour les anciennes sauvegardes
    };
    if (isNew) data.shiftTypes.push(next);
    else data.shiftTypes[data.shiftTypes.findIndex((x) => x.id === t.id)] = next;
    if (isNew && ui.mode === 'paint') ui.brush = next.id;
    commit(isNew ? 'Shift créé' : 'Shift modifié');
    setTimeout(shiftsDialog);
  });
  const dur = form.querySelector('#dur');
  const upd = () => {
    try {
      const s = form.start.value, e = form.end.value;
      const manual = parseDuration(form.dur.value);
      const m = shiftMinutes({ start: s, end: e, breakMinutes: +form.brk.value || 0, durationMinutes: manual });
      dur.textContent = `Durée comptée : ${fmtDuration(m)}${manual != null ? ' (saisie)' : toMin(e) <= toMin(s) ? ' (passe minuit, compté le jour du début)' : ''}`;
    } catch (err) { dur.textContent = err.message.startsWith('durée') ? err.message : ''; }
  };
  form.addEventListener('input', upd);
  upd();
}

function repeatDialog() {
  const sel = sortedSel();
  const len = daysBetween(sel[0], sel[sel.length - 1]) + 1;
  openDialog(`
    <h2>Répéter un cycle</h2>
    <p>Le cycle va du ${shortDate(sel[0])} au ${shortDate(sel[sel.length - 1])} (${len} jours). Il sera recopié à la suite, en remplaçant les jours existants.</p>
    <label>Nombre de répétitions<input name="n" type="number" min="1" max="60" value="4" required></label>
    <div class="actions">${closeBtn('Annuler')}<button class="primary" value="ok">Répéter</button></div>`,
  (f) => {
    const n = Math.min(60, Math.max(1, +f.get('n') || 1));
    const block = Array.from({ length: len }, (_, i) => structuredClone(getDay(addDays(sel[0], i)) || blankDay()));
    snapshot();
    for (let r = 1; r <= n; r++) block.forEach((day, i) => setDay(addDays(sel[0], r * len + i), structuredClone(day)));
    ui.sel.clear();
    commit(`Cycle répété ${n} fois`);
  });
}

function totalsTable(t) {
  const byId = typesById();
  const rows = Object.entries(t.perType).map(([id, p]) => `<tr><td>${esc(byId[id]?.name || '?')}</td><td class="r">${p.count}</td><td class="r">${fmtDuration(p.minutes)}</td></tr>`).join('');
  return `<table><thead><tr><th>Shift</th><th class="r">Nb</th><th class="r">Heures</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="3" class="empty">Aucun shift sur la période.</td></tr>'}</tbody>
    <tfoot><tr><th>Total (avec heures sup)</th><th class="r">${t.days} j</th><th class="r">${fmtDuration(t.minutes)}</th></tr></tfoot></table>`;
}

function statsDialog() {
  const [from, to] = monthBounds(ui.y, ui.m);
  const form = openDialog(`
    <h2>Statistiques</h2>
    <div class="row">
      <label>Du<input name="from" type="date" value="${from}"></label>
      <label>Au<input name="to" type="date" value="${to}"></label>
    </div>
    <div id="st"></div>
    <div class="actions">${closeBtn()}</div>`);
  const upd = () => {
    const f = form.from.value, t = form.to.value;
    form.querySelector('#st').innerHTML = f && t && f <= t ? totalsTable(rangeTotals(data, data.activeCalendarId, f, t)) : '<p class="empty">Période invalide.</p>';
  };
  form.addEventListener('input', upd);
  upd();
}

function yearDialog() {
  const byId = typesById();
  const months = MONTHS.map((name, m) => {
    const cells = monthGrid(ui.y, m).map((date) => {
      if (+date.slice(5, 7) - 1 !== m) return '<span></span>';
      const t = byId[getDay(date)?.shifts[0]];
      return `<span style="${t ? `background:${t.color};color:${ink(t.color)}` : ''}">${+date.slice(8)}</span>`;
    }).join('');
    return `<div class="mini"><h3>${name}</h3><div class="g">${cells}</div></div>`;
  }).join('');
  openDialog(`<h2>Année ${ui.y}</h2><div class="year">${months}</div><h3>Total de l'année</h3>
    ${totalsTable(rangeTotals(data, data.activeCalendarId, `${ui.y}-01-01`, `${ui.y}-12-31`))}
    <div class="actions"><button value="prev">‹ ${ui.y - 1}</button><button value="next">${ui.y + 1} ›</button>${closeBtn()}</div>`,
  (f, v) => { ui.y += v === 'prev' ? -1 : 1; render(); setTimeout(yearDialog); });
}

function calendarsDialog() {
  openDialog(`<h2>Calendriers</h2>
    <ul class="list">${data.calendars.map((c) => `<li><span class="swatch" style="background:${c.color}"></span>
      <span class="grow">${esc(c.name)}${c.id === data.activeCalendarId ? ' <small>affiché</small>' : ''}</span>
      <button value="rename:${c.id}">Renommer</button>
      <button value="delete:${c.id}" class="danger" ${data.calendars.length > 1 ? '' : 'disabled'}>Supprimer</button></li>`).join('')}</ul>
    <div class="actions">${closeBtn()}<button class="primary" value="new" ${data.calendars.length < MAX_CALENDARS ? '' : 'disabled'}>Nouveau calendrier</button></div>`,
  (f, v) => {
    const [cmd, id] = v.split(':');
    const c = data.calendars.find((x) => x.id === id);
    if (cmd === 'new' || cmd === 'rename') {
      const name = prompt('Nom du calendrier', c ? c.name : '')?.trim().slice(0, 80);
      if (!name) return false;
      snapshot();
      if (c) c.name = name;
      else {
        const nc = { id: newId(), name, color: PALETTE[data.calendars.length % PALETTE.length] };
        data.calendars.push(nc);
        data.activeCalendarId = nc.id;
      }
    } else if (cmd === 'delete') {
      if (!confirm(`Supprimer le calendrier « ${c.name} » et tous ses shifts et jours ?`)) return false;
      snapshot();
      data.calendars = data.calendars.filter((x) => x.id !== id);
      data.shiftTypes = data.shiftTypes.filter((t) => t.calendarId !== id);
      for (const k of Object.keys(data.days)) if (k.startsWith(id + '|')) delete data.days[k];
      if (data.activeCalendarId === id) data.activeCalendarId = data.calendars[0].id;
    }
    commit();
    setTimeout(calendarsDialog);
  });
}

const LAST_EXPORT = 'planning-shifts:lastExport';
const lastExport = () => { try { return localStorage.getItem(LAST_EXPORT); } catch { return null; } };
const markExport = () => { try { localStorage.setItem(LAST_EXPORT, new Date().toLocaleDateString('fr-FR')); } catch { /* sans gravité */ } };
const slug = () => cal().name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'planning';

function pickFile(accept, onText) {
  fileInput.accept = accept;
  fileInput.value = '';
  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast('Fichier trop gros (5 Mo maximum).');
    try { onText(await file.text()); } catch (err) { toast(err.message || 'Fichier illisible.'); }
  };
  fileInput.click();
}

function settingsDialog() {
  const last = lastExport();
  openDialog(`<h2>Réglages et sauvegarde</h2>
    <button value="calendars">Calendriers (${data.calendars.length}/${MAX_CALENDARS})</button>
    <h3>Sauvegarde complète</h3>
    <p class="hint">Les données restent sur cet appareil. ${last ? `Dernier export : ${last}.` : 'Aucun export pour l’instant : pensez à sauvegarder.'}</p>
    <div class="row"><button value="export-json" class="primary">Exporter (.json)</button><button value="import-json">Importer (.json)</button></div>
    <h3>Calendrier affiché : « ${esc(cal().name)} »</h3>
    <div class="row"><button value="export-csv">Tableur (.csv)</button><button value="export-ics">Agenda (.ics)</button></div>
    <div class="row"><button value="import-ics">Importer un agenda (.ics) en notes</button><button value="print">Imprimer / PDF du mois</button></div>
    <p class="hint">Le fichier .ics s’importe dans Google Agenda, Outlook ou Apple Calendrier. L’import .ics ajoute les événements (jours fériés, congés…) en notes.</p>
    <div class="actions"><button value="wipe" class="danger">Tout effacer</button>${closeBtn()}</div>`,
  (f, v) => {
    const stamp = iso(new Date());
    if (v === 'calendars') { setTimeout(calendarsDialog); return; }
    if (v === 'export-json') { download(`planning-shifts-${stamp}.json`, exportJson(data), 'application/json'); markExport(); toast('Sauvegarde exportée'); return; }
    if (v === 'export-csv') { download(`${slug()}-${stamp}.csv`, exportCsv(data, data.activeCalendarId), 'text/csv;charset=utf-8'); return; }
    if (v === 'export-ics') { download(`${slug()}.ics`, exportIcs(data, data.activeCalendarId), 'text/calendar;charset=utf-8'); return; }
    if (v === 'print') { setTimeout(() => window.print(), 100); return; }
    if (v === 'import-json') {
      pickFile('.json,application/json', (text) => {
        const next = importJson(text);
        const nDays = Object.keys(next.days).length;
        if (!confirm(`Remplacer toutes les données de cet appareil par la sauvegarde (${next.calendars.length} calendrier(s), ${next.shiftTypes.length} shift(s), ${nDays} jour(s)) ?`)) return;
        snapshot();
        data = next;
        commit('Sauvegarde importée');
      });
      return;
    }
    if (v === 'import-ics') {
      pickFile('.ics,text/calendar', (text) => {
        const events = parseIcs(text);
        if (!events.length) return toast('Aucun événement trouvé dans ce fichier.');
        snapshot();
        const n = mergeIcsNotes(data, data.activeCalendarId, events);
        commit(`${n} note(s) ajoutée(s) depuis l’agenda`);
      });
      return;
    }
    if (v === 'wipe') {
      if (!confirm('Effacer tous les calendriers, shifts et jours de cet appareil ? Exportez une sauvegarde avant si besoin.')) return false;
      snapshot();
      const id = newId();
      data = { version: 1, activeCalendarId: id, calendars: [{ id, name: 'Mon planning', color: PALETTE[0] }], shiftTypes: [], days: {} };
      commit('Données effacées');
    }
  });
}

applyThemeColor();
render();
if (!types().length && !Object.keys(data.days).length) toast('Bienvenue ! Commencez par créer vos shifts.');
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
