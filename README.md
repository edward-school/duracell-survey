# Duracell Family Conversation — live survey

A live, anonymous, section-by-section survey for the Duracell cell group (SIBKL), with three views:

| View | Address | Who |
|---|---|---|
| Participant (phone) | `/j/<CODE>` (or `/` and type the code) | Everyone in the room |
| Facilitator dashboard | `/host` | You (password protected) |
| Presentation | `/present/<session-id>` (use the "Launch presentation" button) | The TV / projector |

**Stack:** Node.js 22, Express, SQLite (built into Node, no separate database server), Server-Sent Events for live updates, optional server-side AI via the Anthropic API. No build step.

---

## What you need to provide

| Item | Required? | Notes |
|---|---|---|
| A host for the app | **Yes** | Any service that runs a Node app or Dockerfile **and has a persistent disk**. Railway is the simplest (steps below). |
| `HOST_PASSWORD` | **Yes** | Your facilitator password. The participant session code never grants host access. |
| `ANTHROPIC_API_KEY` | Optional | Turns on AI theme suggestions for written answers. Without it, you can still group answers manually or use keyword analysis (clearly labelled as *not* AI). |
| `PUBLIC_URL` | Optional | The app's public address, used for the QR code. If unset, it is worked out from the browser address. |

## Deploy on Railway (about 10 minutes)

1. Put this folder in a GitHub repository (private is fine).
2. On railway.app: **New Project → Deploy from GitHub repo** → choose the repo. Railway detects the `Dockerfile`.
3. In the service: **Settings → Volumes → Add volume**, mount path **`/data`**. *This is what keeps responses safe across restarts. Without a volume, data is lost when the app redeploys.*
4. **Variables:** add `HOST_PASSWORD` (long and private), `NODE_ENV=production`, `DATA_DIR=/data`. Optionally add `ANTHROPIC_API_KEY`.
5. **Settings → Networking → Generate domain.** Optionally set `PUBLIC_URL` to that address.
6. Open `https://<your-domain>/host`, log in, and create a **demo session** to rehearse.

Other hosts work the same way: Render (Web Service + Persistent Disk mounted at `/data`, which needs a paid instance type) or Fly.io (`fly launch` + `fly volumes create data` mounted at `/data`). The app is a single process. Run **one instance only**, because live updates are held in memory and SQLite is a single file.

## Run on a laptop (rehearsal, or a meeting on shared Wi-Fi)

```bash
npm install
HOST_PASSWORD=choose-one npm start        # Windows PowerShell: $env:HOST_PASSWORD="choose-one"; npm start
```
Open http://localhost:3000/host. Phones on the same Wi-Fi can join with `http://<laptop-IP>:3000/j/<CODE>`. Many church and guest Wi-Fi networks block device-to-device traffic, so a hosted deployment is more reliable for the real meeting.

## Running the meeting

1. **Before:** create a *live* session. In **Edit survey**, adjust wording or options (for example the Q3 start arrangements) and paste SIBKL's official vision wording for Q12 if you want it shown. Sections lock once opened.
2. **Run session:** show the QR code and code. Open Section 1. Phones move to it automatically. Watch the "submitted now" count.
3. **Close responses.** Written answers are then summarised (AI if configured, otherwise use keyword or manual grouping). Nothing written goes on the projector until you tick **Approve themes for the projector** in *Results & moderation*.
4. **Present results.** One slide per question, plus a section divider and a discussion slide. The projector follows your dashboard; in the presentation window use ← → / Space, and F for full screen.
5. Record observations, decisions, follow-ups and actions (with owner and review date) in **Discussion & notes**.
6. Repeat for Sections 2 and 3. Afterwards, use **Export & settings** for the CSV, the meeting summary, and (separately) the private leaders-only export.

## Privacy and anonymity

- No account, name, email or phone number is collected.
- Each browser stores a random identifier so people can return to unfinished answers and aren't counted twice. The server stores only a salted hash of it. **This cannot stop someone submitting again from a different device or browser.**
- Identifiers and individual response histories are never shown. Exports have no identifiers, and response rows are not linked across sections.
- Q20 defaults to *For leaders to review privately*. Those answers are never projected, never included in themes, summaries or the meeting summary, and are not sent to the AI service. They appear only in the clearly labelled private export.
- When AI is on, participants are told before they begin that written answers go to an external AI service. Only the answer text is sent (no identifiers). The model is told to treat responses as data, and its output is checked against the real responses: unknown response references and unsupported themes are discarded, and counts are always computed by the server. AI can only be switched on before Section 1 opens.
- Participant text is always inserted as plain text (never as HTML), and response content is not written to the server logs.

## Testing

`scripts/e2e-acceptance.js` drives the facilitator, four simulated phones and a projector through the whole Section 1 → 2 → 3 flow (78 checks). To run it locally against a mock AI service:

```bash
node scripts/mock-ai.js &
HOST_PASSWORD=testpw PORT=3111 ANTHROPIC_API_KEY=test-key ANTHROPIC_BASE_URL=http://localhost:4555 npm start &
npm i -D playwright && npx playwright install chromium
BASE=http://localhost:3111 npm run test:e2e
```

## Files

- `server.js`: HTTP API, host auth, session stages, live updates
- `lib/survey.js`: the survey wording and server-side answer validation
- `lib/results.js`: counting, percentages and averages, and slide building
- `lib/themes.js`: AI theme generation (with safety checks) and the keyword fallback
- `lib/export.js`: CSV and meeting-summary exports
- `lib/demo.js`: sample answers, for demo sessions only
- `public/`: participant, host and presentation pages (plain HTML, CSS and JavaScript)
