(function () {
  const { h, api, toast, store, live } = window.DS;
  const app = document.getElementById('app');
  const topright = document.getElementById('topright');
  const TZ = 'Asia/Kuala_Lumpur';
  const fmt = (iso) => (iso ? new Intl.DateTimeFormat('en-MY', { timeZone: TZ, hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' }).format(new Date(iso)) + ' MYT' : '');
  const KINDS = [['positive', 'Working well'], ['concern', 'Concern'], ['suggestion', 'Suggestion'], ['question', 'Question'], ['other', 'Other']];
  const TYPE_LABEL = { single: 'Single choice', multi: 'Multiple choice', rating: 'Rating 1–5', agree: 'Agreement scale', text: 'Open text' };

  let sid = new URLSearchParams(location.search).get('s');
  let S = null; let R = null; let D = null;
  let tab = store.get('duracell:host:tab') || 'run';
  let resultsSection = store.get('duracell:host:rsec') || 's1';
  let conn = null; let pendingRender = false; let splitting = null;

  // ---------- generic ----------
  async function act(fn, okMsg) {
    try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) {
      if (e.status === 401) { boot(); return; }
      toast(e.network ? 'Can’t reach the server.' : e.message, 3500); throw e;
    }
  }
  const sapi = (m, p, b) => api(m, `/api/host/s/${sid}${p}`, b);

  function modal(title, body, actions) {
    const m = document.getElementById('modal');
    const close = () => { m.classList.add('hidden'); m.replaceChildren(); };
    m.replaceChildren(h('div', { class: 'box' }, h('h2', null, title), body, h('div', { class: 'row', style: { marginTop: '16px', justifyContent: 'flex-end' } },
      h('button', { onclick: close }, 'Cancel'), ...actions(close))));
    m.classList.remove('hidden');
    const f = m.querySelector('input,textarea,button.primary,button.danger'); if (f) f.focus();
  }
  function confirmTyped(title, text, btnLabel, onOk) {
    const inp = h('input', { type: 'text', autocomplete: 'off', 'aria-label': 'Session code' });
    modal(title, h('div', null, h('p', null, text), h('p', { class: 'small muted' }, 'Type the session code ', h('b', { class: 'code' }, S.session.code), ' to confirm.'), inp),
      (close) => [h('button', { class: 'danger solid', onclick: async () => { if (inp.value.trim().toUpperCase() !== S.session.code) return toast('Code doesn’t match.'); close(); await onOk(inp.value.trim().toUpperCase()); } }, btnLabel)]);
  }
  function confirmSimple(title, text, btnLabel, onOk) {
    modal(title, h('p', null, text), (close) => [h('button', { class: 'primary', onclick: async () => { close(); await onOk(); } }, btnLabel)]);
  }

  // ---------- boot / auth ----------
  async function boot() {
    const me = await api('GET', '/api/host/me').catch(() => ({ host: false }));
    if (!me.host) return renderLogin();
    topright.replaceChildren(h('button', { class: 'sm ghost', onclick: async () => { await api('POST', '/api/host/logout', {}); location.href = '/host'; } }, 'Log out'));
    if (sid) return openSession(sid);
    renderSessions();
  }

  function renderLogin(err) {
    topright.replaceChildren();
    const pw = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': 'Facilitator password' });
    app.replaceChildren(h('div', { class: 'card login stack' }, h('h1', null, 'Facilitator login'),
      h('p', { class: 'muted' }, 'This dashboard controls the session. The participant code does not give access here.'),
      err ? h('p', { class: 'banner err' }, err) : null,
      h('form', { class: 'stack', onsubmit: async (e) => {
        e.preventDefault();
        try { await api('POST', '/api/host/login', { password: pw.value }); boot(); } catch (x) { renderLogin(x.message); }
      } }, h('label', null, h('span', { class: 'sr-only' }, 'Password'), pw), h('button', { class: 'primary', type: 'submit' }, 'Log in'))));
    pw.focus();
  }

  async function renderSessions() {
    document.getElementById('demo').classList.add('hidden');
    const list = await act(() => api('GET', '/api/host/sessions'));
    const name = h('input', { type: 'text', placeholder: 'e.g. Duracell family meeting — Nov 2026', maxlength: '80', 'aria-label': 'Session name' });
    const create = async (demo) => {
      const r = await act(() => api('POST', '/api/host/sessions', { name: name.value, demo }));
      location.href = '/host?s=' + r.id;
    };
    const live_ = list.filter((s) => !s.isDemo); const demos = list.filter((s) => s.isDemo);
    const row = (s) => h('div', { class: 's' },
      h('div', null, h('div', { style: { fontWeight: 700 } }, s.name, ' ', s.isDemo ? h('span', { class: 'pill demo' }, 'Demo') : null),
        h('div', { class: 'small muted' }, 'Code ', h('span', { class: 'code' }, s.code), ` · created ${s.createdAtMyt} · `, stageText(s.status))),
      h('a', { class: 'btn', href: '/host?s=' + s.id }, 'Open'));
    app.replaceChildren(h('div', { class: 'stack' },
      h('div', { class: 'card stack' }, h('h2', null, 'Start a session'),
        h('label', { class: 'fld' }, h('span', null, 'Session name'), name),
        h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => create(false) }, 'Create live session'),
          h('button', { onclick: () => create(true) }, 'Create demo session (for rehearsal)')),
        h('p', { class: 'small muted' }, 'Demo sessions are kept completely separate and can be filled with sample responses. Live sessions never contain sample data.')),
      h('div', { class: 'card sesslist' }, h('h2', null, 'Live sessions'), live_.length ? live_.map(row) : h('p', { class: 'muted' }, 'None yet.')),
      demos.length ? h('div', { class: 'card sesslist' }, h('h2', null, 'Demo sessions'), demos.map(row)) : null));
  }

  function stageText(status) {
    const st = status.sections;
    const open = Object.entries(st).find(([, v]) => v === 'open');
    if (open) return `Section ${open[0].slice(1)} open`;
    const closed = Object.values(st).filter((v) => v === 'closed').length;
    if (closed === 0) return 'Not started';
    if (closed === Object.keys(st).length) return 'All sections closed';
    return `${closed} of ${Object.keys(st).length} sections closed`;
  }

  // ---------- session ----------
  async function openSession(id) {
    sid = id;
    try { await Promise.all([loadS(), loadR(), loadD()]); } catch (e) { if (e.status === 404) { sid = null; history.replaceState(null, '', '/host'); return renderSessions(); } throw e; }
    if (conn) conn.close();
    conn = live(`/api/host/s/${sid}/events`, onEvent, (ok) => { setOffline(!ok); if (ok) { loadS().then(loadR).then(loadD).then(render); } });
    render();
  }
  async function loadS() { S = await api('GET', `/api/host/s/${sid}`); document.getElementById('demo').classList.toggle('hidden', !S.session.isDemo); }
  async function loadR() { R = await api('GET', `/api/host/s/${sid}/results`); }
  async function loadD() { D = await api('GET', `/api/host/s/${sid}/slides`); }
  let offlineEl = null;
  function setOffline(off) {
    if (off && !offlineEl) { offlineEl = h('div', { class: 'banner warn', style: { position: 'fixed', bottom: '16px', left: '16px', zIndex: 60 } }, 'Connection lost — reconnecting… Nothing is lost; data is saved on the server.'); document.body.appendChild(offlineEl); }
    if (!off && offlineEl) { offlineEl.remove(); offlineEl = null; }
  }

  let evTimer = null; const evPending = new Set();
  function onEvent(ev) {
    if (ev.type === 'presence' && S) { S.presence = ev.presence; const el = document.getElementById('presence'); if (el) el.textContent = String(ev.presence); return; }
    evPending.add(ev.type);
    clearTimeout(evTimer);
    evTimer = setTimeout(async () => {
      const types = new Set(evPending); evPending.clear();
      const jobs = [];
      if (types.has('stage') || types.has('counts')) jobs.push(loadS());
      if (types.has('counts') || types.has('results') || types.has('stage')) jobs.push(loadR());
      if (types.has('slides') || types.has('slide') || types.has('stage')) jobs.push(loadD());
      await Promise.all(jobs).catch(() => {});
      softRender();
    }, 150);
  }
  // Don't destroy what the facilitator is typing: defer re-render until focus leaves an editor.
  function softRender() {
    const a = document.activeElement;
    if (a && app.contains(a) && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && a.type !== 'checkbox') || a.tagName === 'SELECT')) {
      pendingRender = true; return;
    }
    render();
  }
  document.addEventListener('focusout', () => setTimeout(() => { if (pendingRender) { const a = document.activeElement; if (!a || !app.contains(a) || !['TEXTAREA', 'INPUT', 'SELECT'].includes(a.tagName)) { pendingRender = false; render(); } } }, 50));

  function render() {
    if (!S) return;
    const keepScroll = window.scrollY;
    const s = S.session;
    const tabs = [['run', 'Run session'], ['results', 'Results & moderation'], ['notes', 'Discussion & notes'], ['survey', 'Edit survey'], ['export', 'Export & settings']];
    app.replaceChildren(
      h('div', { class: 'shead row between' },
        h('div', null, h('a', { href: '/host', class: 'small' }, '← All sessions'), h('h1', null, s.name),
          h('div', { class: 'small muted' }, 'Code ', h('span', { class: 'code' }, s.code), ` · created ${s.createdAtMyt} · `, stageText(s.status), s.isDemo ? h('span', { class: 'pill demo', style: { marginLeft: '8px' } }, 'Demo — sample data') : null)),
        h('button', { class: 'primary', onclick: launchPresentation }, 'Launch presentation ↗')),
      h('div', { class: 'tabs', role: 'tablist' }, tabs.map(([k, l]) => h('button', { role: 'tab', 'aria-selected': String(tab === k), onclick: () => { tab = k; store.set('duracell:host:tab', k); render(); window.scrollTo(0, 0); } }, l))),
      h('div', { role: 'tabpanel' }, ({ run: renderRun, results: renderResults, notes: renderNotes, survey: renderSurvey, export: renderExport })[tab]()));
    window.scrollTo(0, keepScroll);
  }

  function launchPresentation() { window.open(`/present/${sid}`, 'duracell-present'); }

  // ---------- RUN ----------
  function renderRun() {
    const s = S.session; const secs = s.survey.sections;
    const anyOpen = secs.some((x) => s.status.sections[x.id] === 'open');
    const secRows = secs.map((sec, i) => {
      const st = s.status.sections[sec.id]; const n = S.counts[sec.id] || 0; const t = (s.status.times || {})[sec.id] || {};
      const acts = [];
      if (st === 'pending') acts.push(h('button', { class: 'primary', disabled: anyOpen, title: anyOpen ? 'Close the open section first' : '', onclick: () => act(() => sapi('POST', `/section/${sec.id}/open`, {}), `${sec.title} is open`).then(refreshAll) }, 'Open section'));
      if (st === 'open') acts.push(h('button', { class: 'primary', onclick: () => confirmSimple(`Close “${sec.title}”?`, `${n} ${n === 1 ? 'person has' : 'people have'} submitted. Anyone still answering won’t be able to submit after you close.`, 'Close responses', () => act(() => sapi('POST', `/section/${sec.id}/close`, {}), 'Responses closed').then(refreshAll)) }, 'Close responses'));
      if (st === 'closed') {
        acts.push(h('button', { class: 'primary', onclick: () => goSlide(sec.id + ':divider') }, 'Present results'));
        acts.push(h('button', { class: 'sm', onclick: () => { tab = 'results'; resultsSection = sec.id; store.set('duracell:host:tab', tab); render(); } }, 'Review'));
        acts.push(h('button', { class: 'sm ghost', disabled: anyOpen, onclick: () => confirmSimple('Reopen this section?', 'Participants who haven’t submitted will be able to answer again. Existing responses are kept.', 'Reopen', () => act(() => sapi('POST', `/section/${sec.id}/reopen`, { confirm: true }), 'Reopened').then(refreshAll)) }, 'Reopen'));
      }
      if (st === 'open' && s.isDemo) acts.push(h('button', { class: 'sm', onclick: () => act(() => sapi('POST', '/demo/seed', { count: 8 }), 'Added 8 sample responses').then(refreshAll) }, '+ 8 sample responses'));
      return h('div', { class: `sec is-${st}` }, h('div', { class: 'n' }, String(i + 1)),
        h('div', null, h('div', { class: 't' }, sec.title, ' ', h('span', { class: 'pill ' + st }, st === 'pending' ? 'Not opened' : st === 'open' ? 'Open' : 'Closed')),
          h('div', { class: 'c' }, `${n} submitted`, t.openedAt ? ` · opened ${fmt(t.openedAt)}` : '', t.closedAt ? ` · closed ${fmt(t.closedAt)}` : '')),
        h('div', { class: 'acts' }, acts));
    });
    const openSec = secs.find((x) => s.status.sections[x.id] === 'open');
    const urlInput = h('input', { type: 'text', readonly: true, value: S.joinUrl, 'aria-label': 'Participant link' });
    return h('div', { class: 'grid2' },
      h('div', { class: 'stack' },
        h('div', { class: 'card' }, h('div', { class: 'row between' }, h('h2', null, 'Session flow'),
          h('div', { class: 'row', style: { gap: '18px' } },
            openSec ? h('div', null, h('div', { class: 'counter-big' }, String(S.counts[openSec.id] || 0)), h('div', { class: 'small muted' }, 'submitted now')) : null,
            h('div', null, h('div', { class: 'counter-big', id: 'presence' }, String(S.presence)), h('div', { class: 'small muted' }, 'phones connected')))),
          secRows,
          h('p', { class: 'small muted', style: { marginTop: '10px' } }, 'Open one section at a time. Closing a section stops new answers and makes its results available to present. Written answers are summarised after closing and stay hidden from the projector until you approve them.')),
        presentCard()),
      h('div', { class: 'stack' },
        h('div', { class: 'card stack' }, h('h2', null, 'Invite participants'),
          h('div', { class: 'row', style: { alignItems: 'flex-start' } },
            h('img', { class: 'qr', src: `/api/host/s/${sid}/qr.svg`, alt: 'QR code for the participant link' }),
            h('div', { class: 'stack', style: { flex: 1, minWidth: '180px' } }, h('div', { class: 'small muted' }, 'Session code'), h('div', { class: 'bigcode' }, s.code),
              h('p', { class: 'small muted' }, 'People scan the QR code, or open the link and enter the code. No account, name or phone number needed.'))),
          h('div', { class: 'copyrow' }, urlInput, h('button', { onclick: async () => { try { await navigator.clipboard.writeText(S.joinUrl); toast('Link copied'); } catch { urlInput.select(); toast('Press Ctrl+C to copy'); } } }, 'Copy')),
          h('p', { class: 'small muted' }, 'Anonymity note: each browser gets a random code so it can return to unfinished answers and isn’t counted twice. This can’t stop someone submitting again from a different device.')),
        S.ai.available && s.aiEnabled ? null : h('div', { class: 'banner warn' }, S.ai.available ? 'AI summarising is switched off for this session. Use keyword analysis or group written answers manually.' : 'AI summarising isn’t configured on the server. Written answers can be grouped manually or with keyword analysis (clearly labelled as not AI).')));
  }

  function presentCard() {
    if (!D) return null;
    const i = Math.max(0, D.slides.findIndex((x) => x.key === D.slideKey));
    const cur = D.slides[i];
    const title = (sl) => sl.type === 'title' ? 'Title' : sl.type === 'divider' ? `Section ${sl.sectionNum}: ${sl.sectionTitle}` : sl.type === 'discussion' ? `Section ${sl.sectionNum} discussion` : `Q${sl.result.num}. ${sl.result.text}`;
    return h('div', { class: 'card stack' },
      h('div', { class: 'row between' }, h('h2', null, 'Presentation'), h('div', { class: 'row' },
        h('button', { onclick: () => D.slides[i - 1] && goSlide(D.slides[i - 1].key), disabled: i === 0 }, '← Prev'),
        h('span', { class: 'small muted' }, `${i + 1} / ${D.slides.length}`),
        h('button', { onclick: () => D.slides[i + 1] && goSlide(D.slides[i + 1].key), disabled: i >= D.slides.length - 1 }, 'Next →'))),
      h('div', { class: 'slide-frame' }, window.Slides.render(cur)),
      h('p', { class: 'small muted' }, 'This is exactly what the projector shows. Controls, private answers and moderation never appear there. In the presentation window use ← → or Space; F for full screen.'),
      h('div', { class: 'slidepick' }, D.slides.map((sl) => h('button', { 'aria-current': String(sl.key === cur.key), onclick: () => goSlide(sl.key) }, title(sl)))));
  }
  async function goSlide(key) { await act(() => sapi('PUT', '/slide', { key })); D.slideKey = key; render(); }
  async function refreshAll() { await Promise.all([loadS(), loadR(), loadD()]); render(); }

  // ---------- RESULTS ----------
  function renderResults() {
    const secs = R.sections;
    const sec = secs.find((x) => x.id === resultsSection) || secs[0];
    const sectionIdx = secs.indexOf(sec);
    return h('div', null,
      h('div', { class: 'row', style: { marginBottom: '14px' } }, secs.map((x) => h('button', { class: x.id === sec.id ? 'primary sm' : 'sm', onclick: () => { resultsSection = x.id; store.set('duracell:host:rsec', x.id); render(); } }, `${x.title} (${x.submittedN})`))),
      sec.status !== 'closed' ? h('p', { class: 'banner ' + (sec.status === 'open' ? 'ok' : 'warn') }, sec.status === 'open' ? 'This section is open — results update live here, but they won’t appear on the projector until you close the section.' : 'This section hasn’t been opened yet.') : null,
      sec.questions.map((q) => questionCard(sec, q, sectionIdx)));
  }

  function questionCard(sec, q, sectionIdx) {
    const preview = h('div', { class: 'prev' }, h('div', { class: 'slide-frame' }, window.Slides.render({ type: 'question', sectionNum: sectionIdx + 1, result: q })));
    const parts = [h('div', { class: 'qh' }, h('h3', null, `Q${q.num}. ${q.text}`), h('span', { class: 'small muted' }, `${TYPE_LABEL[q.type]} · ${q.answeredN} answered · ${q.skippedN} skipped`)), preview];
    if ((q.type === 'single' || q.type === 'multi') && q.otherTexts && q.otherTexts.length) parts.push(otherPanel(q));
    if (q.type === 'text') parts.push(textPanel(sec, q));
    return h('div', { class: 'card qcard', id: 'card-' + q.id }, parts);
  }

  function modBtns(item, key) {
    let editing = false;
    const wrap = h('div', null);
    const draw = () => {
      const ta = h('textarea', { rows: '3', 'aria-label': 'Text shown on screen' }); ta.value = item.display;
      wrap.replaceChildren(
        h('div', { class: 'ra' },
          h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: item.excerpt, onchange: (e) => act(() => sapi('POST', '/moderation', { submissionId: item.id, key, excerpt: e.target.checked })).then(refreshAll) }), key.endsWith(':other') ? 'Show on slide' : (item.visibility === 'group' && key === 'q20' ? 'Show in question list' : 'Approve as excerpt')),
          h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: item.hidden, onchange: (e) => act(() => sapi('POST', '/moderation', { submissionId: item.id, key, hidden: e.target.checked })).then(refreshAll) }), 'Hide from projection'),
          h('button', { class: 'sm ghost', onclick: () => { editing = !editing; draw(); } }, editing ? 'Cancel edit' : 'Edit displayed text')),
        editing ? h('div', { class: 'stack', style: { marginTop: '8px' } }, ta, h('div', { class: 'row' },
          h('button', { class: 'sm primary', onclick: () => act(() => sapi('POST', '/moderation', { submissionId: item.id, key, displayText: ta.value }), 'Saved').then(refreshAll) }, 'Save displayed text'),
          h('button', { class: 'sm', onclick: () => act(() => sapi('POST', '/moderation', { submissionId: item.id, key, displayText: null }), 'Restored').then(refreshAll) }, 'Restore original'),
          h('span', { class: 'small muted' }, 'Use this to remove identifying details. The original stays in the private record.'))) : null);
    };
    draw();
    return wrap;
  }

  function otherPanel(q) {
    return h('div', { class: 'mod' }, h('h3', null, '“Other” answers (private until you choose to show them)'),
      q.otherTexts.map((o) => h('div', { class: 'resp' + (o.hidden ? ' is-hidden' : '') }, h('div', { class: 'rt' }, o.text), o.edited ? h('div', { class: 'shown' }, 'Shown as: ' + o.display) : null, modBtns(o, o.key))));
  }

  function textPanel(sec, q) {
    const an = q.analysis; const closed = sec.status === 'closed';
    const aiOk = S.ai.available && S.session.aiEnabled;
    const respById = new Map(q.responses.map((r) => [r.id, r]));
    const short = (id) => { const r = respById.get(id); return r ? (r.display.length > 60 ? r.display.slice(0, 60) + '…' : r.display) : '(removed)'; };
    const run = (method) => {
      const go = () => act(() => sapi('POST', `/q/${q.id}/analyse`, { method }), method === 'ai' ? 'AI summarising started…' : 'Done').then(refreshAll);
      if (q.allThemes.length) confirmSimple('Replace current themes?', 'This replaces the themes and summary for this question. Responses are not affected.', 'Replace', go); else go();
    };
    const methodLabel = { ai: 'AI-assisted (semantic)', keyword: 'Keyword analysis — not AI, counts words only', manual: 'Manual grouping' }[an.method] || 'Not summarised yet';
    const status = an.status === 'running' ? h('span', { class: 'pill open' }, 'AI is summarising…')
      : an.status === 'failed' ? h('span', { class: 'banner err' }, 'AI summarising failed: ' + (an.error || 'unknown error') + '. All responses are kept — retry, or use keyword analysis or manual grouping.')
        : h('span', { class: 'small muted' }, methodLabel + (an.generatedAt ? ` · ${fmt(an.generatedAt)}` : ''));

    const summary = h('textarea', { rows: '3', maxlength: '800', placeholder: 'Brief, neutral summary (optional)', 'aria-label': 'Summary' }); summary.value = an.summary || '';
    const themesEl = q.allThemes.map((t) => themeCard(q, t, short));
    const newLabel = h('input', { type: 'text', placeholder: 'New theme label', maxlength: '80', 'aria-label': 'New theme label' });
    const newKind = kindSelect('suggestion');

    return h('div', { class: 'mod stack' },
      h('div', { class: 'row between' }, h('h3', null, 'Written responses — private review'),
        h('span', { class: 'small muted' }, `${q.projectableN} can be summarised · ${q.leadersOnlyN ? q.leadersOnlyN + ' leaders-only · ' : ''}${q.hiddenN} hidden`)),
      q.visibilityChoice ? h('p', { class: 'banner warn small' }, 'Leaders-only responses are never projected, never used for themes or summaries, and appear only in the private export.') : null,
      !closed ? h('p', { class: 'small muted' }, 'Close the section to summarise written answers.') : h('div', { class: 'row' }, status,
        aiOk ? h('button', { class: 'sm primary', disabled: an.status === 'running', onclick: () => run('ai') }, an.method === 'ai' ? 'Regenerate with AI' : 'Generate themes with AI') : null,
        h('button', { class: 'sm', onclick: () => run('keyword') }, 'Keyword analysis (not AI)'),
        h('button', { class: 'sm', onclick: () => run('manual') }, 'Start manual grouping')),
      closed ? h('div', { class: 'stack' },
        h('label', { class: 'fld' }, h('span', null, 'Summary shown on the slide'), summary),
        an.stale ? h('p', { class: 'banner warn small' }, 'You changed which responses are hidden after this summary was written, so it is held back from the projector. Edit and save it, regenerate, or confirm it is still accurate.') : null,
        h('div', { class: 'row' }, h('button', { class: 'sm', onclick: () => act(() => sapi('PUT', `/q/${q.id}/analysis`, { summary: summary.value }), 'Summary saved').then(refreshAll) }, 'Save summary'),
          an.stale ? h('button', { class: 'sm', onclick: () => act(() => sapi('PUT', `/q/${q.id}/analysis`, { stale: false }), 'Confirmed').then(refreshAll) }, 'Still accurate') : null,
          h('label', { class: 'toggle', style: { marginLeft: 'auto', fontWeight: 700 } }, h('input', { type: 'checkbox', checked: an.approved, onchange: (e) => act(() => sapi('PUT', `/q/${q.id}/analysis`, { approved: e.target.checked }), e.target.checked ? 'Approved for projection' : 'Removed from projection').then(refreshAll) }), 'Approve themes for the projector')),
        h('h3', null, `Themes (${q.allThemes.length})`),
        q.allThemes.length ? null : h('p', { class: 'small muted' }, 'No themes yet.'),
        themesEl,
        h('div', { class: 'row' }, newLabel, newKind, h('button', { class: 'sm', onclick: () => { if (!newLabel.value.trim()) return toast('Give the theme a label'); act(() => sapi('POST', `/q/${q.id}/themes`, { label: newLabel.value, kind: newKind.value, responseIds: [] }), 'Theme added').then(refreshAll); } }, '+ Add theme')),
        q.ungroupedIds.length ? h('p', { class: 'small muted' }, `${q.ungroupedIds.length} summarisable response${q.ungroupedIds.length === 1 ? ' is' : 's are'} not in any theme.`) : null) : null,
      h('h3', null, `Responses (${q.responses.length})`),
      q.responses.length ? null : h('p', { class: 'small muted' }, 'No written responses.'),
      q.responses.map((r) => responseRow(q, r)));
  }

  function kindSelect(val, onchange) {
    const s = h('select', { 'aria-label': 'Theme type', onchange }, KINDS.map(([k, l]) => h('option', { value: k, selected: k === val }, l)));
    return s;
  }

  function themeCard(q, t, short) {
    const label = h('input', { type: 'text', value: t.label, maxlength: '80', 'aria-label': 'Theme label' });
    label.addEventListener('change', () => act(() => sapi('PUT', `/themes/${t.id}`, { label: label.value }), 'Renamed').then(refreshAll));
    const kind = kindSelect(t.kind, (e) => act(() => sapi('PUT', `/themes/${t.id}`, { kind: e.target.value })).then(refreshAll));
    const others = q.allThemes.filter((x) => x.id !== t.id);
    const merge = h('select', { 'aria-label': 'Merge into', onchange: (e) => { if (!e.target.value) return; const into = e.target.value; confirmSimple('Merge themes?', `Move everything in “${t.label}” into “${others.find((x) => x.id === into).label}”.`, 'Merge', () => act(() => sapi('POST', `/themes/${t.id}/merge`, { intoId: into }), 'Merged').then(refreshAll)); e.target.value = ''; } },
      h('option', { value: '' }, 'Merge into…'), others.map((o) => h('option', { value: o.id }, o.label)));
    const isSplit = splitting === t.id;
    const picks = new Set();
    const splitLabel = h('input', { type: 'text', placeholder: 'Label for the new theme', maxlength: '80', 'aria-label': 'New theme label' });
    return h('div', { class: 'theme' },
      h('div', { class: 'th' }, label, kind, h('span', { class: 'cnt' }, `${t.count} ${t.count === 1 ? 'mention' : 'mentions'}`)),
      h('div', { class: 'chips', style: { marginTop: '8px' } }, t.responseIds.length ? t.responseIds.map((id) => {
        const visible = t.visibleIds.includes(id);
        return h('span', { class: 'chip' + (visible ? '' : ' dim'), title: visible ? '' : 'Hidden or leaders-only: not counted' },
          isSplit ? h('input', { type: 'checkbox', 'aria-label': 'Move this response', onchange: (e) => (e.target.checked ? picks.add(id) : picks.delete(id)) }) : null,
          h('span', null, short(id)),
          isSplit ? null : h('button', { 'aria-label': 'Remove from theme', onclick: () => act(() => sapi('PUT', `/themes/${t.id}`, { responseIds: t.responseIds.filter((x) => x !== id) })).then(refreshAll) }, '×'));
      }) : h('span', { class: 'small muted' }, 'No responses linked. Add them from the response list below.')),
      isSplit ? h('div', { class: 'row', style: { marginTop: '8px' } }, splitLabel,
        h('button', { class: 'sm primary', onclick: () => { if (!splitLabel.value.trim() || !picks.size) return toast('Pick responses and give the new theme a label'); splitting = null; act(() => sapi('POST', `/themes/${t.id}/split`, { label: splitLabel.value, responseIds: [...picks] }), 'Split').then(refreshAll); } }, 'Move ticked to new theme'),
        h('button', { class: 'sm', onclick: () => { splitting = null; render(); } }, 'Cancel'))
        : h('div', { class: 'row', style: { marginTop: '8px' } }, others.length ? merge : null,
          t.responseIds.length > 1 ? h('button', { class: 'sm', onclick: () => { splitting = t.id; render(); } }, 'Split…') : null,
          h('button', { class: 'sm danger', onclick: () => confirmSimple('Delete theme?', 'Responses are kept; only this grouping is removed.', 'Delete', () => act(() => sapi('DELETE', `/themes/${t.id}`), 'Deleted').then(refreshAll)) }, 'Delete')));
  }

  function responseRow(q, r) {
    const inThemes = q.allThemes.filter((t) => t.responseIds.includes(r.id));
    const notIn = q.allThemes.filter((t) => !t.responseIds.includes(r.id));
    const add = notIn.length && r.projectable ? h('select', { 'aria-label': 'Add to theme', onchange: (e) => { const t = q.allThemes.find((x) => x.id === e.target.value); if (t) act(() => sapi('PUT', `/themes/${t.id}`, { responseIds: [...t.responseIds, r.id] })).then(refreshAll); } },
      h('option', { value: '' }, 'Add to theme…'), notIn.map((t) => h('option', { value: t.id }, t.label))) : null;
    return h('div', { class: 'resp' + (r.hidden ? ' is-hidden' : '') },
      h('div', { class: 'row', style: { gap: '6px', marginBottom: '4px' } },
        q.visibilityChoice ? h('span', { class: 'badge ' + (r.visibility === 'leaders' ? 'priv' : 'grp') }, r.visibility === 'leaders' ? 'For leaders only' : 'OK for group discussion') : null,
        r.hidden ? h('span', { class: 'badge' }, 'Hidden from projection') : null,
        inThemes.map((t) => h('span', { class: 'badge' }, t.label))),
      h('div', { class: 'rt' }, r.text),
      r.edited ? h('div', { class: 'shown' }, 'Shown as: ' + r.display) : null,
      r.visibility === 'leaders' ? null : h('div', { class: 'row', style: { gap: '8px' } }, modBtns(r, q.id), add));
  }

  // ---------- NOTES ----------
  function renderNotes() {
    return h('div', { class: 'stack' }, R.sections.map((sec, i) => notesCard(sec, i)));
  }
  function notesCard(sec, i) {
    const n = sec.notes; const surveySec = S.session.survey.sections[i];
    const prompts = h('textarea', { rows: '4', 'aria-label': 'Discussion prompts, one per line' }); prompts.value = (surveySec.discussionPrompts || []).join('\n');
    const f = (v, label) => { const t = h('textarea', { rows: '3', 'aria-label': label }); t.value = v || ''; return t; };
    const obs = f(n.observations, 'Key observations'); const dec = f(n.decisions, 'Decisions'); const fol = f(n.followups, 'Items requiring follow-up');
    const actions = (n.actions.length ? n.actions : [{ action: '', owner: '', reviewDate: '' }]).map((a) => ({ ...a }));
    const tbody = h('tbody');
    const drawActs = () => tbody.replaceChildren(...actions.map((a, k) => {
      const ai = h('input', { type: 'text', value: a.action, maxlength: '400', 'aria-label': 'Action', oninput: (e) => (a.action = e.target.value) });
      const oi = h('input', { type: 'text', value: a.owner, maxlength: '120', 'aria-label': 'Owner', oninput: (e) => (a.owner = e.target.value) });
      const di = h('input', { type: 'date', value: a.reviewDate, 'aria-label': 'Review date', oninput: (e) => (a.reviewDate = e.target.value) });
      return h('tr', null, h('td', null, ai), h('td', { style: { width: '24%' } }, oi), h('td', { style: { width: '170px' } }, di), h('td', null, h('button', { class: 'sm ghost', 'aria-label': 'Remove action', onclick: () => { actions.splice(k, 1); drawActs(); } }, '×')));
    }));
    drawActs();
    const show = h('input', { type: 'checkbox', checked: n.showOnSlide });
    const save = async () => {
      await act(() => sapi('PUT', `/notes/${sec.id}`, { observations: obs.value, decisions: dec.value, followups: fol.value, actions: actions.filter((a) => a.action.trim() || a.owner.trim()), showOnSlide: show.checked }));
      await act(() => sapi('PUT', '/survey', { survey: { sections: [{ id: sec.id, discussionPrompts: prompts.value.split('\n'), questions: [] }] } }));
      toast('Notes saved'); refreshAll();
    };
    return h('div', { class: 'card stack' },
      h('div', { class: 'row between' }, h('h2', null, `Section ${i + 1}: ${sec.title}`), h('button', { class: 'sm', disabled: sec.status !== 'closed', onclick: () => { goSlide(sec.id + ':discussion'); } }, 'Show discussion slide')),
      h('label', { class: 'fld' }, h('span', null, 'Discussion prompts (one per line, shown on the discussion slide)'), prompts),
      h('div', { class: 'grid2' }, h('label', { class: 'fld' }, h('span', null, 'Key observations'), obs), h('label', { class: 'fld' }, h('span', null, 'Decisions'), dec)),
      h('label', { class: 'fld' }, h('span', null, 'Items requiring follow-up'), fol),
      h('div', null, h('span', { class: 'small muted', style: { fontWeight: 700 } }, 'Actions (owner entered manually)'),
        h('table', { class: 'acttable' }, h('thead', null, h('tr', null, h('th', null, 'Action'), h('th', null, 'Owner'), h('th', null, 'Review date'), h('th'))), tbody),
        h('button', { class: 'sm', onclick: () => { actions.push({ action: '', owner: '', reviewDate: '' }); drawActs(); } }, '+ Add action')),
      h('div', { class: 'row between' }, h('label', { class: 'toggle' }, show, 'Show decisions and actions on the discussion slide'), h('button', { class: 'primary', onclick: save }, 'Save notes')));
  }

  // ---------- SURVEY EDITOR ----------
  function renderSurvey() {
    const sv = JSON.parse(JSON.stringify(S.session.survey));
    const statuses = S.session.status.sections;
    const anyStarted = Object.values(statuses).some((x) => x !== 'pending');
    const ta = (val, rows, attrs = {}) => { const t = h('textarea', { rows: String(rows), ...attrs }); t.value = val || ''; return t; };
    const intro = ta(sv.intro, 4, { disabled: anyStarted, 'aria-label': 'Introduction' });
    const vision = ta(sv.sibklVision, 3, { disabled: statuses.s2 !== 'pending', 'aria-label': 'SIBKL vision wording', placeholder: 'Optional. Paste SIBKL’s official vision wording here. Leave blank to show nothing.' });
    const endNote = ta(sv.endNote, 2, { 'aria-label': 'End note' });
    intro.oninput = () => (sv.intro = intro.value); vision.oninput = () => (sv.sibklVision = vision.value); endNote.oninput = () => (sv.endNote = endNote.value);

    const save = () => act(() => sapi('PUT', '/survey', { survey: sv }), 'Survey saved').then(refreshAll);
    const secEls = sv.sections.map((sec, si) => {
      const locked = statuses[sec.id] !== 'pending';
      return h('div', { class: 'card stack' + (locked ? ' locked' : '') },
        h('h2', null, `Section ${si + 1}: ${sec.title}`),
        locked ? h('p', { class: 'banner warn small' }, 'This section has been opened, so its wording and options are locked. Discussion prompts can still be edited.') : null,
        sec.questions.map((q) => questionEditor(q, locked)));
    });
    return h('div', { class: 'stack' },
      h('div', { class: 'card stack' }, h('h2', null, 'Before the session'),
        h('label', { class: 'fld' }, h('span', null, 'Participant introduction' + (anyStarted ? ' (locked — session started)' : '')), intro),
        h('label', { class: 'fld' }, h('span', null, 'SIBKL vision wording for Q12 (optional, facilitator-provided)' + (statuses.s2 !== 'pending' ? ' (locked)' : '')), vision),
        h('p', { class: 'small muted' }, 'The app does not supply or paraphrase SIBKL’s vision. Whatever you paste here is shown above Q12 exactly as written.'),
        h('label', { class: 'fld' }, h('span', null, 'Closing note shown at the end'), endNote)),
      secEls,
      h('div', { class: 'row', style: { position: 'sticky', bottom: '12px' } }, h('button', { class: 'primary', onclick: save }, 'Save survey changes')));
  }

  function questionEditor(q, locked) {
    const inp = (val, attrs) => { const i = h('input', { type: 'text', value: val || '', disabled: locked, ...attrs }); return i; };
    const text = inp(q.text, { maxlength: '400', 'aria-label': `Q${q.num} wording` }); text.oninput = () => (q.text = text.value);
    const help = inp(q.help, { maxlength: '600', 'aria-label': `Q${q.num} help text` }); help.oninput = () => (q.help = help.value);
    const prompt = h('input', { type: 'text', value: q.prompt || '', maxlength: '300', 'aria-label': `Q${q.num} discussion prompt` }); prompt.oninput = () => (q.prompt = prompt.value);
    let optsEl = null;
    if (q.options) {
      optsEl = h('div');
      const draw = () => optsEl.replaceChildren(
        h('div', { class: 'small muted', style: { fontWeight: 700, margin: '6px 0' } }, 'Options'),
        ...q.options.map((o, k) => {
          const l = h('input', { type: 'text', value: o.label, maxlength: '200', disabled: locked, 'aria-label': 'Option label', oninput: (e) => (o.label = e.target.value) });
          const sub = h('input', { type: 'text', value: o.sub || '', maxlength: '200', disabled: locked, placeholder: 'Detail line (optional)', 'aria-label': 'Option detail', oninput: (e) => (o.sub = e.target.value) });
          return h('div', { class: 'opt-ed' }, l, sub,
            h('label', { class: 'toggle', title: 'Reveals a text field' }, h('input', { type: 'checkbox', checked: !!o.other, disabled: locked, onchange: (e) => (o.other = e.target.checked) }), 'Other + text'),
            q.type === 'multi' ? h('label', { class: 'toggle', title: 'Clears other selections' }, h('input', { type: 'checkbox', checked: !!o.exclusive, disabled: locked, onchange: (e) => (o.exclusive = e.target.checked) }), 'Exclusive') : h('span'),
            h('button', { class: 'sm ghost', disabled: locked || q.options.length <= 2, 'aria-label': 'Remove option', onclick: () => { q.options.splice(k, 1); draw(); } }, '×'));
        }),
        locked ? null : h('button', { class: 'sm', onclick: () => { q.options.push({ label: 'New option' }); draw(); } }, '+ Add option'));
      draw();
    }
    return h('div', { class: 'qed' },
      h('div', { class: 'row between' }, h('b', null, `Q${q.num}`), h('span', { class: 'small muted' }, TYPE_LABEL[q.type] + (q.max ? ` · max ${q.max}` : '') + (q.allowNA ? ' · includes “Not sure / N/A”' : '') + (q.allowDontKnow ? ' · includes “don’t know the vision”' : ''))),
      h('label', { class: 'fld' }, h('span', null, 'Question'), text),
      h('label', { class: 'fld' }, h('span', null, 'Help text'), help),
      optsEl,
      h('label', { class: 'fld', style: { marginTop: '8px' } }, h('span', null, 'Discussion prompt on the results slide'), prompt));
  }

  // ---------- EXPORT & SETTINGS ----------
  function renderExport() {
    const s = S.session;
    const name = h('input', { type: 'text', value: s.name, maxlength: '80', 'aria-label': 'Session name' });
    const started = Object.values(s.status.sections).some((x) => x !== 'pending');
    const ai = h('input', { type: 'checkbox', checked: s.aiEnabled, disabled: !S.ai.available || (!s.aiEnabled && started) });
    ai.onchange = () => act(() => sapi('PUT', '/settings', { aiEnabled: ai.checked }), ai.checked ? 'AI summarising on' : 'AI summarising off').then(refreshAll);
    const base = `/api/host/s/${sid}/export`;
    return h('div', { class: 'grid2' },
      h('div', { class: 'stack' },
        h('div', { class: 'card stack' }, h('h2', null, 'Export'),
          h('div', { class: 'row' }, h('a', { class: 'btn', href: `${base}/responses.csv` }, 'Anonymous responses (CSV)'),
            h('a', { class: 'btn', href: `${base}/summary.html`, target: '_blank', rel: 'noopener' }, 'View meeting summary'),
            h('a', { class: 'btn', href: `${base}/summary.html?download=1` }, 'Download summary (.html)')),
          h('p', { class: 'small muted' }, 'The meeting summary contains question results, approved themes, decisions and actions. It never includes leaders-only or hidden responses. Open it and use your browser’s Print → Save as PDF if you need a PDF.'),
          h('div', { class: 'banner warn' }, h('b', null, 'Private host export. '), 'Contains responses marked “for leaders to review privately” and responses you hid. Do not share or project.', h('div', { style: { marginTop: '8px' } }, h('a', { class: 'btn', href: `${base}/private.csv` }, 'Download private leaders-only CSV'))))),
      h('div', { class: 'stack' },
        h('div', { class: 'card stack' }, h('h2', null, 'Settings'),
          h('label', { class: 'fld' }, h('span', null, 'Session name'), h('div', { class: 'copyrow' }, name, h('button', { onclick: () => act(() => sapi('PUT', '/settings', { name: name.value }), 'Saved').then(refreshAll) }, 'Save'))),
          h('label', { class: 'toggle' }, ai, 'Use AI to suggest themes for written answers'),
          h('p', { class: 'small muted' }, !S.ai.available ? 'AI is not configured on the server (no ANTHROPIC_API_KEY). Keyword analysis and manual grouping are available.'
            : `Configured model: ${S.ai.model}. When on, participants are told before they start that written answers are sent to an external AI service. It can only be switched on before the first section opens.`)),
        h('div', { class: 'card stack' }, h('h2', null, 'Danger zone'),
          h('div', { class: 'row' },
            h('button', { class: 'danger', onclick: () => confirmTyped('Clear all responses?', 'Deletes every response, theme and summary in this session and sets all sections back to “not opened”. Survey wording and notes are kept. This cannot be undone.', 'Clear responses', (c) => act(() => sapi('POST', '/clear', { confirm: c }), 'Responses cleared').then(refreshAll)) }, 'Clear responses'),
            h('button', { class: 'danger', onclick: () => confirmTyped('Reset the whole session?', 'Deletes all responses, themes, notes and survey edits, returning the session to its original state. This cannot be undone.', 'Reset session', (c) => act(() => sapi('POST', '/reset', { confirm: c }), 'Session reset').then(refreshAll)) }, 'Reset session'),
            h('button', { class: 'danger', onclick: () => confirmTyped('Delete this session?', 'Permanently deletes the session and everything in it.', 'Delete session', (c) => act(() => sapi('DELETE', '', { confirm: c }), 'Deleted').then(() => { location.href = '/host'; })) }, 'Delete session')))));
  }

  boot();
})();
