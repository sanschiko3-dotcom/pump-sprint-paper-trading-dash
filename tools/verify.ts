// Robustness check: current defaults across 4 fail keys + 2x fees + neighbor params.
import { createStrategy, DEFAULT_PARAMS, type Params } from '../strategy.ts';
import { loadDataset, makeHello, phaseSeed, simulate } from '/home/hatch/workspace/makefun/kits/pump-sprint/u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4-kit/baselines/pilot/momentum/tools/sim.ts';

const kit = process.argv[2];
const ds = loadDataset(kit);
const hello = makeHello(phaseSeed('pilot-pumpfun-replay', 'dev', ds.sha256));
const sol = (x: bigint) => (Number(x) / 1e9).toFixed(3);
function run(label: string, overrides: Partial<Params>) {
  const nets: number[] = [];
  let exBest = 0, dd = 0, fills = 0, coins = 0, trips = 0, wins = 0;
  for (const fk of [11n, 22n, 33n, 44n]) {
    const r = simulate(ds, hello, createStrategy({ ...DEFAULT_PARAMS, ...overrides }), { failKey: fk });
    const pnls = r.trips.map((t) => Number(t.pnl) / 1e9).sort((a, b) => b - a);
    const net = Number(r.netPnl) / 1e9;
    nets.push(net);
    exBest += (net - (pnls[0] ?? 0)) / 4;
    dd = Math.max(dd, r.maxDrawdown); fills = r.fills; coins = r.mints; trips = r.trips.length; wins = r.trips.filter((t) => t.pnl > 0n).length;
  }
  const twoX = simulate(ds, hello, createStrategy({ ...DEFAULT_PARAMS, ...overrides }), { feeMultiplier: 2n });
  const mean = nets.reduce((a, b) => a + b, 0) / nets.length;
  console.log(`${label}: mean ${mean.toFixed(3)} worst ${Math.min(...nets).toFixed(3)} keys [${nets.map((n) => n.toFixed(2)).join(', ')}] exBest ${exBest.toFixed(3)} 2xfees ${sol(twoX.netPnl)} fills ${fills} coins ${coins} trips ${trips} wins ${wins} dd ${dd.toFixed(3)}`);
}
run('defaults', {});
run('dipMin 0.08', { dipMin: 0.08 });
run('dipMin 0.12', { dipMin: 0.12 });
run('dipMax 0.30', { dipMax: 0.3 });
run('dipMax 0.40', { dipMax: 0.4 });
run('runupReq 1.4', { runupReq: 1.4 });
run('runupReq 1.6', { runupReq: 1.6 });
run('trail 0.10', { trail: 0.1 });
run('trail 0.15', { trail: 0.15 });
run('hardTp 0.20', { hardTp: 0.2 });
run('hardTp 0.30', { hardTp: 0.3 });
run('stopLoss 0.06', { stopLoss: 0.06 });
run('stopLoss 0.10', { stopLoss: 0.1 });
