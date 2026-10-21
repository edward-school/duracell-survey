(function () {
  const { h, api, live } = window.DS;
  const id = location.pathname.split('/present/')[1].split(/[/?#]/)[0];
  const stage = document.getElementById('stage');
  let deck = null; let key = 'title';
  let queue = Promise.resolve(); let inflight = 0; let lastLocal = 0;

  function idx() { const i = deck.slides.findIndex((s) => s.key === key); return i < 0 ? 0 : i; }
  function draw() {
    if (!deck) return;
    const i = idx(); key = deck.slides[i].key;
    const frame = h('div', { class: 'slide-frame' }, window.Slides.render(deck.slides[i]));
    stage.replaceChildren(frame);
    document.getElementById('pos').textContent = `${i + 1} / ${deck.slides.length}`;
  }
  async function load() {
    try {
      deck = await api('GET', `/api/host/s/${id}/slides`);
      // Don't let a server echo of an older slide override rapid local key presses.
      if (inflight === 0 && Date.now() - lastLocal > 1000) key = deck.slideKey || key;
      document.getElementById('offline').classList.add('hidden');
      draw();
    } catch (e) {
      if (e.status === 401) {
        stage.replaceChildren(h('div', { class: 'gate' }, h('h1', null, 'Facilitator login needed'),
          h('p', null, 'The presentation view is protected. Please log in on the facilitator dashboard in this browser, then open the presentation again.'),
          h('p', null, h('a', { href: '/host' }, 'Go to facilitator login'))));
      } else document.getElementById('offline').classList.remove('hidden');
    }
  }
  async function go(delta) {
    if (!deck) return;
    const i = Math.max(0, Math.min(deck.slides.length - 1, idx() + delta));
    key = deck.slides[i].key; draw();
    lastLocal = Date.now(); inflight++;
    const k = key;
    queue = queue.then(() => api('PUT', `/api/host/s/${id}/slide`, { key: k })).catch(() => {}).finally(() => { inflight--; lastLocal = Date.now(); });
  }
  document.getElementById('prev').onclick = () => go(-1);
  document.getElementById('next').onclick = () => go(1);
  document.getElementById('fs').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
  document.addEventListener('keydown', (e) => {
    if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); go(1); }
    else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); go(-1); }
    else if (e.key === 'Home') { e.preventDefault(); go(-999); }
    else if (e.key === 'End') { e.preventDefault(); go(999); }
    else if (e.key === 'f' || e.key === 'F') document.getElementById('fs').click();
  });
  let mt;
  document.addEventListener('mousemove', () => { document.body.classList.add('mouse'); clearTimeout(mt); mt = setTimeout(() => document.body.classList.remove('mouse'), 2500); });
  live(`/api/host/s/${id}/events?role=present`, () => load(), (ok) => { document.getElementById('offline').classList.toggle('hidden', ok); if (ok) load(); });
  load();
})();
