# Document 1 — API Contract

**Status:** Draft for review
**Project name:** `bcd-embed`
**Contract version:** `v1`

---

## 1. Purpose and scope

This document defines the contract between the hosted data service and any consumer, including the web component (Document 3). It is a standalone specification: a third party should be able to build a different visualization against this contract, and the component should be replaceable without changing the service.

The contract is versioned and published as its own package. The service and the component both depend on it; neither owns it.

The service exposes browser compatibility data derived from `@mdn/browser-compat-data` (BCD). The underlying data is CC0. The transformation is offered under the project license. The payload contains no secrets, no per-identity rate limiting, and no personal data.

---

## 2. Design rule: where transformation logic lives

Rule:

> **The API answers "what is the support?" The consumer answers "how is it shown?"**

More precisely: a transformation must never alter or discard data in a way that could render it factually incorrect or open to misinterpretation. This rule determines what the service computes and what it leaves to the consumer.

**Required by the rule** (correctness concerns, performed by the service):

- Joins compatibility data against release metadata for each **support target** (browser or JavaScript runtime — canonical definition in §5.1). A version string arrives already paired with its release date and status, for browsers and runtimes alike.
- Normalizes version values — resolves the `≤` range notation and preview identifiers into structured fields instead of leaving them as strings.
- Groups parallel support branches. The underlying BCD data is accurate; the risk is in how it gets interpreted. A support array interleaves independent implementations (unprefixed, `-webkit-`, an `alternative_name`), and naive rendering as a single timeline can misrepresent it — a later unprefixed release appearing to precede an earlier prefixed one, or two unrelated implementations appearing as one continuous line of support. "Incorrect" here means that misinterpretation, not a fault in the source data. This is the most commonly mishandled piece of BCD consumption, and the service computes it once so every consumer gets the same, correctly grouped result.
- Computes a summary verdict per support target via a documented precedence (§6), because reducing several support statements to one answer is easy to get subtly wrong if left to each consumer. The full underlying statements are always shipped alongside the summary; the summary is a convenience, not a replacement.

**Forbidden by the rule** (presentational decisions, left to the consumer):

- CSS class names or an icon vocabulary.
- Deciding that "supported behind a flag" displays as unsupported. MDN's table takes this position; it is a rendering choice, not a data fact, and a consumer may reasonably take the opposite position.
- Deciding that a version range displays as an exact version.
- Localization.

These are documented as component-level decisions in Document 3.

---

## 3. Vocabulary

Features are addressed by BCD dotted keys, as published in the BCD schema and used in MDN front matter: `css.properties.display`, `api.AbortController`, `http.headers.Content-Type`, `javascript.builtins.Array.from`.

`v1` supports BCD keys only. `web-features` identifiers are not accepted, and Baseline status is out of scope entirely — not merely deferred as an additive field. The two vocabularies differ in granularity and governance, and bridging them is a separate problem this contract does not take on. Baseline data is only reconsidered if and when it becomes part of BCD itself.

A key must match `^[A-Za-z0-9][A-Za-z0-9._-]*$`. Anything else is rejected before reaching storage. Keys are case-sensitive.

---

## 4. Endpoints

All responses are JSON over HTTPS, `content-type: application/json; charset=utf-8`, with `access-control-allow-origin: *`. The data is public domain, so origins are not restricted.

### 4.1 Feature lookup

```
GET /v1/{snapshot}/features/{key}.json
```

`{snapshot}` is either `current` or a pinned snapshot identifier (§7). `{key}` is a BCD dotted key.

This is the endpoint the component calls. It returns flattened, normalized compatibility data for the key and every feature nested beneath it.

### 4.2 Support-target metadata

```
GET /v1/{snapshot}/browsers.json
```

Full metadata for every support target — browser or runtime: display names, release lists, release dates, statuses, preview names. Referenced support targets are also embedded in each feature response (§5), so most consumers do not need this endpoint directly. It exists for consumers building their own column sets or timelines.

### 4.3 Index

```
GET /v1/{snapshot}/index.json
GET /v1/{snapshot}/index/{namespace}.json
```

The enumerable list of every valid key. Without this, a consumer cannot distinguish "no data for this feature" from "the key is misspelled," and cannot build autocomplete or client-side validation. MDN's undocumented endpoint has no equivalent.

The full index is large (roughly 15,000 entries) and is also published sharded by top-level BCD namespace — `css`, `api`, `html`, `javascript`, `http`, `svg`, `mathml`, `webassembly`, `webdriver`, `webextensions` — so a consumer can load only what it needs.

### 4.4 Metadata

```
GET /v1/meta.json
```

Contract version, available snapshots, the current alias target, and generation timestamp. Used by a consumer to identify what it is talking to and by a cache to decide whether to revalidate.

### 4.5 Raw feature data

```
GET /v1/{snapshot}/raw/{key}.json
```

The untouched BCD subtree for `{key}`, prior to flattening, branch grouping, or any other normalization — generated by the same pipeline pass as §4.1, as a static artifact alongside it (Document 2 §3). This exists for a consumer that wants to run its own normalization or verify our transform against the source, without falling back to the npm package directly.

This resource carries no contract guarantee beyond "this is what BCD says." It is not versioned against the `contract` field, has no `summary`/`branches` shape, and its structure changes exactly when BCD's own schema changes. Consumers wanting the normalized, contract-conformant shape use §4.1.

---

## 5. Feature response shape

```jsonc
{
  "contract": "1.0.0",
  "generated": "2026-07-11T02:14:07Z",
  "source": {
    "package": "@mdn/browser-compat-data",
    "version": "7.1.3"
  },
  "query": "css.properties.display",

  "browsers": {
    "chrome": {
      "name": "Chrome",
      "type": "desktop",
      "previewName": "Canary"
    }
    // ...only the support targets (browsers and runtimes) referenced by this feature's support data
  },

  "features": [
    {
      "key": "css.properties.display",
      "name": "display",
      "depth": 0,
      "description": null,
      "mdnUrl": "https://developer.mozilla.org/docs/Web/CSS/display",
      "specUrls": ["https://drafts.csswg.org/css-display/#the-display-properties"],
      "status": {
        "experimental": false,
        "standardTrack": true,
        "deprecated": false
      },
      "support": {
        "chrome": {
          "summary": {
            "state": "supported",
            "versionAdded": "1",
            "versionRemoved": null,
            "releaseDate": "2008-12-11",
            "removalDate": null,
            "partialImplementation": false,
            "behindFlag": false,
            "prefix": null,
            "alternativeName": null,
            "isPreview": false,
            "hasNotes": false
          },
          "branches": [
            {
              "canonical": true,
              "prefix": null,
              "alternativeName": null,
              "statements": [
                {
                  "versionAdded": "1",
                  "versionAddedIsApproximate": false,
                  "versionRemoved": null,
                  "releaseDate": "2008-12-11",
                  "removalDate": null,
                  "isPreview": false,
                  "partialImplementation": false,
                  "prefix": null,
                  "alternativeName": null,
                  "flags": [],
                  "notes": [],
                  "implUrls": []
                }
              ]
            }
          ]
        }
      }
    }
    // ...nested sub-features, flattened, in document order
  ]
}
```

### 5.1 Notes on the shape

**`features` is a flat array, not a tree.** BCD nests sub-features arbitrarily deep; the service flattens once and carries a `depth` integer so a consumer can restore hierarchy for indentation or grouping. Order is stable and matches BCD's document order; a parent always precedes its children.

**`browsers` is scoped to the response, and covers more than browsers.** The field name follows BCD's own terminology, but its entries include both browsers and JavaScript runtimes (`nodejs`, `deno`, `bun`); the `type` field (`desktop`, `mobile`, `server`) distinguishes them and lets a consumer group them into columns. **This is the canonical definition of "support target"** — the inclusive term used throughout this document for any entry in this field, browser or runtime. Only support targets referenced by this feature's support data are included, and every one of them is: the service does not filter runtimes out or curate the set. Deciding which subset to display is entirely the consumer's responsibility.

**`support` is keyed by support target identifier; a given target may be absent.** Absence means BCD has no entry at all for that browser or runtime, which is distinct from a present entry with `state: "unknown"` (BCD explicitly records unknown support). Consumers must handle both.

**`branches` holds the pre-grouped parallel-implementation structure.** At most one branch is marked `canonical` (no prefix, no alternative name) and it sorts first when present. Remaining branches sort deterministically by `(alternativeName, prefix)`, independent of BCD's internal ordering. Within a branch, `statements` are ordered most-recent-first.

**`versionAddedIsApproximate`** captures BCD's `≤` notation as a boolean rather than embedding a sigil in a version string. MDN displays these as exact versions; the contract preserves the distinction and leaves the choice to the consumer.

**`flags` is always an array**, empty rather than absent, so a consumer testing "behind a flag" does not have to distinguish `undefined` from `[]`.

---

## 6. The `state` enum

`summary.state` takes one of five values, determined as follows:

| `state` | Condition |
| --- | --- |
| `unknown` | BCD records `version_added: null`. |
| `unsupported` | `version_added` is `false`, or a `version_removed` is present. |
| `preview` | Support was added in a release with status `beta`, `nightly`, or `planned`, or in the literal `preview` version. |
| `partial` | The selected statement carries `partial_implementation`. |
| `supported` | `version_added` is a real version value, with no `version_removed`, no `partial_implementation`, and not added in a preview-status release — unconditionally supported in this specific support target. |

**`state` is orthogonal to the modifiers.** `behindFlag`, `prefix`, and `alternativeName` are separate fields and do not collapse `state` to `unsupported`. MDN's table renders a flag-gated feature as unsupported; that is a rendering decision, and encoding it into the data would prevent a consumer from taking the opposite position. A consumer wanting MDN's behavior computes `state === "supported" && !behindFlag`; a consumer building a "what works behind a flag today" view has the data it needs either way.

**The summary is selected, not synthesized.** `summary` reports the fields of one statement chosen from `branches`, never a blend of several. Selection follows this precedence, in order:

1. Fully supported, no limitation.
2. Fully supported, notes only.
3. Supported under a prefix or alternative name.
4. Partial implementation.
5. Supported only behind a flag.
6. Removed or otherwise inactive.

This mirrors MDN's own precedence and is advisory only. `branches` remains authoritative.

---

## 7. Versioning and snapshots

Two independent axes.

**Contract version** (`v1` in the path) describes the shape of the JSON. It changes only on a breaking change to the response format. Additive fields ship within `v1`; the `contract` field in the body carries a full semantic version so a consumer can detect additions.

**Snapshot** identifies the BCD release the data was generated from. `current` is a moving alias to the most recent generation and is the component's default. Every generation is also published under an immutable, content-addressed path, so a consumer needing short-to-medium-term build stability can pin to it. Retention is bounded, not indefinite (Document 2 §3, default 90 days): pinning is for keeping a build or a staged rollout stable across a release cycle, not for indefinite historical reference. A pinned snapshot older than the retention window returns `snapshot_not_found` (§8); this project does not serve as a historical archive of past BCD data (Document 0 §3).

**Relationship between the two:** each contract version is pinned to a BCD major version. A breaking schema change in BCD itself is unlikely at this point — BCD has enough downstream consumers that such a change would be disruptive well beyond this project — but the policy exists as a safeguard regardless: if it happens, `v1` continues to be generated from the last compatible BCD major (frozen, and marked as such in `meta.json`), and `v2` is introduced for the new BCD major. `v1` is never silently reshaped. Deprecation of a contract version is announced in `meta.json` with a sunset date in advance.

Every response carries `source.version`, so a consumer can determine which BCD release it is looking at even when querying `current`.

---

## 8. Errors

Errors are JSON, never HTML, and carry a machine-readable `code`.

```jsonc
{
  "error": {
    "code": "feature_not_found",
    "message": "No compatibility data for key 'css.properties.dispaly'.",
    "query": "css.properties.dispaly",
    "didYouMean": ["css.properties.display"]
  }
}
```

| HTTP | `code` | Meaning |
| --- | --- | --- |
| 400 | `invalid_key` | Key failed the character allowlist. |
| 404 | `feature_not_found` | Well-formed key, no such feature in this snapshot. |
| 404 | `namespace_not_queryable` | Well-formed key, but it names an organizational namespace (e.g. `css`, `css.properties`) that carries no `__compat` of its own — never addressable, regardless of snapshot (Document 2 §3). |
| 404 | `snapshot_not_found` | Snapshot does not exist or has been retired. |
| 429 | `rate_limited` | Bandwidth protection. Carries `Retry-After`. |
| 503 | `generation_in_progress` | Only possible in a self-hosted dynamic deployment. |

`didYouMean` is optional, generated from the index by edit distance. A typo in a BCD key is the most likely consumer error.

`invalid_key` (400) and `feature_not_found` (404) are distinct: the former means the request is malformed and the consumer should fix its code; the latter means the key is plausible but BCD has no data, and the consumer's appropriate response is a "report missing data" affordance rather than a bare error.

`feature_not_found` and `namespace_not_queryable` are also distinct: `feature_not_found` means BCD might reasonably have data at this key and currently doesn't — a legitimate gap to report. `namespace_not_queryable` means this key can never resolve to a feature, in any snapshot, because it names a grouping rather than a feature — the fix is not to wait for BCD to add data, it is to query one of the addressable keys beneath it, discoverable via the index (§4.3).

---

## 9. Caching and transport

`current` responses use a moderate `max-age` with a longer `stale-while-revalidate`. Pinned snapshots are immutable, served with `max-age=31536000, immutable`.

Every response carries a strong `ETag` and supports conditional requests.

All responses are compressed, Brotli where the client supports it (falling back to gzip otherwise). Compatibility JSON is highly repetitive — a small vocabulary of field names and values (`versionAdded`, `partialImplementation`, browser identifiers) repeated across many entries — and compresses well under Brotli specifically; this affects the component's performance budget directly.

---

## 10. Abuse surface

The data is public domain and identical for every caller. There is no authentication, no per-user state, no write path, and no query engine — no injection surface, nothing to exfiltrate, no expensive computation an attacker can force. In the static architecture (Document 2), a request is a CDN file read.

What remains is bandwidth, handled at the edge: per-IP rate limiting, standard CDN protections, and a cache that absorbs the majority of legitimate traffic. The one required input validation is the key allowlist in §3, which prevents a malformed key from being interpreted as a path traversal when mapped to storage. This should be fuzz-tested, not just unit-tested.

A published fair-use expectation and an easy self-hosting path (Document 2 §7) are the primary mitigation against sustained abuse: standing up an independent copy is intentionally a low-effort exercise.

---

## 11. Open questions

**Baseline status inclusion.** Resolved — out of scope. Baseline/`web-features` data is not included, additively or otherwise, unless it becomes part of BCD itself (§3). Until then it stays outside this contract.

**Index metadata.** A bare key list is small. A key list with titles and status flags is more useful for autocomplete but larger. Namespace sharding may make the size difference immaterial.

**Batch endpoint.** A page documenting five features currently makes five requests. HTTP/2 and static files both make this cheap; a batch route would complicate the static-file model for marginal benefit. Recommendation: no batch endpoint in `v1`.

**Naming.** Settled — `bcd-embed`.
