# dsh-scout · 司察 (Scout)

[![ci](https://github.com/MaxHou-infinity/dsh-scout/actions/workflows/ci.yml/badge.svg)](https://github.com/MaxHou-infinity/dsh-scout/actions/workflows/ci.yml)
[![license MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![node >=22.19](https://img.shields.io/badge/node-%3E%3D22.19-brightgreen)](package.json)
[![DSH nightly compatibility](https://github.com/MaxHou-infinity/dsh-scout/actions/workflows/compatibility-nightly.yml/badge.svg)](https://github.com/MaxHou-infinity/dsh-scout/actions/workflows/compatibility-nightly.yml)
[![tests passing](https://img.shields.io/badge/tests-passing-green)](tests/model.test.mjs)
[![中文 README](https://img.shields.io/badge/README-%E4%B8%AD%E6%96%87-2ea44f)](README.md)

**司察 (Scout)** — an **evidence-driven company & job due-diligence plugin** for [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness).

In one sentence: **it helps an agent answer — "Is this company and this role worth taking to the next round, and what must I verify in the interview?"** Every conclusion is tied to a real source; company self-description and funding news are never treated as verified facts.

## Naming

- **Scout** — a scout is sent ahead to reconnoiter a company and a role before you commit: background check, due diligence, evidence gathering, interview prep. The package and repository name stays `dsh-scout` so install references remain stable.
- **司察** (sī-chá) — the Chinese name: "司" echoes *scout*, "察" means to examine and reconnoiter, capturing the core function of evidence-driven company & role due diligence.

---

## Why it exists (the pain it removes)

Say you receive an interview invitation or an offer:

- The job posting says the company is "the global leader, valued at tens of billions" — **that is marketing, not fact**;
- Media reports "raised $2B" — **that may be second-hand reporting, possibly already denied by the company**;
- Before the interview you need to judge: is the legal entity real? Are the reporting line, mandate, and compensation credible? **What should I ask?**

`dsh-scout` turns this into a reproducible workflow: **collect sources → register evidence → add claims → verify identity → render a report with explicit evidence boundaries**. The report separates "verified", "needs verification", and "unknown", and ends with an interview action list.

---

## Mental model: evidence levels (the core concept)

Every claim is bounded by **evidence levels**; the ceiling comes from the sources it cites:

| Level | Meaning | Examples |
|---|---|---|
| **E0** | No source / model inference | Unsupported guesses — may only be `unknown` or `needs_verification` |
| **E1** | User-provided | Information you obtained from an internal channel |
| **E2** | Authoritative third party | Independent media, recruiting platforms (BOSS/Liepin), business-registry aggregators (Tianyancha/Aiqicha), Wikipedia |
| **E3** | Official first-hand | National Enterprise Credit Information Publicity System (gsxt.gov.cn), regulatory notices, official filings |

**Four disciplines (enforced by the plugin, not bypassable):**

1. A claim's `evidenceLevel` **cannot exceed** its strongest cited source (an E1 source cannot support an E3 conclusion);
2. A high-impact conclusion **without a source** may only be `unknown` or `needs_verification`;
3. **Identity verification** (`scout_verify_identity`) requires an E3 official registration source, or it refuses to run;
4. Decisions default to **conservative**: while the entity is unverified or a blocking claim is unresolved, the decision stays `VERIFY` — it never pretends the case passed.

> The guarantee: **when evidence is thin, the report honestly says "not verified yet" instead of overstating a conclusion.**

---

## The lifecycle of a case

```
scout_start          create the case (decision defaults to VERIFY)
   │
scout_search         run a Web Provider search; result URLs register as sources
   │
scout_ingest         batch-register collected results (optionally drafting claims)
   │
scout_add_source     register a source (sourceType + evidenceLevel)
   │
scout_add_claim      add a claim (bounded by the evidence policy)
   │
scout_verify_identity verify the legal entity from an E3 official source
   │
scout_verify_claim   promote a claim to verified (prior evidence state retained)
   │
scout_report / scout_questions  render the report / derive interview questions
   │
scout_compare        compare several cases side by side
   │
scout_export / scout_import  persist (five files + completion marker), resumable across sessions
```

You can also drive it explicitly: `/scout status|questions|report|export` (see "Commands & Skill" below).

## Quick start (a complete example)

To judge whether a company's HR role is worth pursuing, the agent works like this:

```text
① scout_start(caseId=acme-hr, companyName=Acme, roleTitle=HRBP, location=Shenzhen)
② Search the registry → scout_add_source(sourceId=s1, sourceType=company_registry/…, evidenceLevel=E2)
③ Fetch the official job posting → scout_add_source(sourceId=s2, sourceType=company_official, evidenceLevel=E2)
④ Extract duties/qualifications/comp → scout_add_claim(claimId=c1, status=verified, evidenceLevel=E2, …)
   Unsupported high-impact items (e.g. the reporting line) → status=unknown / needs_verification
⑤ Try gsxt official verification → scout_verify_identity(…)
⑥ scout_report → render the report
```

The generated report contains:

- **Decision**: `PROCEED` / `VERIFY` / `STOP` (with reasons)
- **Key supporting evidence**: the strongest verified claims
- **Blocking or unresolved risks**: risks and unknowns that block progress
- **Verification checklist**: every blocking/important item awaiting verification plus its next action (use it directly as an interview action list)
- **Coverage (new in 0.9.1)**: per-dimension counts of verified / open / untouched across all 11 investigation dimensions, calling out **untouched dimensions** — the report becomes due-diligence progress, not just an evidence list
- **Claim ledger**: every claim (status / evidence level / impact / sources / confidence note)
- **Sources**: URL-linked source list
- **Interview questions**: suggested questions (untouched dimensions come first)

## Tools (12)

| Tool | Purpose |
|---|---|
| `scout_start` | Create a due-diligence case |
| `scout_add_source` | Register a source (with evidence level) |
| `scout_ingest` | Batch-register collected results (infers source type/evidence level; can draft one claim per item) |
| `scout_search` | Search through the DSH Web Provider and auto-register result sources (type/evidence inferred per URL) |
| `scout_add_claim` | Add an evidence-bounded claim |
| `scout_verify_identity` | Verify the legal entity from an E3 official source |
| `scout_verify_claim` | Promote a claim with stronger evidence |
| `scout_report` | Render the current Markdown report |
| `scout_questions` | Derive a deduplicated, prioritized interview question list (up to 12; case-curated questions keep their quota) |
| `scout_compare` | Side-by-side comparison of 2–5 cases (decisions/identity/claims/risks/questions) |
| `scout_export` | Persist the five-file export + completion marker |
| `scout_import` | Restore a case from an export directory and recompute its decision (tolerates legacy exports, reports `complete`) |

### Output contract (since 0.9.1)

Mutating tools (`scout_start` / `scout_add_source` / `scout_ingest` / `scout_search` / `scout_add_claim` / `scout_verify_identity` / `scout_verify_claim` / `scout_import`, 8 in total) **no longer echo the whole case JSON back to the model**:

- `value` is a **structured object**: `{ ok, caseId, decision, identity, counts: { sources, claims, verified, open }, changed: { kind, ids }, nextActions, persist? }`;
- `render` is a **compact summary that never exceeds 1 KB as a whole**: decision + this call's delta + unresolved blockers + next steps. The cap is the render budget itself (`MAX_RENDER_BYTES = 1024` B): the ellipsis's own UTF-8 length is subtracted from the budget before cutting, so **the final string including the ellipsis never exceeds 1024 B**;
- `persist: { persisted, targetDir, error? }` appears **only on the `autoPersist` path of mutating tools** (the key is omitted when no persist was attempted). **A failed persist is no longer silent**: `persist.persisted === false` plus `persist.error`, and no `case_exported` event is recorded. `scout_export` carries **no `persist` key** — it expresses the same thing through **top-level** `persisted` / `complete` / `error`;
- **Full data still comes from `scout_report` (Markdown) and `scout_export` (files)** — the model sees a summary, not the whole ledger.

Read-class tools keep their own shapes: `scout_report` → `{ caseId, decision, report, coverage }`; `scout_questions` → `{ caseId, questions }`; `scout_compare` → `{ caseIds, report }`; `scout_export` → `{ caseId, targetDir, files, persisted, complete, error? }`, where `targetDir` is the **resolved absolute path**. `scout_import` reuses the mutating envelope and adds `sourceDir` (the directory it restored from) and `complete` (whether the export was complete).

### Commands & Skill (new in 0.9.1)

| Entry point | Purpose |
|---|---|
| `/scout` command | `status` / `questions` / `report` / `export` sub-actions (reusing the tool logic). The host automatically logs `command/run` + `command/done` around the handler — both names are in the host's known event vocabulary, so the session log stays reconstructable |
| `scout` Skill | The due-diligence workflow registered by the plugin itself (`ctx.skills.register`, no files, no client bundle): start → search/ingest → claim → verify_identity → report → questions, plus the four evidence disciplines; it disappears on unload |

Usage (identical to the implementation):

```text
/scout status <caseId> | /scout questions <caseId> | /scout report <caseId> | /scout export <caseId> [targetDir]
```

Both are **optional bindings**: when the host exposes no `commands` / `skills` service they are skipped silently, and plugin loading plus tools are unaffected.

## Install into a DSH profile

Three verified paths:

```sh
# Path A: npm install (fetches the published package from npm)
dsh plugin --profile scout-demo add dsh-scout

# Path B: git install (fetches source, runs prepare)
dsh plugin --profile scout-demo add github:MaxHou-infinity/dsh-scout#<commit>

# Path C: local tarball (offline, reproducible; this is the exact form the gate runs)
pnpm pack                                        # produces dsh-scout-0.9.2.tgz
dsh plugin --profile scout-demo add "file:$PWD/dsh-scout-0.9.2.tgz"

# Verify the mounted tools
dsh --profile scout-demo --dump-config
```

**A just-released version may not be picked up by `latest` yet**: pnpm ≥ 11 enables minimum-release-age supply-chain protection by default, so too-new versions are skipped and pnpm falls back to the newest version that passes the age gate (installing right after 0.9.2 shipped resolved to 0.9.0). To install a just-released version immediately, **pin it explicitly**, e.g. `dsh plugin --profile <name> add dsh-scout@0.9.2`; pnpm records it under the profile's `minimumReleaseAgeExclude` (the output prints `Added 1 entry to minimumReleaseAgeExclude…`).

Requirements: Node ≥ 22.19. A git install runs `prepare`; pnpm may require an explicit `allowBuilds` entry for `dsh-scout` (only allow a pinned source you have reviewed).

### DSH compatibility

DSH compatibility has **three layers** — do not conflate them:

| Layer | Where | Who enforces it | What happens on mismatch |
|---|---|---|---|
| **Declaration** | `package.json` → `engines.dsh` (`>=0.1.0-rc.6 <0.3.0-0`) | **Nothing reads it today** (the DSH 0.2.0-rc.2 runtime never reads `engines.dsh`; the official manifest comment says *"DSH compatibility is declarative until a reader enforces it"*) | Expresses author intent only; blocks nothing |
| **Enforced** | The ranges in `peerDependencies` whose names are `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` (this repo has exactly one: `@deepseek-ai/dsh-tools: ">=0.1.0-rc.6 <0.3.0-0"`) | DSH install checks + the profile startup preflight `evaluatePluginCompatibility()` | Install is refused, or the plugin row is disabled at startup |
| **Not enforced** | `@deepseek-ai/cordis: ">=4.0.2 <5"` (and `@deepseek-ai/schemastery`) | DSH's peer name filter only accepts `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` | Resolved by pnpm; DSH makes no compatibility judgement |

Three details that matter:

1. **Prereleases participate in matching.** The check is `semver.satisfies(runtime, range, { includePrerelease: true })`. The `<0.3.0-0` upper bound exists precisely to exclude `0.3.0-alpha` and later *while* prereleases are included; conversely, **the range depends on that flag** — without it, `0.2.0-rc.2` would be judged incompatible. **When checking this range with other tooling, pass `includePrerelease`**: under default semver semantics (node-semver's prerelease rule accepts a prerelease only through a comparator with the same major.minor.patch tuple), `0.1.2-rc.1` / `0.2.0-rc.2` / `0.2.1-alpha.2` are all judged **unsatisfied** (measured with semver 7.8.5: `0.1.0-rc.6` is true under both semantics; the other three are plain=false / incl=true; `0.3.0-alpha.1` is false under both). **DSH's verdict is the one that counts.**
2. **The failure mode is "silently not loaded", not an error.** Specs that can be judged up front (adding a registry package) are refused before pnpm runs, with the exemption command printed. Git / tarball specs are judged after installation, and a failure rolls back the profile manifest and lockfile. But a plugin **already in the profile whose mismatch is only discovered at startup** has its row disabled: the process writes exactly one stderr line, `dsh: disabling profile plugin <row>: <reason>`. What the user sees is "the plugin isn't working" (no tools, no `/scout`) — not a loud red error.
3. **That single `@deepseek-ai/dsh-tools` peer carries the entire gate.** Changing the peer range changes the compatibility promise.

#### Escape hatch: profile-level exact-version exemptions

If only the **declared range has expired** (say DSH publishes `0.3.0-alpha.1` while the plugin still runs fine), you can exempt it in the profile instead of shipping a new version:

```sh
dsh plugin --profile <name> version-exemptions   # inspect current exemptions and the runtime version
dsh plugin --profile <name> allow-version <package>@<version> --dsh-version <exact-dsh-version> --accept-risk
dsh plugin --profile <name> revoke-version <package>@<version> --dsh-version <exact-dsh-version>
```

The exemption lives in the profile's `compatibility.json`, beside `package.json` and `cordis.patch.yml` (exact `package@version` → list of exact DSH versions). Four boundaries:

- **Exact versions only** — ranges are rejected;
- it authorizes **one package version paired with one DSH version**, and is **not inherited** by plugin or DSH upgrades;
- it does **not** authorize dependency install scripts;
- it takes effect on the **next composition**: a live profile recomposes and mounts it, a startup-only profile needs a restart.

Granting requires explicit risk acceptance (CLI `--accept-risk`, plugin manager `acceptRisk: true`); DSH prints a risk warning before writing — an incompatible plugin may crash or corrupt data.

#### Verified version matrix

**`dsh-scout@0.9.2` passed on four exact DSH versions** (before the 2026-10-13 release, isolated profiles, all four binaries fetched from npm rather than the local DSH): covering installation, cold startup, tool mounting, the **extended six-step real-host gate** (`scout_start` → export → cold restart → lazy rehydration → cross-language import → uninstall, plus the "marker missing / `complete:false`" negative controls), and unload. The full gate runs through `npm run check:release`; measured output:

```text
dsh-scout release gate: PASS (4 DSH versions, >=0.1.0-rc.6 <0.3.0-0)
```

| DSH version | npm channel (checked 2026-10-12) | 0.9.2 (released) |
| --- | --- | --- |
| `0.1.0-rc.6` | Declared lower bound | Pass |
| `0.1.2-rc.1` | Older release regression | Pass |
| `0.2.0-rc.2` | `latest` / `next` | Pass |
| `0.2.1-alpha.2` | `alpha` | Pass |

This table previously recorded the **0.9.0** and **0.9.1** candidate tarball results; 0.9.2 keeps the identical `peerDependencies` and `engines.dsh` ranges (**unchanged**), aligns only `@deepseek-ai/schemastery` from `^3.18.2` to `~3.18.4`, and passed the matrix again on the same four exact versions under the extended gate (4/4), so it is updated to this version. The npm-channel column is still the 2026-10-12 check; this re-run did not re-check it. **0.9.2 is published on npm** (`dist-tags.latest` = `0.9.2`): the release workflow (run `38406696598`) ran the same four-version gate before `pnpm pack`, so the table verifies the exact 0.9.2 that shipped. The `/scout` command and Skill added in 0.9.1 are optional bindings, skipped silently on hosts without the corresponding services, so they do not affect loading.

Future `0.2.x` versions still require runtime verification. The [nightly compatibility workflow](https://github.com/MaxHou-infinity/dsh-scout/actions/workflows/compatibility-nightly.yml) resolves npm's `latest`, `next`, and `alpha` tags to exact versions before running tests and the isolated profile check. The badge shows the latest workflow result; this table records versions already verified.

> **A red nightly does not mean the plugin is broken**: it may simply mean the declared range expired (e.g. DSH published `0.3.0-alpha.1`). `check:release` reports "out of declared range (expected)" separately from "in range but failing (regression)" — the former calls for updating the range or using the exact-version exemption above, not for a regression fix.

## Configuration (optional)

Configure `dsh-scout` in the DSH profile's `cordis.patch.yml`:

```yaml
- id: dsh-scout
  config:
    scoutDir: /path/to/scout-cases   # default export dir; cases land in <scoutDir>/<caseId>/ (default 'dsh-scout')
    autoPersist: true                # write the five files after every mutation (default false)
    language: en                     # 'zh-CN' (default) or 'en'
    authorityHostSuffixes:           # E3 trusted-host suffixes (defaults cover government/registry/exchange domains)
      - gov.cn
```

- A relative `scoutDir` resolves against the **session cwd**, not the DSH process cwd;
- With `autoPersist: true`, every mutation persists automatically; **failures are visible**: the return value carries `persist.persisted=false` plus `persist.error`, and no `case_exported` event is written;
- `language` affects the report, interview questions, the comparison report, and the explanatory text that `scout_ingest` writes into auto-drafted claims (`confidenceNote` / `nextAction`); it also aligns case-owned text that is **still at its factory default**, at two different granularities: `decisionObjective` / `role.fitQuestion` are decided **per field** (a field still at its factory default is aligned); curated interview questions are decided **entry by entry, by index** — when the set has the factory length, an entry still equal to its factory slot is replaced by this deployment's default at the same index and **an entry the user edited is kept verbatim**; a set whose length differs from the factory array is taken as fully user-authored and preserved as a whole. The test is "does this entry equal its factory slot", not edit history (editing an entry back to the factory text makes it align). It is a no-op when it matches the case's own language, so the `zh-CN` default changes nothing for existing users. Separately, `language` in `case.json` is the **rendering language of this deployment**, not the language of the file's contents: alignment reads only that label and **never checks whether the label is consistent with the content**, so a hand-edited file whose `language` disagrees with its prose is taken at its word and skipped by the "same language" early return (the normal export / import / upgrade paths are unaffected: a 0.9.0 export always says `zh-CN`, matching its content).

## Data persistence

Cases live in memory by default, isolated per session; `scout_export` writes one copyable directory:

```
case.json              case body (including the decision)
sources.json           source list
claims.json            claim ledger
events.jsonl           replayable event stream (case_started / source_added / claim_added /
                       identity_verified / claim_verified / case_exported /
                       case_imported / case_rehydrated)
report.md              current report snapshot
export.complete.json   since 0.9.1: completion marker (written as complete:false first, rewritten to complete:true once the five files land)
```

- The export order is "**record the `case_exported` event first, then write files**", so the on-disk `events.jsonl` includes that export; "export → import → export again" yields a stable event sequence;
- The completion marker `export.complete.json` holds `{ schemaVersion, caseId, complete, files, eventCount }`: it is written as **`complete: false` before any file is written** and rewritten to `complete: true` only after all five data files have landed — so **a stale marker never claims completeness for a half-written export** (when overwriting, the previous successful marker is downgraded before the new files are written). `scout_import` reads the marker's **`complete` field**, not merely whether the marker file exists; **`eventCount` matches the line count of `events.jsonl` only when `complete: true`** (after an interrupted export it records the event count that failed attempt expected) — read `complete`, do not compare `eventCount` alone; the marker's `files` and the `files` returned by `scout_export` are **the same key with different meanings** — the marker lists only the **five data files**, while `scout_export` returns the **six names** it wrote (the five data files plus the marker itself), and both are correct;
- `scout_import` accepts a **legacy export with no completion marker**; when the marker is missing or says `complete: false`, the import still proceeds **as long as all five data files are present**, but the return value reports `complete: false` so the caller can decide whether to trust the snapshot (a brand-new export missing any of the five files — e.g. interrupted while writing `claims.json` — still fails hard);
- **Whether a session restore rehydrates automatically depends on export completeness**: on a cache miss, **only a complete export** (completion marker `complete: true`) is lazily rehydrated, appending a `case_rehydrated` event, keeping a "case that appeared from nowhere" auditable; **a 0.9.0 export has no completion marker and is never auto-rehydrated** — restore it explicitly with `scout_import`. Alignment itself only runs on the `decide` path — it executes on the tools that recompute the decision (`scout_add_claim` / `scout_ingest` / `scout_search` / `scout_verify_identity` / `scout_verify_claim` / `scout_import`) and on lazy rehydration after a cache miss; rehydration is triggered by the **first tool call that touches the case** (`requireCase`), so after a cold start even a plain `scout_report` can carry one alignment, while `scout_start`, which only creates the case, does not reach it. The aligned values land in the in-memory case and in later exports on the first `decide`; **a third-party tool that reads `case.json` straight from disk, never passing through the plugin, sees no alignment**.

## Design boundaries

- Its built-in `scout_search` only turns search results into registered sources; it does not replace dedicated browser or MCP providers for deep retrieval.
- It does not send applications, emails, or personal identity data to third parties.
- It does not turn funding, company self-description, or a job posting into verified success claims.
- It is not legal, investment, or medical advice.
- Identity verification depends on E3 official sources; when gsxt and friends are unreachable, the report marks the item as unverified.
- **Explicitly not in 0.9.1 or 0.9.2**: the client panel, custom session events, the `ctx.storageDomain` persistence rewrite, and scoring/ranking. See [CHANGELOG](CHANGELOG.md) for the reasons and boundaries; "custom session events would make the plugin's own sessions unreconstructable" is a hard constraint — see [product contract §5.1](docs/dsh-scout-product-contract.md).

See [the product contract](docs/dsh-scout-product-contract.md) for the full MVP boundary and acceptance criteria. The first fixture is [Snapmaker HR Head](docs/fixtures/dsh-scout/snapmaker-hr-head.json).

## Development

```sh
pnpm install
pnpm test                 # build + unit tests (decision defaults/evidence constraints/identity/session isolation/report rendering/export-import round-trip/auto-persist/questions/ingest-to-claim/multi-language/package contract)
pnpm run check:release    # profile gate on four exact DSH versions + package-content check
```

`test:profile` runs a **six-step real-host scenario chain** inside isolated profiles: create (`scout_start` + `scout_add_source` + `scout_add_claim`) → export (absolute `targetDir`, 6 files, completion marker `complete: true`) → cold restart (a second process on the same `DSH_HOME`/profile) → lazy rehydration (no `scout_import`; decision unchanged and `case_rehydrated` persisted) → cross-language import (an `en` profile imports the zh export; report and `report.md` CJK = 0) → uninstall (no registry residue), plus three negative controls: `output.schema` sensitivity, missing marker, and marker `complete:false`. A full run takes ~16 s and can be trimmed with `DSH_SCOUT_SMOKE_SKIP_CROSS_LANGUAGE` / `DSH_SCOUT_SMOKE_SKIP_REHYDRATION_CONTROL` / `DSH_SCOUT_SMOKE_SKIP_NEGATIVE_CONTROL`; every skip is reported in the PASS line as degraded coverage. **Still not covered** (spelled out in the script comments): the real LLM / agent loop and approval policy, relative paths (`agent` unset leaves `cwd` undefined, so the gate uses absolute paths only), `autoPersist`, a real process interruption (the torn export is reproduced by rewriting the marker), and the other 6 tools, which are asserted by registration only. `check:release` then re-runs the same gate on four exact DSH versions (reporting "out of declared range (expected)" separately from "in range but failing (regression)") and finally checks the packed contents.

## Roadmap

- ✅ v0.1: evidence discipline, three-state decisions, structured report, session isolation
- ✅ v0.2: five-file durable export + event stream + import/restore
- ✅ v0.3: configurable storage (`scoutDir` / `autoPersist`) + interview question generation (`scout_questions`)
- ✅ v0.4: research ingestion (`scout_ingest`: batch-register search/page results, inferring source type and evidence level)
- ✅ v0.5: company/role comparison (`scout_compare`: multi-case side-by-side report with merged questions)
- ✅ v0.6: ingest-to-claim flow (`scout_ingest` claim drafts: register a source and add a claim in one call)
- ✅ v0.7: deeper provider integration (`scout_search` through the DSH Web Provider, result sources auto-registered)
- ✅ v0.8: first npm release (0.8.0); 0.8.1 declared the Schemastery `Config`, added the `exports` map, and fixed optional-service injection; 0.8.2 aligned with the DSH 0.2 rc channel
- ✅ v0.9.0: adapted to the DSH 0.2 runtime; four-version compatibility matrix + nightly compatibility check + compatibility issue template
- ✅ v0.9.1: output contract (structured value + compact summary), persistence trustworthiness, call-site service binding with lazy rehydration, `language` and `## Coverage`, `/scout` and the `scout` Skill, distribution contract (`engines.dsh` / `manifestVersion` / locale / icon)
- ✅ v0.9.2: real-host end-to-end gate (six-step scenario chain + completion-marker negative controls, closing the U11 blind spot in the 0.9.1 verification report), curated interview questions aligned **entry by entry, by index** (closing D10), the render whole-string cap, and `@deepseek-ai/schemastery` aligned to `~3.18.4`
- ⏭ v0.10.0 (planned): client panel, `ctx.storageDomain` persistence rewrite, `presentationMeta` payloads, comparison-matrix upgrade and extensible evidence policy (**scoring still out of scope**)

## Community

This is an independent community plugin for DeepSeek Harness. The repository uses the `dsh-plugin`, `deepseek-harness`, `due-diligence`, `company-research`, `job-research`, `hr-tech`, and `evidence-based` topics for discovery. For install or startup failures, use the [compatibility issue template](https://github.com/MaxHou-infinity/dsh-scout/issues/new?template=compatibility.yml) with exact versions and redacted logs.

Version history lives in the [CHANGELOG](CHANGELOG.md).
