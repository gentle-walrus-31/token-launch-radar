// Token Launch Radar — the token-radar-01 entry's build program (Node 22, standard library only).
//
// Pipeline, end to end:
//   sealed snapshot (/input/snapshot.json, or --input <file|dir>)
//     -> parseSnapshot + buildRadar in lib/model.ts (model `radar-2`)
//     -> two independent gate checks on the finished board (below)
//     -> /output/board.json, /output/data.js
//     -> this repository's dashboard/ and screenshots/ copied to /output
//     -> /output/dossier.json, the summary the judge reads, built with the
//        vendored make.fun library (vendor/makefun-board.ts, never edited).
//
// How the model prices a protocol (the assumptions the board stands on):
//   - Only pre-token protocols are ranked: no market cap, no Gecko id, no
//     symbol, and not a wrapped, staked or bridged product of a token that
//     already trades. The snapshot's watchlist is the floor, never the
//     ceiling: the board also ranks pre-token protocols above the floor that
//     the watchlist leaves out, flagged on_watchlist: false.
//   - Implied value comes from comparables, not from TVL alone: for each
//     protocol, the median market-cap/TVL of live-token protocols in the same
//     category (at least 3 comps, else the global median 0.246x), clamped to
//     [0.05, 1.50]. Market cap is used as a conservative proxy for FDV, since
//     FDV is usually >= market cap; that is stated on the dashboard, not hidden.
//   - Three multipliers adjust the multiple: growth from the 7-day TVL change,
//     tenure from the days since listing without a token, and reach from the
//     number of chains. Implied FDV = TVL x multiple x growth x tenure x reach.
//   - The airdrop pool is 7.5% of implied FDV, an explicit assumption the
//     dashboard's scenario simulator lets a reader change.
//   - Every row also carries a farmability score (cost, time, risk), an early
//     score with its signals in plain words, and a 7-step farm plan whose
//     steps each name their cost and time.
//
// Why this file checks the board twice: lib/model.ts already refuses a bad
// board through boardIssue, and this file runs a second, independent check
// (selfCheckBoard, below) written from the gate's limits directly. The two
// agree on a good board and either one alone stops a bad one from being
// written, so a bug in the model cannot ship a board the scorer refuses.
// Neither check changes a row: a failed check exits before any file is
// written, and a passing check leaves the output byte-identical.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot, type BoardRow, type Snapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** The gate's board limits, restated here so this file can judge a board on its own. */
const GATE = {
  board_min_rows: 100,
  board_max_rows: 4000,
  farm_steps_min: 3,
  farm_steps_max: 12,
  farm_step_min_chars: 20,
  farm_step_max_chars: 600,
  implied_max_usd: 100_000_000_000_000,
} as const;

/**
 * A second, independent read of the finished board, written from the gate's
 * limits rather than from the model's own checks: it re-derives every
 * invariant from the rows themselves — row count, rank order, unique slugs,
 * non-increasing implied value, exact watchlist coverage, farm-step count and
 * length, implied value within its cap, and an airdrop pool that is positive
 * and no larger than the implied value it comes from. Returns the first
 * failure as plain words, or null when the board is safe to write. It runs
 * after buildRadar and before any file is written, and it never changes a row.
 */
function selfCheckBoard(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < GATE.board_min_rows || board.length > GATE.board_max_rows) {
    return `board has ${board.length} rows: the gate takes ${GATE.board_min_rows} to ${GATE.board_max_rows}`;
  }
  const seen = new Set<string>();
  let watchlistSeen = 0;
  let previous = Number.POSITIVE_INFINITY;
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (row.rank !== i + 1) {
      return `row ${i + 1} carries rank ${row.rank}: ranks must run 1..${board.length} in board order`;
    }
    if (seen.has(row.slug)) return `${row.slug} appears twice on the board`;
    seen.add(row.slug);
    if (row.on_watchlist) watchlistSeen++;
    if (row.implied_value_usd > previous) {
      return `${row.slug} at rank ${row.rank} outranks the row above it on implied value`;
    }
    previous = row.implied_value_usd;
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) {
      return `${row.slug} has implied value ${row.implied_value_usd}: it must be a positive whole number of dollars`;
    }
    if (row.implied_value_usd > GATE.implied_max_usd) {
      return `${row.slug} has implied value $${row.implied_value_usd}: over the $${GATE.implied_max_usd} cap`;
    }
    if (!Number.isSafeInteger(row.airdrop_pool_usd) || row.airdrop_pool_usd <= 0 || row.airdrop_pool_usd > row.implied_value_usd) {
      return `${row.slug} has airdrop pool $${row.airdrop_pool_usd}: it must be positive and no larger than the implied value`;
    }
    if (row.farm_steps.length < GATE.farm_steps_min || row.farm_steps.length > GATE.farm_steps_max) {
      return `${row.slug} has ${row.farm_steps.length} farm steps: the gate takes ${GATE.farm_steps_min} to ${GATE.farm_steps_max}`;
    }
    for (const step of row.farm_steps) {
      if (step.length < GATE.farm_step_min_chars || step.length > GATE.farm_step_max_chars) {
        return `${row.slug} has a farm step of ${step.length} characters: the gate takes ${GATE.farm_step_min_chars} to ${GATE.farm_step_max_chars}`;
      }
    }
  }
  const missing = snapshot.watchlist.filter((slug) => !seen.has(slug));
  if (missing.length > 0) {
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  }
  if (watchlistSeen !== snapshot.watchlist.length) {
    return `the board flags ${watchlistSeen} rows as watchlist, but the snapshot names ${snapshot.watchlist.length}`;
  }
  return null;
}

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}
// The model's own check above is one read; this file's own check is a second
// one, from the gate's limits directly, before anything is written.
const selfIssue = selfCheckBoard(board, snapshot);
if (selfIssue !== null) {
  process.stderr.write(`token radar: the board fails this program's own gate check: ${selfIssue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (3 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
