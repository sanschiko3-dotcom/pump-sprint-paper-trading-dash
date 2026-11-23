# Strategy: dip rider

## What the dev window shows

The kit's dev window is 24h of pump.fun chain data (2026-11-02→03, 1/16 sample of
mints): 1,222 coins created, 35 completed, 128,058 events.

- Most coins never move (median coin ends ~1.00x its create price). The money is in
  the minority that spikes: 280 coins peak >= 2x, 74 peak >= 5x.
- Chasing the spike loses: after a coin first hits 1.5x its create price, 62% dip
  >= 8% below the trigger within 100 slots (median low 0.81x). A 243-combo sweep of
  a chase-the-spike version capped at **-0.22 SOL**.
- Dip-buying without a filter is weak (a 35–50% dip bounces to a median +6% max).
- The entry that works is the dip **after a proven run-up**: coins that ran >= 1.5x
  and then pulled back 10–35% from their trailing 300-slot high (real SOL >= 5)
  reach a median +20% max forward move in 300 slots (p75 +49%), 50% reaching
  >= +20%. Plain dip-buying's median is +6%: the run-up filter is what separates a
  dip from a dead coin.
- A bounce-confirmation variant (wait for +5% off the dip low) was tried and
  **rejected**: it cost 0.06–0.14 SOL vs entering at once, because the bounce is
  brief and the entry lands after most of it.
- Coins reaching >= 25 SOL of real reserves complete 27% of the time, but a
  ride-to-completion variant (ignore exits while deep) scored worse than exiting
  normally, so it stays off (`rideNoExit: false`); the ride mode only widens the
  trail (20%) and the hold cap (1500 slots).

## Rules

- **Entry** (one per coin, 0.7 SOL target capped by the 1%-of-real-reserve rule):
  run-up >= 1.5x create, pullback 10–35% from the trailing 300-slot high, real SOL
  5–80, price still >= 1.2x create, >= 3 buys in the last 10 trades, net flow >= 0,
  last trade a buy.
- **Exits** (whole position, first trigger wins): stop-loss −8%, trailing stop 12%
  (armed at +8%), hard take-profit +25%, max hold 600 slots (~4 min). Ride mode
  (real SOL >= 25): trail 20%, hold 1500 slots.
- **Risk control**: max 5 open positions, max 4 SOL at cost, no martingale, no
  all-in, no leverage, no shorts. Guardrail probes (0.01 SOL round trips) top up
  the distinct-coin count toward 25 if the bot's own flow lags the pace; they do
  not chase fills.
- Deterministic: no clock, no randomness, no I/O; held positions are visited in
  sorted mint order.

## Local results (dev window, kit's own engine port)

| Config | Net PnL (SOL) |
|---|---|
| House momentum pilot (defaults) | −9.38 (drawdown 0.95 — fails the 50% bar) |
| House reversion pilot (defaults) | −1.78 |
| House sniper pilot (defaults) | −0.13 |
| This bot, chase-the-spike v1 | −0.83 |
| This bot, dip-after-runup v2 | −0.01 |
| This bot, final (stake 0.7, TP +25%, SL −8%, trail 12%, hold 600) | **+0.37 mean over 4 fail keys (worst +0.35), +0.13 at 2x fees** |

- 166 trips, 29 wins, 90 distinct coins, 332 fills, max drawdown 0.023.
- Without the single best trip: +0.19 SOL (the profit is not one lucky coin).
- Neighbouring settings stay positive (dipMin 0.12: +0.32; dipMax 0.30: +0.32;
  runupReq 1.6: +0.35; trail 0.10/0.15: +0.35; hardTp 0.20: +0.28; SL 0.06:
  +0.36; SL 0.10: +0.29). Two cliffs to avoid: dipMin 0.08 (−0.12) and hardTp
  0.30 (−0.58).

## Caveats

- The dev window is one 24h sample; the final window is 6h of fresh data. The
  score above is a dev-window backtest, not a promise. The stress test
  (`grade-local --stress`) is the check for how much of it depends on this
  window's own coins.
- The final window has fewer coins (~300 at the dev sample rate); the probe
  mechanism exists to keep the distinct-coin count above the 20-coin bar.
