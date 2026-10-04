// #/feedback[/all[/id]] — what you've reported (with replies), and the shared
// inbox for triage. Adapted from Site Scout's Settings → My feedback and
// Admin → Feedback / Ideas; the capture widget itself is web/feedback.js.
import { store, api, esc, $, $$, toast, modal, confirm } from '../app.js';

const STATUSES = ['new', 'triaged', 'done', 'wontfix'];
const statusLabel = (s) => (s === 'wontfix' ? 'Won’t fix' : s[0].toUpperCase() + s.slice(1));
const ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
const filters = { status: '', kind: '', criticality: '' };

function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso.replace(' ', 'T') + (iso.endsWith('Z') ? '' : 'Z'))) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso.replace(' ', 'T') + 'Z').toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' });
}
const who = (email) => (email === store.me.email ? 'you' : email.split('@')[0]);
const openImage = (src) => modal({ title: 'Screenshot', wide: true, body: `<img src="${esc(src)}" style="max-width:100%;display:block;border-radius:6px" alt="">`, actions: [{ label: 'Close', primary: true }] });

export async function render(el, params) {
  const tab = params[0] === 'all' && store.me.isAdmin ? 'all' : 'mine';
  const focusId = params[1] || null;
  el.innerHTML = `<div class="page page-narrow">
    <div class="page-head"><div><h1>Feedback</h1><p>Spotted something odd, or want it to do something else? Click <strong>Feedback</strong> in the top bar (or press <kbd>Shift</kbd>+<kbd>F</kbd>), then click the thing you mean.</p></div>
      <button class="btn primary" id="fbNew">+ Send feedback</button></div>
    <div class="seg" role="tablist" style="margin-bottom:14px">
      <button type="button" data-tab="mine" aria-pressed="${tab === 'mine'}">Mine</button>
      ${store.me.isAdmin ? `<button type="button" data-tab="all" aria-pressed="${tab === 'all'}">Everyone's ${store.feedback && store.feedback.adminNewFeedback ? `<span class="count">${store.feedback.adminNewFeedback}</span>` : ''}</button>` : ''}
    </div>
    <div class="card"><div class="card-body" id="fbBody"><span class="spinner"></span></div></div></div>`;
  $('#fbNew', el).onclick = () => window.TA_FEEDBACK && window.TA_FEEDBACK.open();
  el.querySelector('.seg').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) location.hash = b.dataset.tab === 'all' ? '#/feedback/all' : '#/feedback'; };
  const body = $('#fbBody', el);
  const reload = () => (tab === 'all' ? inbox(body, focusId) : mine(body));
  const onSent = () => reload();
  window.addEventListener('ta:feedback-submitted', onSent);
  await reload();
  return () => window.removeEventListener('ta:feedback-submitted', onSent);
}

async function mine(box) {
  try {
    const { data: r } = await api('GET', '/api/feedback');
    const seen = r.seenBefore;
    if (store.feedback) { store.feedback.unreadReplies = 0; window.dispatchEvent(new CustomEvent('ta:feedback-counts')); }
    if (!r.reports.length) { box.innerHTML = '<div class="empty" style="padding:24px"><h3>Nothing sent yet</h3><p>Report a bug, an idea or a question — it keeps the page and the thing you clicked, so it can be fixed exactly.</p></div>'; return; }
    box.innerHTML = r.reports.map((f) => `<div class="fbl-row" data-feedback-id="${f.id}"><div class="fbl-main">
        <div class="fbl-body">${esc(f.body)}</div>
        <div class="fbl-meta"><span class="chip ${esc(f.criticality || 'medium')}">${esc(f.criticality || 'medium')}</span> · ${esc(f.code)} · ${ago(f.created_at)}${f.updated_at ? ' · edited' : ''}${f.kind ? ' · ' + esc(f.kind) : ''}${f.element_label ? ' · about “' + esc(String(f.element_label).slice(0, 60)) + '”' : ''}</div>
        ${f.screenshot_key ? `<img class="fbl-thumb" src="/api/feedback/${f.id}/screenshot" alt="Attached screenshot" loading="lazy" data-zoom>` : ''}
        ${f.resolution_note ? `<div class="fbl-reply ${!seen || f.reply_at > seen ? 'unread' : ''}"><div class="fbl-reply-head">Reply · ${ago(f.reply_at)}</div>${esc(f.resolution_note)}</div>` : ''}
      </div><div class="fbl-side"><span class="fbl-status ${f.status === 'new' ? 'is-new' : f.status === 'done' ? 'is-done' : ''}">${esc(statusLabel(f.status))}</span>
        <div class="toolbar"><button class="btn sm" data-fb-edit="${f.id}">Edit</button><button class="btn sm danger" data-fb-del="${f.id}">Withdraw</button></div></div></div>`).join('');
    box.onclick = async (e) => {
      const img = e.target.closest('[data-zoom]');
      if (img) return openImage(img.src);
      const ed = e.target.closest('[data-fb-edit]'), del = e.target.closest('[data-fb-del]');
      if (ed) {
        const f = r.reports.find((x) => String(x.id) === ed.dataset.fbEdit);
        const form = document.createElement('div');
        form.innerHTML = `<div class="field"><label for="efKind">Kind</label><select class="select" id="efKind"><option value="">— not sure —</option>${['bug', 'idea', 'question'].map((k) => `<option ${f.kind === k ? 'selected' : ''} value="${k}">${k}</option>`).join('')}</select></div>
          <div class="field" style="margin-top:10px"><label for="efCrit">How urgent is this?</label><select class="select" id="efCrit">${['low', 'medium', 'high', 'critical'].map((c) => `<option ${((f.criticality || 'medium') === c) ? 'selected' : ''} value="${c}">${c}</option>`).join('')}</select></div>
          <div class="field" style="margin-top:10px"><label for="efBody">What happened?</label><textarea class="input" id="efBody" rows="5">${esc(f.body)}</textarea></div>
          <p class="help" style="margin-top:8px">The screen context captured when you sent it stays as it was.</p>`;
        if (await modal({ title: `Edit ${f.code}`, body: form, actions: [{ label: 'Cancel', value: false }, { label: 'Save', value: true, primary: true }] })) {
          try { await api('PATCH', '/api/feedback/' + f.id, { body: $('#efBody', form).value, kind: $('#efKind', form).value || null, criticality: $('#efCrit', form).value }); toast('Updated'); mine(box); } catch (er) { toast(er.message, 'err'); }
        }
      }
      if (del) {
        if (!(await confirm('Withdraw feedback', 'Withdraw this report? Any screenshot attached to it is deleted too.', 'Withdraw', true))) return;
        try { await api('DELETE', '/api/feedback/' + del.dataset.fbDel); toast('Withdrawn'); mine(box); } catch (er) { toast(er.message, 'err'); }
      }
    };
  } catch (e) { box.innerHTML = `<div class="help">${esc(e.message)}</div>`; }
}

async function inbox(box, focusId) {
  // A critical-alert email links to #/feedback/all/<id>: clear filters so that report is in the list.
  if (focusId) Object.assign(filters, { status: '', kind: '', criticality: '' });
  try {
    const qs = new URLSearchParams(); if (filters.status) qs.set('status', filters.status); if (filters.kind) qs.set('kind', filters.kind);
    const { data: r } = await api('GET', '/api/feedback/all?' + qs);
    const opt = (v, l, cur) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${l}</option>`;
    const reports = (filters.criticality ? r.reports.filter((x) => (x.criticality || 'medium') === filters.criticality) : r.reports)
      .sort((a, b) => (ORDER[a.criticality || 'medium'] - ORDER[b.criticality || 'medium']) || (b.created_at < a.created_at ? -1 : 1));
    const mb = (n) => (n / 1048576).toFixed(n > 1e7 ? 0 : 1);
    box.innerHTML = `<div class="fbl-filters">
        <select class="select" id="afStatus">${opt('', 'All statuses', filters.status)}${STATUSES.map((s) => opt(s, statusLabel(s), filters.status)).join('')}</select>
        <select class="select" id="afKind">${opt('', 'All kinds', filters.kind)}${['bug', 'idea', 'question'].map((k) => opt(k, k[0].toUpperCase() + k.slice(1), filters.kind)).join('')}</select>
        <select class="select" id="afCrit">${opt('', 'All urgencies', filters.criticality)}${['critical', 'high', 'medium', 'low'].map((c) => opt(c, c[0].toUpperCase() + c.slice(1), filters.criticality)).join('')}</select>
        <span class="help" style="margin-left:auto">${reports.length} report${reports.length === 1 ? '' : 's'} · screenshots ${mb(r.storage.bytes)} of ${mb(r.storage.limit)} MB</span>
      </div>
      ${reports.length ? reports.map(row).join('') : '<div class="empty">No reports match.</div>'}`;
    $('#afStatus', box).onchange = (e) => { filters.status = e.target.value; inbox(box); };
    $('#afKind', box).onchange = (e) => { filters.kind = e.target.value; inbox(box); };
    $('#afCrit', box).onchange = (e) => { filters.criticality = e.target.value; inbox(box); };
    box.onclick = async (e) => {
      const img = e.target.closest('[data-zoom]');
      if (img) return openImage(img.src);
      const go = e.target.closest('[data-goto]');
      if (go) { location.hash = go.dataset.goto; return; }
      const send = e.target.closest('[data-reply]');
      if (send) {
        const id = send.dataset.reply, ta = box.querySelector(`[data-reply-text="${id}"]`);
        try { await api('PUT', `/api/feedback/${id}/reply`, { note: ta.value }); toast('Reply sent — it shows in their Feedback page'); inbox(box); } catch (er) { toast(er.message, 'err'); }
      }
    };
    $$('[data-status-for]', box).forEach((sel) => { sel.onchange = async () => {
      try { await api('PUT', `/api/feedback/${sel.dataset.statusFor}/status`, { status: sel.value }); toast('Status updated'); refreshCounts(); } catch (er) { toast(er.message, 'err'); }
    }; });
    const focus = focusId && box.querySelector(`[data-feedback-id="${CSS.escape(String(focusId))}"]`);
    if (focus) { focus.classList.add('focus'); focus.scrollIntoView({ block: 'center' }); }
  } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

// Where the report was filed, as a link back (map pages open at the same camera).
function backLink(f, where) {
  const hash = where.hash || '';
  if (!hash) return '';
  const cam = where.map ? `${where.map.zoom.toFixed(1)}z at ${where.map.center[1].toFixed(3)}, ${where.map.center[0].toFixed(3)}` : '';
  return ` · <a href="javascript:void 0" data-goto="${esc(hash)}">${esc(hash)}</a>${cam ? ' · map ' + esc(cam) : ''}`;
}

function row(f) {
  const c = f.context || {}, where = c.where || {}, diag = c.diagnostics || {};
  const errs = (diag.console || []).length + (diag.net || []).length;
  const subject = f.subject_type === 'route' && store.route(+f.subject_id) ? ` · route “${esc(store.route(+f.subject_id).name)}” (#${esc(f.subject_id)})` : f.subject_type ? ` · ${esc(f.subject_type.replace(/_/g, ' '))} ${esc(f.subject_id)}` : '';
  return `<div class="fbl-row" data-feedback-id="${f.id}"><div class="fbl-main">
    <div class="fbl-body">${esc(f.body)}</div>
    <div class="fbl-meta"><span class="chip ${esc(f.criticality || 'medium')}">${esc(f.criticality || 'medium')}</span> · <strong>${esc(who(f.author_email))}</strong> · ${ago(f.created_at)}${f.kind ? ' · ' + esc(f.kind) : ''}${f.edited_since_triage ? ' · <span style="color:var(--warn)">edited since triage</span>' : ''}</div>
    <div class="fbl-meta">${esc(where.activeTab || '')}${backLink(f, where)}${f.element_label ? ' · clicked “' + esc(String(f.element_label).slice(0, 80)) + '”' : ''}${subject}${where.viewport ? ' · ' + esc(where.viewport) : ''}${errs ? ` · <span style="color:var(--over)">${errs} error${errs === 1 ? '' : 's'} captured</span>` : ''}</div>
    ${f.screenshot_key ? `<img class="fbl-thumb" src="/api/feedback/${f.id}/screenshot" alt="Screenshot" loading="lazy" data-zoom>` : ''}
    ${f.resolution_note ? `<div class="fbl-reply"><div class="fbl-reply-head">Reply · ${ago(f.reply_at)}</div>${esc(f.resolution_note)}</div>` : ''}
    <details style="margin-top:8px"><summary class="help" style="cursor:pointer">Captured context</summary><pre class="ctx">${esc(JSON.stringify(c, null, 2))}</pre></details>
    <div class="fbl-reply-form"><textarea class="input" rows="2" data-reply-text="${f.id}" placeholder="Reply to ${esc(who(f.author_email))}…"></textarea><button class="btn sm primary" data-reply="${f.id}">Reply</button></div>
  </div><div class="fbl-side">
    <select class="select sm" data-status-for="${f.id}" style="width:auto">${STATUSES.map((s) => `<option value="${s}" ${f.status === s ? 'selected' : ''}>${statusLabel(s)}</option>`).join('')}</select>
    <span class="help">${esc(f.code)}${f.app_version ? ' · ' + esc(String(f.app_version).slice(0, 8)) : ''}</span>
  </div></div>`;
}

export async function refreshCounts() {
  try { const { data } = await api('GET', '/api/feedback/counts'); store.feedback = data; window.dispatchEvent(new CustomEvent('ta:feedback-counts')); } catch (_) { /* badge only */ }
}
