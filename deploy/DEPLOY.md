# Autonomous Trader VPS Deployment

This runbook stages the autonomous trader on the GapGuard VPS. It is documentation
only: do not apply these commands until the operator has separately approved the
VPS change and live arming.

The safe rollout order is fixed:

1. Install a disabled, kill-switched service whose `ExecStart` is forced to
   `auto:trade:dryrun`.
2. Explicitly enable only the dry-run and observe at least one full 30-minute
   timer cycle.
3. Validate the installed Bitget response shape through a sanitized, read-only
   reconciliation observation.
4. Reapply the kill-switch file and stop the timer.
5. Only after reviewing both observations, change `ExecStart` to
   `auto:trade`, reload systemd, and explicitly re-arm live entry.

Do not skip from installation to the live script.

## Enforced boundaries

`AUTO_TRADE_ENABLED` defaults to `false` and must be exactly `true` before either
mode evaluates the market. Live mode then enforces all of these limits:

- At most 3 autonomous opens per UTC day.
- A 0.30 USDT daily realized-trade-PnL stop, calculated from reconciled fills
  plus USDT-denominated fees. This is not an account-wide loss or drawdown cap;
  it does not claim to cover unrealized PnL or every account adjustment.
- An entry risk budget no larger than 20% of current futures equity multiplied
  by Quorum's position multiplier.
- A default 20 USDT pre-submit notional upper bound, further reduced by the
  live market report and passport limits. The calculation uses the executable
  bid/ask; favorable execution can report a different filled notional.
- A complete spread below 25bps and a fill-or-kill limit at the executable
  quote. Missing/wider books abstain, and adverse movement cancels instead of
  executing beyond the quoted bound.
- No new entry while any USDT-FUTURES order is pending or position is open.
- One selected candidate and at most one order per invocation.
- Isolated margin, 1x leverage, and the same protected bracket calculation used
  by the manual broker path.

The daily PnL stop sets a persistent state trip. UTC rollover does not clear it.
Deleting `state/auto-trader-daily.json` is never a valid reset: that file also
contains duplicate-order reservations and reconciled counters. There is no
safe file-deletion shortcut. The dedicated `auto:trade:rearm` command acquires
the live lock, performs fresh read-only exchange reconciliation, refuses to run
while the touch-file gate, a pending order, an open position, or the daily PnL
stop remains active, and then clears only the persistent trip.

## 1. Prepare the checkout and service account

The examples use `/opt/gapguard`, a dedicated `gapguard` service account, and
`/usr/bin/npm`. Verify all three on the VPS and adjust the unit if the installed
paths differ.

```bash
command -v npm
sudo test -d /opt/gapguard
sudo install -d -o gapguard -g gapguard -m 700 /opt/gapguard/state
```

The service account needs read access to the checkout and signing key, plus write
access only to `state/`, the configured trade journal, and the Arena chain and
attestation outputs. Do not use world-writable permissions.

Install dependencies from the reviewed checkout before enabling the timer:

```bash
cd /opt/gapguard
sudo -u gapguard npm ci
npm run typecheck
npm test
npm run evidence:check
npm run manifest -- --check
```

## 2. Create the protected environment file

Create `/etc/gapguard-autotrader.env` with `sudoedit`; never place credentials in
the repository. It must be owned by root and readable only by root:

```bash
sudo install -o root -g root -m 600 /dev/null /etc/gapguard-autotrader.env
sudoedit /etc/gapguard-autotrader.env
sudo chmod 600 /etc/gapguard-autotrader.env
```

Set the following names. Insert the real credential and signing-key paths only in
the protected VPS file:

```dotenv
BITGET_API_KEY=<operator-supplied>
BITGET_SECRET_KEY=<operator-supplied>
BITGET_PASSPHRASE=<operator-supplied>
ARENA_SIGNING_KEY_FILE=/etc/gapguard/arena-signing-key.pem

AUTO_TRADE_ENABLED=false
AUTO_TRADE_MAX_TRADES_PER_DAY=3
AUTO_TRADE_MAX_DAILY_LOSS_USDT=0.30
AUTO_TRADE_MAX_POSITION_PCT=0.20
LIVE_MAX_NOTIONAL_USDT=20

AUTO_TRADE_STATE_PATH=/opt/gapguard/state/auto-trader-daily.json
AUTO_TRADE_LOCK_PATH=/opt/gapguard/state/auto-trader.lock
AUTO_TRADE_KILL_SWITCH_PATH=/opt/gapguard/state/AUTO_TRADE_KILL
AUTO_TRADE_DRY_RUN_STATE_PATH=/opt/gapguard/state/auto-trader-dry-run.json
AUTO_TRADE_DRY_RUN_LOCK_PATH=/opt/gapguard/state/auto-trader-dry-run.lock
AUTO_TRADE_ARENA_LOCK_PATH=/opt/gapguard/state/arena-chain.lock
```

Do not track this file, copy it into the checkout, or print its contents into the
journal. The repository ignores `state/`; credential files remain outside the
repository entirely.

## 3. Install the dry-run service and timer

Create `/etc/systemd/system/gapguard-autotrader.service`:

```ini
[Unit]
Description=GapGuard autonomous trader (dry-run burn-in)
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
User=gapguard
Group=gapguard
WorkingDirectory=/opt/gapguard
EnvironmentFile=/etc/gapguard-autotrader.env
ExecStart=/usr/bin/npm run auto:trade:dryrun
TimeoutStartSec=10min
UMask=0077
```

Create `/etc/systemd/system/gapguard-autotrader.timer`:

```ini
[Unit]
Description=Run GapGuard autonomous-trader gate every 30 minutes

[Timer]
OnBootSec=5min
OnUnitActiveSec=30min
AccuracySec=1min
Persistent=false
Unit=gapguard-autotrader.service

[Install]
WantedBy=timers.target
```

Create `/etc/systemd/system/gapguard-autotrader-rearm.service` for the rare,
operator-reviewed persistent-trip reset. Never enable or schedule this unit:

```ini
[Unit]
Description=GapGuard persistent kill-switch reconciliation and re-arm
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
User=gapguard
Group=gapguard
WorkingDirectory=/opt/gapguard
EnvironmentFile=/etc/gapguard-autotrader.env
ExecStart=/usr/bin/npm run auto:trade:rearm
TimeoutStartSec=10min
UMask=0077
```

Install with both independent entry gates still closed:

```bash
sudo touch /opt/gapguard/state/AUTO_TRADE_KILL
sudo systemctl daemon-reload
sudo systemctl enable --now gapguard-autotrader.timer
sudo systemctl list-timers gapguard-autotrader.timer
```

The resulting service must report a clean blocked run; it must not fetch market
data or issue a private exchange call while `AUTO_TRADE_ENABLED=false` or the
kill-switch file is present.

## 4. Observe a complete dry-run timer cycle

Confirm the installed unit still says `auto:trade:dryrun`, then change only
`AUTO_TRADE_ENABLED` to `true` in the protected environment file. Because the
service command fixes `--mode dry_run`, this arms market evaluation without
arming exchange writes.

```bash
sudo systemctl cat gapguard-autotrader.service
sudoedit /etc/gapguard-autotrader.env
sudo rm -- /opt/gapguard/state/AUTO_TRADE_KILL
sudo systemctl restart gapguard-autotrader.timer
sudo systemctl list-timers gapguard-autotrader.timer
```

Observe at least one timer-triggered dry run and the next scheduled invocation,
30 minutes later. A valid run either records a complete dry-run order plan or
reports `no actionable Quorum signal`; it must never report a live submission.

```bash
sudo journalctl -u gapguard-autotrader.service --since "1 hour ago"
sudo journalctl -u gapguard-autotrader.service -f
```

## 5. Validate live reconciliation shapes without placing an order

Before changing the unit to live mode, make one direct, read-only snapshot using
the installed credentials. The helper invokes Bitget account, pending-order,
position, fill-history, and order-history commands with `--read-only`. The probe
below prints only schema checks and observed field names, never raw rows, order
identifiers, balances, or credentials:

```bash
sudo -i
cd /opt/gapguard
set -a
. /etc/gapguard-autotrader.env
set +a
./node_modules/.bin/tsx -e '
import { readAutoTraderExchangeSnapshot } from "./src/autoTraderExchange.ts";
const now = new Date();
const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
readAutoTraderExchangeSnapshot({ pnlSince: dayStart, orderHistorySince: dayStart })
  .then((snapshot) => {
    const orders = [...snapshot.pendingOrders, ...snapshot.recentOrders];
    console.log(JSON.stringify({
      capturedAtIsTimestamp: Number.isFinite(Date.parse(snapshot.capturedAt)),
      captureStartedAtIsTimestamp: Number.isFinite(Date.parse(snapshot.captureStartedAt)),
      openActivityDuringCaptureIsBoolean: typeof snapshot.openActivityDuringCapture === "boolean",
      equityIsFinite: Number.isFinite(snapshot.equityUSDT),
      realizedTradePnlIsFinite: Number.isFinite(snapshot.realizedPnlUSDT),
      pendingOrdersIsArray: Array.isArray(snapshot.pendingOrders),
      openPositionsIsArray: Array.isArray(snapshot.openPositions),
      recentOrdersIsArray: Array.isArray(snapshot.recentOrders),
      observedOrderFields: [...new Set(orders.flatMap((row) => Object.keys(row)))].sort(),
      observedPositionFields: [...new Set(snapshot.openPositions.flatMap((row) => Object.keys(row)))].sort()
    }, null, 2));
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
'
exit
```

All schema-check booleans must be `true`, and the strict parser must complete without an API
shape or pagination error. Save the sanitized output with the deployment review.
If returned order or position lists are empty, record that limitation explicitly;
do not claim those populated row shapes were observed.

## 6. Promote to live only after separate operator approval

First close the entry gate and stop all scheduled runs:

```bash
sudo touch /opt/gapguard/state/AUTO_TRADE_KILL
sudo systemctl stop gapguard-autotrader.timer
sudo systemctl stop gapguard-autotrader.service
```

Review the full timer-cycle logs, the sanitized reconciliation observation, the
current persistent state, and the exchange for pending orders or open positions.
Only after explicit live-arming approval, replace the service's `ExecStart` with:

```ini
ExecStart=/usr/bin/npm run auto:trade
```

Then reload while the kill-switch file is still present:

```bash
sudo systemctl daemon-reload
sudo systemctl start gapguard-autotrader.timer
sudo systemctl start gapguard-autotrader.service
sudo journalctl -u gapguard-autotrader.service -n 100 --no-pager
```

The manual start must block on the touch-file gate. The final live-arming action
is an explicit operator step:

```bash
sudo rm -- /opt/gapguard/state/AUTO_TRADE_KILL
sudo systemctl enable --now gapguard-autotrader.timer
```

Removing the file re-arms only the touch-file entry gate. It does not clear a
persistent daily-PnL trip, resolve a durable pending-order reservation, cancel an
exchange order, or close a position.

To clear a persistent trip, first stop the timer and live service, set
`AUTO_TRADE_ENABLED=false`, and confirm the exchange has no exposure. Temporarily
remove the touch file, start the dedicated one-shot re-arm unit, inspect its log,
and restore the touch file before doing anything else:

```bash
sudo systemctl stop gapguard-autotrader.timer gapguard-autotrader.service
sudoedit /etc/gapguard-autotrader.env
sudo rm -- /opt/gapguard/state/AUTO_TRADE_KILL
sudo systemctl start gapguard-autotrader-rearm.service
sudo journalctl -u gapguard-autotrader-rearm.service -n 100 --no-pager
sudo touch /opt/gapguard/state/AUTO_TRADE_KILL
```

The one-shot must report `rearmed`. Any blocked or failed result leaves the
persistent trip intact. Re-enable live scheduling only through the reviewed
promotion procedure above.

## Stop, inspect, and recover

Block the next new entry without changing the timer:

```bash
sudo touch /opt/gapguard/state/AUTO_TRADE_KILL
```

Stop scheduling and terminate a currently running service:

```bash
sudo systemctl disable --now gapguard-autotrader.timer
sudo systemctl stop gapguard-autotrader.service
```

Inspect logs and status:

```bash
sudo systemctl status gapguard-autotrader.service gapguard-autotrader.timer
sudo journalctl -u gapguard-autotrader.service -f
```

A lock older than 10 minutes remains a hard block; the trader never removes it
automatically. Stop the timer and service, inspect the recorded PID and timestamp,
and confirm that PID is no longer running before removing the exact lock file:

```bash
sudo systemctl stop gapguard-autotrader.timer gapguard-autotrader.service
sudo cat /opt/gapguard/state/auto-trader.lock
ps -p <pid-from-lock> -o pid,lstart,cmd
sudo rm -- /opt/gapguard/state/auto-trader.lock
```

For dry-run overlap, inspect and remove
`/opt/gapguard/state/auto-trader-dry-run.lock` instead. Never remove either lock
while its recorded process is alive, and never delete the daily state file as a
recovery shortcut.
