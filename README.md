# NUMBER//ZERO

A polished browser-based number rolling and case-battle game with a linear virtual-credit economy.

**Static frontend:** <https://daminion73.github.io/number-zero/>

GitHub Pages serves files, not a Node server. The Render configuration below hosts the entire app and its multiplayer backend together. Adding the configuration to GitHub does not create a Render service; an authenticated operator must approve its initial deployment.

## Features

- One-million-number rolls with pattern badges and rarity analysis
- 435 cases across 13 collections, including variable 3–24 outcome pools
- Custom case creator with all traits and editable percentage odds
- 1–6 player case battles with Classic, Crazy, Clutch, Terminal, and Share modes
- Gold Coin bonus spins and case-inside-a-case bonuses
- Responsive battle layouts and automatic virtual-credit settlement
- Google sign-in, persistent online wallets and public battle lobbies
- Human team seats, host-added/removable bots, invite links and spectators
- Server-generated rounds, automatic settlement and reconnectable history
- Local collection exploration, favorites, measured milestones and ambience controls

## Run locally

Requires Node.js **22.20 or newer**. Local development uses built-in SQLite; hosting uses Turso through `@libsql/client/web`. Both use the same asynchronous query/transaction interface. Commands below use Windows PowerShell.

```powershell
npm install
npm run dev
```

Open <http://localhost:4173>.

For local multiplayer testing without Google, explicitly enable development accounts:

```powershell
$env:DEV_AUTH = "1"
npm run dev
```

This binds to loopback only. Open two independent browsers/private windows, sign in using different test names, build and publish a battle, join it from the other browser, then start it as host. Development accounts are not Google accounts and are disabled under `NODE_ENV=production`.

## Google sign-in

1. In Google Cloud, configure the OAuth consent screen and create a **Web application** OAuth client. Add test users if the consent screen is in testing mode.
2. Add exact authorized JavaScript origins, e.g. `http://localhost:4173`, your production frontend origin, and `https://daminion73.github.io` when using Pages. Origins have no `/number-zero/` path. This uses the Google Identity Services JavaScript popup callback, not a server redirect flow.
3. Set `GOOGLE_CLIENT_ID` on the backend to the generated client ID. No client secret is needed for this ID-token verification flow. Do not put any client secret in frontend files.

```powershell
Remove-Item Env:DEV_AUTH -ErrorAction SilentlyContinue
$env:GOOGLE_CLIENT_ID = "YOUR_WEB_CLIENT_ID.apps.googleusercontent.com"
npm start
```

The server verifies Google's signature, audience, issuer and expiration using `google-auth-library`, keys accounts by Google's `sub`, and returns a revocable seven-day opaque session. Only its hash is stored in SQLite. The browser keeps the token in sessionStorage (per tab); account data survives signing in again. Public battle data includes display names and game account IDs, not emails or Google subjects. Use HTTPS in production.

## Deploy the backend

### Render Free + Turso Free (selected hosts)

The root `render.yaml` configures one **free** Node service, with no paid disk. Accounts, sessions, wallets and battles live in **Turso's free libSQL database**, so Render restarts do not erase them. The service hosts the frontend and API at the same HTTPS origin; keep `API_BASE` empty. Render startup refuses to use an ephemeral local database if the Turso URL is missing.

[Render Free](https://render.com/docs/free) sleeps after 15 idle minutes and takes about a minute to wake up. Its 750 monthly instance hours are shared across your workspace. [Turso Free](https://turso.tech/pricing) currently includes 5 GB storage, 500 million rows read and 10 million rows written per month. These are hobby tiers, not an uptime guarantee. Render also limits bandwidth, builds and unusually high outbound traffic (including external database calls). Keep paid upgrades/overages disabled and review both dashboards' limits; traffic can cause suspension. No keep-alive traffic is needed.

Create a free Turso account and a **libSQL** database near Render's Oregon region first. Copy its `libsql://…` connection URL and create a database auth token. Store the token only in Render's secret environment settings, never in source, `config.js`, screenshots or chat. Startup creates the schema in the selected database; use a new database for the initial deployment. Existing local SQLite data is not automatically uploaded: preserve it and plan a separate migration if it contains accounts you need to keep.

After pushing this configuration to `main`, open:

[Deploy NUMBER//ZERO to Render](https://render.com/deploy?repo=https://github.com/daminion73/number-zero)

1. Sign in to Render, connect the GitHub repository, confirm the **Free** service plan with **no disk**, and supply `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and `GOOGLE_CLIENT_ID` when prompted. The Google value is the public Web client ID, not a client secret.
2. Create the Blueprint and wait for its initial deployment to become **Live**. Use the actual HTTPS URL assigned by Render; the service name does not guarantee a particular hostname.
3. Add that exact HTTPS origin to the Google OAuth client's authorized JavaScript origins. Publish the consent screen or add your players as test users.
4. Check `/api/config` at the assigned origin: `devAuth` must be `false`, and `googleClientId` must match your Web client ID. Verify Google login and a two-account battle before inviting players.
5. To keep using the GitHub Pages URL as well, set `API_BASE` in `config.js` to the verified Render origin and push that frontend configuration. Do not point Pages at an unprovisioned hostname. Render already allows the Pages origin in CORS.

Automatic code deployments are disabled. Deploy later commits explicitly from Render after tests pass. While the service sleeps or restarts, no maintenance runs; the next API request catches up due refunds and settlements from Turso without paying twice. Use Turso's backup/export tools for hosted data. No deployment is complete until the public health check, Google login, two-account battle and restart recovery have been verified against the hosted database.

### Other hosts and local containers

Run **one instance** of this Node service with either Turso or a persistent local disk (not GitHub Pages or an ephemeral function). The same service can host the frontend. Build with `npm ci --omit=dev`, start with `npm start`, and expose its port behind HTTPS. `GET /api/config` checks database access as well as returning public configuration.

| Setting               | Purpose                                                              |
| --------------------- | -------------------------------------------------------------------- |
| `NODE_ENV=production` | Disables development login regardless of `DEV_AUTH`                  |
| `GOOGLE_CLIENT_ID`    | Web client ID, also provided publicly to the login UI                |
| `TURSO_DATABASE_URL`  | Hosted libSQL URL (`libsql://…`); takes precedence over local storage |
| `TURSO_AUTH_TOKEN`    | Secret database token; required with the Turso URL                   |
| `DATABASE_PATH`       | Local SQLite file when Turso is unset; defaults to `data/number-zero.sqlite` |
| `PORT`                | Backend HTTP port, defaults to 4173                                  |
| `HOST`                | Bind address, defaults to `0.0.0.0`                                  |
| `ALLOWED_ORIGINS`     | Comma-separated exact frontend origins; same-origin works without it |
| `ROUND_MS`            | Standard reveal interval, default 4000; fast mode halves it          |
| `WAITING_MS`          | Waiting-lobby lifetime, default 900000 (15 minutes)                  |

For GitHub Pages, set `API_BASE` in `config.js` to your deployed backend's HTTPS origin, and set backend `ALLOWED_ORIGINS=https://daminion73.github.io`. Deploy the frontend configuration separately. No backend credentials go in `config.js`. CORS includes error responses so expired sessions can be recovered. Configure provider rate limiting at the edge as well: the built-in limiter groups by socket address, so reverse-proxy clients share its budget.

A Dockerfile is included for Docker Desktop (Linux containers) or a container host:

```powershell
docker build -t number-zero .
docker volume create number-zero-data
docker run --name number-zero --restart unless-stopped -p 4173:8080 `
  --mount source=number-zero-data,target=/app/data `
  -e GOOGLE_CLIENT_ID="YOUR_WEB_CLIENT_ID.apps.googleusercontent.com" number-zero
```

This command starts a local container; a public host still needs TLS, a domain/origin registered with Google, and either Turso or persistent-volume attachment and backups. Keep one application instance; its rate limiter is process-local. Stop the service before copying a local database for a consistent backup, or use SQLite's online backup tooling. Do not expose `data/` through another static server. Native Windows Node hosting is supported without Docker.

## Multiplayer rules and boundaries

- New accounts receive 50,000 virtual credits; daily claims add 20,000, once per UTC day. No money, deposits, withdrawals or credit purchases.
- **Online and practice wallets are separate.** Local admin tools, custom cases, inventory and localStorage balances never determine online credits or outcomes.
- Select 1–20 canonical cases, a mode and format, then publish. Entry is reserved for the host. Each human chooses and pays for one seat, and may hold only one active battle at a time.
- The host manually adds/removes labelled house bots and starts only when all seats are filled. No fabricated human activity is generated.
- Leaving a waiting battle refunds that participant. The host cancels to refund everyone. Expired lobbies also refund everyone. Running battles cannot be cancelled; disconnects do not stop them.
- Results use server CSPRNG and the shared economy functions. Future results are never returned to clients. Outcomes, reservations and settlements persist in SQLite transactions. Restarting resumes reveals/settlement, without paying twice.
- Classic/Crazy use team totals, Clutch uses the best individual pull within a team, Terminal sums the team's final round, and Share pays every seat. Tied winning teams share the pot, excluding losing teams. Integer-cent remainders go in winning-team/seat order. Bots' shares are not transferred to humans.
- Lobby polling is every five seconds, or about 1.5 seconds while watching a running battle. Pause Updates freezes the display, not the server game. Reconnecting shows the current server state. The feed shows up to 100 recent/active battles; saved invite links can retrieve older results.
- This is server-authoritative randomness, **not** a cryptographic provably-fair commitment/reveal protocol. No such claim is made for online battles.
- Local discovery/favorites and practice achievements remain browser-local; online completed battles and wins follow the Google account. Google authentication and public deployment require operator configuration and a live end-to-end check.

## Test

```powershell
npm test
npx playwright install chromium
npm run test:ui
```

Unit/HTTP tests use disposable local SQLite databases and cover asynchronous rollback/isolation, authorization, competing joins, request replay, refunds, UTC boundaries, hidden results, tied payouts, session revocation and restart recovery. UI verification launches an in-memory backend and independent test accounts, exercises publish/join/bot/start/reconnect/settlement, and captures desktop/mobile screenshots under `.amp/in/artifacts/`. These checks do not authenticate against Google's live service or verify Turso network latency/availability; those require a configured staging deployment.

Credits are virtual and have no cash value.
