// Mock Anthropic Messages API for local testing only.
const http = require('http');
let calls = 0;
http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    calls++;
    const body = JSON.parse(b);
    if (req.headers['x-api-key'] !== 'test-key') { res.writeHead(401); return res.end(JSON.stringify({ error: { message: 'bad key' } })); }
    const msg = body.messages[0].content;
    if (msg.includes('FAILME')) { res.writeHead(500); return res.end(JSON.stringify({ error: { message: 'simulated outage' } })); }
    const m = msg.match(/<responses>\n([\s\S]*)\n<\/responses>/);
    const items = JSON.parse(m[1]);
    const meal = items.filter((r) => /dinner|eat|meal/i.test(r.text)).map((r) => r.id);
    const rest = items.filter((r) => !meal.includes(r.id)).map((r) => r.id);
    const out = { summary: `Mock summary of ${items.length} responses.`, themes: [
      { label: 'More shared meals', kind: 'suggestion', response_ids: meal.concat(['r99']) },
      { label: 'Other ideas', kind: 'other', response_ids: rest },
      { label: 'Invented theme with no support', kind: 'concern', response_ids: [] },
    ] };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ content: [{ type: 'text', text: 'Here you go:\n' + JSON.stringify(out) }] }));
  });
}).listen(4555, () => console.log('mock ai on 4555'));
