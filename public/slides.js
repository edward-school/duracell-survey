// Renders one projection slide. Shared by the presentation view and the host preview.
(function () {
  const { h } = window.DS;
  const KIND_LABEL = { positive: 'Working well', concern: 'Concern', suggestion: 'Suggestion', question: 'Question', other: 'Theme' };
  const METHOD_LABEL = {
    ai: 'AI-assisted themes, reviewed by the facilitator',
    keyword: 'Keyword analysis (counts words, not meaning), reviewed by the facilitator',
    manual: 'Themes grouped by the facilitator',
  };
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  function bars(rows) {
    const max = Math.max(1, ...rows.map((r) => r.pct));
    return h('div', { class: 'bars' }, rows.map((r) => h('div', { class: 'bar-row' },
      h('div', { class: 'bar-label' }, r.label, r.sub ? h('span', { class: 'bar-sub' }, r.sub) : null),
      h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: { width: `${(r.pct / max) * 100}%` } })),
      h('div', { class: 'bar-val' }, h('b', null, String(r.count)), h('span', null, `${r.pct}%`)))));
  }

  function meta(r) {
    return h('div', { class: 'slide-meta' }, `${plural(r.answeredN, 'person', 'people')} answered`, r.skippedN ? ` · ${r.skippedN} skipped` : '');
  }

  function cloud(themes) {
    const max = Math.max(...themes.map((t) => t.count));
    const min = Math.min(...themes.map((t) => t.count));
    // interleave so the largest sit in the middle
    const sorted = [...themes].sort((a, b) => b.count - a.count);
    const arranged = [];
    sorted.forEach((t, i) => (i % 2 ? arranged.push(t) : arranged.unshift(t)));
    return h('div', { class: 'cloud', role: 'img', 'aria-label': 'Theme cloud: ' + sorted.map((t) => `${t.label}, ${plural(t.count, 'mention', 'mentions')}`).join('; ') },
      arranged.map((t) => {
        const scale = max === min ? 0.6 : (t.count - min) / (max - min);
        return h('span', { class: `cw k-${t.kind}`, style: { fontSize: `${1.3 + scale * 2.6}cqw` }, title: `${t.label}: ${plural(t.count, 'mention', 'mentions')}` }, t.label);
      }));
  }

  function textBody(r) {
    if (!r.approved) {
      return h('div', { class: 'slide-empty' },
        h('p', null, r.answeredN ? 'Written responses are being reviewed by the facilitator.' : 'No written responses to this question.'),
        r.answeredN ? h('p', { class: 'dim' }, plural(r.answeredN, 'written response', 'written responses') + ' received') : null);
    }
    const body = h('div', { class: 'textbody' });
    const info = [METHOD_LABEL[r.method] || METHOD_LABEL.manual, `${plural(r.projectableN, 'response', 'responses')} included`];
    body.appendChild(h('div', { class: 'method' }, info.join(' · ')));
    if (r.small) body.appendChild(h('div', { class: 'small-n' }, 'Limited responses — please avoid broad conclusions.'));
    if (r.summary) body.appendChild(h('p', { class: 'summary' }, r.summary));

    const questionsList = r.visibilityChoice && r.excerpts.length
      ? h('div', { class: 'qlist' }, h('h3', null, 'Questions for us to discuss'), h('ol', null, r.excerpts.map((x) => h('li', null, x)))) : null;
    if (questionsList) body.appendChild(questionsList);

    if (r.themes.length) {
      const legend = h('div', { class: 'legend' }, 'Larger text means more people mentioned this theme.');
      const ranked = h('ol', { class: 'ranked' }, r.themes.map((t) => h('li', null,
        h('span', { class: 'rl' }, t.label), h('span', { class: `tag k-${t.kind}` }, KIND_LABEL[t.kind] || 'Theme'),
        h('span', { class: 'rc' }, plural(t.count, 'mention', 'mentions')))));
      body.appendChild(h('div', { class: 'themes' + (questionsList ? ' secondary' : '') }, h('div', { class: 'cloudwrap' }, cloud(r.themes), legend), ranked));
    } else if (!questionsList) {
      body.appendChild(h('p', { class: 'dim' }, r.projectableN ? 'No themes have been shared for this question.' : 'No responses to show for this question.'));
    }
    if (!r.visibilityChoice && r.excerpts.length) {
      body.appendChild(h('div', { class: 'excerpts' }, r.excerpts.slice(0, 4).map((x) => h('blockquote', null, x))));
    }
    return body;
  }

  function ratingBody(r) {
    const total = r.ratedN;
    const cols = h('div', { class: 'dist' }, r.dist.map((d) => {
      const hpct = total ? (d.count / Math.max(...r.dist.map((x) => x.count), 1)) * 100 : 0;
      return h('div', { class: 'dcol' },
        h('div', { class: 'dval' }, h('b', null, String(d.count)), h('span', null, `${d.pct}%`)),
        h('div', { class: 'dbar-track' }, h('div', { class: 'dbar', style: { height: `${hpct}%` } })),
        h('div', { class: 'dnum' }, String(d.v)),
        h('div', { class: 'dlabel' }, d.label));
    }));
    const stats = [
      ['Average', r.avg == null ? '—' : r.avg.toFixed(1), total ? `of ${plural(total, 'rating', 'ratings')} (1–5)` : 'no ratings'],
      ['Chose 4 or 5', r.top2Pct == null ? '—' : `${r.top2Pct}%`, total ? `of ${total}` : ''],
    ];
    if (r.naLabel) stats.push(['Not sure / N/A', String(r.naN), 'not in average']);
    if (r.dkLabel) stats.push(['Don’t know SIBKL’s vision', String(r.dkN), 'not counted as disagreement']);
    stats.push(['Skipped', String(r.skippedN), '']);
    return h('div', { class: 'ratingbody' },
      r.vision ? h('div', { class: 'vision-s' }, h('b', null, 'SIBKL’s vision: '), r.vision) : null,
      cols,
      h('div', { class: 'stats' }, stats.map(([k, v, s]) => h('div', { class: 'stat' }, h('div', { class: 'sv' }, v), h('div', { class: 'sk' }, k), s ? h('div', { class: 'ss' }, s) : null))));
  }

  function questionSlide(s) {
    const r = s.result;
    let body;
    if (r.type === 'text') body = textBody(r);
    else if (r.answeredN === 0) body = h('div', { class: 'slide-empty' }, h('p', null, 'No one answered this question.'));
    else if (r.type === 'single' || r.type === 'multi') {
      body = h('div', { class: 'choicebody' }, bars(r.rows),
        r.note ? h('p', { class: 'note' }, r.note) : h('p', { class: 'note' }, `Percentages are of the ${plural(r.answeredN, 'person', 'people')} who answered.`),
        r.otherShown && r.otherShown.length ? h('p', { class: 'note' }, h('b', null, '“Other” answers: '), r.otherShown.join(' · ')) : null);
    } else body = ratingBody(r);
    return h('div', { class: 'slide q t-' + r.type },
      h('div', { class: 'slide-head' },
        h('div', { class: 'eyebrow' }, `Section ${s.sectionNum} · ${r.sectionTitle}`),
        h('h2', null, h('span', { class: 'qn' }, `Q${r.num}`), ' ', r.text),
        meta(r)),
      h('div', { class: 'slide-body' }, body),
      r.prompt ? h('div', { class: 'prompt' }, h('span', null, 'Discuss'), r.prompt) : null);
  }

  function render(slide) {
    if (!slide) return h('div', { class: 'slide center' }, h('p', null, 'No slide.'));
    if (slide.type === 'title') {
      const anyClosed = slide.sections.some((x) => x.status === 'closed');
      return h('div', { class: 'slide center title' },
        slide.isDemo ? h('div', { class: 'demo-badge' }, 'DEMO — SAMPLE DATA') : null,
        h('div', { class: 'eyebrow' }, 'Duracell · SIBKL'),
        h('h1', null, 'Our family conversation'),
        h('p', { class: 'sub' }, slide.name),
        h('ol', { class: 'sections' }, slide.sections.map((x) => h('li', { class: 's-' + x.status }, x.title, h('span', null, x.status === 'closed' ? 'results ready' : x.status === 'open' ? 'answering now' : 'coming up')))),
        !anyClosed ? h('p', { class: 'dim' }, 'Results appear here after each section closes.') : null);
    }
    if (slide.type === 'divider') {
      return h('div', { class: 'slide center divider' },
        h('div', { class: 'eyebrow' }, `Section ${slide.sectionNum}`),
        h('h1', null, slide.sectionTitle),
        h('p', { class: 'sub' }, `${plural(slide.submittedN, 'person', 'people')} shared their answers · ${slide.questionCount} questions`));
    }
    if (slide.type === 'discussion') {
      const n = slide.notes;
      const hasNotes = n && ((n.decisions && n.decisions.trim()) || n.actions.length);
      return h('div', { class: 'slide discussion' + (hasNotes ? ' withnotes' : '') },
        h('div', { class: 'eyebrow' }, `Section ${slide.sectionNum} · ${slide.sectionTitle}`),
        h('h1', null, 'Let’s talk about it'),
        h('div', { class: 'disc-grid' },
          h('ol', { class: 'prompts' }, slide.prompts.map((p) => h('li', null, p))),
          hasNotes ? h('div', { class: 'notes' },
            n.decisions && n.decisions.trim() ? h('div', null, h('h3', null, 'Decisions'), h('p', { class: 'pre' }, n.decisions)) : null,
            n.actions.length ? h('div', null, h('h3', null, 'Next steps'), h('ul', null, n.actions.map((a) => h('li', null, a.action, a.owner ? h('span', { class: 'own' }, ` — ${a.owner}`) : null, a.reviewDate ? h('span', { class: 'own' }, ` · review ${a.reviewDate}`) : null)))) : null) : null));
    }
    return questionSlide(slide);
  }

  window.Slides = { render };
})();
