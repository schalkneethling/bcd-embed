# Load test

A [k6](https://grafana.com/docs/k6/latest/) script that drives the bcd-embed API from one machine at 20 to 24
requests per second. The plan, the pass marks and the limits of what it shows are in
[Document 11](../docs/planning/11-load-test.md). This page says how to run one generator.

## What is here

| File                 | Purpose                                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `load-test.js`       | The k6 script. It has no default host.                                                                                      |
| `keys.json`          | Public feature keys for snapshot `bcd-8.1.9-gen-0.1.0`, in five groups. Regenerate it with `build-key-list.mjs`.            |
| `build-key-list.mjs` | Writes `keys.json` from a locally generated artifact folder. It sends no request.                                           |
| `local-server.mjs`   | The repository's request handler over that folder, on `127.0.0.1`. The target for every local run.                          |
| `lib/`               | Plain modules that both k6 and the unit tests (`tests/load-test.test.ts`) load: the mix, byte comparison, the target guard. |

## Prerequisites

- k6 v2.4.0 (`k6 version`).
- Node 24 and `pnpm install`, for the local server and the key list builder.

## Run it against a local server

```sh
# 1. Build the packages the generator and server need.
pnpm --filter @bcd-embed/schema build && pnpm --filter @bcd-embed/core build \
  && pnpm --filter @bcd-embed/generator build && pnpm --filter @bcd-embed/server build

# 2. Generate the artifacts (about a minute and 900 MB). Use any folder outside the repository.
node packages/generator/dist/bin.js --out /tmp/bcd-artifacts \
  --generated 2026-11-22T08:00:00Z --expires 2027-02-20

# 3. Serve them on http://127.0.0.1:8787.
node load-test/local-server.mjs --artifacts /tmp/bcd-artifacts

# 4. In another terminal, run the 60-second smoke profile.
BASE_URL=http://127.0.0.1:8787 PROFILE=smoke k6 run --no-usage-report --rps 24 load-test/load-test.js
```

The local server has no edge cache and no rate limiting rule, so it cannot show either. It checks the script
and the handler, not Cloudflare.

## Run one generator against a remote host

The script has no default host. It refuses a non-loopback host unless `CONFIRM_REMOTE` is set to that exact
host name, so a mistyped command or a variable left over in the shell cannot reach production. Set both
variables on the command, never with `export`, and keep the Mac awake with `caffeinate -i`, which
`man caffeinate` describes as preventing idle sleep while the command it wraps runs.

```sh
mkdir -p load-test/results
BASE_URL=https://api.browser-compat.dev CONFIRM_REMOTE=api.browser-compat.dev PROFILE=steady \
  caffeinate -i k6 run --no-usage-report --rps 24 --summary-export load-test/results/steady.json load-test/load-test.js
```

`load-test/results/` is git-ignored. The script prints its target host once at the start (`Target: ...`).

Rules for the run:

- Run it from one machine only. The zone's rule counts requests per IP address, and a second generator behind
  the same address would add to the count. Do not run two k6 processes at once.
- Send no other traffic from the Mac's IP address to `/v1/` while it runs, including a browser tab on the
  documentation or the introduction page that calls the API. The rule counts every request from that address.
- Never suspend the run (`kill -STOP`, closing the lid, Ctrl-Z). After a stall k6 starts the missed iterations
  at once, and the `rps` cap below is the only thing that holds that burst down.

## Settings

All settings are environment variables.

| Variable          | Meaning                                                                                            | Default |
| ----------------- | -------------------------------------------------------------------------------------------------- | ------- |
| `BASE_URL`        | The origin to test, with no path.                                                                  | none    |
| `CONFIRM_REMOTE`  | The exact host name (for example `api.browser-compat.dev`) that a non-loopback `BASE_URL` may use. | unset   |
| `PROFILE`         | `smoke`, `preflight`, `ramp`, `steady`, `ceiling` or `full`.                                       | `smoke` |
| `STEADY_SECONDS`  | Length of the `steady` phase.                                                                      | 600     |
| `CEILING_SECONDS` | Length of the `ceiling` phase.                                                                     | 300     |

| Profile     | Iterations per second   | Length            | Requests, about                                                               |
| ----------- | ----------------------- | ----------------- | ----------------------------------------------------------------------------- |
| `smoke`     | 1, every class in turn  | 60 s              | 64 (1.07 per second, because each of its four `compare` iterations sends two) |
| `preflight` | 5                       | 60 s              | 306                                                                           |
| `ramp`      | 1 rising to 20          | 60 s              | 640                                                                           |
| `steady`    | 20                      | `STEADY_SECONDS`  | 20.4 per second                                                               |
| `ceiling`   | 22                      | `CEILING_SECONDS` | 22.4 per second                                                               |
| `full`      | the three above in turn | all three         | all three                                                                     |

### The rate cap is load-bearing

The script sets `rps: 24` in its `options`, and the commands repeat it as `--rps 24`. k6's options reference
describes `rps` as the maximum requests per second summed across all VUs, and calls it discouraged because it
has caveats and is difficult to use correctly, mainly in cloud or distributed runs where each instance applies
the limit alone. Neither applies to one local process. It is used here because the arrival-rate executors it
is meant to replace do not cap a burst: after a stall they start the missed iterations at once. A review froze
k6 for 8 seconds during `PROFILE=ceiling`. Without `rps`, 66 requests went out in one second and 272 in 10
seconds, 91% of the rule's 300 per 10 seconds. With `rps: 24`, at most 24 or 25 went out in one second and
240 in 10 seconds. `maxVUs` is also limited to three seconds of requests, so the executor cannot start a
large backlog. See Document 11, section 3, for the measurements.

## Reading the result

The script stops the run on a 5xx rate above 1% (checked after 30 seconds), on a transport error rate above
1% (30 seconds), on an unexpected status rate above 1% (10 seconds; any status a request class does not expect,
such as a proxy's `403`), and on the first `429`. It fails at the end if any check, comparison or latency pass mark fails. k6
exits with code 99 when a threshold fails. See Document 11, section 7, for each pass mark and its source.

The counters to read are `conditional_304` (304 responses, counted apart from everything else),
`compare_ok` and `compare_mismatch` (compressed body against identity body), and `cache_status_responses` by
`cf-cache-status`. A cached 404 must keep `max-age=3600`; the check fails if the edge cache changes its
lifetime (issue #259).

## After a BCD update

`keys.json` is drawn from one BCD release, named in its `sourceVersion` field. A Dependabot BCD pull request may
change only the BCD pins and the lockfile, so it cannot regenerate the list. While the installed release is
newer than `sourceVersion`, `tests/load-test.test.ts` skips its two checks against the installed data. Those
checks are that every listed key still exists, and that no `missing` or `grouping` key has become addressable.
The list also has to name the snapshot the live Worker serves, because the script requests that snapshot's
paths. So regenerate it only after the new snapshot is published and live, not when the BCD update reaches
`main`. In the same pull request, change the snapshot that `tests/load-test.test.ts` expects ("names the
snapshot that the live Worker serves") and the snapshot named in this README's table. The skipped checks then
run again:

```sh
node packages/generator/dist/bin.js --out /tmp/bcd-artifacts \
  --generated 2026-11-22T08:00:00Z --expires 2027-02-20
node load-test/build-key-list.mjs --artifacts /tmp/bcd-artifacts
```
