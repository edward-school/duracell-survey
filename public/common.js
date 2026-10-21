// Shared helpers. All user-provided text is inserted with textContent (never innerHTML).
(function () {
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      }
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  async function api(method, url, body, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (url.startsWith('/api/host')) headers['x-host-request'] = '1';
    let res;
    try {
      res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin', cache: 'no-store' });
    } catch (e) {
      const err = new Error('network'); err.network = true; throw err;
    }
    let data = null;
    try { data = await res.json(); } catch { /* not json */ }
    if (!res.ok) {
      const err = new Error((data && (data.message || data.error)) || `Request failed (${res.status})`);
      err.status = res.status; err.data = data; throw err;
    }
    return data;
  }

  function toast(msg, ms = 2400) {
    const t = h('div', { class: 'toast', role: 'status' }, msg);
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    return [...b].map((x) => x.toString(16).padStart(2, '0')).join('').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
  }

  // Resilient EventSource wrapper with status callback.
  function live(url, onUpdate, onStatus = () => {}) {
    let es, timer;
    function connect() {
      es = new EventSource(url);
      es.addEventListener('open', () => onStatus(true));
      es.addEventListener('update', (e) => { try { onUpdate(JSON.parse(e.data)); } catch { /* ignore */ } });
      es.addEventListener('error', () => {
        onStatus(false);
        if (es.readyState === EventSource.CLOSED) { clearTimeout(timer); timer = setTimeout(connect, 3000); }
      });
    }
    connect();
    return { close: () => { clearTimeout(timer); es && es.close(); } };
  }

  window.DS = { h, api, toast, store, uuid, live };
})();
