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
