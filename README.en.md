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

## Install

First decide where you run it — the two entry points install differently, and they must not be mixed:

| Where you run | Target profile | How to install |
|---|---|---|
| **Desktop app (DeepSeek Harness)** | `desktop` | **In-app install** (the only path — see below) |
| CLI / headless / your own profile | your profile name | `dsh plugin --profile <your-profile> add …` |

### Path 0: desktop app (recommended)

The desktop `desktop` profile is owned exclusively by the Electron application, so the CLI cannot manage it — `dsh plugin --profile desktop list` and `add` are both refused:

```text
error: profile "desktop" is managed exclusively by the Electron application
```

That is a hard refusal **by profile name**, so **every** `dsh plugin` subcommand against it is rejected — including `allow-version` in the compatibility section below. Install from the **sidebar → Plugins page** (install, enable, and remove all live there) instead:

```sh
dsh-scout@0.9.3
```

> Always pin the exact version. pnpm ≥ 11 enables minimum-release-age supply-chain protection by default, so a bare package name silently skips a just-released version and falls back to an older one (installing right after 0.9.2 shipped resolved to 0.9.0); with an exact version pnpm records it under the profile's `minimumReleaseAgeExclude` (it prints `Added 1 entry to …`).

No restart is needed: the 12 `scout_*` tools are injected into the current session. A desktop session's cwd differs from the CLI's, so give `scoutDir` an absolute path in the profile's `cordis.patch.yml` (see "Configuration" below).

### Path 1: CLI (npm, recommended)

```sh
# Replace <your-profile> with your own profile name — do not copy the example verbatim
dsh plugin --profile <your-profile> add dsh-scout@0.9.3
```

<details>
<summary>How do I find my profile name?</summary>

There is no `dsh profile list` subcommand (`profile` is parsed as a profile name and errors), so read the directory:

```sh
ls ~/.dsh/profiles          # or $DSH_HOME/profiles
```

Every name it lists is a usable profile (e.g. `web`, or one you created). `desktop` is app-owned: any `dsh plugin` subcommand against it is refused.
</details>

**Do not copy an example name** (such as `scout-demo`) verbatim: the CLI creates and uses it without any error, so the plugin lands in a different profile and appears not to work.

### Path 2: local tarball (offline / reproducible)

```sh
pnpm pack                                        # produces dsh-scout-0.9.3.tgz
dsh plugin --profile <your-profile> add "file:$PWD/dsh-scout-0.9.3.tgz"
```

### Other install sources, and the trade-off

| Source | Ships build output | Runs install scripts | Recommendation |
|---|---|---|---|
| npm (path 1) | yes, ships `dist/` | no (`pendingBuilds: []` measured) | **recommended** |
| local tarball (path 2) | yes (the `pnpm pack` output) | no | offline / self-test |
| git: `github:MaxHou-infinity/dsh-scout#v0.9.3` | no (`dist/` is not committed) | yes — `prepare` runs `tsc` and installs devDependencies | **not recommended**; only for unreleased commits |

The git ref must be a **real tag or commit**: the repository has 10 tags since `v0.3.0` (`v0.3.0` … `v0.9.2`; `v0.9.1` was a local iteration and was never tagged), and this release creates `v0.9.3`. Git is also the only path that executes code: `dist/` is not committed, so it always builds locally, and pnpm may require an explicit `allowBuilds` entry for `dsh-scout` (only allow a pinned version you have reviewed).

> The desktop app bundles its own node / pnpm runtime (measured: node 24.21.0 + pnpm 11.7.0), so you do **not** need Node installed; the "Node ≥ 22.19" requirement applies to the CLI / gate paths only.

### Did it install? (success criteria)

**Desktop app**

1. **Sidebar → Plugins page**: `dsh-scout` appears under Installed; **open its detail page** — the title carries a `v0.9.3` tag, and the version lives only on this page (list cards carry only the Experimental / Problem status tags);
2. **Settings → Built-in plugins → Plugin list**: the `dsh-scout` row carries the **Enabled** tag and the **Running** status — not **Disabled** / **Failed** / **Conditional** (this page shows **no version**);
3. start a new turn — 12 `scout_*` tools appear in the tool list;
4. `/scout status <caseId>` resolves and its output ends with the plugin version (`· dsh-scout 0.9.3`) — with no stderr or logs on desktop, this is the surface that proves which version actually loaded.

**CLI**

```sh
# the composed tree should contain the dsh-scout layer
dsh --profile <your-profile> --dump-config | grep -A2 'dsh-scout'
```

Being composed is **not** the same as being mounted at runtime: the reliable signal is always whether the 12 `scout_*` tools show up and whether `/scout` resolves.

On a runtime mismatch the CLI disables the plugin row and writes exactly one stderr line, `dsh: disabling profile plugin <row>: <reason>` — what you see is "the plugin isn't working", not a loud red error. **The desktop app has no visible stderr** (measured: the Electron main process points fd0/fd1/fd2 at `/dev/null`, `~/Library/Logs/DeepSeek Harness/` is empty, and there is no DSH runtime log anywhere), so on desktop the only place to look is the GUI: **Settings → Built-in plugins → Plugin list** groups rows into Session plugins / Global plugins and answers "is it installed, and why isn't it working?" with the **Enabled / Disabled / Failed / Conditional** tags and the **Running / Failed to start / Waiting for dependencies / Not running** statuses (this page shows **no version**) — a row disabled at startup (a peer mismatch is one cause) shows up there as **disabled**, because the host projects it as `enabled: !entry.disabled`; the stderr line thrown into `/dev/null` already has its answer in the GUI. For which version is installed, open the plugin's detail page on the **sidebar → Plugins page** and read the `v{version}` tag.

### Upgrade and uninstall

```sh
dsh plugin --profile <your-profile> add dsh-scout@<new-version>   # upgrade: target version, also pinned
dsh plugin --profile <your-profile> remove dsh-scout              # uninstall
```

Use the **sidebar → Plugins page** on desktop to upgrade / remove. A failed install rolls back the profile manifest and lockfile.

### DSH compatibility

The following table records **historical DSH 0.2.0-rc.2 behavior**. As of 2026-10-29, the [current official rules](https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish) prioritize `engines.dsh`, falling back to DSH peer ranges only when it is absent. This plugin declares the same range in both places.

That older runtime has three compatibility layers:

| Layer | Where | Who enforces it | What happens on mismatch |
|---|---|---|---|
| **Declaration** | `package.json` → `engines.dsh` (`>=0.1.0-rc.6 <0.3.0-0`) | **That version does not read it** (the DSH 0.2.0-rc.2 runtime never reads `engines.dsh`; the official manifest comment says *"DSH compatibility is declarative until a reader enforces it"*) | Expresses author intent only; blocks nothing |
| **Enforced** | The ranges in `peerDependencies` whose names are `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` (this repo has exactly one: `@deepseek-ai/dsh-tools: ">=0.1.0-rc.6 <0.3.0-0"`) | DSH install checks + the profile startup preflight `evaluatePluginCompatibility()` | Install is refused, or the plugin row is disabled at startup |
| **Not enforced** | `@deepseek-ai/cordis: ">=4.0.2 <5"` (and `@deepseek-ai/schemastery`) | DSH's peer name filter only accepts `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` | Resolved by pnpm; DSH makes no compatibility judgement |

Three details that matter:

1. **Prereleases participate in matching.** The check is `semver.satisfies(runtime, range, { includePrerelease: true })`. The `<0.3.0-0` upper bound exists precisely to exclude `0.3.0-alpha` and later *while* prereleases are included; conversely, **the range depends on that flag** — without it, `0.2.0-rc.2` would be judged incompatible. **When checking this range with other tooling, pass `includePrerelease`**: under default semver semantics (node-semver's prerelease rule accepts a prerelease only through a comparator with the same major.minor.patch tuple), `0.1.2-rc.1` / `0.2.0-rc.2` / `0.2.1-alpha.2` are all judged **unsatisfied** (measured with semver 7.8.5: `0.1.0-rc.6` is true under both semantics; the other three are plain=false / incl=true; `0.3.0-alpha.1` is false under both). **DSH's verdict is the one that counts.**
2. **The failure mode is "silently not loaded", not an error.** Specs that can be judged up front (adding a registry package) are refused before pnpm runs, with the exemption command printed. Git / tarball specs are judged after installation, and a failure rolls back the profile manifest and lockfile. But a plugin **already in the profile whose mismatch is only discovered at startup** has its row disabled: the process writes exactly one stderr line, `dsh: disabling profile plugin <row>: <reason>`. What the user sees is "the plugin isn't working" (no tools, no `/scout`) — not a loud red error. **That line is visible to CLI users only**; the desktop app's stderr goes to `/dev/null` and there is no runtime log (see "Did it install?" above), so on desktop the state is only visible in **Settings → Built-in plugins → Plugin list** (the installed version, in turn, only on the **sidebar → Plugins page**).
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

**Desktop app users**: `allow-version` is refused by profile name like every other `dsh plugin` subcommand, so this file must be written by hand. It is a flat JSON object — exact `package@version` → the exact DSH versions it is allowed on; with a desktop runtime of `0.2.0-rc.2`:

```json
{
  "dsh-scout@0.9.3": ["0.2.0-rc.2"]
}
```

A hand-written grant is bound by the same four boundaries above (exact versions only, one package version paired with one DSH version, no authorization of install scripts, effective on the next composition) and it **bypasses the CLI's `--accept-risk` acknowledgement** — an incompatible plugin may crash or corrupt data. Read the exact runtime version from `desktopVersion` in `~/.dsh/dsh-runtimes/*/runtime.json`; a malformed record is ignored with a warning and never makes the profile unusable.

#### Verified version matrix

**`dsh-scout@0.9.3` passed on four exact DSH versions** (before the release, 2026-10-13, isolated profiles, all four binaries fetched from npm rather than the local DSH): covering installation, cold startup, tool mounting, the **six-step real-host gate** (`scout_start` → export → cold restart → lazy rehydration → cross-language import → uninstall, plus the "marker missing / `complete:false`" negative controls), and unload. The full gate runs through `npm run check:release`; measured output:

```text
dsh-scout release gate: PASS (4 DSH versions, >=0.1.0-rc.6 <0.3.0-0)
```

| DSH version | npm channel (checked 2026-10-12) | 0.9.3 (released) |
| --- | --- | --- |
| `0.1.0-rc.6` | Declared lower bound | Pass |
| `0.1.2-rc.1` | Older release regression | Pass |
| `0.2.0-rc.2` | `latest` / `next` | Pass |
| `0.2.1-alpha.2` | `alpha` | Pass |

This table previously recorded the **0.9.0** and **0.9.1** candidate tarball results; 0.9.3 keeps the identical `peerDependencies` and `engines.dsh` ranges (**unchanged**) — this version changes the install docs and the diagnostic surface (the desktop-app path in the install chapter, the README version-reference guard, and the plugin version in `/scout status`), not dependencies or the runtime contract — and it passed the same gate again on the same four exact versions (4/4), so the table is updated to this version. **0.9.3 is published on npm** (`dist-tags.latest` = `0.9.3`): the release workflow (run `38428072425`) ran the same four-version gate before `pnpm pack`, so the table verifies the exact 0.9.3 that shipped. The npm-channel column is still the 2026-10-12 check; this re-run did not re-check it. The previous release, **0.9.2, is published on npm** (`dist-tags.latest` = `0.9.2`): the release workflow (run `38406696598`) ran the same four-version gate before `pnpm pack`, so the 0.9.2 four-version pass this table recorded at the time is the exact artifact that shipped. The `/scout` command and Skill added in 0.9.1 are optional bindings, skipped silently on hosts without the corresponding services, so they do not affect loading.

2026-10-29 verification-script repair: nightly checks use Node 24 for the Node ≥24.9 requirement of DSH `0.2.2-alpha.2`. The verifier selects single-call or batch execution via the public `setExecutor` capability, checks result cardinality and call IDs, and never retries failures. This repair is not yet published to npm; see the [verification record](docs/verification-dsh-2026-10-29.md).

Future `0.2.x` versions still require runtime verification. The [nightly compatibility workflow](https://github.com/MaxHou-infinity/dsh-scout/actions/workflows/compatibility-nightly.yml) resolves npm's `latest`, `next`, and `alpha` tags to exact versions before running tests and the isolated profile check. The badge shows the latest workflow result; this table records versions already verified.

> **A red nightly does not mean the plugin is broken**: it may simply mean the declared range expired (e.g. DSH published `0.3.0-alpha.1`). `check:release` reports "out of declared range (expected)" separately from "in range but failing (regression)" — the former calls for updating the range or using the exact-version exemption above, not for a regression fix.

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
- **Desktop app**: the default `scoutDir` (`./dsh-scout`) depends on cwd, and a desktop session's cwd differs from the CLI's, so give `id: dsh-scout` an absolute path in `~/.dsh/profiles/desktop/cordis.patch.yml`; the app maintains that file, so quit the app before editing it, or the write may be overwritten;
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
