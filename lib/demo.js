'use strict';
// Sample answers for DEMO sessions only. Never used in live sessions.
const crypto = require('node:crypto');
const pick = (arr) => arr[crypto.randomInt(arr.length)];
const chance = (p) => crypto.randomInt(1000) < p * 1000;

const TEXTS = {
  q7: [
    'More shared dinners before cell would be nice.', 'Could we eat together more often?', 'Parking near the host home is difficult.',
    'Announcements on the WhatsApp group sometimes come quite late.', 'Rotate hosting so travel is fairer for those living far.',
    'Start on time please, even if a few people are late.', 'An earlier finish would help those of us who work early.',
    'Maybe a later start so we can get through traffic.', 'Location changes should be confirmed by Tuesday.',
  ],
  q16: [
    'What’s helping: the honest sharing in small groups. What would help: more time for prayer.',
    'The Acts studies have been really good. Would love more practical application.',
    'Being checked on when I missed a few weeks meant a lot.', 'Smaller breakout groups would make it easier to share.',
    'More time to go deeper in the Bible passage rather than rushing.', 'Prayer partners would help me grow.',
  ],
  q18: [
    'Keep the dinners!', 'Introduce a quarterly outing.', 'Do less of long announcements at the start.', 'Change: start on time.',
    'Introduce a reading plan we follow together.', 'Keep the small group sharing.',
  ],
  q20: [
    'How do we welcome newcomers better?', 'Could we discuss how to serve in the wider church?',
    'How do we keep each other accountable without it feeling heavy?', 'I have been finding things hard lately and would appreciate prayer.',
  ],
};

function sampleAnswers(section) {
  const out = {};
  for (const q of section.questions) {
    if (chance(0.08)) continue; // some skips
    if (q.type === 'single') {
      const o = pick(q.options);
      out[q.id] = { v: o.id, ...(o.other ? { other: pick(['9.00pm', 'Depends on the week', 'Flexible']) } : {}) };
    } else if (q.type === 'multi') {
      const excl = q.options.filter((o) => o.exclusive);
      if (excl.length && chance(0.15)) { out[q.id] = { v: [excl[0].id] }; continue; }
      const pool = q.options.filter((o) => !o.exclusive);
      const k = Math.min(q.max || 3, 1 + crypto.randomInt(3));
      const chosen = [...new Set(Array.from({ length: k }, () => pick(pool).id))];
      const hasOther = chosen.some((id) => q.options.find((o) => o.id === id).other);
      out[q.id] = { v: chosen, ...(hasOther ? { other: pick(['Saturday', 'Sunday afternoon', 'Youth ministry', 'Tech support']) } : {}) };
    } else if (q.type === 'rating') {
      out[q.id] = { v: pick([2, 3, 3, 4, 4, 4, 5, 5]) };
    } else if (q.type === 'agree') {
      const r = crypto.randomInt(100);
      if (q.allowDontKnow && r < 12) out[q.id] = { v: 'dontknow' };
      else if (r < 20) out[q.id] = { v: 'na' };
      else out[q.id] = { v: pick([2, 3, 3, 4, 4, 4, 5, 5]) };
    } else if (q.type === 'text') {
      if (chance(0.35)) continue;
      const t = pick(TEXTS[q.id] || ['No comment.']);
      out[q.id] = { text: t, ...(q.visibilityChoice ? { visibility: /prayer|hard/.test(t) ? 'leaders' : 'group' } : {}) };
    }
  }
  return out;
}

module.exports = { sampleAnswers };
