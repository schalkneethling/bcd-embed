# Phase 5: freshness and observability

## Automated BCD updates

Dependabot groups the exact `@mdn/browser-compat-data` pin across `core`,
`generator`, and `worker`. It preserves the repository's existing daily
schedule and cooldown values. The generator reads its required BCD version from
its own exact dependency declaration; do not create a second source pin.

`Freshness` runs only for same-repository Dependabot pull requests targeting `main`.
The guard verifies login, immutable account ID `49699333`, bot type, and both
head and base repositories. Its
`pull_request_target` workflow checks out the base SHA as trusted source and
the candidate SHA as data. It rejects any changed path beyond the three BCD
manifests and `pnpm-lock.yaml`, confirms all three pins match, and checks the
candidate lock integrity against npm's public registry. Candidate source is
never built or executed. The base generator produces both output trees;
candidate manifests and lockfile are copied into a trusted base tree and
installed with `--ignore-scripts`. Trusted base dependencies are installed before
the YAML parser runs. Structural lockfile checks reject arbitrary BCD tarballs,
importer changes, snapshot dependencies, and unrelated package changes. The
trusted generator's output-diff policy validates contracts and compares semantic
changes with provenance normalized, enforcing reviewed thresholds. Non-BCD
dependency updates skip generation and cannot enable BCD auto-merge.

Lockfile validation takes O(L log L) time and O(L) space for L parsed lockfile
entries (canonical key sorting); it never scans the BCD dataset. Output comparison
uses the generator's bounded-memory semantic diff and its documented complexity.

Auto-merge defaults off. Set repository variable `BCD_EMBED_AUTO_MERGE_ENABLED`
to exactly `true` only after configuring the rules below. The merge job waits
for the latest CI run at the checked candidate SHA and verifies `CI / check`
has `success`, not skipped or neutral. It rechecks the trusted PR immediately
before `gh pr merge --auto --squash --match-head-commit`; no administrative
bypass. Explicit CI verification matters because `--auto` can merge immediately
when required-check rules are absent. Before enabling it, an
operator must make both `CI / check` and `Freshness / freshness` required
status checks in the repository ruleset; GitHub then waits for those checks on
the current head before merging. If that ruleset is absent, auto-merge is not a
valid deployment control.

## Publication checkpoint: local by default

The weekly backstop validates `main`, performs a full-volume generation check,
and preserves an immutable GitHub Actions candidate artifact. It does not
provision Cloudflare, upload to R2, or deploy a Worker.

The existing protected manual publish job requires dispatch from `main`, an
operator request, and the configured `bcd-embed-production` environment controls.
It restores the exact published candidate from private durable R2 controls into
an empty local directory. GitHub Actions artifacts are review evidence, not
baseline authority. It generates the candidate in the same run.
The publisher parses `BCD_EMBED_DIFF_APPROVAL`; its
baseline and candidate hashes must match those output trees before its explicit
`--execute-remote-write`, account, bucket, and credentials are accepted. An
environment variable alone is never approval. Record that reviewed hash with
the release; a stale or arbitrary approval must block publication. Before
regenerating, the protected job reads the publisher reservation for the
deterministic snapshot ID. A prior reservation supplies its exact `generated`
and `expires` values, so a resumed run cannot change bytes under that snapshot
ID. Bootstrap has no reservation and remains blocked by the same exact-hash
approval before any remote write.

The review candidate's generation window derives from the trusted commit time,
not a changing workflow wall clock; rerunning the same revision reproduces its
bytes. A durable reservation overrides that window for interrupted publication.
Generated/expires values are exported as step outputs and explicitly provided to
the generator. Install/build and generation steps receive no R2 credentials.
Only durable read operations and the explicit publisher receive them.
Both ordinary and protected candidate artifacts preserve the hidden manifest;
the protected exact candidate remains available if approval blocks publication.
Publication failures participate in Sentry notifications.

Manual-only publication is the explicitly approved scope. Push and scheduled
runs prepare local artifacts; only a dispatch from `main` with `publish=true`
can enter protected publication. Required exact-hash approval remains in place
for every manual publication. No automatic production publication is configured.
Non-main dispatches cannot run preparation or credentialed failure notification.
Artifact names include the run attempt so rerun-all does not collide with an
earlier immutable upload. Builds include workspace dependencies in topological
order; fresh runners need no pre-existing schema/core output. No Cloudflare
resources, secrets, or live data were changed during this checkpoint.

Remote publication processes roughly 124,000 files. It is bounded to four
parallel uploads plus verified reads and durable baseline restoration, so it
can take hours even though local generation is much faster. The protected job
therefore has a six-hour timeout; reservations make an interrupted remote run
resumable without changing its snapshot bytes.

## Sentry prerequisites

Set `SENTRY_DSN` as a Worker secret and GitHub Actions secret only after an
operator has configured an alert and tested it with a non-production project.
No DSN is committed. Without it, Worker reporting and pipeline notification are
disabled and say so; neither claims delivery. Worker events have a strict
whitelist and omit request, user, breadcrumb, error-message, stack, and extra
data. Sentry's Cloudflare SDK flushes through `ctx.waitUntil`; this integration
uses the SDK's source-verified 2-second Cloudflare flush bound and reporting
errors never affect serving.

Pipeline failure notifications use the Sentry SDK's envelope endpoint protocol
with only fixed event/status identifiers, a two-second abort signal, and a
fake-transport test. A notification transport failure fails its notification
job; no successful-delivery message is emitted first.
