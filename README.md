# Family Kosh

A family money ledger that runs as a web app, an installable PWA (Android, iPhone, desktop) and an Android APK, all from one codebase.

- **Individual and family net worth** as headlines, with a trend over time.
- **Holdings anywhere**: bank, Groww, EPF, FDs, LIC, gold, land, foreign cash. Offline assets are tracked in units (grams, sq ft, EUR, ETF units) × a price series you update, so one price change revalues everything that uses it.
- **Next month's cash flow** per person, with contributions charged to whoever pays them (for example a monthly gift into a parent's FD).
- **Goals** that count savings already set aside and money already flowing in.
- **Where the next rupee goes**: a deterministic rules engine (emergency fund → goals under 7 years → fill the asset type furthest below target), with signal tilts as the hook for InvestBot.
- **Simulator**: a Monte Carlo of each strategy for new money, with bad/median/good outcomes per asset type and the odds of paying for goals on time.
- **Everyone has their own login.** Families are opt-in groups. People without a login (for example parents) can be managed by someone else, and can take over their own profile later with a hand-over code.

## Architecture

```
React + TypeScript (Vite)          src/ui, src/data
  ├─ engine (pure TS, unit-tested)  src/engine   ← all money logic, no I/O
  │    └─ simulator in a Web Worker
  ├─ offline cache (IndexedDB)      last synced data shows instantly and offline
  └─ service worker (Workbox)       installable PWA, works without a connection
Supabase                            supabase/
  ├─ Postgres + row-level security  every read/write checked per user and family
  ├─ Auth (email + password)
  ├─ Realtime                       other family members' changes appear live
  └─ Edge Function (optional)       Claude second opinion, API key stays server-side
Capacitor                           android/  → APK built by GitHub Actions
GitHub Actions                      Pages deploy, APK release, tests incl. RLS
```

The publishable (anon) key in `.env.production` is meant to be public. It identifies the project; it grants nothing on its own. Access is decided by the policies in `supabase/migrations/0001_init.sql`, which are tested in CI (`supabase/tests/rls_test.sql`): outsiders see nothing, family members see but can't edit each other's money, private holdings stay private, and a hand-over moves ownership cleanly.

**No financial data is ever committed.** Test fixtures are synthetic.

## One-time setup

1. **Database:** Supabase → SQL Editor → New query → paste all of `supabase/migrations/0001_init.sql` → Run.
2. **Auth URLs:** Supabase → Authentication → URL Configuration
   - Site URL: `https://ankitpani8.github.io/family-kosh/`
   - Redirect URLs: add `https://ankitpani8.github.io/family-kosh/**` and `http://localhost:5173/**`
3. **Hosting:** GitHub → repo Settings → Pages → Build and deployment → Source: **GitHub Actions**. Then re-run the "Deploy web app" workflow (Actions tab).

The app is then live at **https://ankitpani8.github.io/family-kosh/**, and each push builds a new APK under **Releases**:
`https://github.com/ankitpani8/family-kosh/releases/latest/download/family-kosh.apk`

### Optional: stable APK signing
Without this, each APK is signed with a throwaway key, so installing a newer APK over an older one fails and you uninstall first (your data lives in Supabase, so you just sign in again). To make updates install in place, create a key once and add four repository secrets:

```bash
keytool -genkeypair -v -keystore kosh.jks -alias kosh -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 kosh.jks   # → KOSH_KEYSTORE_BASE64
```
Secrets: `KOSH_KEYSTORE_BASE64`, `KOSH_KEYSTORE_PASSWORD`, `KOSH_KEY_ALIAS` (`kosh`), `KOSH_KEY_PASSWORD`. Keep `kosh.jks` safe; it's also what a Play Store upload would need.

### Optional: Claude second opinion
```bash
supabase functions deploy second-opinion --project-ref yvghuvpqpaoantpegeqi
supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref yvghuvpqpaoantpegeqi
```
Without it, the rules engine works as normal and the button explains that the review isn't set up.

### Optional: InvestBot signals
InvestBot (or any signal source) inserts a row with the service-role key:
```sql
insert into public.signals (source, as_of, views) values ('InvestBot', current_date, '{"equity": 5, "gold": -3}');
```
Views are tilts in percentage points. Each user opts in under Settings → "Take tilts from the latest signal".

## Install

- **Android:** open the site in Chrome → ⋮ → Install app, or download the APK from Releases and open it (allow installs from your browser when asked).
- **iPhone:** open the site in Safari → Share → Add to Home Screen. A native iOS build needs a Mac and an Apple developer account ($99/year); the PWA does everything this app needs.
- **Play Store:** needs a Google Play developer account ($25 one-time), the stable signing key above, and `./gradlew bundleRelease` for an `.aab`.

## Develop

```bash
npm install
npm run dev          # http://localhost:5173 (uses .env.development)
npm test             # engine tests
npm run build        # production build into dist/
npm run android:apk  # needs the Android SDK locally; CI does this for you
```

## Moving data in

Settings → "Import from the Family Kosh artifact" takes the JSON export of the earlier claude.ai artifact. It adds the people you manage, holdings with their history, unit prices, goals and a family, all owned by your account. Run it once on a fresh account.
