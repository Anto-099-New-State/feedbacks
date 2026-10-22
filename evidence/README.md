# evidence/

- `04-docs-typecheck.txt` — output of `npm run check:docs` (offline, deterministic).
- `01-phantom-rows.json`, `02-stale-feed-health.json`, `03-funding-forgiven.json` — written by `npm run live`
  (read-only, Hideki testnet). Not included yet: the workspace these reports were prepared in could not reach
  the Hideki RPC or indexer. Run `npm run live` and commit the output alongside the reports.
