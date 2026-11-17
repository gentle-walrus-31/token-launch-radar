// Token Radar's model, version radar-2: one snapshot of the protocol universe in, one ranked
// board out. The model is deliberately auditable: every number on the board can be traced back
// to the snapshot's own figures plus a small set of stated constants.
//
// Implied value is a comparables (comps) model, not a flat multiple:
//   1. comps multiple: for the protocol's category, the MEDIAN market-cap/TVL of the live-token
//      protocols in that category (at least 3 comps; otherwise the global median across all live
//      protocols). Market cap is used as a conservative proxy for fully-diluted value: FDV is
//      usually >= market cap, so the implied value is a lower-bound-style estimate, and the
//      dashboard says so.
//   2. growth: the 7-day TVL change, clamped to [-50, +100]%, weighted 0.5.
//   3. tenure: how long the protocol has run with no token on record (age since listed_at),
//      0.85 + min(age, 1095)/1095 * 0.30. Older with no token scores slightly higher: it is
//      the most "overdue" for a launch, and it has survived longest.
//   4. reach: 1 + min(chains - 1, 5) * 0.02. More chains means a wider user base to airdrop to.
//   implied FDV = tvl_usd x compMultiple x growthMult x ageMult x chainMult
//   airdrop pool = implied FDV x AIRDROP_PCT (7.5% of supply, the stated assumption; the
//   dashboard's simulator lets a reader change it and watch the values move).
//
// Two more scores, both derived from the snapshot alone:
//   farmability (0-100): cost (main chain's gas tier, 30) + time (hold window, 30) + risk
//      (age, size, category risk, chain count, drawdown, 40). It answers "how cheap, fast and
//      safe is it to farm this one", not "how big is it".
//   early score (0-100): recency of listing (40) + 7-day growth (35) + chain count (25).
//      >= 60 earns the EARLY badge: a protocol that is new, growing and spreading.
//
//   The watchlist is the floor, never the ceiling: the board also ranks the pre-token
//   protocols above the floor that the watchlist leaves out (20 of them). The watchlist's
//   parent-protocol exclusion uses DefiLlama's parentProtocol field, which the snapshot
//   does NOT carry, so this board applies every exclusion the snapshot can express
//   (category, name, version marker, exchange prefix) and flags those rows
//   on_watchlist: false, so a reader can tell them apart.
//
// No protocol name is ever special-cased: the same functions score every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the simulator may vary them. */
export interface ModelConstants {
  /** Share of token supply assumed to go to an airdrop (0.075 = 7.5%). */
  airdrop_pct: number;
  /** Bounds on the comps multiple actually applied. */
  multiple_floor: number;
  multiple_cap: number;
  /** Growth clamp and weight. */
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  /** Tenure (age with no token) multiplier range. */
  age_floor: number;
  age_range: number;
  age_days: number;
  unknown_age_days: number;
  /** Per-extra-chain multiplier step, capped at this many extra chains. */
  chain_step: number;
  chain_max_extra: number;
}

export const MODEL: ModelConstants = {
  airdrop_pct: 0.075,
  multiple_floor: 0.05,
  multiple_cap: 1.5,
  growth_weight: 0.5,
  growth_floor: -50,
  growth_cap: 100,
  age_floor: 0.85,
  age_range: 0.3,
  age_days: 1095,
  unknown_age_days: 365,
  chain_step: 0.02,
  chain_max_extra: 5,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live comps view carries, by market cap. */
export const LIVE_ROWS = 60;

/** The farmability grade bands. */
export function farmGrade(score: number): 'A' | 'B' | 'C' | 'D' {
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 50) return 'C';
  return 'D';
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One live-token comparable: the market's own numbers for a protocol that already trades. */
export interface CompEntry {
  slug: string;
  name: string;
  mcap_usd: number;
  tvl_usd: number;
  multiple: number;
}

/** A category's comparables: the comps behind one multiple, for the audit view. */
export interface CategoryComps {
  category: string;
  /** How many live-token protocols fed the median. */
  n: number;
  /** The median market-cap/TVL actually applied (before the floor/cap). */
  median: number;
  /** True when the category had fewer than 3 comps and the global median was used. */
  fallback_global: boolean;
  /** The category's largest comps by market cap (at most 8), for the detail view. */
  comps: CompEntry[];
}

/** The farmability breakdown: cost, time and risk out of 30 / 30 / 40. */
export interface Farmability {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D';
  cost: number;
  time: number;
  risk: number;
  /** The main chain's gas tier, as the dashboard explains it. */
  gas_tier: 'cheap' | 'mid' | 'expensive';
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  /** True when the snapshot's watchlist names this protocol. */
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  /** The airdrop pool at the model's stated airdrop share. */
  airdrop_pool_usd: number;
  farmability: Farmability;
  early_score: number;
  /** The early signals that fired, in plain words (empty when none). */
  early_signals: string[];
  /** The top-10 narrative reason, null outside the top 10. */
  pick_reason: string | null;
  model: {
    comp_multiple: number;
    comp_category: string;
    comp_n: number;
    comp_fallback_global: boolean;
    growth_pct: number;
    growth_multiplier: number;
    age_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with its farm plan and scores. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  /** True when the snapshot's watchlist names this protocol. */
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  airdrop_pool_usd: number;
  comp_multiple: number;
  comp_category: string;
  comp_n: number;
  comp_fallback_global: boolean;
  growth_multiplier: number;
  age_multiplier: number;
  chain_multiplier: number;
  farmability: Farmability;
  early_score: number;
  early_signals: string[];
  pick_reason: string | null;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  multiple: number | null;
}

/** One top pick: rank, slug and the reason it is worth farming, in words. */
export interface TopPick {
  rank: number;
  slug: string;
  name: string;
  reason: string;
}

/** Everything the dashboard needs: the board, the live set, the comps and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  /** Ranked rows above the watchlist floor that the watchlist itself leaves out. */
  off_watchlist_above_floor: number;
  /** Sum of implied FDV across the board, and of the airdrop pools. */
  total_implied_usd: number;
  total_airdrop_usd: number;
  /** The global median market-cap/TVL across all live comps. */
  global_median_multiple: number;
  rows: RadarRow[];
  live: LiveRow[];
  comps: CategoryComps[];
  top_picks: TopPick[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** The watchlist's excluded categories: a wrapped, staked or bridged product of a traded token. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** Exchange names a protocol must not begin with. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, and not a wrapped, staked or
 *  bridged product of a token that already trades (the watchlist's own rule, without its TVL floor). */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The live-token protocols that can serve as comparables: a market cap and a TVL, not a CEX. */
export function liveComps(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX');
}

/** The comps table: per-category median market-cap/TVL, with the global median as fallback. */
export function buildComps(snapshot: Snapshot): { byCategory: Map<string, CategoryComps>; globalMedian: number } {
  const live = liveComps(snapshot);
  const globalMedian = median(live.map((p) => p.mcap_usd! / p.tvl_usd));
  const byCat = new Map<string, SnapshotProtocol[]>();
  for (const p of live) {
    const c = p.category ?? 'Other';
    const arr = byCat.get(c) ?? [];
    arr.push(p);
    byCat.set(c, arr);
  }
  const out = new Map<string, CategoryComps>();
  for (const [category, arr] of byCat) {
    const multiples = arr.map((p) => p.mcap_usd! / p.tvl_usd);
    const useGlobal = arr.length < 3;
    const top = [...arr]
      .sort((a, b) => b.mcap_usd! - a.mcap_usd!)
      .slice(0, 8)
      .map((p) => ({ slug: p.slug, name: p.name, mcap_usd: p.mcap_usd!, tvl_usd: p.tvl_usd, multiple: p.mcap_usd! / p.tvl_usd }));
    out.set(category, {
      category,
      n: arr.length,
      median: useGlobal ? globalMedian : median(multiples),
      fallback_global: useGlobal,
      comps: top,
    });
  }
  return { byCategory: out, globalMedian };
}

/** The multiple a category applies, clamped to the model's bounds. */
export function compMultiple(category: string | null, comps: { byCategory: Map<string, CategoryComps>; globalMedian: number }, model: ModelConstants): { multiple: number; median: number; n: number; fallback: boolean; category: string } {
  const key = category ?? 'Other';
  const entry = comps.byCategory.get(key);
  const raw = entry !== undefined ? entry.median : comps.globalMedian;
  const n = entry !== undefined ? entry.n : 0;
  const fallback = entry === undefined || entry.fallback_global;
  const multiple = Math.min(model.multiple_cap, Math.max(model.multiple_floor, raw));
  return { multiple, median: raw, n, fallback, category: key };
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  comps: { byCategory: Map<string, CategoryComps>; globalMedian: number },
): {
  implied: number;
  airdropPool: number;
  comp: { multiple: number; median: number; n: number; fallback: boolean; category: string };
  growthPct: number;
  growthMult: number;
  ageMult: number;
  chainMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const comp = compMultiple(protocol.category, comps, model);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const ageMult = model.age_floor + (Math.min(Math.max(ageForModel, 0), model.age_days) / model.age_days) * model.age_range;
  const extraChains = Math.min(Math.max(protocol.chains.length - 1, 0), model.chain_max_extra);
  const chainMult = 1 + extraChains * model.chain_step;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * comp.multiple * growthMult * ageMult * chainMult));
  return { implied, airdropPool: Math.max(1, Math.round(implied * model.airdrop_pct)), comp, growthPct, growthMult, ageMult, chainMult, age };
}

/** Chains where a farm transaction is cheap, and where it is dear. */
const CHEAP_CHAINS = new Set([
  'Solana', 'Base', 'Arbitrum', 'Optimism', 'Polygon', 'Binance', 'Avalanche', 'Gnosis',
  'Fantom', 'Blast', 'Linea', 'Scroll', 'ZkSync', 'Starknet', 'Monad', 'Hyperliquid L1',
  'Berachain', 'Sui', 'Aptos', 'Near', 'Cosmos', 'Osmosis', 'Injective', 'Sei', 'Movement',
  'MegaETH', 'Unichain', 'World Chain', 'Mode', 'Manta', 'Mantle', 'Taiko', 'Fraxtal',
  'Sonic', 'Abstract', 'Ink', 'Katana', 'Stellar', 'Flare', 'Tron',
]);
const EXPENSIVE_CHAINS = new Set(['Ethereum', 'Bitcoin']);

/** The main chain's gas tier. */
export function gasTier(chain: string): 'cheap' | 'mid' | 'expensive' {
  if (EXPENSIVE_CHAINS.has(chain)) return 'expensive';
  if (CHEAP_CHAINS.has(chain)) return 'cheap';
  return 'mid';
}

/** How long a farm position should be held, from the protocol's age: younger protocols get a longer qualifying window. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
export function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** Categories whose farming carries extra market risk. */
const RISKY_CATEGORY = /perpetual|derivative|leveraged|basis trading|prediction|options/i;

/**
 * Farmability: how cheap, fast and safe a protocol is to farm, 0-100. Cost is the main
 * chain's gas tier (30), time is the hold window (30), risk is age, size, category risk,
 * chain count and drawdown (40). The score never uses a name, only the snapshot's figures.
 */
export function farmability(p: SnapshotProtocol, age: number | null): Farmability {
  const chain = p.chains.length > 0 ? p.chains[0]! : '';
  const tier = gasTier(chain);
  const cost = tier === 'cheap' ? 30 : tier === 'mid' ? 20 : 10;
  const hold = holdDaysFor(age);
  const time = hold === 30 ? 30 : hold === 45 ? 22 : 15;
  let risk = 40;
  if (age !== null && age < 180) risk -= 10;
  else if (age === null) risk -= 5;
  if (p.tvl_usd < 100_000_000) risk -= 8;
  if (p.category !== null && RISKY_CATEGORY.test(p.category)) risk -= 8;
  if (p.chains.length <= 1) risk -= 5;
  if (p.change_7d !== null && p.change_7d < -20) risk -= 5;
  risk = Math.max(5, risk);
  const score = cost + time + risk;
  return { score, grade: farmGrade(score), cost, time, risk, gas_tier: tier };
}

/**
 * The early score: how new, how fast-growing and how widely spread a protocol is, 0-100.
 * 60 or more earns the EARLY badge. Signals name what fired, for the board and the detail view.
 */
export function earlyScore(p: SnapshotProtocol, age: number | null): { score: number; signals: string[] } {
  const signals: string[] = [];
  let recency: number;
  if (age === null) {
    recency = 15;
  } else if (age < 90) {
    recency = 40;
    signals.push(`listed ${age} days ago`);
  } else if (age < 180) {
    recency = 32;
    signals.push(`listed ${age} days ago`);
  } else if (age < 365) {
    recency = 24;
    signals.push('listed under a year ago');
  } else if (age < 730) {
    recency = 12;
  } else {
    recency = 5;
  }
  let growth: number;
  const g = p.change_7d;
  if (g === null) {
    growth = 10;
  } else if (g > 20) {
    growth = 35;
    signals.push(`TVL up ${g.toFixed(1)}% in 7 days`);
  } else if (g > 10) {
    growth = 28;
    signals.push(`TVL up ${g.toFixed(1)}% in 7 days`);
  } else if (g > 0) {
    growth = 20;
  } else if (g > -10) {
    growth = 10;
  } else {
    growth = 5;
  }
  let spread: number;
  const n = p.chains.length;
  if (n >= 5) {
    spread = 25;
    signals.push(`live on ${n} chains`);
  } else if (n >= 3) {
    spread = 18;
    signals.push(`live on ${n} chains`);
  } else if (n === 2) {
    spread = 10;
  } else {
    spread = 4;
  }
  return { score: recency + growth + spread, signals };
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Gas for one ordinary transaction on a chain tier, in words. */
function gasFor(tier: 'cheap' | 'mid' | 'expensive'): string {
  if (tier === 'cheap') return 'about $1 of gas';
  if (tier === 'mid') return 'about $3 of gas';
  return 'about $8 of gas';
}

/** The category's core action and its follow-up, in the words a farmer can follow. */
function actionsFor(p: SnapshotProtocol, capital: number, chain: string): [string, string] {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('risk curator') || c.includes('curator') || c.includes('allocator') || c.includes('collateral management')) {
    return [
      `Deposit $${capital} of USDC into a ${name} vault on ${chain} and hold the vault shares.`,
      `Move a second $${Math.round(capital / 2)} into a different ${name} vault on ${chain} so two vaults carry your address.`,
    ];
  }
  if (c.includes('lending') || c.includes('cdp') || c.includes('collateral')) {
    return [
      `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`,
      `Borrow $${Math.round(capital * 0.3)} against the supply, swap it back to USDC and repay it a week later to register a borrow.`,
    ];
  }
  if (c.includes('dex') || c.includes('liquidity manager') || c.includes('leveraged farm') || c.includes('farm')) {
    return [
      `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`,
      `Swap $${Math.round(capital / 2)} through ${name} on ${chain} once a week so your address trades as well as provides liquidity.`,
    ];
  }
  if (c.includes('bridge') || c.includes('cross chain')) {
    return [
      `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`,
      `Bridge a second, smaller amount back the other way through ${name} a week later to register a return trip.`,
    ];
  }
  if (c.includes('staking') || c.includes('restak')) {
    return [
      `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`,
      `Restake the receipt token once more through ${name} if it offers a second layer, and hold both receipts.`,
    ];
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis trading') || c.includes('options')) {
    return [
      `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position, no more than 2x leverage.`,
      `Close the position after a few days, then open a second small one in the opposite direction to register two-way activity.`,
    ];
  }
  if (c.includes('prediction')) {
    return [
      `Fund $${capital} and place one position on a ${name} market on ${chain}.`,
      `Place a second position on a different ${name} market the following week and let the first one settle.`,
    ];
  }
  if (c.includes('stable') || c.includes('algo-stable') || c.includes('dual-token')) {
    return [
      `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`,
      `Hold the minted asset for a full week, then use a small part of it in a swap on ${chain} and mint again.`,
    ];
  }
  if (c.includes('rwa')) {
    return [
      `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it.`,
      `Top the position up once with another $${Math.round(capital / 2)} after two weeks so the holding grows over time.`,
    ];
  }
  if (c.includes('insurance')) {
    return [
      `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`,
      `Renew or extend the cover once before it lapses so the policy spans more than one snapshot.`,
    ];
  }
  if (c.includes('yield aggregator') || c.includes('yield')) {
    return [
      `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and keep the shares.`,
      `Claim the vault's yield once, then redeposit it into the same vault so the position compounds.`,
    ];
  }
  if (c.includes('launchpad')) {
    return [
      `Stake $${capital} of the launchpad asset on ${name} to qualify for allocations on ${chain}.`,
      `Join one allocation round on ${name} with a small ticket, even if the allocation is modest.`,
    ];
  }
  if (c.includes('token locker')) {
    return [
      `Lock $${capital} of tokens in a ${name} locker on ${chain} for the shortest term it offers.`,
      `Create a second, shorter lock a week later so two locks are tied to your address.`,
    ];
  }
  if (c.includes('payment') || c.includes('card')) {
    return [
      `Fund $${capital} through ${name} on ${chain} and make one real payment with it.`,
      `Make a second payment the following week, in a different amount, so the usage is recurring.`,
    ];
  }
  if (c.includes('privacy')) {
    return [
      `Deposit $${capital} through ${name}'s private pool on ${chain} and keep the note it gives you.`,
      `Withdraw a smaller amount a week later using the same note system so both legs are recorded.`,
    ];
  }
  if (c.includes('chain')) {
    return [
      `Bridge $${capital} of USDC onto ${name}'s chain and deploy it in the chain's flagship app.`,
      `Make one transaction a week on ${name} itself, such as a transfer or a contract call, to stay active on the chain.`,
    ];
  }
  if (c.includes('indexes')) {
    return [
      `Buy $${capital} of the ${name} index on ${chain} and hold the index token.`,
      `Add another $${Math.round(capital / 2)} to the index after two weeks so the holding grows.`,
    ];
  }
  if (c.includes('governance')) {
    return [
      `Deposit $${capital} into ${name} on ${chain} and vote on one live proposal with the position.`,
      `Vote on a second proposal the following week so your address votes more than once.`,
    ];
  }
  if (c.includes('ai agent') || c.includes('decentralized ai')) {
    return [
      `Deposit $${capital} into ${name} on ${chain} and run one agent task with it.`,
      `Run a second agent task the following week, on a different agent if ${name} offers more than one.`,
    ];
  }
  if (c.includes('nft')) {
    return [
      `Buy or mint one ${name} NFT on ${chain} for about $${capital} and hold it in the farming wallet.`,
      `List the NFT for sale once, then delist it, so the marketplace records both actions.`,
    ];
  }
  if (c.includes('otc')) {
    return [
      `Place one $${capital} OTC quote on ${name} on ${chain} and let it fill.`,
      `Place a second, smaller quote the following week on the other side of the book.`,
    ];
  }
  if (c.includes('anchor') || c.includes('decentralized btc') || c.includes('reserve')) {
    return [
      `Deposit $${capital} of the wrapped asset into ${name} on ${chain} and hold the receipt.`,
      `Add a second deposit of $${Math.round(capital / 2)} after two weeks so the balance grows over time.`,
    ];
  }
  if (c.includes('cede') || c.includes('interest rate')) {
    return [
      `Deposit $${capital} into ${name} on ${chain} and open one position in its main market.`,
      `Adjust the position once after a week, such as changing its size or its term, to register ongoing use.`,
    ];
  }
  return [
    `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`,
    `Use ${name}'s second main feature once a week, such as a swap, a vote or a claim, so the address stays active.`,
  ];
}

/** The weekly cadence verb for a category, so the recurring step reads like the protocol. */
function weeklyFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lending') || c.includes('cdp')) return 'a supply top-up, a borrow or a repayment';
  if (c.includes('dex') || c.includes('liquidity')) return 'a swap or a liquidity top-up';
  if (c.includes('bridge')) return 'a bridge in either direction';
  if (c.includes('staking') || c.includes('restak')) return 'a stake top-up or a restake';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis')) return 'a small trade or a margin adjustment';
  if (c.includes('prediction')) return 'a position on a new market';
  if (c.includes('yield')) return 'a deposit, a claim or a redeposit';
  if (c.includes('rwa')) return 'a mint or a top-up';
  if (c.includes('governance')) return 'a vote on a live proposal';
  if (c.includes('launchpad')) return 'an allocation or a stake top-up';
  return 'a deposit, a swap or a vote';
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is
 * derived from the protocol's own record (category, chains, TVL, age, gas tier), never from
 * a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const tier = gasTier(chain);
  const gas = gasFor(tier);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const [core, second] = actionsFor(p, capital, chain);
  const weekly = weeklyFor(p);
  const otherChain = p.chains.length > 1 ? ` and ${p.chains[1]}` : '';
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm on ${chain}, and keep its seed phrase offline.`,
      cost: 'nothing to create the wallet',
      time: '5 minutes',
    },
    {
      text: chain === 'Ethereum'
        ? `Send $${capital} of USDC and a little ETH for gas to the fresh wallet on Ethereum.`
        : `Bridge $${capital} of USDC from Ethereum to ${chain}${otherChain} and keep enough of ${chain}'s gas token for a month of transactions.`,
      cost: `${gas} per transaction, plus the bridge fee`,
      time: '15 minutes',
    },
    {
      text: core,
      cost: `$${capital} of capital and ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: second,
      cost: `about $${Math.round(capital / 2)} of capital and ${gas}`,
      time: '15 minutes',
    },
    {
      text: `Make one qualifying action each week, such as ${weekly}.`,
      cost: `${gas} a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot, and check ${p.name}'s own points or rewards page each week for tasks.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, claim only from the link ${p.name} itself publishes, and write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
  ];
}

/** A top-10 pick's reason, written from its own figures: why this one is worth farming. */
export function pickReason(
  row: {
    name: string;
    category: string | null;
    chains: string[];
    tvl_usd: number;
    change_7d: number | null;
    age_days: number | null;
    implied_value_usd: number;
    airdrop_pool_usd: number;
    farmability: Farmability;
    early_score: number;
  },
  comp: { multiple: number; n: number; fallback: boolean; category: string },
  categoryRank: number,
  categoryTotal: number,
): string {
  const parts: string[] = [];
  const tvlM = row.tvl_usd >= 1e9 ? `$${(row.tvl_usd / 1e9).toFixed(2)}B` : `$${Math.round(row.tvl_usd / 1e6)}M`;
  parts.push(
    `${row.name} is the largest pre-token ${row.category ?? 'protocol'} on the board by TVL at ${tvlM} (#${categoryRank} of ${categoryTotal} in its category), so a launch here would be the category's biggest event.`,
  );
  parts.push(
    `Live ${comp.category} protocols trade at a median ${comp.multiple.toFixed(2)}x TVL${comp.fallback ? ' (global median: too few same-category comps to use)' : ` across ${comp.n} traded comps`}, which puts its implied value at $${(row.implied_value_usd / 1e6).toFixed(0)}M and the airdrop pool at $${(row.airdrop_pool_usd / 1e6).toFixed(1)}M under the 7.5% assumption.`,
  );
  if (row.change_7d !== null && row.change_7d > 5) {
    parts.push(`TVL is growing fast at +${row.change_7d.toFixed(1)}% in seven days, so the window is now, while the protocol is still expanding.`);
  } else if (row.change_7d !== null && row.change_7d < -10) {
    parts.push(`TVL fell ${row.change_7d.toFixed(1)}% in seven days, which keeps the crowd away — but the size and tenure still make it the category's main candidate.`);
  }
  if (row.age_days !== null && row.age_days < 365) {
    parts.push(`It has run only ${row.age_days} days with no token on record, so it is early: the points, if they exist, are young and the field is thin.`);
  } else if (row.age_days !== null && row.age_days >= 730) {
    parts.push(`It has run ${(row.age_days / 365).toFixed(1)} years with no token on record — the longest-tenured kind of candidate, and the one most overdue for a launch.`);
  }
  parts.push(
    `Farming it scores ${row.farmability.score}/100 (grade ${row.farmability.grade}) on cost, time and risk${row.chains.length > 1 ? `, and it already spans ${row.chains.length} chains (${row.chains.slice(0, 3).join(', ')})` : ', on a single chain'}, so the plan below is the cheap way in.`,
  );
  return parts.join(' ');
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const comps = buildComps(snapshot);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable pre-token protocol the watchlist does not name,
  // at any TVL. Never a replacement for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  // Category rank, for the top-10 narratives: a protocol's place among its category's board rows.
  const categoryCounts = new Map<string, number>();
  for (const p of chosen.values()) {
    const c = p.category ?? 'Other';
    categoryCounts.set(c, (categoryCounts.get(c) ?? 0) + 1);
  }
  const categorySeen = new Map<string, number>();

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model, comps);
    const farm = farmability(p, v.age);
    const early = earlyScore(p, v.age);
    return { p, v, farm, early };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => {
    const cat = s.p.category ?? 'Other';
    const catRank = (categorySeen.get(cat) ?? 0) + 1;
    categorySeen.set(cat, catRank);
    const pick =
      i < 10
        ? pickReason(
            {
              name: s.p.name,
              category: s.p.category,
              chains: s.p.chains,
              tvl_usd: s.p.tvl_usd,
              change_7d: s.p.change_7d,
              age_days: s.v.age,
              implied_value_usd: s.v.implied,
              airdrop_pool_usd: s.v.airdropPool,
              farmability: s.farm,
              early_score: s.early.score,
            },
            s.v.comp,
            catRank,
            categoryCounts.get(cat) ?? 1,
          )
        : null;
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      on_watchlist: snapshot.watchlist.includes(s.p.slug),
      age_days: s.v.age,
      implied_value_usd: s.v.implied,
      airdrop_pool_usd: s.v.airdropPool,
      farmability: s.farm,
      early_score: s.early.score,
      early_signals: s.early.signals,
      pick_reason: pick,
      model: {
        // Full precision, not rounded: the dashboard recomputes the implied value from
        // these exact numbers, so its audit line can say it matches board.json.
        comp_multiple: s.v.comp.multiple,
        comp_category: s.v.comp.category,
        comp_n: s.v.comp.n,
        comp_fallback_global: s.v.comp.fallback,
        growth_pct: round4(s.v.growthPct),
        growth_multiplier: s.v.growthMult,
        age_multiplier: s.v.ageMult,
        chain_multiplier: s.v.chainMult,
        age_days: s.v.age,
      },
      farm_steps: farmSteps(s.p, s.v.age).map(stepText),
    };
  });
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The live-token protocols, by market cap, for the dashboard's Live comps view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? Math.round((p.mcap_usd / p.tvl_usd) * 1e4) / 1e4 : null,
    }));
}

/** A board row's compact form for data.js, with the farm plan and scores the page renders. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    on_watchlist: row.on_watchlist,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    airdrop_pool_usd: row.airdrop_pool_usd,
    comp_multiple: row.model.comp_multiple,
    comp_category: row.model.comp_category,
    comp_n: row.model.comp_n,
    comp_fallback_global: row.model.comp_fallback_global,
    growth_multiplier: row.model.growth_multiplier,
    age_multiplier: row.model.age_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    farmability: row.farmability,
    early_score: row.early_score,
    early_signals: row.early_signals,
    pick_reason: row.pick_reason,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const comps = buildComps(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const compsList: CategoryComps[] = [...comps.byCategory.values()].sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    off_watchlist_above_floor: board.filter((r) => !r.on_watchlist && r.tvl_usd >= snapshot.floor_usd).length,
    total_implied_usd: board.reduce((n, r) => n + r.implied_value_usd, 0),
    total_airdrop_usd: board.reduce((n, r) => n + r.airdrop_pool_usd, 0),
    global_median_multiple: Math.round(comps.globalMedian * 1e4) / 1e4,
    rows: board.map(radarRow),
    live,
    comps: compsList,
    top_picks: board
      .filter((r) => r.pick_reason !== null)
      .map((r) => ({ rank: r.rank, slug: r.slug, name: r.name, reason: r.pick_reason! })),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value over the cap`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
