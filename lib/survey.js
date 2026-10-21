'use strict';
// Default survey definition + server-side validation of answers and of facilitator edits.

const AGREE_SCALE = [
  { v: 1, label: 'Strongly disagree' },
  { v: 2, label: 'Disagree' },
  { v: 3, label: 'Neither agree nor disagree' },
  { v: 4, label: 'Agree' },
  { v: 5, label: 'Strongly agree' },
];
const NA_LABEL = 'Not sure / Not applicable';
const DONTKNOW_LABEL = 'I don’t know enough about SIBKL’s vision to answer.';

const LIMITS = { otherText: 200, openText: 2000, optionLabel: 200, questionText: 400, helpText: 600 };

function opts(list) {
  return list.map((o, i) => (typeof o === 'string' ? { id: 'o' + (i + 1), label: o } : { id: 'o' + (i + 1), ...o }));
}
const OTHER = (extra = {}) => ({ label: 'Other—please specify', other: true, ...extra });

function agree(id, num, text, prompt, extra = {}) {
  return { id, num, type: 'agree', text, help: '', allowNA: true, prompt, ...extra };
}

function defaultSurvey() {
  return {
    version: 1,
    intro:
      'Welcome to our Duracell family conversation. We’d love to understand how you’re experiencing cell and shape our next season together. Please answer honestly and kindly. Your responses are anonymous, and you may skip any question. Specific details in written answers may still identify you, so share only what you’re comfortable sharing.',
    sibklVision: '',
    endNote:
      'If you’d like to follow up on anything — including how you might contribute next year — please approach one of the leaders privately. Because this survey is anonymous, leaders can’t see who said what.',
    sections: [
      {
        id: 's1',
        title: 'Practical arrangements',
        intro: 'A few questions about when and how we meet.',
        discussionPrompts: [
          'What practical arrangements are working?',
          'What is the biggest barrier to participation?',
          'What change should we explore?',
        ],
        questions: [
          {
            id: 'q1', num: 1, type: 'single', text: 'How well does our current meeting day work for you?', help: '',
            options: opts(['Works consistently', 'Works most weeks', 'Often difficult', 'Rarely works']),
            prompt: 'What would make our meeting day work for more of us?',
          },
          {
            id: 'q2', num: 2, type: 'multi', text: 'Which meeting days would usually work for you?', help: 'Select all that apply.',
            options: opts(['Wednesday', 'Thursday', 'Friday', OTHER()]),
            prompt: 'Is there a day that works for most of us?',
          },
          {
            id: 'q3', num: 3, type: 'single', text: 'Which meeting start arrangement would work best for you?',
            help: 'Each option shows the dinner time (if any) and the time the cell session itself starts.',
            options: opts([
              { label: 'Dinner at 7.00pm, with the cell session starting at 8.00pm', sub: 'Dinner 7.00pm · Cell session 8.00pm' },
              { label: 'Dinner at 7.30pm, with the cell session starting at 8.30pm', sub: 'Dinner 7.30pm · Cell session 8.30pm' },
              { label: 'Cell session starting at 8.00pm, without organised dinner beforehand', sub: 'No organised dinner · Cell session 8.00pm' },
              { label: 'Cell session starting at 8.30pm, without organised dinner beforehand', sub: 'No organised dinner · Cell session 8.30pm' },
              'No strong preference',
              OTHER(),
            ]),
            prompt: 'How do we balance eating together with starting on time?',
          },
          {
            id: 'q4', num: 4, type: 'single', text: 'What would be your preferred end time for the organised cell session?',
            help: 'This refers to the end of the organised session. Optional fellowship can continue afterwards.',
            options: opts(['10.00pm', '10.30pm', '11.00pm', '11.30pm', 'No strong preference', OTHER()]),
            prompt: 'What end time would help people stay for the whole session?',
          },
          {
            id: 'q5', num: 5, type: 'multi', text: 'What makes it harder for you to attend or participate?', help: 'Select all that apply.',
            options: opts([
              'Work commitments', 'Travel or traffic', 'Meeting location', 'Family commitments', 'Energy or health',
              'Meeting starts too early', 'Meeting ends too late', { label: 'Nothing significant', exclusive: true }, OTHER(),
            ]),
            prompt: 'Which of these barriers could we actually do something about?',
          },
          {
            id: 'q6', num: 6, type: 'rating', text: 'How clear and timely are our announcements and arrangements?', help: '',
            scale: [
              { v: 1, label: 'Very unclear or late' },
              { v: 2, label: 'Somewhat unclear or late' },
              { v: 3, label: 'Okay' },
              { v: 4, label: 'Clear and timely' },
              { v: 5, label: 'Very clear and timely' },
            ],
            allowNA: false,
            prompt: 'What would make our communication clearer or more timely?',
          },
          {
            id: 'q7', num: 7, type: 'text', text: 'Is there anything else we could improve about the practical arrangements?',
            help: 'For example: location, transport, dinner, hosting, communication, or meeting format.',
            prompt: 'Which of these ideas should we try first?',
          },
        ],
      },
      {
        id: 's2',
        title: 'Belonging and spiritual growth',
        intro: 'For each statement, choose how much you agree. You can also choose “Not sure / Not applicable” or skip.',
        discussionPrompts: [
          'What helps us feel connected and grow?',
          'What would make it easier to share honestly?',
          'How can we support one another better?',
        ],
        questions: [
          agree('q8', 8, 'I feel connected to the people in Duracell.', 'What helps us feel connected to one another?'),
          agree('q9', 9, 'I feel safe sharing my real struggles, doubts, and mistakes in Duracell.', 'What makes honest sharing feel safe — or harder?'),
          agree('q10', 10, 'I have someone in Duracell I feel comfortable reaching out to when I need support.', 'How can we make sure no one is without support?'),
          agree('q11', 11, 'I feel connected to the wider SIBKL church community.', 'What would help us connect with the wider church?'),
          agree('q12', 12, 'I feel aligned with SIBKL’s vision and direction.', 'What would help us understand and take part in SIBKL’s vision?', { allowDontKnow: true, showVision: true }),
          agree('q13', 13, 'I feel I am growing spiritually.', 'What has helped us grow, and what gets in the way?'),
          agree('q14', 14, 'Through cell, I am growing in my knowledge and understanding of the Bible.', 'How could our Bible discussions help us understand more deeply?'),
          agree('q15', 15, 'I feel empowered and encouraged to study the Bible for myself.', 'What would help us study the Bible on our own?'),
          {
            id: 'q16', num: 16, type: 'text',
            text: 'What has helped you feel connected or grow spiritually, and what would help you further?',
            help: 'It helps if you can separate what is working now from what could improve.',
            placeholder: 'What’s helping: …\nWhat would help further: …',
            prompt: 'What should we keep doing, and what should we add?',
          },
        ],
      },
      {
        id: 's3',
        title: 'Our next season',
        intro: 'Looking ahead to 2027 together.',
        discussionPrompts: [
          'What are our top priorities for 2027?',
          'What can we begin before year-end?',
          'Who would like to help take the next steps?',
        ],
        questions: [
          {
            id: 'q17', num: 17, type: 'multi', text: 'Which areas would you most like Duracell to strengthen in 2027?',
            help: 'Choose up to three.', max: 3,
            options: opts([
              'Bible understanding and practical application', 'Personal Bible study habits', 'Worship and prayer',
              'Honest sharing and emotional support', 'Accountability and mentoring', 'Fellowship and deeper friendships',
              'Connection with the wider SIBKL community', 'Understanding and participating in SIBKL’s vision',
              'Welcoming newcomers', 'Outreach and community service', OTHER(),
            ]),
            prompt: 'Which one or two of these should we focus on first?',
          },
          {
            id: 'q18', num: 18, type: 'text', text: 'What is one thing you would like us to keep, change, introduce, or do less of in 2027?', help: '',
            prompt: 'What do we want to keep, and what are we ready to change?',
          },
          {
            id: 'q19', num: 19, type: 'multi', text: 'How would you be interested in contributing next year?',
            help: 'This is an expression of interest, not a commitment.',
            options: opts([
              'Hosting', 'Food and meals', 'Administration and coordination', 'Worship or music', 'Facilitating Bible discussions',
              'Prayer and member care', 'Organising outings and fellowship', 'Outreach and community service',
              'Exploring where I could contribute', 'Unsure at the moment', 'Not able to take on a role in this season', OTHER(),
            ]),
            footnote: 'Because this survey is anonymous, leaders can’t see who chose what. If you’d like to follow up, please approach a leader privately.',
            prompt: 'If you’d like to help, please speak to a leader privately afterwards.',
          },
          {
            id: 'q20', num: 20, type: 'text',
            text: 'What questions would you like us to discuss, or is there anything else you want the leaders to know?', help: '',
            visibilityChoice: true,
            prompt: 'Which of these questions should we take up together?',
          },
        ],
      },
    ],
  };
}

function allQuestions(survey) {
  return survey.sections.flatMap((s) => s.questions.map((q) => ({ ...q, sectionId: s.id })));
}
function findQuestion(survey, qid) {
  for (const s of survey.sections) for (const q of s.questions) if (q.id === qid) return { q, section: s };
  return null;
}

function cleanStr(v, max) {
  if (typeof v !== 'string') return null;
  // strip control chars except newline/tab
  const s = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  return s.length > max ? null : s;
}

class ValidationError extends Error {}

// Validate one section's answers. Returns normalised answers object (skipped questions omitted).
function validateAnswers(section, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ValidationError('Answers must be an object.');
  const qmap = new Map(section.questions.map((q) => [q.id, q]));
  for (const k of Object.keys(raw)) if (!qmap.has(k)) throw new ValidationError('Unknown question: ' + k);
  const out = {};
  for (const q of section.questions) {
    const a = raw[q.id];
    if (a === undefined || a === null) continue; // skipped
    if (typeof a !== 'object' || Array.isArray(a)) throw new ValidationError(`Q${q.num}: invalid answer.`);
    const optIds = new Set((q.options || []).map((o) => o.id));
    const otherIds = new Set((q.options || []).filter((o) => o.other).map((o) => o.id));
    if (q.type === 'single') {
      if (!optIds.has(a.v)) throw new ValidationError(`Q${q.num}: invalid option.`);
      const r = { v: a.v };
      if (otherIds.has(a.v)) {
        const t = a.other == null ? '' : cleanStr(a.other, LIMITS.otherText);
        if (t === null) throw new ValidationError(`Q${q.num}: “Other” text is too long (max ${LIMITS.otherText}).`);
        if (t) r.other = t;
      }
      out[q.id] = r;
    } else if (q.type === 'multi') {
      if (!Array.isArray(a.v)) throw new ValidationError(`Q${q.num}: invalid selection.`);
      const v = [...new Set(a.v)];
      if (v.length === 0) continue; // nothing selected = skipped
      for (const id of v) if (!optIds.has(id)) throw new ValidationError(`Q${q.num}: invalid option.`);
      if (q.max && v.length > q.max) throw new ValidationError(`Q${q.num}: choose at most ${q.max}.`);
      const excl = (q.options || []).filter((o) => o.exclusive).map((o) => o.id);
      if (v.length > 1 && v.some((id) => excl.includes(id))) throw new ValidationError(`Q${q.num}: “Nothing significant” can’t be combined with other options.`);
      const r = { v };
      if (v.some((id) => otherIds.has(id))) {
        const t = a.other == null ? '' : cleanStr(a.other, LIMITS.otherText);
        if (t === null) throw new ValidationError(`Q${q.num}: “Other” text is too long (max ${LIMITS.otherText}).`);
        if (t) r.other = t;
      }
      out[q.id] = r;
    } else if (q.type === 'rating' || q.type === 'agree') {
      const ok =
        (Number.isInteger(a.v) && a.v >= 1 && a.v <= 5) ||
        (a.v === 'na' && q.allowNA) ||
        (a.v === 'dontknow' && q.allowDontKnow);
      if (!ok) throw new ValidationError(`Q${q.num}: invalid rating.`);
      out[q.id] = { v: a.v };
    } else if (q.type === 'text') {
      const t = cleanStr(a.text, LIMITS.openText);
      if (t === null) throw new ValidationError(`Q${q.num}: answer is too long (max ${LIMITS.openText} characters).`);
      if (!t) continue;
      const r = { text: t };
      if (q.visibilityChoice) {
        if (a.visibility !== undefined && a.visibility !== 'group' && a.visibility !== 'leaders') throw new ValidationError(`Q${q.num}: invalid visibility.`);
        r.visibility = a.visibility === 'group' ? 'group' : 'leaders'; // default private
      }
      out[q.id] = r;
    }
  }
  return out;
}

// Merge a facilitator-edited survey into the current one.
// Only wording, help text, options and prompts may change; question ids/types/structure are fixed.
// Sections that are already open/closed are locked except for discussion prompts.
function applySurveyEdit(current, edited, sectionStatus) {
  if (!edited || typeof edited !== 'object' || !Array.isArray(edited.sections)) throw new ValidationError('Invalid survey.');
  const next = JSON.parse(JSON.stringify(current));
  const anyStarted = Object.values(sectionStatus).some((s) => s !== 'pending');
  const str = (v, max, label) => {
    const s = cleanStr(v ?? '', max);
    if (s === null) throw new ValidationError(`${label} is too long (max ${max}).`);
    return s;
  };
  if (!anyStarted && edited.intro !== undefined) {
    const s = str(edited.intro, 1500, 'Introduction');
    if (s) next.intro = s;
  }
  if (edited.endNote !== undefined) next.endNote = str(edited.endNote, 800, 'End note');
  if (edited.sibklVision !== undefined && sectionStatus.s2 === 'pending') next.sibklVision = str(edited.sibklVision, 1500, 'SIBKL vision');

  for (const es of edited.sections) {
    const cs = next.sections.find((s) => s.id === es.id);
    if (!cs) throw new ValidationError('Unknown section ' + es.id);
    if (Array.isArray(es.discussionPrompts)) {
      cs.discussionPrompts = es.discussionPrompts.map((p) => str(p, 300, 'Discussion prompt')).filter(Boolean).slice(0, 8);
    }
    const locked = sectionStatus[cs.id] !== 'pending';
    for (const eq of es.questions || []) {
      const cq = cs.questions.find((q) => q.id === eq.id);
      if (!cq) throw new ValidationError('Unknown question ' + eq.id);
      if (eq.prompt !== undefined) cq.prompt = str(eq.prompt, 300, `Q${cq.num} discussion prompt`);
      if (locked) continue;
      if (eq.text !== undefined) {
        const t = str(eq.text, LIMITS.questionText, `Q${cq.num} wording`);
        if (!t) throw new ValidationError(`Q${cq.num} wording can’t be empty.`);
        cq.text = t;
      }
      if (eq.help !== undefined) cq.help = str(eq.help, LIMITS.helpText, `Q${cq.num} help text`);
      if (cq.options && Array.isArray(eq.options)) {
        if (eq.options.length < 2 || eq.options.length > 20) throw new ValidationError(`Q${cq.num} needs between 2 and 20 options.`);
        const used = new Set();
        let n = 1 + Math.max(0, ...cq.options.map((o) => parseInt(String(o.id).slice(1), 10) || 0));
        cq.options = eq.options.map((eo) => {
          const label = str(eo.label, LIMITS.optionLabel, `Q${cq.num} option`);
          if (!label) throw new ValidationError(`Q${cq.num}: option labels can’t be empty.`);
          let id = typeof eo.id === 'string' && /^o\d+$/.test(eo.id) && !used.has(eo.id) ? eo.id : 'o' + n++;
          used.add(id);
          const o = { id, label };
          const sub = str(eo.sub, LIMITS.optionLabel, `Q${cq.num} option detail`);
          if (sub) o.sub = sub;
          if (eo.other) o.other = true;
          if (eo.exclusive && cq.type === 'multi') o.exclusive = true;
          return o;
        });
      }
    }
  }
  return next;
}

module.exports = {
  defaultSurvey, allQuestions, findQuestion, validateAnswers, applySurveyEdit, ValidationError,
  AGREE_SCALE, NA_LABEL, DONTKNOW_LABEL, LIMITS,
};
