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
BASE_URL=http://127.0.0.1:8787 PROFILE=smoke k6 run --no-usage-report load-test/load-test.js
```

The local server has no edge cache and no rate limiting rule, so it cannot show either. It checks the script
and the handler, not Cloudflare.

## Run one generator against a remote host

The script refuses a non-loopback host unless `CONFIRM_REMOTE=yes` is set, and it has no default host, so a
mistyped command cannot reach production.

```sh
BASE_URL=https://api.browser-compat.dev CONFIRM_REMOTE=yes PROFILE=steady \
  k6 run --no-usage-report --rps 24 --summary-export result-steady.json load-test/load-test.js
```

Run it from one machine only. The zone's rule counts requests per IP address, and a second generator behind
the same address would add to the count. Do not run two k6 processes at once, because each sends its own
20 to 24 requests per second.

## Settings

All settings are environment variables.

| Variable          | Meaning                                                      | Default |
| ----------------- | ------------------------------------------------------------ | ------- |
| `BASE_URL`        | The origin to test, with no path.                            | none    |
| `CONFIRM_REMOTE`  | `yes` allows a host that is not loopback.                    | unset   |
| `PROFILE`         | `smoke`, `preflight`, `ramp`, `steady`, `ceiling` or `full`. | `smoke` |
| `STEADY_SECONDS`  | Length of the `steady` phase.                                | 600     |
| `CEILING_SECONDS` | Length of the `ceiling` phase.                               | 300     |

| Profile     | Iterations per second   | Length            | Requests, about |
| ----------- | ----------------------- | ----------------- | --------------- |
| `smoke`     | 1, every class in turn  | 60 s              | 65              |
| `preflight` | 5                       | 60 s              | 306             |
| `ramp`      | 1 rising to 20          | 60 s              | 640             |
| `steady`    | 20                      | `STEADY_SECONDS`  | 20.4 per second |
| `ceiling`   | 22                      | `CEILING_SECONDS` | 22.4 per second |
| `full`      | the three above in turn | all three         | all three       |

`--rps 24` is a second belt on top of the rate the executors set. k6's documentation discourages `--rps`
because it has caveats, so the script does not depend on it.

## Reading the result

The script stops the run on a 5xx rate above 1% (checked after 30 seconds), on a transport error rate above
1%, and on the first `429`. It fails at the end if any check, comparison or latency pass mark fails. k6
exits with code 99 when a threshold fails. See Document 11, section 7, for each pass mark and its source.

The counters to read are `conditional_304` (304 responses, counted apart from everything else),
`compare_ok` and `compare_mismatch` (compressed body against identity body), `cache_status_responses` by
`cf-cache-status`, and `current_404_max_age_14400` (how often the edge cache changed a 404's lifetime, issue
#259).
