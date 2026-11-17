# Token Launch Radar

[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![Rank](https://make.fun/badge/token-radar-01/gentle-walrus-31/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/gentle-walrus-31/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

Token Launch Radar is a token launch radar made for the [make.fun token-radar-01 bounty](https://make.fun/bounty/token-radar-01). It ranks 198 pre-token protocols from a sealed DefiLlama snapshot (14 November 2026) by implied token value — and tells you how to farm each one.

## How it works

Every protocol is priced from comparable protocols that already have a token: the median market-cap/TVL multiple of live-token protocols in the same category (global median 0.25x as fallback), adjusted for 7-day growth, tenure since listing, and chain reach. Implied FDV = TVL × multiple × growth × tenure × reach; the airdrop pool assumes 7.5% of implied FDV. No protocol is special-cased — one function scores every row.

Each row also carries a farmability score (cost, time, risk), early signals (recent listing, 7-day growth, chain expansion), and a 7-step farm plan with cost and time per step. The dashboard adds a Top 10 picks narrative and an interactive scenario simulator (change the airdrop share or the multiple haircut and the board re-sorts).

Top of the board: Steakhouse Financial, implied $736.1M (airdrop pool $55.2M); Sentora Curator $699.5M; Gauntlet $438.4M. Total implied value across the board: $5.36B.

## Run it

Node 22, standard library only — no build step, no network requests:

```sh
MAKEFUN_OUTPUT_DIR=/tmp/out node main.ts --input <path-to-snapshot.json>
# writes board.json, data.js, dashboard/, screenshots/ and dossier.json to /tmp/out
```

Or serve `dashboard/` with any static HTTP server (it reads `data.js` beside the page).

## Entry

- Program: `main.ts` (+ `lib/model.ts`), which reads the sealed snapshot, writes `board.json`, the dashboard data, and `dossier.json` via `vendor/makefun-board.ts`
- Dashboard: `dashboard/` (static page, renders with no network)
- Screenshots: `screenshots/` (board, detail view, filtered view — real Chrome renders)

## License

MIT — see [LICENSE](LICENSE).
