// Dip rider for the pump.fun bonding-curve replay (agent-fun/replay/v2).
//
// What the dev window (24h, 1222 coins) shows, and what this bot is built on:
// - Most coins never move (median coin ends ~1.00x its create price); the money is in the
//   minority that spikes: 280 coins peak >=2x, 74 peak >=5x, 35 complete.
// - Chasing the spike loses: after a coin first hits 1.5x its create price, 62% of them dip
//   >=8% below the trigger within 100 slots (median low 0.81x), so a tight stop is hit
//   almost at once. A 243-combo sweep of the chase-the-spike version capped at -0.22 SOL.
// - The entry that works is the dip AFTER a proven run-up: for coins that ran >=1.5x
//   and then pulled back 10-35% from their trailing 300-slot high (real SOL >= 5), the
//   max forward move in 300 slots is a median +20% (p75 +49%), with 50% reaching >=+20%.
//   Buy the pullback at once while buyers are stepping back in, take the bounce, leave
//   fast. (Waiting for a +5% bounce confirmation was tried and rejected: it cost
//   0.06-0.14 SOL vs entering at once, because the bounce is brief.)
// - Plain dip-buying (no run-up filter) is weak (median max bounce +6%): the run-up
//   filter is what separates a dip from a dead coin.
// - Coins that reach >=25 SOL of real reserves complete 27% of the time and their median
//   max forward move is +44% (p75 +233%): while a held coin is that deep, the trailing
//   stop is widened and the hold cap lifted ("ride" mode).
//
// Entries: small (stakeSol, capped by the 1%-of-real-reserve rule), one per coin, only on
// coins with a proven run-up, a pullback in range, and buy flow resuming.
// Exits (whole position, first trigger wins): hard stop-loss, trailing stop from the best
// close value (armed once up trailArm), hard take-profit, or a short max-hold. Guardrail
// probes keep the run above 20 coins / 200 fills when the bot's own flow lags the pace.
//
// Deterministic by construction: no clock, no randomness, no I/O; iteration only over
// insertion-ordered maps (held positions are visited in sorted mint order).

import type { Batch, Bot, BotState, OrderInput, Pubkey } from './vendor/makefun-bot.ts';

export interface Params {
  /** Lookback (slots) for the trailing high the pullback is measured from. */
  highWindow: number;
  /** The coin must have reached at least this multiple of its create price. */
  runupReq: number;
  /** Pullback from the trailing high, at least this (fraction). */
  dipMin: number;
  /** ...and not more than this (a pullback, not a collapse). */
  dipMax: number;
  /** Price now must still be at least this multiple of the create price. */
  minFloor: number;
  /** Last N trades checked for resuming buy flow. */
  flowTrades: number;
  /** Of those, at least this many must be buys. */
  minFlowBuys: number;
  /** The most recent trade must be a buy (the dip is being bought). */
  lastMustBeBuy: boolean;
  /** Net buy SOL over the flow window must be at least this. */
  minNetFlowSol: number;
  /** Curve real SOL bounds at entry. */
  minRqSol: number;
  maxRqSol: number;
  /** SOL to put into one position (capped by the 1% reserve rule and cash). */
  stakeSol: number;
  /** Smallest buy worth sending. */
  minBuySol: number;
  /** Slippage on buys (bps); sells always go out at 10000. */
  buySlipBps: number;
  /** Exits. */
  stopLoss: number;
  trail: number;
  /** The trailing stop arms once value reached cost * (1 + trailArm). */
  trailArm: number;
  /** Hard take-profit (whole exit). */
  hardTp: number;
  /** Exit after this many slots held. */
  maxHold: number;
  /** Real SOL at which a held coin switches to ride mode (wider trail, longer hold). */
  rideRqSol: number;
  /** Trailing stop in ride mode. */
  rideTrail: number;
  /** Max hold in ride mode. */
  rideMaxHold: number;
  /** In ride mode, ignore stop-loss / trail / hard-TP and hold to completion or rideMaxHold. */
  rideNoExit: boolean;
  /** Slots to wait after an exit before the same curve may be bought again. */
  cooldown: number;
  /** Most entries per curve over the run. */
  maxEntries: number;
  /** Most momentum positions open at once. */
  maxMain: number;
  /** Most SOL at cost across all positions at once (a drawdown guard). */
  maxExposureSol: number;
  /** Guardrail pacing targets: the bar is >= 20 distinct coins; targetFills is
   * deliberately low (probes cost ~2.7% per round trip in fees, so they top up the
   * coin count, never chase fills). */
  targetCoins: number;
  targetFills: number;
  paceSecs: number;
  probeSol: number;
  maxProbes: number;
}

export const DEFAULT_PARAMS: Params = {
  highWindow: 300,
  runupReq: 1.5,
  dipMin: 0.1,
  dipMax: 0.35,
  minFloor: 1.2,
  flowTrades: 10,
  minFlowBuys: 3,
  lastMustBeBuy: true,
  minNetFlowSol: 0,
  minRqSol: 5,
  maxRqSol: 80,
  stakeSol: 0.7,
  minBuySol: 0.01,
  buySlipBps: 1500,
  stopLoss: 0.08,
  trail: 0.12,
  trailArm: 0.08,
  hardTp: 0.25,
  maxHold: 600,
  rideRqSol: 25,
  rideTrail: 0.2,
  rideMaxHold: 1500,
  rideNoExit: false,
  cooldown: 150,
  maxEntries: 1,
  maxMain: 5,
  maxExposureSol: 4,
  targetCoins: 25,
  targetFills: 60,
  paceSecs: 14_400,
  probeSol: 0.01,
  maxProbes: 1,
};

const LAMPORTS = 1e9;
const CURVE_FEE = 0.0125;
const BPS_PER_UNIT = 10_000;

interface Trade {
  slot: number;
  buy: boolean;
  sol: number;
  user: string;
  price: number;
}

interface Tape {
  created: number | null;
  createPrice: number;
  /** Highest price / create price seen so far. */
  maxRunup: number;
  trades: Trade[];
  entries: number;
  lastExit: number;
}

interface Held {
  opened: number;
  peakValue: number;
  invested: number;
  exiting: boolean;
  filled: boolean;
  lastValue: number;
}

export function createStrategy(p: Params = DEFAULT_PARAMS): Bot {
  const tapes = new Map<Pubkey, Tape>();
  const held = new Map<Pubkey, Held>();
  const probes = new Map<Pubkey, boolean>();
  let myFills = 0;
  const myCoins = new Set<Pubkey>();
  let firstTime: number | null = null;
  let lastTime: number | null = null;
  const keep = p.highWindow + 5;

  const tapeOf = (mint: Pubkey): Tape => {
    let t = tapes.get(mint);
    if (t === undefined) {
      t = { created: null, createPrice: 0, maxRunup: 0, trades: [], entries: 0, lastExit: -1e12 };
      tapes.set(mint, t);
    }
    return t;
  };

  /**
   * Dip-after-runup signal. A dip is bought at once when the coin has a proven run-up
   * and has pulled back dipMin..dipMax from its trailing high, with buy flow resuming.
   * (A bounce-confirmation variant was tried and rejected: waiting for +5% off the dip
   * low cost 0.06-0.14 SOL vs entering at once, because the bounce is brief and the
   * entry lands after most of it.)
   */
  const entrySignal = (t: Tape, now: number, rqSol: number, price: number): boolean => {
    if (rqSol < p.minRqSol || rqSol > p.maxRqSol) return false;
    if (t.created === null || t.createPrice <= 0) return false;
    if (t.maxRunup < p.runupReq) return false;
    if (price / t.createPrice < p.minFloor) return false;
    // Trailing high over highWindow slots.
    let high = 0;
    for (let i = t.trades.length - 1; i >= 0; i--) {
      const tr = t.trades[i]!;
      if (tr.slot <= now - p.highWindow) break;
      if (tr.price > high) high = tr.price;
    }
    if (high <= 0) return false;
    const dip = 1 - price / high;
    if (dip < p.dipMin || dip > p.dipMax) return false;
    // Buy flow resuming over the last flowTrades trades.
    const n = Math.min(p.flowTrades, t.trades.length);
    if (n < p.flowTrades) return false;
    let buys = 0;
    let net = 0;
    for (let i = t.trades.length - n; i < t.trades.length; i++) {
      const tr = t.trades[i]!;
      if (tr.buy) {
        buys++;
        net += tr.sol;
      } else net -= tr.sol;
    }
    if (buys < p.minFlowBuys) return false;
    if (net < p.minNetFlowSol) return false;
    if (p.lastMustBeBuy && !t.trades[t.trades.length - 1]!.buy) return false;
    return true;
  };

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      const now = batch.slot;
      const traded = new Set<Pubkey>();
      for (const f of batch.fills) {
        if (f.status === 'filled' && !f.client_id.startsWith('_')) {
          myFills++;
          myCoins.add(f.mint);
        }
      }
      for (const e of batch.events) {
        if (e.block_time !== null) {
          if (firstTime === null) firstTime = e.block_time;
          if (lastTime === null || e.block_time > lastTime) lastTime = e.block_time;
        }
        if (e.event === 'CreateEvent') {
          const t = tapeOf(e.mint);
          t.created = e.slot;
          t.createPrice = Number(e.virtual_quote_reserves) / Number(e.virtual_token_reserves);
        } else if (e.event === 'TradeEvent') {
          const t = tapeOf(e.mint);
          const sol = Number(e.sol_amount) / LAMPORTS;
          const price = Number(e.virtual_quote_reserves) / Number(e.virtual_token_reserves);
          t.trades.push({ slot: e.slot, buy: e.is_buy, sol, user: e.user, price });
          if (t.createPrice > 0 && price / t.createPrice > t.maxRunup) t.maxRunup = price / t.createPrice;
          traded.add(e.mint);
        }
      }
      for (const mint of traded) {
        const t = tapes.get(mint)!;
        let cut = 0;
        while (cut < t.trades.length && t.trades[cut]!.slot <= now - keep) cut++;
        if (cut > 0) t.trades.splice(0, cut);
      }
      const marks = new Map(batch.marks.map((m) => [m.mint, m] as const));
      const pendingByMint = new Map<Pubkey, number>();
      for (const po of state.pending.values()) pendingByMint.set(po.order.mint, (pendingByMint.get(po.order.mint) ?? 0) + 1);

      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const tx = Number(state.txFeeLamports()) / LAMPORTS;

      // Exits first, in sorted mint order (deterministic).
      for (const mint of [...held.keys()].sort()) {
        const h = held.get(mint)!;
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!pendingByMint.has(mint)) {
            held.delete(mint);
            const t = tapeOf(mint);
            if (h.filled) t.lastExit = now;
            else t.entries--;
          }
          continue;
        }
        h.filled = true;
        if (curve === undefined || curve.complete) continue;
        const mk = marks.get(mint);
        const vq = mk ? Number(mk.virtual_quote_reserves) : Number(curve.virtual_quote_reserves);
        const vt = mk ? Number(mk.virtual_token_reserves) : Number(curve.virtual_token_reserves);
        const rqSol = (mk ? Number(mk.real_quote_reserves) : Number(curve.real_quote_reserves)) / LAMPORTS;
        const tokens = Number(pos.token_amount);
        const value = ((tokens * vq) / (vt + tokens) / LAMPORTS) * (1 - CURVE_FEE) - tx;
        const cost = Number(pos.cost_lamports) / LAMPORTS;
        if (value > h.peakValue) h.peakValue = value;
        h.lastValue = value;
        const riding = rqSol >= p.rideRqSol;
        const trail = riding ? p.rideTrail : p.trail;
        const maxHold = riding ? p.rideMaxHold : p.maxHold;
        let exit = h.exiting;
        if (!exit && !(riding && p.rideNoExit)) {
          if (value < cost * (1 - p.stopLoss)) exit = true;
          if (!exit && h.peakValue >= cost * (1 + p.trailArm) && value < h.peakValue * (1 - trail)) exit = true;
          if (!exit && value >= cost * (1 + p.hardTp)) exit = true;
        }
        if (!exit && now - h.opened > maxHold) exit = true;
        if (!exit) continue;
        h.exiting = true;
        if (pendingByMint.has(mint)) {
          let sellPending = false;
          for (const po of state.pending.values()) if (po.order.mint === mint && po.order.side === 'sell') sellPending = true;
          if (sellPending) continue;
        }
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
      }

      // Probe round trips: sell the whole probe as soon as its buy has landed.
      for (const [mint, selling] of probes) {
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!pendingByMint.has(mint)) probes.delete(mint);
          continue;
        }
        if (curve === undefined || curve.complete || pendingByMint.has(mint)) continue;
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
        if (!selling) probes.set(mint, true);
      }

      // Then entries.
      let free = Number(state.freeCashLamports()) / LAMPORTS;
      let slotsLeft = state.hello.caps.max_open_positions - state.committedPositionCount();
      let mainLeft = p.maxMain - held.size;
      let exposure = 0;
      for (const [mint, h] of held) exposure += Math.max(h.invested, Number(state.positions.get(mint)?.cost_lamports ?? 0n) / LAMPORTS);
      for (const mint of traded) {
        if (orders.length >= cap) break;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        if (pendingByMint.has(mint) || probes.has(mint) || held.has(mint)) continue;
        const t = tapes.get(mint)!;
        if (slotsLeft <= 0 || mainLeft <= 0) continue;
        if (t.entries >= p.maxEntries || now - t.lastExit < p.cooldown) continue;
        const price = Number(curve.virtual_quote_reserves) / Number(curve.virtual_token_reserves);
        const rqSol = Number(curve.real_quote_reserves) / LAMPORTS;
        if (!entrySignal(t, now, rqSol, price)) continue;
        const capSol = Math.floor(Number(state.maxBuyLamports(mint)) * 0.97) / LAMPORTS;
        let amount = Math.min(capSol, p.stakeSol, p.maxExposureSol - exposure);
        if (amount > free - tx) amount = free - tx;
        if (amount < p.minBuySol) continue;
        const lamports = BigInt(Math.floor(amount * LAMPORTS));
        orders.push({ side: 'buy', mint, quote_lamports: lamports, max_slippage_bps: p.buySlipBps });
        free -= amount + tx;
        exposure += amount;
        held.set(mint, { opened: now, peakValue: 0, invested: amount, exiting: false, filled: false, lastValue: 0 });
        t.entries++;
        slotsLeft--;
        mainLeft--;
      }

      // Guardrail pacing: open a probe when the bot's fills or coins lag the pace.
      if (probes.size < p.maxProbes && slotsLeft > 0 && firstTime !== null && lastTime !== null) {
        const pace = Math.min(1, (lastTime - firstTime) / p.paceSecs);
        const needCoins = myCoins.size < Math.ceil(p.targetCoins * pace);
        const needFills = myFills < Math.ceil(p.targetFills * pace);
        if (needCoins || needFills) {
          const minRq = (p.probeSol * BPS_PER_UNIT) / state.hello.caps.max_order_bps_of_real_reserve;
          for (const mint of traded) {
            if (orders.length >= cap || probes.size >= p.maxProbes) break;
            if (held.has(mint) || probes.has(mint) || pendingByMint.has(mint) || state.positions.has(mint)) continue;
            if (needCoins && !needFills && myCoins.has(mint)) continue;
            const curve = state.curves.get(mint);
            if (curve === undefined || curve.complete) continue;
            if (Number(curve.real_quote_reserves) / LAMPORTS < minRq * 1.5) continue;
            if (free < p.probeSol + 2 * tx) break;
            orders.push({ side: 'buy', mint, quote_lamports: BigInt(Math.floor(p.probeSol * LAMPORTS)), max_slippage_bps: p.buySlipBps });
            probes.set(mint, false);
            free -= p.probeSol + tx;
          }
        }
      }
      return orders;
    },
  };
}
