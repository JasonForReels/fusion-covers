# Covers for Fusion

Design collection covers for Fusion and get a Fusion-ready JSON URL. It's a privacy-first alternative to covers.betterer.cc.

**No backend.** The app is static files. Your browser talks straight to the addon, Trakt, and **your own** GitHub repo.

## Privacy compared with covers.betterer.cc

| | covers.betterer.cc | This app |
|---|---|---|
| Stremio manifest URLs (often with personal addon config) | Sent to their server | Fetched by your browser |
| Trakt | OAuth tokens held on their server | Your own public Client ID, no login |
| PMDB API key | Sent to their server | Never asked for (use the Custom source) |
| Cover images + JSON | Uploaded to their Cloudflare R2, public, `immutable`, can't be deleted | Committed to your repo, so you can edit or delete them any time |
| Poster fetching | Their `/api/poster` proxy | Direct. The weserv.nl proxy is opt-in |
| Analytics | GoatCounter hook (currently unset) | None. Strict CSP, `no-referrer` |
| Storage | Server | `localStorage`. The GitHub token is kept per session unless you choose to remember it |

> Your published JSON is public no matter which tool you use, and it contains your addon manifest URLs, because Fusion needs them.

## Output format
Uses `{"exportType":"fusionWidgets","exportVersion":1,"widgets":[…collection.row…]}` with item data sources `addonCatalog` (`addonId`, `catalogId: "type::id"`, `type`) and `traktList` (`listName`, `listSlug`, `traktId`, `username`). It was checked against a real betterer.cc export, and import→export round-trips identically.

## Use
1. `npm install && npm run dev`, or push to GitHub (the Pages workflow is included).
2. Create a **public** repo for your covers, plus a fine-grained token scoped to that repo only, with *Contents: Read and write*.
3. Load an addon or Trakt list, add covers, style them, then **Publish**. Paste the `config.json` URL into Fusion › Settings › Widgets › Add New › Collections Row.

## Sync with one token
**Sync** (top bar) › **Turn on sync** creates a token like `fc1_…`. To sync another browser or device, paste the token there under **Sync › Already have a token**. Collections, covers and settings then stay in sync automatically, with no account or email.

- **End-to-end encrypted.** The app derives a storage ID, a write secret and an AES-256-GCM key from the token, and compresses and encrypts the data in the browser. The Worker ([`sync-worker/`](sync-worker)) only stores ciphertext and a hash of the write secret. It does no logging and no analytics.
- **Edits merge.** Every row and cover carries a change timestamp, so edits on several devices at once are merged instead of overwritten. Deletions win over older edits.
- **Images don't sync.** Published covers already live in your GitHub repo, so other devices use those. Uploaded images stay on the device they were added on.
- **The token is the account.** Anyone with it can read and edit. If you lose it and clear your browser, the synced data can't be recovered.

### Keeping it free (Cloudflare free plan)
Free-plan limits cause errors, never charges. Workers get 100k requests/day. D1 gets 5M row reads/day, 100k row writes/day, and 500 MB per database (up to 10 databases).

| Measure | Effect |
|---|---|
| Images never synced, gzip before encrypting | A typical vault is **1–10 KB**, so ~500 MB holds tens of thousands of users |
| 128 KB hard cap per vault | No single user can use up the storage |
| Vaults unopened for **180 days** are deleted by a daily cron | Abandoned data frees itself up. Any device opening a vault keeps it alive |
| Edits batched (4 s), unchanged data never re-uploaded, polling only while the tab is visible | Fewer writes and requests |
| Polls use `?since=<version>` → `304` | No CORS preflight, so no doubled request count |
| Limit hit → `503`; clients keep local data and retry later | Degrades safely |

**Check usage:** `cd sync-worker && npx wrangler d1 info fusion-covers-sync`

**Scale to 5 GB for free (shards):**
1. Create another database with `npx wrangler d1 create fusion-covers-sync-1` and apply `schema.sql` to it.
2. Add it to `wrangler.jsonc` as binding `DB_1`.
3. Set `SHARD_MAP`: its 16 characters correspond to the vault ID's first hex digit (`0`–`f`), and each character names the database that holds those vaults. For example, `0000000011111111` moves IDs `8…f` to `DB_1`.
4. Copy those rows across before deploying.

### Deploy the Worker
```bash
cd sync-worker && npm install
npx wrangler d1 create fusion-covers-sync   # put the id in wrangler.jsonc
npm run db:remote && npm run deploy
```
Then set `VITE_SYNC_URL` in `.env.production`, and add your site's origin to `ALLOWED_ORIGINS`.

## MDBList
Add your free MDBList API key (and optionally your AIOMetadata manifest URL) in **Settings**. In the **MDBList** tab, tick as many lists as you like, then use **+ Cover** to add them all as sources of one cover (e.g. Disney+ movies + Disney+ shows + Disney+ originals). Fusion has no native MDBList source, so each list becomes:
1. a native **Trakt list**, when the MDBList list is mirrored on Trakt under the same user/slug, otherwise
2. an **AIOMetadata catalog** (`movie::mdblist.<id>` / `series::mdblist.<id>`). If a list isn't in your AIOMetadata config yet, the tab offers an import file for AIOMetadata.

## Sign in with GitHub (one-time setup for whoever hosts the Worker)
1. Go to <https://github.com/settings/applications/new> and fill in:
   - **Homepage URL:** your site
   - **Authorization callback URL:** `https://<your-worker>.workers.dev/auth/github/callback`
2. Put the **Client ID** in `sync-worker/wrangler.jsonc` → `GITHUB_CLIENT_ID`.
3. Set the secret and deploy:
   ```bash
   cd sync-worker
   npx wrangler secret put GITHUB_CLIENT_SECRET
   npx wrangler deploy
   ```
   (`STATE_SECRET` is any long random string, also set via `wrangler secret put`.)

Users then click **Publish › Sign in with GitHub**, and the app creates a public repo on their account and publishes to it. The Worker only exchanges the login code for a token. It never stores the token, which reaches the browser in the URL fragment and is removed immediately. The fine-grained token option remains for people who want access limited to a single repo.
