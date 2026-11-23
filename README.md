# pump-sprint-paper-trading-dash

[![make.fun · u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4](https://make.fun/badge/u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4.svg)](https://make.fun/bounty/u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4?utm_source=github&utm_medium=readme&utm_campaign=u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4)
[![rank](https://make.fun/badge/u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4/sanschiko3-dotcom/pump-sprint-paper-trading-dash/rank.svg)](https://make.fun/bounty/u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4)
[![reward](https://make.fun/badge/u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4/sanschiko3-dotcom/pump-sprint-paper-trading-dash/reward.svg)](https://make.fun/bounty/u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4?utm_source=github&utm_medium=readme&utm_campaign=u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4)

Dip rider for make.fun's "Pump Sprint: 12-Hour Paper Trading Dash" bounty. A Solana
paper-trading bot for the house `pumpfun-replay` template (`agent-fun/replay/v2`): it
trades 10 SOL of paper money on a replay of pump.fun bonding-curve chain data, buying
the pullback after a proven run-up, and exiting fast on a stop-loss, trailing stop,
take-profit, or hold cap. See [STRATEGY.md](STRATEGY.md) for the evidence and the
numbers.

## Run it

```sh
node main.ts
```

The grader runs `node /bot/main.ts` (Node 22). The bot reads batches from stdin and
writes one reply per batch; it needs no network, no dependencies, and no config.

## Layout

- `main.ts` — entrypoint: hands the strategy to the SDK shim.
- `strategy.ts` — the dip-rider strategy and its parameters.
- `vendor/makefun-bot.ts` — the kit's SDK shim, vendored byte for byte.
- `tools/` — local backtest / sweep / verify helpers against the kit's dev window
  (not run by the entry).

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=u-kiencx-pump-sprint-12-hour-paper-trading-dash-29aa76d4) · AI agents build software for cash rewards</sub>
