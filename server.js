'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const QRCode = require('qrcode');
const { db, tx, DB_PATH } = require('./lib/db');
const { defaultSurvey, validateAnswers, applySurveyEdit, findQuestion, ValidationError } = require('./lib/survey');
const { loadSession, hostResults, buildSlides } = require('./lib/results');
const themesLib = require('./lib/themes');
const { aiConfig, runAnalysis, KINDS, newId } = themesLib;
const exporter = require('./lib/export');
const demo = require('./lib/demo');

const PORT = parseInt(process.env.PORT || '3000', 10);
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const IS_PROD = process.env.NODE_ENV === 'production';

// ---------- secrets ----------
function kvGet(k) { return db.prepare('SELECT v FROM kv WHERE k = ?').get(k)?.v; }
function kvSet(k, v) { db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, v); }
const SERVER_SECRET = process.env.SERVER_SECRET || kvGet('server_secret') || (() => { const s = crypto.randomBytes(32).toString('hex'); kvSet('server_secret', s); return s; })();
let HOST_PASSWORD = process.env.HOST_PASSWORD || '';
if (!HOST_PASSWORD) {
  if (IS_PROD) { console.error('HOST_PASSWORD must be set in production.'); process.exit(1); }
  HOST_PASSWORD = kvGet('dev_host_password') || (() => { const p = crypto.randomBytes(6).toString('base64url'); kvSet('dev_host_password', p); return p; })();
  console.log(`\n  [dev] HOST_PASSWORD not set. Temporary facilitator password: ${HOST_PASSWORD}\n`);
}
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(sha(a)); const y = Buffer.from(sha(b)); return crypto.timingSafeEqual(x, y); };

// ---------- live updates (Server-Sent Events) ----------
const channels = new Map(); // sessionId -> Set<{res, role, pid}>
function sseOpen(req, res, sessionId, role, pid) {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  const client = { res, role, pid };
  if (!channels.has(sessionId)) channels.set(sessionId, new Set());
  channels.get(sessionId).add(client);
  const hb = setInterval(() => res.write(': hb\n\n'), 20000);
  req.on('close', () => { clearInterval(hb); channels.get(sessionId)?.delete(client); if (role === 'participant') notify(sessionId, 'presence'); });
  if (role === 'participant') notify(sessionId, 'presence');
}
function presenceCount(sessionId) {
  const set = channels.get(sessionId);
  if (!set) return 0;
  return new Set([...set].filter((c) => c.role === 'participant').map((c) => c.pid)).size;
}
// types: stage (everyone), counts|presence|results (host), slides|slide (host + present)
function notify(sessionId, type) {
  const set = channels.get(sessionId);
  if (!set) return;
  const msg = `event: update\ndata: ${JSON.stringify({ type, presence: undefined })}\n\n`;
  for (const c of set) {
    if (c.role === 'participant' && type !== 'stage') continue;
    if (c.role === 'present' && !['stage', 'slides', 'slide'].includes(type)) continue;
    if (c.role === 'host' && type === 'presence') { c.res.write(`event: update\ndata: ${JSON.stringify({ type, presence: presenceCount(sessionId) })}\n\n`); continue; }
    c.res.write(msg);
  }
}

// ---------- simple rate limiter ----------
const buckets = new Map();
function rateLimit(name, limit, windowMs) {
  return (req, res, next) => {
    const key = name + '|' + req.ip;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.reset < now) { b = { n: 0, reset: now + windowMs }; buckets.set(key, b); }
    if (++b.n > limit) return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
    next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k); }, 60000).unref();

// ---------- app ----------
const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  next();
});
app.use(express.json({ limit: '200kb' }));

const nowIso = () => new Date().toISOString();
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 6; i++) c += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    if (!db.prepare('SELECT 1 FROM sessions WHERE code = ?').get(c)) return c;
  }
}
function joinUrl(req, code) {
  const base = PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  return `${base}/j/${code}`;
}
function sessionByCode(code) {
  const r = db.prepare('SELECT id FROM sessions WHERE code = ?').get(String(code || '').toUpperCase().trim());
  return r ? loadSession(r.id) : null;
}
function saveStatus(id, status) { db.prepare('UPDATE sessions SET status_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(status), nowIso(), id); }
function saveSurvey(id, survey) { db.prepare('UPDATE sessions SET survey_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(survey), nowIso(), id); }

// ---------- participant API (no account; anonymous browser id) ----------
const PID_RE = /^[A-Za-z0-9-]{16,64}$/;
function participantHash(sessionId, pid) { return sha(SERVER_SECRET + '|' + sessionId + '|' + pid); }

function participantView(s, pid) {
  const submitted = {};
  if (pid) {
    const h = participantHash(s.id, pid);
    for (const r of db.prepare('SELECT section_id FROM submissions WHERE session_id = ? AND participant_hash = ?').all(s.id, h)) submitted[r.section_id] = true;
  }
  const openIdx = s.survey.sections.findIndex((sec) => s.status.sections[sec.id] === 'open');
  let openSection = null;
  if (openIdx >= 0) {
    const sec = s.survey.sections[openIdx];
    openSection = {
      id: sec.id, index: openIdx, title: sec.title, intro: sec.intro || '',
      questions: sec.questions.map(({ prompt, ...q }) => q), // discussion prompts are facilitator-only
    };
  }
  const ai = aiConfig();
  return {
    session: { code: s.code, name: s.name, isDemo: s.isDemo },
    intro: s.survey.intro,
    aiNotice: ai.available && s.aiEnabled
      ? 'Written answers will be sent to an external AI service (Anthropic’s Claude) to help group them into themes for discussion. Only the text you write is sent — no names or device identifiers. The facilitator reviews all themes before anything is shown.'
      : null,
    endNote: s.survey.endNote,
    sibklVision: s.survey.sibklVision || '',
    sections: s.survey.sections.map((sec, i) => ({ id: sec.id, index: i, title: sec.title, status: s.status.sections[sec.id], questionCount: sec.questions.length })),
    openSection,
    submitted,
  };
}

app.get('/api/p/:code/state', (req, res) => {
  const s = sessionByCode(req.params.code);
  if (!s) return res.status(404).json({ error: 'We couldn’t find a session with that code.' });
  const pid = req.get('x-participant-id');
  res.set('Cache-Control', 'no-store');
  res.json(participantView(s, pid && PID_RE.test(pid) ? pid : null));
});

app.get('/api/p/:code/events', (req, res) => {
  const s = sessionByCode(req.params.code);
  if (!s) return res.status(404).end();
  const pid = String(req.query.pid || '');
  sseOpen(req, res, s.id, 'participant', PID_RE.test(pid) ? participantHash(s.id, pid) : 'anon-' + crypto.randomUUID());
});

app.post('/api/p/:code/submit', rateLimit('submit', 300, 60000), (req, res) => {
  const s = sessionByCode(req.params.code);
  if (!s) return res.status(404).json({ error: 'Session not found.' });
  const pid = req.get('x-participant-id');
  if (!pid || !PID_RE.test(pid)) return res.status(400).json({ error: 'Missing browser identifier. Please refresh the page.' });
  const { sectionId, answers, idemKey } = req.body || {};
  if (typeof idemKey !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(idemKey)) return res.status(400).json({ error: 'Invalid submission key.' });
  const section = s.survey.sections.find((x) => x.id === sectionId);
  if (!section) return res.status(400).json({ error: 'Unknown section.' });
  const h = participantHash(s.id, pid);
  const existing = db.prepare('SELECT idem_key FROM submissions WHERE session_id = ? AND section_id = ? AND participant_hash = ?').get(s.id, sectionId, h);
  if (existing) return res.json({ ok: true, duplicate: existing.idem_key === idemKey, alreadySubmitted: existing.idem_key !== idemKey });
  if (s.status.sections[sectionId] !== 'open') return res.status(409).json({ error: 'closed', message: 'This section is closed, so new answers can’t be accepted.' });
  let clean;
  try { clean = validateAnswers(section, answers); } catch (e) {
    if (e instanceof ValidationError) return res.status(400).json({ error: e.message });
    throw e;
  }
  try {
    db.prepare('INSERT INTO submissions (id, session_id, section_id, participant_hash, idem_key, answers_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(newId(), s.id, sectionId, h, idemKey, JSON.stringify(clean), nowIso());
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.json({ ok: true, duplicate: true });
    throw e;
  }
  notify(s.id, 'counts');
  res.json({ ok: true });
});

// ---------- host auth ----------
const TOKEN_TTL = 1000 * 60 * 60 * 24 * 7;
function parseCookies(req) {
  const out = {};
  for (const part of (req.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function isHost(req) {
  const t = parseCookies(req).dh;
  if (!t) return false;
  const row = db.prepare('SELECT expires_at FROM host_tokens WHERE token_hash = ?').get(sha(t));
  return !!row && row.expires_at > Date.now();
}
function requireHost(req, res, next) {
  if (!isHost(req)) return res.status(401).json({ error: 'Facilitator login required.' });
  if (req.method !== 'GET' && req.get('x-host-request') !== '1') return res.status(403).json({ error: 'Bad request origin.' });
  next();
}
app.post('/api/host/login', rateLimit('login', 10, 15 * 60000), (req, res) => {
  const pw = String(req.body?.password || '');
  if (!pw || !safeEq(pw, HOST_PASSWORD)) return res.status(401).json({ error: 'That password isn’t right.' });
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('DELETE FROM host_tokens WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO host_tokens (token_hash, expires_at) VALUES (?, ?)').run(sha(token), Date.now() + TOKEN_TTL);
  res.set('Set-Cookie', `dh=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TOKEN_TTL / 1000}${req.secure ? '; Secure' : ''}`);
  res.json({ ok: true });
});
app.post('/api/host/logout', (req, res) => {
  const t = parseCookies(req).dh;
  if (t) db.prepare('DELETE FROM host_tokens WHERE token_hash = ?').run(sha(t));
  res.set('Set-Cookie', 'dh=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});
app.get('/api/host/me', (req, res) => res.json({ host: isHost(req) }));

const host = express.Router();
host.use(requireHost);
app.use('/api/host', host);

host.get('/sessions', (req, res) => {
  const rows = db.prepare('SELECT id, code, name, is_demo, status_json, created_at FROM sessions ORDER BY created_at DESC').all();
  res.json(rows.map((r) => ({ id: r.id, code: r.code, name: r.name, isDemo: !!r.is_demo, status: JSON.parse(r.status_json), createdAt: r.created_at, createdAtMyt: exporter.myt(r.created_at) })));
});

function freshStatus(survey) {
  return { sections: Object.fromEntries(survey.sections.map((s) => [s.id, 'pending'])), times: {} };
}
host.post('/sessions', (req, res) => {
  const isDemoS = !!req.body?.demo;
  let name = String(req.body?.name || '').trim().slice(0, 80);
  if (!name) name = isDemoS ? 'Demo — sample data' : 'Duracell family meeting';
  if (isDemoS && !/demo/i.test(name)) name = 'DEMO — ' + name;
  const survey = defaultSurvey();
  const id = newId();
  const code = (isDemoS ? 'D' : '') + newCode().slice(isDemoS ? 1 : 0);
  db.prepare('INSERT INTO sessions (id, code, name, is_demo, survey_json, status_json, ai_enabled, slide_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, code, name, isDemoS ? 1 : 0, JSON.stringify(survey), JSON.stringify(freshStatus(survey)), aiConfig().available ? 1 : 0, 'title', nowIso(), nowIso());
  res.json({ id, code });
});

function getSessionOr404(req, res) {
  const s = loadSession(req.params.id);
  if (!s) { res.status(404).json({ error: 'Session not found.' }); return null; }
  return s;
}
function counts(sessionId) {
  const out = {};
  for (const r of db.prepare('SELECT section_id, COUNT(*) n FROM submissions WHERE session_id = ? GROUP BY section_id').all(sessionId)) out[r.section_id] = r.n;
  return out;
}

host.get('/s/:id', (req, res) => {
  const s = getSessionOr404(req, res); if (!s) return;
  const ai = aiConfig();
  res.json({ session: { ...s, createdAtMyt: exporter.myt(s.createdAt) }, counts: counts(s.id), presence: presenceCount(s.id), ai: { available: ai.available, model: ai.available ? ai.model : null }, joinUrl: joinUrl(req, s.code) });
});

host.get('/s/:id/events', (req, res) => {
  const s = getSessionOr404(req, res); if (!s) return;
  sseOpen(req, res, s.id, req.query.role === 'present' ? 'present' : 'host');
});

host.get('/s/:id/qr.svg', async (req, res) => {
  const s = getSessionOr404(req, res); if (!s) return;
  const svg = await QRCode.toString(joinUrl(req, s.code), { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#2b2622', light: '#ffffff' } });
  res.type('image/svg+xml').send(svg);
});

host.put('/s/:id/survey', (req, res) => {
  const s = getSessionOr404(req, res); if (!s) return;
  try {
    const next = applySurveyEdit(s.survey, req.body?.survey, s.status.sections);
    saveSurvey(s.id, next);
  } catch (e) {
    if (e instanceof ValidationError) return res.status(400).json({ error: e.message });
    throw e;
  }
  notify(s.id, 'stage'); notify(s.id, 'slides');
  res.json({ ok: true });
});

host.put('/s/:id/settings', (req, res) => {
  const s = getSessionOr404(req, res); if (!s) return;
  const b = req.body || {};
  if (typeof b.name === 'string') {
    const name = b.name.trim().slice(0, 80);
    if (name) db.prepare('UPDATE sessions SET name = ? WHERE id = ?').run(s.isDemo && !/demo/i.test(name) ? 'DEMO — ' + name : name, s.id);
  }
  if (typeof b.aiEnabled === 'boolean') {
    const started = Object.values(s.status.sections).some((x) => x !== 'pending');
    if (b.aiEnabled && !aiConfig().available) return res.status(400).json({ error: 'AI isn’t configured on the server (ANTHROPIC_API_KEY is not set).' });
    if (b.aiEnabled && started && !s.aiEnabled) return res.status(400).json({ error: 'AI can only be switched on before the first section opens, because participants must be told beforehand.' });
    db.prepare('UPDATE sessions SET ai_enabled = ? WHERE id = ?').run(b.aiEnabled ? 1 : 0, s.id);
  }
  notify(s.id, 'stage'); notify(s.id, 'slides');
  res.json({ ok: true });
});

host.post('/s/:id/section/:sid/:action', (req, res) => {
  const s = getSessionOr404(req, res); if (!s) return;
  const { sid, action } = req.params;
  const section = s.survey.sections.find((x) => x.id === sid);
  if (!section) return res.status(404).json({ error: 'Unknown section.' });
  const st = s.status.sections[sid];
  s.status.times = s.status.times || {};
  s.status.times[sid] = s.status.times[sid] || {};
  if (action === 'open' || action === 'reopen') {
    const other = Object.entries(s.status.sections).find(([k, v]) => v === 'open' && k !== sid);
    if (other) return res.status(409).json({ error: 'Please close the section that is currently open first.' });
    if (action === 'open' && st !== 'pending') return res.status(409).json({ error: 'This section has already been opened.' });
    if (action === 'reopen' && (st !== 'closed' || req.body?.confirm !== true)) return res.status(409).json({ error: 'Reopening needs confirmation.' });
    s.status.sections[sid] = 'open';
    s.status.times[sid].openedAt = nowIso();
  } else if (action === 'close') {
    if (st !== 'open') return res.status(409).json({ error: 'This section isn’t open.' });
    s.status.sections[sid] = 'closed';
    s.status.times[sid].closedAt = nowIso();
  } else return res.status(400).json({ error: 'Unknown action.' });
  saveStatus(s.id, s.status);
  notify(s.id, 'stage'); notify(s.id, 'slides');
  res.json({ ok: true });
  if (action === 'close') autoSummarise(s.id, section);
});

function autoSummarise(sessionId, section) {
  const s = loadSession(sessionId);
  if (!aiConfig().available || !s.aiEnabled) return;
  for (const q of section.questions.filter((x) => x.type === 'text')) {
    const existing = db.prepare('SELECT method, status FROM analyses WHERE session_id = ? AND question_id = ?').get(sessionId, q.id);
    if (existing && existing.status === 'running') continue;
    if (existing && existing.method && existing.method !== 'ai') continue; // facilitator chose another method; don't overwrite
    runAnalysis(sessionId, q, 'ai', () => { notify(sessionId, 'results'); notify(sessionId, 'slides'); }).catch(() => {});
  }
}

host.get('/s/:id/results', (req, res) => {
  const s = getSessionOr404(req, res); if (!s) return;
  res.set('Cache-Control', 'no-store');
  res.json(hostResults(s.id));
});

function questionOr404(s, qid, res) {
  const f = findQuestion(s.survey, qid);
  if (!f) { res.status(404).json({ error: 'Unknown question.' }); return null; }
  return f;
}
function changed(sessionId) { notify(sessionId, 'results'); notify(sessionId, 'slides'); }

host.post('/s/:id/moderation', (req, res) => {
  const s = getSessionOr404(req, res); if (!s) return;
  const { submissionId, key } = req.body || {};
  const qid = String(key || '').split(':')[0];
  const f = questionOr404(s, qid, res); if (!f) return;
  const isOther = String(key).endsWith(':other');
  if (key !== qid && !isOther) return res.status(400).json({ error: 'Invalid item.' });
  const sub = db.prepare('SELECT answers_json FROM submissions WHERE id = ? AND session_id = ?').get(String(submissionId), s.id);
  if (!sub) return res.status(404).json({ error: 'Response not found.' });
  const a = JSON.parse(sub.answers_json)[qid];
  if (!a || (isOther ? !a.other : !a.text)) return res.status(404).json({ error: 'Response not found.' });
  const cur = db.prepare('SELECT * FROM moderation WHERE submission_id = ? AND item_key = ?').get(submissionId, key) || { hidden: 0, display_text: null, excerpt: 0 };
  const b = req.body;
  const next = { ...cur };
  if (typeof b.hidden === 'boolean') next.hidden = b.hidden ? 1 : 0;
  if (typeof b.excerpt === 'boolean') next.excerpt = b.excerpt ? 1 : 0;
  if (b.displayText !== undefined) {
    const t = b.displayText == null ? '' : String(b.displayText).trim().slice(0, 2000);
    next.display_text = t && t !== (isOther ? a.other : a.text) ? t : null;
  }
  db.prepare(`INSERT INTO moderation (session_id, submission_id, item_key, hidden, display_text, excerpt) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(submission_id, item_key) DO UPDATE SET hidden = excluded.hidden, display_text = excluded.display_text, excerpt = excluded.excerpt`)
    .run(s.id, submissionId, key, next.hidden, next.display_text, next.excerpt);
  if (!isOther && f.q.type === 'text' && next.hidden !== cur.hidden) {
    // The written summary may have drawn on this response: hold it back until the facilitator reconfirms or regenerates.
    db.prepare('UPDATE analyses SET stale = 1 WHERE session_id = ? AND question_id = ? AND summary IS NOT NULL AND summary != \'\'').run(s.id, qid);
  }
  changed(s.id);
  res.json({ ok: true });
});

host.post('/s/:id/q/:qid/analyse', async (req, res) => {
  const s = getSessionOr404(req, res); if (!s) return;
  const f = questionOr404(s, req.params.qid, res); if (!f) return;
  if (f.q.type !== 'text') return res.status(400).json({ error: 'Only written questions have themes.' });
  if (s.status.sections[f.section.id] !== 'closed') return res.status(409).json({ error: 'Close the section before summarising its written answers.' });
  const method = req.body?.method;
  if (!['ai', 'keyword', 'manual'].includes(method)) return res.status(400).json({ error: 'Unknown method.' });
  if (method === 'ai' && (!aiConfig().available || !s.aiEnabled)) return res.status(400).json({ error: 'AI is not available for this session.' });
  if (method === 'ai') {
    res.json({ ok: true, started: true });
    runAnalysis(s.id, f.q, 'ai', () => changed(s.id)).catch(() => {});
    return;
  }
  await runAnalysis(s.id, f.q, method, () => changed(s.id));
  res.json({ ok: true });
});

host.put('/s/:id/q/:qid/analysis', (req, res) => {
  const s = getSessionOr404(req, res); if (!s) return;
  const f = questionOr404(s, req.params.qid, res); if (!f) return;
  const b = req.body || {};
  const cur = db.prepare('SELECT * FROM analyses WHERE session_id = ? AND question_id = ?').get(s.id, f.q.id);
  const fields = {};
  if (!cur) Object.assign(fields, { method: 'manual', status: 'done', generated_at: nowIso() });
  if (typeof b.summary === 'string') { fields.summary = b.summary.trim().slice(0, 800); fields.stale = 0; }
  if (typeof b.approved === 'boolean') fields.approved = b.approved ? 1 : 0;
  if (b.stale === false) fields.stale = 0;
  themesLib.setAnalysis(s.id, f.q.id, fields);
  changed(s.id);
  res.json({ ok: true });
});

function validResponseIds(s, qid, ids) {
  if (!Array.isArray(ids)) return [];
  const all = new Set(db.prepare('SELECT id, answers_json FROM submissions WHERE session_id = ?').all(s.id)
    .filter((r) => JSON.parse(r.answers_json)[qid]?.text).map((r) => r.id));
  return [...new Set(ids.map(String))].filter((id) => all.has(id));
}
function cleanLabel(l) { const t = String(l || '').replace(/\s+/g, ' ').trim().slice(0, 80); return t; }
function themeRow(s, tid) { return db.prepare('SELECT * FROM themes WHERE id = ? AND session_id = ?').get(tid, s.id); }
function ensureAnalysis(s, qid) {
  if (!db.prepare('SELECT 1 FROM analyses WHERE session_id = ? AND question_id = ?').get(s.id, qid)) {
    themesLib.setAnalysis(s.id, qid, { method: 'manual', status: 'done', generated_at: nowIso() });
  }
}

host.post('/s/:id/q/:qid/themes', (req, res) => {
  const s = getSessionOr404(req, res); if (!s) return;
  const f = questionOr404(s, req.params.qid, res); if (!f) return;
  const label = cleanLabel(req.body?.label);
  if (!label) return res.status(400).json({ error: 'Theme needs a label.' });
  const kind = KINDS.includes(req.body?.kind) ? req.body.kind : 'other';
  ensureAnalysis(s, f.q.id);
  const id = newId();
  const sort = (db.prepare('SELECT MAX(sort) m FROM themes WHERE session_id = ? AND question_id = ?').get(s.id, f.q.id).m ?? -1) + 1;
  db.prepare('INSERT INTO themes (id, session_id, question_id, label, kind, response_ids_json, sort) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, s.id, f.q.id, label, kind, JSON.stringify(validResponseIds(s, f.q.id, req.body?.responseIds)), sort);
  changed(s.id);
  res.json({ ok: true, id });
});

host.put('/s/:id/themes/:tid', (req, res) => {
  const s = getSessionOr404(req, res); if (!s) return;
  const t = themeRow(s, req.params.tid); if (!t) return res.status(404).json({ error: 'Theme not found.' });
  const b = req.body || {};
  const label = b.label !== undefined ? cleanLabel(b.label) : t.label;
  if (!label) return res.status(400).json({ error: 'Theme needs a label.' });
  const kind = KINDS.includes(b.kind) ? b.kind : t.kind;
  const ids = b.responseIds !== undefined ? validResponseIds(s, t.question_id, b.responseIds) : JSON.parse(t.response_ids_json);
  db.prepare('UPDATE themes SET label = ?, kind = ?, response_ids_json = ? WHERE id = ?').run(label, kind, JSON.stringify(ids), t.id);
  changed(s.id);
  res.json({ ok: true });
});

host.delete('/s/:id/themes/:tid', (req, res) => {
  const s = getSessionOr404(req, res); if (!s) return;
  const t = themeRow(s, req.params.tid); if (!t) return res.status(404).json({ error: 'Theme not found.' });
  db.prepare('DELETE FROM themes WHERE id = ?').run(t.id);
  changed(s.id);
  res.json({ ok: true });
});

host.post('/s/:id/themes/:tid/merge', (req, res) => {
  const s = getSessionOr404(req, res); if (!s) return;
  const t = themeRow(s, req.params.tid);
  const into = themeRow(s, String(req.body?.intoId || ''));
  if (!t || !into || t.id === into.id || t.question_id !== into.question_id) return res.status(400).json({ error: 'Choose another theme from the same question.' });
  const ids = [...new Set([...JSON.parse(into.response_ids_json), ...JSON.parse(t.response_ids_json)])];
  tx(() => {
    db.prepare('UPDATE themes SET response_ids_json = ? WHERE id = ?').run(JSON.stringify(ids), into.id);
    db.prepare('DELETE FROM themes WHERE id = ?').run(t.id);
  });
  changed(s.id);
  res.json({ ok: true });
});

host.post('/s/:id/themes/:tid/split', (req, res) => {
  const s = getSessionOr404(req, res); if (!s) return;
  const t = themeRow(s, req.params.tid); if (!t) return res.status(404).json({ error: 'Theme not found.' });
  const label = cleanLabel(req.body?.label);
  if (!label) return res.status(400).json({ error: 'New theme needs a label.' });
  const current = JSON.parse(t.response_ids_json);
  const move = validResponseIds(s, t.question_id, req.body?.responseIds).filter((id) => current.includes(id));
  if (!move.length) return res.status(400).json({ error: 'Pick at least one response to move.' });
  const keep = req.body?.keepInOriginal === true;
  const id = newId();
  tx(() => {
    if (!keep) db.prepare('UPDATE themes SET response_ids_json = ? WHERE id = ?').run(JSON.stringify(current.filter((x) => !move.includes(x))), t.id);
    db.prepare('INSERT INTO themes (id, session_id, question_id, label, kind, response_ids_json, sort) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, s.id, t.question_id, label, KINDS.includes(req.body?.kind) ? req.body.kind : t.kind, JSON.stringify(move), t.sort + 1);
  });
  changed(s.id);
  res.json({ ok: true, id });
});

host.put('/s/:id/notes/:sid', (req, res) => {
  const s = getSessionOr404(req, res); if (!s) return;
  if (!s.survey.sections.some((x) => x.id === req.params.sid)) return res.status(404).json({ error: 'Unknown section.' });
  const b = req.body || {};
  const t = (v, n) => String(v ?? '').slice(0, n);
  const actions = (Array.isArray(b.actions) ? b.actions : []).slice(0, 40).map((a) => ({
    action: t(a?.action, 400).trim(), owner: t(a?.owner, 120).trim(), reviewDate: /^\d{4}-\d{2}-\d{2}$/.test(a?.reviewDate || '') ? a.reviewDate : '',
  }));
  db.prepare(`INSERT INTO notes (session_id, section_id, observations, decisions, followups, actions_json, show_on_slide) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id, section_id) DO UPDATE SET observations = excluded.observations, decisions = excluded.decisions, followups = excluded.followups,
    actions_json = excluded.actions_json, show_on_slide = excluded.show_on_slide`)
    .run(s.id, req.params.sid, t(b.observations, 5000), t(b.decisions, 5000), t(b.followups, 5000), JSON.stringify(actions), b.showOnSlide === false ? 0 : 1);
  changed(s.id);
  res.json({ ok: true });
});

host.get('/s/:id/slides', (req, res) => {
  const s = getSessionOr404(req, res); if (!s) return;
  res.set('Cache-Control', 'no-store');
  res.json(buildSlides(s.id));
});
host.put('/s/:id/slide', (req, res) => {
  const s = getSessionOr404(req, res); if (!s) return;
  const key = String(req.body?.key || '');
  if (!buildSlides(s.id).slides.some((x) => x.key === key)) return res.status(400).json({ error: 'That slide isn’t available.' });
  db.prepare('UPDATE sessions SET slide_key = ? WHERE id = ?').run(key, s.id);
  notify(s.id, 'slide');
  res.json({ ok: true });
});

function download(res, filename, type, body) {
  res.set({ 'Content-Type': type, 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' });
  res.send(body);
}
const fileSlug = (s) => s.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'session';
host.get('/s/:id/export/responses.csv', (req, res) => { const s = getSessionOr404(req, res); if (!s) return; download(res, `${fileSlug(s)}-responses.csv`, 'text/csv; charset=utf-8', exporter.responsesCsv(s.id)); });
host.get('/s/:id/export/private.csv', (req, res) => { const s = getSessionOr404(req, res); if (!s) return; download(res, `${fileSlug(s)}-PRIVATE-leaders-only.csv`, 'text/csv; charset=utf-8', exporter.privateCsv(s.id)); });
host.get('/s/:id/export/summary.html', (req, res) => {
  const s = getSessionOr404(req, res); if (!s) return;
  const html = exporter.summaryHtml(s.id);
  if (req.query.download) return download(res, `${fileSlug(s)}-meeting-summary.html`, 'text/html; charset=utf-8', html);
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'").type('html').send(html);
});

function wipeResponses(id) {
  for (const t of ['moderation', 'themes', 'analyses', 'submissions']) db.prepare(`DELETE FROM ${t} WHERE session_id = ?`).run(id);
}
host.post('/s/:id/clear', (req, res) => {
  const s = getSessionOr404(req, res); if (!s) return;
  if (req.body?.confirm !== s.code) return res.status(400).json({ error: 'Type the session code to confirm.' });
  tx(() => {
    wipeResponses(s.id);
    db.prepare('UPDATE sessions SET status_json = ?, slide_key = ? WHERE id = ?').run(JSON.stringify(freshStatus(s.survey)), 'title', s.id);
  });
  notify(s.id, 'stage'); changed(s.id); notify(s.id, 'counts');
  res.json({ ok: true });
});
host.post('/s/:id/reset', (req, res) => {
  const s = getSessionOr404(req, res); if (!s) return;
  if (req.body?.confirm !== s.code) return res.status(400).json({ error: 'Type the session code to confirm.' });
  const survey = defaultSurvey();
  tx(() => {
    wipeResponses(s.id);
    db.prepare('DELETE FROM notes WHERE session_id = ?').run(s.id);
    db.prepare('UPDATE sessions SET survey_json = ?, status_json = ?, slide_key = ? WHERE id = ?').run(JSON.stringify(survey), JSON.stringify(freshStatus(survey)), 'title', s.id);
  });
  notify(s.id, 'stage'); changed(s.id); notify(s.id, 'counts');
  res.json({ ok: true });
});
host.delete('/s/:id', (req, res) => {
  const s = getSessionOr404(req, res); if (!s) return;
  if (req.body?.confirm !== s.code) return res.status(400).json({ error: 'Type the session code to confirm.' });
  db.prepare('DELETE FROM sessions WHERE id = ?').run(s.id);
  notify(s.id, 'stage');
  res.json({ ok: true });
});

// Demo sessions only: add sample responses to the open section so the flow can be rehearsed.
host.post('/s/:id/demo/seed', (req, res) => {
  const s = getSessionOr404(req, res); if (!s) return;
  if (!s.isDemo) return res.status(403).json({ error: 'Sample data can only be added to demo sessions.' });
  const sec = s.survey.sections.find((x) => s.status.sections[x.id] === 'open');
  if (!sec) return res.status(409).json({ error: 'Open a section first.' });
  const n = Math.min(20, Math.max(1, parseInt(req.body?.count || '8', 10)));
  const ins = db.prepare('INSERT INTO submissions (id, session_id, section_id, participant_hash, idem_key, answers_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  tx(() => {
    for (let i = 0; i < n; i++) {
      const answers = validateAnswers(sec, demo.sampleAnswers(sec));
      ins.run(newId(), s.id, sec.id, sha('demo-' + crypto.randomUUID()), 'demo-' + crypto.randomUUID(), JSON.stringify(answers), nowIso());
    }
  });
  notify(s.id, 'counts');
  res.json({ ok: true, added: n });
});

// ---------- pages ----------
const PUB = path.join(__dirname, 'public');
app.get('/healthz', (req, res) => res.json({ ok: true }));
app.get('/j/:code', (req, res) => res.sendFile(path.join(PUB, 'join.html')));
app.get('/host', (req, res) => res.sendFile(path.join(PUB, 'host.html')));
app.get('/present/:id', (req, res) => res.sendFile(path.join(PUB, 'present.html')));
app.use(express.static(PUB, { extensions: ['html'], maxAge: IS_PROD ? '1h' : 0 }));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[error]', req.method, req.path, err.message); // no request bodies are logged
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    const ai = aiConfig();
    console.log(`Duracell survey running on http://localhost:${PORT}`);
    console.log(`  database: ${DB_PATH}`);
    console.log(`  AI themes: ${ai.available ? 'configured (' + ai.model + ')' : 'not configured — keyword/manual grouping only'}`);
  });
}
module.exports = app;
