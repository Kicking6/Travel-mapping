// #/settings — the trip (name, day 1), legs, people.
import { store, api, loadBootstrap, loadRoutes, esc, $, toast, confirm, fmtDate } from '../app.js';
import { addDays } from '../lib/names.js';

export async function render(el) {
  const people = store.me.isAdmin ? (await api('GET', '/api/people')).data.people : [];
  const dayRoutes = store.routes.filter((r) => r.date_source === 'trip-day').length;
  const legColor = (l) => l.color || '#1c5d8c';

  el.innerHTML = `<div class="page page-narrow stack" style="gap:18px">
    <div class="page-head"><div><h1>Trip &amp; people</h1><p>Shared by everyone who signs in.</p></div></div>

    <div class="card"><div class="card-head"><h3>The trip</h3></div><form class="card-body stack" id="trip">
      <div class="field-row"><div class="field"><label>Name</label><input class="input" name="trip_name" value="${esc(store.trip.trip_name || '')}"></div>
      <div class="field"><label>Day 1 of the trip</label><input class="input" type="date" name="trip_start" value="${esc(store.trip.trip_start || '')}" required>
        <span class="hint">Files named “day 103 busing” are dated from this. ${dayRoutes} route${dayRoutes === 1 ? '' : 's'} use it — day 103 is currently ${esc(fmtDate(addDays(store.trip.trip_start, 102)))}.</span></div></div>
      <div><button class="btn primary" type="submit">Save</button></div></form></div>

    <div class="card"><div class="card-head"><h3>Legs</h3><button class="btn sm" id="addLeg">Add a leg</button></div><div class="card-body stack">
      <p class="help">Named stretches of the trip — “USA road trip”, “Peru”, “Norway”. Routes belong to a leg by date (or pin one in the route editor). Legs drive filters and “One map per leg” in the Album.</p>
      <table class="rt"><colgroup><col style="width:36px"><col><col style="width:140px"><col style="width:140px"><col style="width:80px"><col style="width:90px"></colgroup>
      <thead><tr><th></th><th>Name</th><th>From</th><th>To</th><th class="num">Routes</th><th></th></tr></thead><tbody id="legs">
      ${store.legs.map((l) => {
        const n = store.routes.filter((r) => r.leg_id === l.id || (!r.leg_id && r.date && l.start_date && l.end_date && r.date >= l.start_date && r.date <= l.end_date)).length;
        return `<tr data-id="${l.id}"><td><input type="color" name="color" value="${esc(legColor(l))}" style="width:26px;height:24px;padding:0;border:0;background:none"></td>
          <td><input class="input sm" name="name" value="${esc(l.name)}"></td><td><input class="input sm" type="date" name="start_date" value="${esc(l.start_date || '')}"></td>
          <td><input class="input sm" type="date" name="end_date" value="${esc(l.end_date || '')}"></td><td class="num">${n}</td><td><button class="btn ghost sm danger" data-del>Remove</button></td></tr>`;
      }).join('') || '<tr><td colspan="6" class="muted">No legs yet.</td></tr>'}
      </tbody></table></div></div>

    ${store.me.isAdmin ? `<div class="card"><div class="card-head"><h3>People</h3></div><div class="card-body stack">
      <p class="help">Who can sign in. They get a 6-digit code by email — no passwords.</p>
      <table class="rt"><colgroup><col><col style="width:160px"><col style="width:90px"></colgroup><tbody>
      ${people.map((p) => `<tr><td>${esc(p.name || '')} <span class="muted">${esc(p.email)}</span>${p.is_admin ? ' <span class="chip accent">admin</span>' : ''}${p.status !== 'active' ? ' <span class="chip">removed</span>' : ''}</td>
        <td class="help">${p.last_seen_at ? 'Last in ' + esc(fmtDate(p.last_seen_at.slice(0, 10))) : 'Not signed in yet'}</td>
        <td>${p.email !== store.me.email && p.status === 'active' ? `<button class="btn ghost sm danger" data-remove="${esc(p.email)}">Remove</button>` : ''}</td></tr>`).join('')}
      </tbody></table>
      <form class="filter-row" id="addPerson"><input class="input sm" name="name" placeholder="Name" style="max-width:140px"><input class="input sm" name="email" type="email" placeholder="email@example.com" required><button class="btn sm primary">Add</button></form>
    </div></div>` : ''}
  </div>`;

  $('#trip', el).onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const body = { trip_name: f.trip_name.value, trip_start: f.trip_start.value };
    if (body.trip_start !== store.trip.trip_start && dayRoutes &&
      !(await confirm('Move day 1', `This re-dates the ${dayRoutes} routes named “day N”. Routes dated from GPS or a real date in the file name don't move.`, 'Re-date them'))) return;
    try {
      const { data } = await api('PATCH', '/api/trip', body);
      await loadBootstrap(); await loadRoutes(true);
      document.getElementById('tripName').textContent = store.trip.trip_name || 'Trip Atlas';
      toast(data.redated ? `Saved — ${data.redated} routes re-dated` : 'Saved');
      render(el);
    } catch (err) { toast(err.message, 'err'); }
  };

  $('#addLeg', el).onclick = async () => {
    await api('POST', '/api/legs', { name: 'New leg', color: '#1c5d8c' });
    await loadBootstrap(); render(el);
  };
  const legs = $('#legs', el);
  legs.addEventListener('change', async (e) => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    const name = e.target.name;
    try {
      await api('PUT', `/api/legs/${tr.dataset.id}`, { [name]: e.target.value || null });
      await loadBootstrap();
      toast('Saved');
    } catch (err) { toast(err.message, 'err'); }
  });
  legs.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-del]')) return;
    const tr = e.target.closest('tr[data-id]');
    if (!(await confirm('Remove leg', 'Routes stay; they just stop belonging to this leg.', 'Remove', true))) return;
    await api('DELETE', `/api/legs/${tr.dataset.id}`);
    await loadBootstrap(); render(el);
  });

  const ap = $('#addPerson', el);
  if (ap) {
    ap.onsubmit = async (e) => {
      e.preventDefault();
      try { await api('POST', '/api/people', { email: ap.email.value, name: ap.name.value }); toast('Added — they can sign in now'); render(el); } catch (err) { toast(err.message, 'err'); }
    };
    el.querySelectorAll('[data-remove]').forEach((b) => { b.onclick = async () => {
      if (!(await confirm('Remove person', `${b.dataset.remove} won't be able to sign in. Their edits stay.`, 'Remove', true))) return;
      await api('DELETE', '/api/people', { email: b.dataset.remove }); render(el);
    }; });
  }
}
