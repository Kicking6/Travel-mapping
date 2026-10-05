// The route edit drawer — one route or many. Used by the Map and Review pages.
import { store, api, legFor, esc, $, toast, confirm, fmtDate, fmtKm } from '../app.js';
import { TYPES, typeById } from '../lib/types.js';

const SOURCE_LABEL = {
  'gps-time': 'from the GPS recording', filename: 'from the file name', 'trip-day': 'from “day N” in the file name',
  manual: 'set by hand', suggested: 'a guess — please check',
};

export function routeEditor(host, routes, { onClose, onSaved, onDeleted, onLineSaved }) {
  const one = routes.length === 1 ? routes[0] : null;
  const same = (k) => (routes.every((r) => (r[k] ?? null) === (routes[0][k] ?? null)) ? routes[0][k] ?? '' : null);
  const val = (k) => { const v = same(k); return v == null ? '' : v; };
  const mixed = (k) => (same(k) === null ? 'placeholder="(mixed)"' : '');
  const types = TYPES.map((t) => `<option value="${t.id}" ${same('type') === t.id ? 'selected' : ''}>${esc(t.label)}</option>`).join('');
  const legOpts = `<option value="">${one ? `By date${legFor(one) ? ` (${esc(legFor(one).name)})` : ''}` : '—'}</option>` +
    store.legs.map((l) => `<option value="${l.id}" ${same('leg_id') === l.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
  const color = same('color');
  const dup = one && one.review && one.review.possibleDuplicateName;
  const kmTotal = routes.reduce((a, r) => a + (r.distance_km || 0), 0);

  host.innerHTML = `
    <div class="card-head"><h3>${one ? 'Route' : `${routes.length} routes`}</h3><button class="btn ghost sm" data-close aria-label="Close">✕</button></div>
    <form class="ws-drawer-body" autocomplete="off">
      ${dup ? `<div class="notice warn">Looks like a duplicate of <strong>${esc(one.review.possibleDuplicateName)}</strong> — same start, end and length. Hide or delete one, or <button type="button" class="btn sm" data-notdup>keep both</button>.</div>` : ''}
      ${one && one.date_source === 'suggested' ? `<div class="notice warn">The date's year was guessed from a name with no year. Check it and save.</div>` : ''}
      ${one ? `<div class="field"><label for="f-name">Name</label><input class="input" id="f-name" name="name" value="${esc(one.name)}" required></div>` : `<div class="kpi"><div><b>${routes.length}</b><span>routes</span></div><div><b>${fmtKm(kmTotal)}</b><span>km</span></div></div><p class="help">Change a field to set it on all of them. Untouched fields stay as they are.</p>`}
      <div class="field-row">
        ${one ? `<div class="field"><label for="f-date">Date</label><input class="input" type="date" id="f-date" name="date" value="${esc(one.date || '')}">${one.date_source ? `<span class="hint">${esc(SOURCE_LABEL[one.date_source] || one.date_source)}</span>` : ''}</div>` : ''}
        <div class="field"><label for="f-type">Type</label><select class="select" id="f-type" name="type">${same('type') === null ? '<option value="" selected>(mixed)</option>' : ''}${types}</select></div>
      </div>
      <div class="field"><label for="f-leg">Leg</label><select class="select" id="f-leg" name="leg_id">${same('leg_id') === null && !one ? '<option value="__keep" selected>(mixed)</option>' : ''}${legOpts}</select></div>
      <div class="field-row">
        <div class="field"><label for="f-country">Country</label><input class="input" id="f-country" name="country" value="${esc(val('country'))}" ${mixed('country')} list="countryList"></div>
        <div class="field"><label for="f-region">Region</label><input class="input" id="f-region" name="region" value="${esc(val('region'))}" ${mixed('region')}></div>
      </div>
      <datalist id="countryList">${[...new Set(store.routes.flatMap((r) => (r.country || '').split(',').map((c) => c.trim())).filter(Boolean))].sort().map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
      ${one ? `<div class="field"><label for="f-notes">Notes</label><textarea class="input" id="f-notes" name="notes" rows="3">${esc(one.notes || '')}</textarea></div>` : ''}
      <div class="field"><label>Line</label>
        <div class="color-field">
          <label class="switch" title="Use a custom colour for ${one ? 'this route' : 'these routes'}"><input type="checkbox" name="customColor" ${color ? 'checked' : ''}><span class="track"></span></label>
          <input type="color" name="color" value="${esc(color || typeById(routes[0].type).color)}" ${color ? '' : 'disabled'}>
          <input class="input sm" type="number" name="width" min="0.25" max="20" step="0.25" placeholder="width" value="${esc(val('width'))}" title="Line width (blank = the style's width for this type)" style="width:84px">
        </div>
        <span class="hint">Off = the preset's colour for this transport type. Saves as you change it. <span data-linesaved></span></span>
      </div>
      <label class="switch"><input type="checkbox" name="hidden" ${same('hidden') ? 'checked' : ''}><span class="track"></span>Hidden — keep it, but leave it off every map</label>
      ${one ? `<div class="kv-list help">
        ${fmtKm(one.distance_km)} km · ${one.point_count?.toLocaleString() || '?'} GPS points${one.started_at ? ` · recorded ${esc(fmtDate(one.date))}` : ''}<br>
        ${one.trip_day ? `Trip day ${one.trip_day} · ` : ''}${one.source_name ? `From <span class="mono">${esc(one.source_name)}</span>` : ''}${one.source_folder ? ` in ${esc(one.source_folder.split('/').slice(0, -1).join('/') || '')}` : ''}
        ${one.updated_by ? `<br>Last edited by ${esc(one.updated_by.split('@')[0])}` : ''}
        ${one.source_hash ? `<br><a href="/api/raw/${one.source_hash}" download>Download original file</a>` : ''}
      </div>` : ''}
      <div class="row-between" style="margin-top:4px">
        <button type="button" class="btn danger sm" data-delete>Delete${one ? '' : ` ${routes.length}`}</button>
        <button type="submit" class="btn primary">Save</button>
      </div>
    </form>`;

  const form = $('form', host);
  const colorInput = form.elements.color;
  // The line's colour and width save straight away, like the style editor — no Save press.
  let lineSaved = { color: color || null, width: val('width') === '' ? null : +val('width') };
  let lineTimer = null;
  const saveLine = () => {
    clearTimeout(lineTimer);
    lineTimer = setTimeout(async () => {
      const f = form.elements, fields = {};
      const wantColor = f.customColor.checked ? f.color.value.toLowerCase() : null;
      const wantWidth = f.width.value === '' ? null : +f.width.value;
      if (wantColor !== lineSaved.color) fields.color = wantColor;
      if (wantWidth !== lineSaved.width && !(wantWidth !== null && !(wantWidth >= 0.25 && wantWidth <= 20))) fields.width = wantWidth;
      if (!Object.keys(fields).length) return;
      const note = $('[data-linesaved]', host);
      note.textContent = 'Saving…';
      try {
        await api('PATCH', '/api/routes', { ids: routes.map((r) => r.id), fields });
        lineSaved = { ...lineSaved, ...fields };
        for (const r of routes) Object.assign(r, fields);
        note.textContent = 'Saved';
        onLineSaved && onLineSaved(fields);
      } catch (err) { note.textContent = ''; toast(err.message, 'err'); }
    }, 350);
  };
  form.elements.customColor.onchange = (e) => { colorInput.disabled = !e.target.checked; saveLine(); };
  colorInput.addEventListener('input', saveLine);
  form.elements.width.addEventListener('input', saveLine);
  $('[data-close]', host).onclick = onClose;

  const notDup = $('[data-notdup]', host);
  if (notDup) notDup.onclick = async () => {
    await api('PATCH', '/api/routes', { ids: [one.id], fields: { review: null } });
    toast('Marked as not a duplicate');
    onSaved();
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = form.elements, fields = {};
    const changed = (name, current) => f[name] && f[name].value !== String(current ?? '');
    if (one) {
      if (changed('name', one.name)) fields.name = f.name.value;
      if (changed('date', one.date) || one.date_source === 'suggested') fields.date = f.date.value || null;
      if (changed('notes', one.notes)) fields.notes = f.notes.value;
    }
    if (f.type.value && f.type.value !== same('type')) fields.type = f.type.value;
    if (f.leg_id.value !== '__keep' && f.leg_id.value !== String(same('leg_id') ?? '')) fields.leg_id = f.leg_id.value ? +f.leg_id.value : null;
    for (const k of ['country', 'region']) if (f[k].value !== String(val(k)) || (same(k) === null && f[k].value)) fields[k] = f[k].value || null;
    const wantColor = f.customColor.checked ? f.color.value.toLowerCase() : null;
    if (wantColor !== lineSaved.color) fields.color = wantColor;
    const wantWidth = f.width.value === '' ? null : +f.width.value;
    if (wantWidth !== lineSaved.width) fields.width = wantWidth;
    const hid = f.hidden.checked ? 1 : 0;
    if (same('hidden') === null ? f.hidden.checked : hid !== (same('hidden') ? 1 : 0)) fields.hidden = hid;
    if (!Object.keys(fields).length) { toast('Nothing changed'); return; }
    try {
      await api('PATCH', '/api/routes', { ids: routes.map((r) => r.id), fields });
      toast(one ? 'Saved' : `Saved ${routes.length} routes`);
      onSaved();
    } catch (err) { toast(err.message, 'err'); }
  };

  $('[data-delete]', host).onclick = async () => {
    const ok = await confirm(one ? 'Delete route' : `Delete ${routes.length} routes`,
      `This removes ${one ? `“${one.name}”` : 'them'} from the trip for both of you. To keep ${one ? 'it' : 'them'} but off the maps, use Hidden instead.`, 'Delete', true);
    if (!ok) return;
    try {
      await api('DELETE', '/api/routes', { ids: routes.map((r) => r.id) });
      toast('Deleted');
      onDeleted();
    } catch (err) { toast(err.message, 'err'); }
  };
}
