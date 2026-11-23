// Grid sweep of strategy parameters on the dev window (1 fail key for screening).
//   node tools/sweep.ts <kit dir> '<grid json>' [top N]
// Results also appended to tools/sweep-results.txt.
import { appendFileSync } from 'node:fs';
import { createStrategy, DEFAULT_PARAMS, type Params } from '../strategy.ts';
import { loadDataset, makeHello, phaseSeed, simulate } from '/home/hatch/workspace/makefun/kits/pump-sprint/u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4-kit/baselines/pilot/momentum/tools/sim.ts';

const kit = process.argv[2];
const grid = JSON.parse(process.argv[3]) as Record<string, unknown[]>;
const topN = Number(process.argv[4] ?? 15);
const ds = loadDataset(kit);
const hello = makeHello(phaseSeed('pilot-pumpfun-replay', 'dev', ds.sha256));
const keys = Object.keys(grid);
const combos: Record<string, unknown>[] = [{}];
for (const k of keys) { const next: Record<string, unknown>[] = []; for (const c of combos) for (const v of grid[k]!) next.push({ ...c, [k]: v }); combos.splice(0, combos.length, ...next); }
console.log(`combos ${combos.length}`);
const rows: any[] = [];
for (const c of combos) {
  const r = simulate(ds, hello, createStrategy({ ...DEFAULT_PARAMS, ...c } as Params), { failKey: 11n });
  const pnls = r.trips.map((t) => Number(t.pnl) / 1e9).sort((a, b) => b - a);
  const net = Number(r.netPnl) / 1e9;
  rows.push({ c, net, exBest: net - (pnls[0] ?? 0), fills: r.fills, coins: r.mints, dd: r.maxDrawdown, trips: r.trips.length, wins: r.trips.filter((t) => t.pnl > 0n).length });
}
rows.sort((a, b) => b.net - a.net);
for (const r of rows.slice(0, topN)) {
  const line = `net ${r.net.toFixed(3)} exBest ${r.exBest.toFixed(3)} fills ${r.fills} coins ${r.coins} trips ${r.trips} wins ${r.wins} dd ${r.dd.toFixed(3)} ${JSON.stringify(r.c)}`;
  console.log(line);
  appendFileSync(new URL('./sweep-results.txt', import.meta.url), line + '\n');
}
