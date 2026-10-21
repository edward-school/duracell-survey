(function () {
  const { h, api, store, uuid, live } = window.DS;
  const app = document.getElementById('app');
  const connEl = document.getElementById('conn');
  const AGREE = ['Strongly disagree', 'Disagree', 'Neither agree nor disagree', 'Agree', 'Strongly agree'];
  const NA = 'Not sure / Not applicable';
  const DK = 'I don’t know enough about SIBKL’s vision to answer.';

  const code = (location.pathname.split('/j/')[1] || '').split(/[/?#]/)[0].toUpperCase();
  let pid = store.get('duracell:pid');
  if (!pid || !/^[A-Za-z0-9-]{16,64}$/.test(pid)) { pid = uuid(); store.set('duracell:pid', pid); }

  let st = null;           // server state
  let lastSig = '';
  let sending = false;
  let sendError = null;    // { kind: 'network'|'validation', msg }
  let retryTimer = null;
  let missed = store.get(`duracell:missed:${code}`) || null; // section title that closed before submit

  const draftKey = (sid) => `duracell:draft:${code}:${sid}`;
  const getDraft = (sid) => store.get(draftKey(sid)) || { answers: {}, idx: -1, idemKey: uuid() };
  const saveDraft = (sid, d) => store.set(draftKey(sid), d);

  const icon = (name) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
    const paths = {
      leaf: 'M5 19c0-8 6-14 14-14 0 8-6 14-14 14zM5 19l7-7',
      check: 'M5 12.5l4.5 4.5L19 7.5',
      clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
      heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
    };
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', paths[name]); s.appendChild(p);
    return s;
  };
  const brand = () => h('div', { class: 'brand' }, icon('leaf'), 'Duracell · SIBKL');

  function setConn(ok, msg) {
    if (ok) connEl.classList.add('hidden');
    else { connEl.textContent = msg || 'Reconnecting… your answers are saved on this phone.'; connEl.classList.remove('hidden'); }
  }

  async function refresh() {
    if (!code) return renderCodeEntry();
    try {
      const next = await api('GET', `/api/p/${encodeURIComponent(code)}/state`, undefined, { headers: { 'x-participant-id': pid } });
      setConn(true);
      const sig = JSON.stringify(next);
      if (st && sig === lastSig) return; // nothing changed: don't re-render (keeps focus while typing)
      lastSig = sig;
      st = next;
      document.getElementById('demo').classList.toggle('hidden', !st.session.isDemo);
      document.title = 'Duracell Family Conversation';
      render();
    } catch (e) {
      if (e.status === 404) return renderCodeEntry('We couldn’t find a session with that code. Please check and try again.');
      setConn(false, 'Can’t reach the server right now. Retrying…');
      if (!st) app.replaceChildren(h('p', { class: 'muted center pad' }, 'Connecting…'));
    }
  }

  function renderCodeEntry(err) {
    const input = h('input', { type: 'text', inputmode: 'text', autocomplete: 'off', autocapitalize: 'characters', maxlength: '8', 'aria-label': 'Session code', value: code || '' });
    app.replaceChildren(h('div', { class: 'fade-in' }, brand(),
      h('h1', null, 'Join the conversation'),
      h('p', { class: 'muted' }, 'Enter the session code shown on the screen.'),
      err ? h('p', { class: 'banner err' }, err) : null,
      h('form', { class: 'codeform', onsubmit: (e) => { e.preventDefault(); const c = input.value.trim().toUpperCase(); if (c) location.href = '/j/' + encodeURIComponent(c); } },
        input, h('button', { class: 'primary', type: 'submit' }, 'Join'))));
  }

  // ---------- main renderer ----------
  function render() {
    clearNav();
    const welcomed = store.get(`duracell:welcomed:${code}`);
    if (!welcomed) return renderWelcome();
    const open = st.openSection;
    if (open) {
      if (missed && missed.sid !== open.id) { /* keep notice until they start */ }
      if (st.submitted[open.id]) return renderWaiting(open);
      return renderSection(open);
    }
    // nothing open
    const drafts = st.sections.filter((s) => s.status === 'closed' && !st.submitted[s.id] && store.get(draftKey(s.id)));
    if (drafts.length) {
      const s = drafts[drafts.length - 1];
      missed = { sid: s.id, title: s.title };
      store.set(`duracell:missed:${code}`, missed);
      drafts.forEach((d) => store.del(draftKey(d.id)));
    }
    const allClosed = st.sections.every((s) => s.status === 'closed');
    if (allClosed) return renderFinished();
    const lastClosed = [...st.sections].reverse().find((s) => s.status === 'closed');
    if (lastClosed && st.submitted[lastClosed.id]) return renderWaiting(lastClosed);
    return renderLobby(lastClosed);
  }

  function renderWelcome() {
    const begin = h('button', { class: 'primary bigbtn', onclick: () => { store.set(`duracell:welcomed:${code}`, true); render(); } }, 'Begin');
    app.replaceChildren(h('div', { class: 'fade-in hero' }, brand(),
      h('h1', null, 'Welcome'),
      h('p', { class: 'lead' }, st.intro),
      st.aiNotice ? h('div', { class: 'notice' }, h('strong', null, 'About written answers. '), st.aiNotice) : null,
      h('div', { class: 'notice' }, h('strong', null, 'Privacy. '),
        'No name, email or phone number is needed. This browser keeps a random code so you can return to unfinished answers and so the same browser isn’t counted twice. It can’t stop someone answering again from another device, so please answer once.'),
      begin));
  }

  function renderLobby(lastClosed) {
    const msg = lastClosed
      ? `“${lastClosed.title}” is now closed. The next section will open shortly — keep this page open.`
      : 'The facilitator will open the first section shortly. Keep this page open — it will update by itself.';
    app.replaceChildren(h('div', { class: 'waiting fade-in' }, brand(),
      h('div', { class: 'glyph pulse' }, icon('clock')),
      h('h1', null, lastClosed ? 'Waiting for the next section' : 'You’re in'),
      missedNotice(),
      h('p', { class: 'lead' }, msg)));
  }

  function missedNotice() {
    if (!missed) return null;
    return h('p', { class: 'banner warn' }, `“${missed.title}” closed before your answers were sent, so they weren’t included.`);
  }

  function renderWaiting(section) {
    const isLast = section.index === st.sections.length - 1;
    app.replaceChildren(h('div', { class: 'waiting fade-in' }, brand(),
      h('div', { class: 'glyph' }, icon('check')),
      h('h1', null, 'Thank you!'),
      h('p', { class: 'lead' }, 'We’ll now review this section together. Keep this page open for the next section.'),
      isLast ? h('div', { class: 'notice' }, st.endNote) : null));
  }

  function renderFinished() {
    const any = Object.keys(st.submitted).length > 0;
    app.replaceChildren(h('div', { class: 'waiting fade-in' }, brand(),
      h('div', { class: 'glyph' }, icon('heart')),
      h('h1', null, any ? 'Thank you for sharing' : 'This conversation has finished'),
      missedNotice(),
      h('p', { class: 'lead' }, any ? 'All sections are now closed.' : 'All sections are now closed, so new answers can’t be accepted.'),
      h('div', { class: 'notice' }, st.endNote)));
  }

  // ---------- section flow ----------
  function isAnswered(q, a) {
    if (!a) return false;
    if (q.type === 'multi') return Array.isArray(a.v) && a.v.length > 0;
    if (q.type === 'text') return !!(a.text && a.text.trim());
    return a.v !== undefined && a.v !== null;
  }

  function renderSection(sec) {
    const d = getDraft(sec.id);
    const n = sec.questions.length;
    if (d.idx < 0) return renderSectionIntro(sec, d);
    if (d.idx >= n) return renderReview(sec, d);
    const q = sec.questions[d.idx];
    const a = d.answers[q.id];
    const go = (delta) => { d.idx = Math.max(-1, Math.min(n, d.idx + delta)); saveDraft(sec.id, d); render(); window.scrollTo(0, 0); };
    const update = (val) => {
      if (val === undefined) delete d.answers[q.id]; else d.answers[q.id] = val;
      saveDraft(sec.id, d);
      nextBtn.textContent = isAnswered(q, d.answers[q.id]) ? (d.idx === n - 1 ? 'Review' : 'Next') : 'Skip';
      clearBtn.classList.toggle('hidden', !isAnswered(q, d.answers[q.id]));
    };
    const clearBtn = h('button', { class: 'clear', type: 'button', onclick: () => { update(undefined); render(); } }, 'Clear my answer (skip this question)');
    clearBtn.classList.toggle('hidden', !isAnswered(q, a));

    app.replaceChildren(h('div', { class: 'fade-in' },
      h('div', { class: 'secthead' }, h('span', null, `Section ${sec.index + 1} · ${sec.title}`), h('span', null, `Question ${d.idx + 1} of ${n}`)),
      h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(n), 'aria-valuenow': String(d.idx + 1) }, h('span', { style: { width: `${((d.idx + 1) / n) * 100}%` } })),
      h('div', { class: 'qnum' }, `Q${q.num}`),
      h('h1', { class: 'qtext', id: 'qtext' }, q.text),
      q.help ? h('p', { class: 'qhelp' }, q.help) : null,
      renderInput(q, a, update),
      q.footnote ? h('p', { class: 'footnote' }, q.footnote) : null,
      clearBtn));

    const nextBtn = h('button', { class: 'primary', type: 'button', onclick: () => go(1) }, isAnswered(q, a) ? (d.idx === n - 1 ? 'Review' : 'Next') : 'Skip');
    setNav(h('button', { class: 'back', type: 'button', onclick: () => go(-1), 'aria-label': 'Back' }, '← Back'), nextBtn);
  }

  function renderSectionIntro(sec, d) {
    const earlierClosed = st.sections.filter((s) => s.index < sec.index && s.status === 'closed' && !st.submitted[s.id]);
    app.replaceChildren(h('div', { class: 'fade-in hero' }, brand(),
      h('div', { class: 'qnum' }, `Section ${sec.index + 1} of ${st.sections.length}`),
      h('h1', null, sec.title),
      sec.intro ? h('p', { class: 'lead' }, sec.intro) : null,
      earlierClosed.length && !missed ? h('p', { class: 'banner warn' }, `Earlier section${earlierClosed.length > 1 ? 's' : ''} (${earlierClosed.map((s) => s.title).join(', ')}) ${earlierClosed.length > 1 ? 'are' : 'is'} already closed, so you’ll start here.`) : null,
      missedNotice(),
      h('p', { class: 'muted' }, `${sec.questions.length} questions · every question is optional · you can go back and change answers before you submit.`)));
    setNav(h('button', { class: 'primary', type: 'button', onclick: () => {
      if (missed) { missed = null; store.del(`duracell:missed:${code}`); }
      d.idx = 0; saveDraft(sec.id, d); render(); window.scrollTo(0, 0);
    } }, 'Start section'));
  }

  function optButton({ checked, multi, disabled, label, sub, num, onClick }) {
    return h('button', {
      type: 'button', class: 'opt' + (multi ? ' multi' : ''), role: multi ? 'checkbox' : 'radio',
      'aria-checked': String(!!checked), 'aria-disabled': disabled ? 'true' : null, onclick: onClick,
    }, num != null ? h('span', { class: 'num' }, num) : h('span', { class: 'mark' }), h('span', { class: 'lbl' }, h('span', null, label), sub ? h('span', { class: 'sub' }, sub) : null));
  }

  function otherInput(q, a, onInput) {
    const inp = h('input', { type: 'text', class: 'othertext', maxlength: '200', placeholder: 'Please specify (optional)', 'aria-label': 'Other — please specify', value: (a && a.other) || '' });
    inp.addEventListener('input', () => onInput(inp.value));
    return inp;
  }

  function renderInput(q, a, update) {
    if (q.type === 'single') {
      const wrap = h('div', { class: 'opts', role: 'radiogroup', 'aria-labelledby': 'qtext' });
      for (const o of q.options) {
        const checked = a && a.v === o.id;
        wrap.appendChild(optButton({
          checked, label: o.label, sub: o.sub, onClick: () => {
            update(checked ? undefined : { v: o.id, other: o.other ? (a && a.other) || '' : undefined });
            render();
          },
        }));
        if (o.other && checked) wrap.appendChild(otherInput(q, a, (v) => update({ v: o.id, other: v })));
      }
      return wrap;
    }
    if (q.type === 'multi') {
      const sel = (a && a.v) || [];
      const atMax = q.max && sel.length >= q.max;
      const wrap = h('div', null);
      if (q.max) wrap.appendChild(h('p', { class: 'counter', 'aria-live': 'polite' }, `${sel.length} of ${q.max} selected`));
      const list = h('div', { class: 'opts', role: 'group', 'aria-labelledby': 'qtext' });
      for (const o of q.options) {
        const checked = sel.includes(o.id);
        list.appendChild(optButton({
          checked, multi: true, disabled: atMax && !checked, label: o.label, sub: o.sub, onClick: () => {
            let next;
            if (checked) next = sel.filter((x) => x !== o.id);
            else if (o.exclusive) next = [o.id];
            else {
              if (atMax) { window.DS.toast(`You can choose up to ${q.max}. Unselect one first.`); return; }
              const excl = q.options.filter((x) => x.exclusive).map((x) => x.id);
              next = sel.filter((x) => !excl.includes(x)).concat(o.id);
            }
            update(next.length ? { v: next, other: (a && a.other) || '' } : undefined);
            render();
          },
        }));
        if (o.other && checked) list.appendChild(otherInput(q, a, (v) => update({ v: sel, other: v })));
      }
      wrap.appendChild(list);
      return wrap;
    }
    if (q.type === 'rating' || q.type === 'agree') {
      const labels = q.type === 'agree' ? AGREE : q.scale.map((s) => s.label);
      const wrap = h('div', null);
      if (q.showVision && st.sibklVision) wrap.appendChild(h('div', { class: 'vision' }, h('b', null, 'SIBKL’s vision'), st.sibklVision));
      const list = h('div', { class: 'opts', role: 'radiogroup', 'aria-labelledby': 'qtext' });
      labels.forEach((label, i) => {
        const v = i + 1; const checked = a && a.v === v;
        list.appendChild(optButton({ checked, num: v, label, onClick: () => { update(checked ? undefined : { v }); render(); } }));
      });
      const extra = [];
      if (q.allowNA) extra.push(['na', NA]);
      if (q.allowDontKnow) extra.push(['dontknow', DK]);
      if (extra.length) list.appendChild(h('hr', { class: 'optsep' }));
      for (const [v, label] of extra) {
        const checked = a && a.v === v;
        list.appendChild(optButton({ checked, label, onClick: () => { update(checked ? undefined : { v }); render(); } }));
      }
      wrap.appendChild(list);
      return wrap;
    }
    // text
    const wrap = h('div', null);
    const ta = h('textarea', { maxlength: '2000', rows: '6', 'aria-labelledby': 'qtext', placeholder: q.placeholder || 'Type your answer (optional)' });
    ta.value = (a && a.text) || '';
    const cc = h('div', { class: 'charcount' }, `${ta.value.length} / 2000`);
    const vis = () => (a && a.visibility) || (d0.answers[q.id] && d0.answers[q.id].visibility) || 'leaders';
    const d0 = getDraft(st.openSection.id);
    ta.addEventListener('input', () => {
      cc.textContent = `${ta.value.length} / 2000`;
      const cur = getDraft(st.openSection.id).answers[q.id];
      update(ta.value.trim() || (cur && q.visibilityChoice) ? { text: ta.value, ...(q.visibilityChoice ? { visibility: (cur && cur.visibility) || 'leaders' } : {}) } : undefined);
    });
    wrap.append(ta, cc);
    if (q.visibilityChoice) {
      const current = vis();
      const group = h('div', { class: 'opts', role: 'radiogroup', 'aria-label': 'Who should see this answer?', style: { marginTop: '14px' } });
      const opts = [['leaders', 'For leaders to review privately', 'Not shown to the group'], ['group', 'Suitable for discussion with the group', 'May be shown on screen after the facilitator reviews it']];
      for (const [v, label, sub] of opts) {
        group.appendChild(optButton({
          checked: current === v, label, sub, onClick: () => {
            const cur = getDraft(st.openSection.id).answers[q.id] || { text: ta.value };
            update({ text: cur.text || ta.value, visibility: v });
            render();
          },
        }));
      }
      wrap.append(h('p', { class: 'qhelp', style: { margin: '18px 0 0' } }, 'Who should see this answer?'), group,
        h('p', { class: 'footnote' }, 'Because responses are anonymous, leaders can’t reply to you personally. If you’d like a response, please speak to a leader privately.'));
    }
    return wrap;
  }

  function answerSummary(q, a) {
    if (q.type === 'single') { const o = q.options.find((x) => x.id === a.v); return (o ? o.label.replace(/\s*\u2014\s*please specify$/i, '') : '') + (a.other ? ` — ${a.other}` : ''); }
    if (q.type === 'multi') return a.v.map((id) => ((q.options.find((x) => x.id === id) || {}).label || '').replace(/\s*\u2014\s*please specify$/i, '')).join(', ') + (a.other ? ` — ${a.other}` : '');
    if (q.type === 'rating' || q.type === 'agree') {
      if (a.v === 'na') return NA; if (a.v === 'dontknow') return 'Don’t know enough about SIBKL’s vision';
      return `${a.v} — ${q.type === 'agree' ? AGREE[a.v - 1] : q.scale[a.v - 1].label}`;
    }
    return a.text.trim() + (q.visibilityChoice ? ` (${a.visibility === 'group' ? 'for group discussion' : 'leaders only'})` : '');
  }

  function renderReview(sec, d) {
    const list = h('ul', { class: 'review' });
    sec.questions.forEach((q, i) => {
      const a = d.answers[q.id];
      const ans = isAnswered(q, a);
      list.appendChild(h('li', null,
        h('div', { class: 'rq' }, h('b', null, `Q${q.num}. ${q.text}`), h('div', { class: 'ra' + (ans ? '' : ' skipped') }, ans ? answerSummary(q, a) : 'Skipped')),
        h('button', { class: 'sm', type: 'button', disabled: sending, onclick: () => { d.idx = i; saveDraft(sec.id, d); render(); window.scrollTo(0, 0); } }, 'Edit')));
    });
    const answeredN = sec.questions.filter((q) => isAnswered(q, d.answers[q.id])).length;
    app.replaceChildren(h('div', { class: 'fade-in' },
      h('div', { class: 'secthead' }, h('span', null, `Section ${sec.index + 1} · ${sec.title}`), h('span', null, 'Review')),
      h('div', { class: 'progress' }, h('span', { style: { width: '100%' } })),
      h('h1', null, 'Ready to submit?'),
      h('p', { class: 'muted' }, `You answered ${answeredN} of ${sec.questions.length}. Skipped questions are recorded as skipped, not as a neutral answer.`),
      sendError ? h('div', { class: 'banner ' + (sendError.kind === 'network' ? 'warn' : 'err'), role: 'alert' }, sendError.msg) : null,
      list,
      sec.index === st.sections.length - 1 ? h('div', { class: 'notice' }, st.endNote) : null));
    const submitBtn = h('button', { class: 'primary', type: 'button', disabled: sending, onclick: () => submit(sec) }, sending ? 'Sending…' : (sendError && sendError.kind === 'network' ? 'Try again' : 'Submit section'));
    setNav(h('button', { class: 'back', type: 'button', disabled: sending, onclick: () => { d.idx = sec.questions.length - 1; saveDraft(sec.id, d); render(); } }, '← Back'), submitBtn);
  }

  function payload(sec, d) {
    const out = {};
    for (const q of sec.questions) {
      const a = d.answers[q.id];
      if (!isAnswered(q, a)) continue;
      if (q.type === 'single') out[q.id] = { v: a.v, ...(a.other && a.other.trim() ? { other: a.other.trim() } : {}) };
      else if (q.type === 'multi') out[q.id] = { v: a.v, ...(a.other && a.other.trim() ? { other: a.other.trim() } : {}) };
      else if (q.type === 'text') out[q.id] = { text: a.text.trim(), ...(q.visibilityChoice ? { visibility: a.visibility === 'group' ? 'group' : 'leaders' } : {}) };
      else out[q.id] = { v: a.v };
    }
    return out;
  }

  async function submit(sec, attempt = 0) {
    if (sending) return; // guards against repeated taps
    clearTimeout(retryTimer);
    const d = getDraft(sec.id);
    sending = true; sendError = null; render();
    try {
      await api('POST', `/api/p/${encodeURIComponent(code)}/submit`, { sectionId: sec.id, answers: payload(sec, d), idemKey: d.idemKey }, { headers: { 'x-participant-id': pid } });
      sending = false;
      store.del(draftKey(sec.id));
      st.submitted[sec.id] = true;
      render();
      refresh();
    } catch (e) {
      sending = false;
      if (e.network || e.status >= 500 || e.status === 429) {
        const wait = Math.min(15000, 2000 * (attempt + 1));
        sendError = { kind: 'network', msg: `We couldn’t reach the server. Your answers are saved on this phone — trying again in ${Math.round(wait / 1000)} seconds…` };
        retryTimer = setTimeout(() => submit(sec, attempt + 1), wait);
      } else if (e.status === 409) {
        missed = { sid: sec.id, title: sec.title };
        store.set(`duracell:missed:${code}`, missed);
        store.del(draftKey(sec.id));
        await refresh();
        return;
      } else {
        sendError = { kind: 'validation', msg: e.message };
      }
      render();
    }
  }

  // ---------- nav bar ----------
  let navEl = null;
  function clearNav() { if (navEl) { navEl.remove(); navEl = null; } }
  function setNav(...btns) {
    clearNav();
    navEl = h('div', { class: 'navbar' }, h('div', { class: 'in' }, ...btns));
    document.body.appendChild(navEl);
  }

  // ---------- live updates ----------
  if (code) {
    live(`/api/p/${encodeURIComponent(code)}/events?pid=${encodeURIComponent(pid)}`, () => refresh(), (ok) => { if (ok) refresh(); else setConn(false); });
    setInterval(refresh, 20000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    window.addEventListener('online', refresh);
  }
  refresh();
})();
