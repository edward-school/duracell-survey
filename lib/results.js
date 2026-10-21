'use strict';
const { db } = require('./db');
const { AGREE_SCALE, NA_LABEL, DONTKNOW_LABEL } = require('./survey');

const SMALL_N = 5;

function loadSession(id) {
  const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!s) return null;
  return {
    id: s.id, code: s.code, name: s.name, isDemo: !!s.is_demo, aiEnabled: !!s.ai_enabled,
    slideKey: s.slide_key, createdAt: s.created_at, updatedAt: s.updated_at,
    survey: JSON.parse(s.survey_json), status: JSON.parse(s.status_json),
  };
}

function loadData(sessionId) {
  const session = loadSession(sessionId);
  if (!session) return null;
  const subs = db.prepare('SELECT id, section_id, answers_json, created_at FROM submissions WHERE session_id = ? ORDER BY created_at, id').all(sessionId)
    .map((r) => ({ id: r.id, sectionId: r.section_id, answers: JSON.parse(r.answers_json), createdAt: r.created_at }));
  const mod = new Map();
  for (const m of db.prepare('SELECT * FROM moderation WHERE session_id = ?').all(sessionId)) {
    mod.set(m.submission_id + '|' + m.item_key, { hidden: !!m.hidden, displayText: m.display_text, excerpt: !!m.excerpt });
  }
  const analyses = new Map();
  for (const a of db.prepare('SELECT * FROM analyses WHERE session_id = ?').all(sessionId)) {
    analyses.set(a.question_id, {
      method: a.method, status: a.status, summary: a.summary, error: a.error,
      approved: !!a.approved, stale: !!a.stale, generatedAt: a.generated_at,
    });
  }
  const themes = new Map();
  for (const t of db.prepare('SELECT * FROM themes WHERE session_id = ? ORDER BY sort, rowid').all(sessionId)) {
    if (!themes.has(t.question_id)) themes.set(t.question_id, []);
    themes.get(t.question_id).push({ id: t.id, label: t.label, kind: t.kind, responseIds: JSON.parse(t.response_ids_json) });
  }
  const notes = new Map();
  for (const n of db.prepare('SELECT * FROM notes WHERE session_id = ?').all(sessionId)) {
    notes.set(n.section_id, {
      observations: n.observations, decisions: n.decisions, followups: n.followups,
      actions: JSON.parse(n.actions_json), showOnSlide: !!n.show_on_slide,
    });
  }
  return { session, subs, mod, analyses, themes, notes };
}

const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0);

function textResponses(q, sectionSubs, mod) {
  const out = [];
  for (const s of sectionSubs) {
    const a = s.answers[q.id];
    if (!a || !a.text) continue;
    const m = mod.get(s.id + '|' + q.id) || {};
    const visibility = q.visibilityChoice ? a.visibility || 'leaders' : 'group';
    const hidden = !!m.hidden;
    out.push({
      id: s.id, text: a.text, display: m.displayText || a.text, edited: !!m.displayText,
      hidden, visibility, excerpt: !!m.excerpt, projectable: !hidden && visibility === 'group',
    });
  }
  return out;
}

function otherTexts(q, sectionSubs, mod) {
  const out = [];
  for (const s of sectionSubs) {
    const a = s.answers[q.id];
    if (!a || !a.other) continue;
    const key = q.id + ':other';
    const m = mod.get(s.id + '|' + key) || {};
    out.push({ id: s.id, key, text: a.other, display: m.displayText || a.other, edited: !!m.displayText, hidden: !!m.hidden, excerpt: !!m.excerpt });
  }
  return out;
}

// Full result for one question. `host` = include private material for the facilitator.
function questionResult(data, section, q, { host }) {
  const sectionSubs = data.subs.filter((s) => s.sectionId === section.id);
  const submittedN = sectionSubs.length;
  const base = { id: q.id, num: q.num, type: q.type, text: q.text, help: q.help || '', prompt: q.prompt || '', sectionId: section.id, sectionTitle: section.title, submittedN };

  if (q.type === 'single' || q.type === 'multi') {
    const answered = sectionSubs.filter((s) => s.answers[q.id]);
    const n = answered.length;
    const rows = q.options.map((o) => {
      const c = answered.filter((s) => (q.type === 'single' ? s.answers[q.id].v === o.id : s.answers[q.id].v.includes(o.id))).length;
      return { id: o.id, label: o.other ? o.label.replace(/\s*[\u2014-]\s*please specify\s*$/i, '') : o.label, sub: o.sub || '', other: !!o.other, count: c, pct: pct(c, n) };
    });
    const others = otherTexts(q, sectionSubs, data.mod);
    const r = { ...base, answeredN: n, skippedN: submittedN - n, rows, max: q.max || null };
    if (q.type === 'multi') r.note = q.max
      ? `Participants could choose up to ${q.max} options; percentages may exceed 100% in total.`
      : 'Participants could select more than one option; percentages may exceed 100% in total.';
    r.otherShown = others.filter((o) => o.excerpt && !o.hidden).map((o) => o.display);
    if (host) r.otherTexts = others;
    return r;
  }

  if (q.type === 'rating' || q.type === 'agree') {
    const scale = q.type === 'agree' ? AGREE_SCALE : q.scale;
    const vals = sectionSubs.map((s) => s.answers[q.id]).filter(Boolean).map((a) => a.v);
    const numeric = vals.filter((v) => typeof v === 'number');
    const naN = vals.filter((v) => v === 'na').length;
    const dkN = vals.filter((v) => v === 'dontknow').length;
    const dist = scale.map((s) => ({ v: s.v, label: s.label, count: numeric.filter((v) => v === s.v).length }));
    dist.forEach((d) => (d.pct = pct(d.count, numeric.length)));
    const avg = numeric.length ? Math.round((numeric.reduce((a, b) => a + b, 0) / numeric.length) * 10) / 10 : null;
    const top2 = numeric.filter((v) => v >= 4).length;
    return {
      ...base, scaleType: q.type, answeredN: vals.length, ratedN: numeric.length, skippedN: submittedN - vals.length,
      dist, avg, top2Pct: numeric.length ? pct(top2, numeric.length) : null,
      naN, naLabel: q.allowNA ? NA_LABEL : null, dkN, dkLabel: q.allowDontKnow ? DONTKNOW_LABEL : null,
      vision: q.showVision ? data.session.survey.sibklVision || '' : undefined,
    };
  }

  // text
  const responses = textResponses(q, sectionSubs, data.mod);
  const projectable = new Set(responses.filter((r) => r.projectable).map((r) => r.id));
  const analysis = data.analyses.get(q.id) || { method: null, status: 'idle', summary: null, approved: false, stale: false };
  const themes = (data.themes.get(q.id) || []).map((t) => {
    const visibleIds = t.responseIds.filter((id) => projectable.has(id));
    return { ...t, visibleIds, count: visibleIds.length }; // distinct respondents (one response per respondent per question)
  });
  const projThemes = themes.filter((t) => t.count > 0).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .map((t) => ({ label: t.label, kind: t.kind, count: t.count }));
  const r = {
    ...base, answeredN: responses.length, skippedN: submittedN - responses.length,
    projectableN: projectable.size,
    leadersOnlyN: responses.filter((x) => x.visibility === 'leaders').length,
    hiddenN: responses.filter((x) => x.hidden).length,
    small: projectable.size > 0 && projectable.size < SMALL_N,
    method: analysis.method, approved: analysis.approved,
    summary: analysis.approved && !analysis.stale ? analysis.summary || '' : '',
    summaryStale: !!analysis.stale,
    themes: analysis.approved ? projThemes : [],
    excerpts: analysis.approved ? responses.filter((x) => x.projectable && x.excerpt).map((x) => x.display) : [],
    visibilityChoice: !!q.visibilityChoice,
  };
  if (host) {
    r.responses = responses;
    r.analysis = analysis;
    r.allThemes = themes;
    r.previewThemes = projThemes;
    r.ungroupedIds = [...projectable].filter((id) => !themes.some((t) => t.visibleIds.includes(id)));
  }
  return r;
}

function hostResults(sessionId) {
  const data = loadData(sessionId);
  if (!data) return null;
  const sections = data.session.survey.sections.map((sec) => ({
    id: sec.id, title: sec.title, status: data.session.status.sections[sec.id],
    submittedN: data.subs.filter((s) => s.sectionId === sec.id).length,
    questions: sec.questions.map((q) => questionResult(data, sec, q, { host: true })),
    notes: data.notes.get(sec.id) || emptyNotes(),
  }));
  return { session: publicSessionInfo(data.session), sections };
}

function emptyNotes() {
  return { observations: '', decisions: '', followups: '', actions: [], showOnSlide: true };
}

function publicSessionInfo(s) {
  return { id: s.id, code: s.code, name: s.name, isDemo: s.isDemo, status: s.status };
}

// Slides for projection. Only closed sections produce results slides. Never includes private content.
function buildSlides(sessionId) {
  const data = loadData(sessionId);
  if (!data) return null;
  const { session } = data;
  const slides = [{ key: 'title', type: 'title', name: session.name, isDemo: session.isDemo,
    sections: session.survey.sections.map((s) => ({ title: s.title, status: session.status.sections[s.id] })) }];
  session.survey.sections.forEach((sec, i) => {
    if (session.status.sections[sec.id] !== 'closed') return;
    const n = data.subs.filter((s) => s.sectionId === sec.id).length;
    slides.push({ key: sec.id + ':divider', type: 'divider', sectionNum: i + 1, sectionTitle: sec.title, submittedN: n, questionCount: sec.questions.length });
    for (const q of sec.questions) {
      const r = questionResult(data, sec, q, { host: false });
      slides.push({ key: sec.id + ':' + q.id, type: 'question', sectionNum: i + 1, result: r });
    }
    const notes = data.notes.get(sec.id) || emptyNotes();
    slides.push({
      key: sec.id + ':discussion', type: 'discussion', sectionNum: i + 1, sectionTitle: sec.title,
      prompts: sec.discussionPrompts || [],
      notes: notes.showOnSlide ? { decisions: notes.decisions, actions: notes.actions.filter((a) => a.action) } : null,
    });
  });
  return { session: publicSessionInfo(session), slides, slideKey: session.slideKey || 'title' };
}

module.exports = { loadSession, loadData, hostResults, buildSlides, questionResult, emptyNotes, SMALL_N };
