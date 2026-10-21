'use strict';
const { loadData, hostResults } = require('./results');
const { AGREE_SCALE, NA_LABEL, DONTKNOW_LABEL } = require('./survey');

const TZ = 'Asia/Kuala_Lumpur';
function myt(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-MY', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) + ' MYT';
}

function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formula injection
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const csvRow = (arr) => arr.map(csvCell).join(',');

function answerToText(q, a) {
  if (!a) return '';
  if (q.type === 'single') {
    const o = q.options.find((x) => x.id === a.v);
    return (o ? o.label : a.v) + (a.other ? ` (${a.other})` : '');
  }
  if (q.type === 'multi') {
    return a.v.map((id) => q.options.find((x) => x.id === id)?.label || id).join('; ') + (a.other ? ` (Other: ${a.other})` : '');
  }
  if (q.type === 'rating' || q.type === 'agree') {
    if (a.v === 'na') return NA_LABEL;
    if (a.v === 'dontknow') return DONTKNOW_LABEL;
    const scale = q.type === 'agree' ? AGREE_SCALE : q.scale;
    return `${a.v} - ${scale.find((s) => s.v === a.v)?.label || ''}`;
  }
  return a.text;
}

// General CSV: one row per submission per section, with a per-section row number only
// (no identifiers, and rows are not linked across sections). Leaders-only text is withheld.
function responsesCsv(sessionId) {
  const data = loadData(sessionId);
  const lines = [csvRow(['session', 'section', 'response_no', 'submitted_at_MYT', 'question_no', 'question', 'answer', 'note'])];
  for (const sec of data.session.survey.sections) {
    const subs = data.subs.filter((s) => s.sectionId === sec.id);
    subs.forEach((s, i) => {
      for (const q of sec.questions) {
        const a = s.answers[q.id];
        let ans = answerToText(q, a);
        let note = a ? '' : 'skipped';
        if (q.visibilityChoice && a && (a.visibility || 'leaders') === 'leaders') {
          ans = '';
          note = 'leaders-only response withheld (see private export)';
        }
        lines.push(csvRow([data.session.name, sec.title, i + 1, myt(s.createdAt), q.num, q.text, ans, note]));
      }
    });
  }
  return '﻿' + lines.join('\r\n');
}

function privateCsv(sessionId) {
  const data = loadData(sessionId);
  const lines = [csvRow(['PRIVATE - FOR LEADERS ONLY. Do not share or project.']),
    csvRow(['session', 'question_no', 'question', 'visibility', 'response', 'hidden_from_projection', 'submitted_at_MYT'])];
  for (const sec of data.session.survey.sections) {
    for (const q of sec.questions.filter((x) => x.type === 'text')) {
      for (const s of data.subs.filter((x) => x.sectionId === sec.id)) {
        const a = s.answers[q.id];
        if (!a || !a.text) continue;
        const vis = q.visibilityChoice ? a.visibility || 'leaders' : 'group';
        const m = data.mod.get(s.id + '|' + q.id) || {};
        if (vis !== 'leaders' && !m.hidden) continue; // private export = leaders-only + hidden items
        lines.push(csvRow([data.session.name, q.num, q.text, vis === 'leaders' ? 'For leaders to review privately' : 'Group (hidden by facilitator)', a.text, m.hidden ? 'yes' : 'no', myt(s.createdAt)]));
      }
    }
  }
  return '﻿' + lines.join('\r\n');
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function bars(rows, denomLabel) {
  return `<table class="bars"><tbody>${rows.map((r) => `<tr><td>${esc(r.label)}</td><td class="n">${r.count}</td><td class="n">${r.pct}%</td><td class="b"><span style="width:${r.pct}%"></span></td></tr>`).join('')}</tbody></table>${denomLabel ? `<p class="small">${esc(denomLabel)}</p>` : ''}`;
}

// Readable meeting summary. Uses only projectable data (approved themes, group-visible content).
function summaryHtml(sessionId) {
  const res = hostResults(sessionId);
  const data = loadData(sessionId);
  const s = data.session;
  const parts = [];
  parts.push(`<h1>${esc(s.name)}</h1><p class="meta">Duracell family conversation · Summary generated ${esc(myt(new Date().toISOString()))}${s.isDemo ? ' · <strong>DEMO SESSION — SAMPLE DATA</strong>' : ''}</p>`);
  parts.push('<p class="meta">Responses were anonymous. Leaders-only responses and responses hidden by the facilitator are not included in this summary.</p>');
  for (const sec of res.sections) {
    parts.push(`<h2>${esc(sec.title)}</h2><p class="meta">${sec.submittedN} people submitted this section · status: ${esc(sec.status)}</p>`);
    for (const q of sec.questions) {
      parts.push(`<h3>Q${q.num}. ${esc(q.text)}</h3><p class="meta">${q.answeredN} answered · ${q.skippedN} skipped</p>`);
      if (q.type === 'single' || q.type === 'multi') {
        parts.push(bars(q.rows, q.note || 'Percentages are of people who answered this question.'));
        if (q.otherShown.length) parts.push(`<p class="small">“Other” answers shown: ${q.otherShown.map(esc).join('; ')}</p>`);
      } else if (q.type === 'rating' || q.type === 'agree') {
        parts.push(bars(q.dist.map((d) => ({ label: `${d.v} – ${d.label}`, count: d.count, pct: d.pct })), `Percentages are of the ${q.ratedN} people who gave a 1–5 answer.`));
        parts.push(`<p class="small">Average: ${q.avg ?? '—'} · Selecting 4 or 5: ${q.top2Pct ?? '—'}%${q.naLabel ? ` · ${esc(q.naLabel)}: ${q.naN}` : ''}${q.dkLabel ? ` · “Don’t know enough about the vision”: ${q.dkN}` : ''} · Skipped: ${q.skippedN}</p>`);
      } else {
        if (!q.approved) { parts.push('<p class="small"><em>Themes not yet approved by the facilitator.</em></p>'); continue; }
        const label = q.method === 'ai' ? 'AI-assisted themes, reviewed by the facilitator' : q.method === 'keyword' ? 'Keyword analysis (word counts, not meaning), reviewed by the facilitator' : 'Themes grouped by the facilitator';
        parts.push(`<p class="small">${esc(label)}. ${q.projectableN} written responses included.${q.small ? ' Limited responses — avoid broad conclusions.' : ''}</p>`);
        if (q.summary) parts.push(`<p>${esc(q.summary)}</p>`);
        if (q.themes.length) parts.push(`<ul>${q.themes.map((t) => `<li>${esc(t.label)} <span class="small">(${esc(t.kind)}) — ${t.count} ${t.count === 1 ? 'mention' : 'mentions'}</span></li>`).join('')}</ul>`);
        if (q.excerpts.length) parts.push(`<p class="small">${q.visibilityChoice ? 'Questions for group discussion' : 'Approved excerpts'}:</p><ul>${q.excerpts.map((x) => `<li>“${esc(x)}”</li>`).join('')}</ul>`);
      }
    }
    const n = sec.notes;
    parts.push(`<h3>Discussion notes — ${esc(sec.title)}</h3>`);
    const block = (t, v) => (v && v.trim() ? `<h4>${t}</h4><p class="pre">${esc(v)}</p>` : '');
    parts.push(block('Key observations', n.observations) + block('Decisions', n.decisions) + block('Items requiring follow-up', n.followups) || '<p class="small">No notes recorded.</p>');
    const acts = n.actions.filter((a) => a.action);
    if (acts.length) parts.push(`<h4>Actions</h4><table class="acts"><thead><tr><th>Action</th><th>Owner</th><th>Review date</th></tr></thead><tbody>${acts.map((a) => `<tr><td>${esc(a.action)}</td><td>${esc(a.owner)}</td><td>${esc(a.reviewDate)}</td></tr>`).join('')}</tbody></table>`);
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(s.name)} — meeting summary</title>
<style>body{font:16px/1.55 Georgia,'Iowan Old Style',serif;color:#2b2622;background:#fbf7f1;max-width:820px;margin:0 auto;padding:32px 20px}h1{font-size:30px;margin:0 0 4px}h2{margin-top:40px;border-bottom:2px solid #c2643c;padding-bottom:4px}h3{margin:26px 0 2px;font-size:18px}h4{margin:12px 0 2px;font-size:15px}.meta,.small{color:#6b625a;font-size:14px;font-family:system-ui,sans-serif}.pre{white-space:pre-wrap}table.bars{border-collapse:collapse;width:100%;font:14px system-ui,sans-serif}table.bars td{padding:3px 6px;border-bottom:1px solid #eadfd2}td.n{text-align:right;width:48px}td.b{width:35%}td.b span{display:block;height:10px;background:#c2643c;border-radius:5px}table.acts{border-collapse:collapse;width:100%;font:14px system-ui,sans-serif}table.acts th,table.acts td{border:1px solid #eadfd2;padding:6px;text-align:left}@media print{body{background:#fff}}</style></head><body>${parts.join('\n')}</body></html>`;
}

module.exports = { responsesCsv, privateCsv, summaryHtml, myt };
