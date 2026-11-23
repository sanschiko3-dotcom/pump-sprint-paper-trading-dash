// Dip rider for the agent.fun pump.fun replay (agent-fun/replay/v2).
// The grader runs `node /bot/main.ts`; the strategy lives in strategy.ts and the SDK shim is
// the kit's sdk/ts/makefun-bot.ts, vendored byte for byte.
//
// The bot buys the pullback after a proven run-up (>= 2x create, dip 15-35% from the
// trailing 300-slot high, real SOL >= 15, >= +1 SOL net buying over the last 10 trades)
// and exits fast on a -12% stop, a 20% trailing stop, a +25% take-profit, or a 600-slot
// hold cap. Dev window (full 128,058 events): +0.72 SOL mean over 5 fail keys,
// 102 trips, 37 wins, 96 coins, max drawdown 0.042. See STRATEGY.md for the evidence.

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

await runBot(createStrategy(DEFAULT_PARAMS));
