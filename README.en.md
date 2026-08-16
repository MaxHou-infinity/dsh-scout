# dsh-scout · 司察 (Scout)

[![license MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![node >=22.19](https://img.shields.io/badge/node-%3E%3D22.19-brightgreen)](package.json)
[![dsh-tools 0.1.0-rc.6](https://img.shields.io/badge/dsh-tools-0.1.0--rc.6-4b32c3)](package.json)
[![tests 32 passing](https://img.shields.io/badge/tests-32%20passing-green)](tests/model.test.mjs)
[![中文 README](https://img.shields.io/badge/README-%E4%B8%AD%E6%96%87-2ea44f)](README.md)

**司察（Scout）** — evidence-driven company & job due-diligence plugin for [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness).

`dsh-scout` helps an agent answer a concrete question:

> Is this company and role worth taking to the next round, and what must I verify in the interview?

The plugin keeps facts, reported information, inference, unknowns, sources, and next actions separate. It starts conservatively at `VERIFY` until the company identity and high-impact claims are supported.

## Naming

- **Scout** — a scout is sent ahead to reconnoiter a company and a role before you commit: background check, due diligence, evidence gathering, interview prep. The English package and repository name stays `dsh-scout` for stable install references.
- **司察** (sī-chá) — Chinese name: "司" echoes *scout*, "察" means to examine and reconnoiter, capturing the core function of evidence-driven company & role due diligence.

## Current scope

This repository contains the first runnable, session-isolated slice:

- `scout_start`: create an in-memory diligence case.
- `scout_add_source`: register a source.
- `scout_ingest`: batch-register collected research results (auto-infers source type and evidence level per URL, optionally drafting a claim per item; individual failures or rejected claims are isolated without aborting the batch).
- `scout_search`: run a web search through the DSH web provider and auto-register the result URLs as sources (type and evidence level inferred per URL).
- `scout_add_claim`: attach an evidence-bounded claim.
- `scout_verify_identity`: confirm the legal entity from an `E3` source.
- `scout_verify_claim`: promote a claim while retaining its prior evidence state.
- `scout_report`: render the current Markdown report (evidence summary counts, impact-sorted key evidence/risks/role hypotheses, a **verification checklist**, URL-linked source list, and interview questions).
- `scout_questions`: derive a deduplicated, prioritized interview question list from the case (up to 12 items).
- `scout_compare`: render a side-by-side comparison report for two to five cases (decisions, identity status, verified conclusions, open risks, and merged interview questions).
- `scout_export`: persist a case as the durable **five-file export** (`case.json`, `sources.json`, `claims.json`, `events.jsonl`, `report.md`) into a target directory (`targetDir` is optional; defaults to `<scoutDir>/<caseId>`).
- `scout_import`: restore a case from a five-file export directory and recompute its decision.

The first case fixture is [Snapmaker HR Head](docs/fixtures/dsh-scout/snapmaker-hr-head.json). Its historical material is deliberately marked as `E1` and is not treated as current verification.

Case state lives in memory by default and is isolated by DSH agent/session identity; `scout_export` / `scout_import` make a case durable across sessions through the five-file format with a replayable `events.jsonl`. Configurable storage is available via plugin config (`scoutDir` / `autoPersist`); `scout_ingest` handles batch source registration from collected search/page results and can draft claims from each item; `scout_search` runs the DSH web provider directly and auto-registers result sources; `scout_compare` renders side-by-side case comparisons. This repository does not yet claim the full product contract is complete.

## Development

```sh
pnpm install
pnpm test
pnpm run check:release
```

The tests cover the conservative decision default, evidence-level constraints, identity verification, session isolation, report rendering, export/import round-trips, auto-persist, question generation, and tool cleanup on unload. `check:release` additionally packs the plugin, installs it into an isolated temporary DSH profile, verifies `--dump-config`, checks the mounted tools, and observes the Cordis unload disposer. The gate uses `DSH_BIN` or a local `dsh` binary when available; otherwise it downloads the exact official CLI version `0.1.0-rc.6` through `npx`.

## Install into a DSH profile

The package is an installable DSH bundle:

```sh
dsh plugin --profile scout-demo add github:MaxHou-infinity/dsh-scout#<commit>
dsh --profile scout-demo --dump-config
```

Git installs fetch source and run `prepare`. pnpm may require an explicit `allowBuilds` entry for `dsh-scout`; only allow a pinned source you have reviewed. The current package targets `@deepseek-ai/dsh-tools` `0.1.0-rc.6` and `@deepseek-ai/cordis` `4.0.x`.

## Configuration (optional)

Configure `dsh-scout` in the DSH profile's `cordis.patch.yml`:

```yaml
- id: dsh-scout
  config:
    scoutDir: /path/to/scout-cases   # default export dir; cases land in <scoutDir>/<caseId>/
    autoPersist: true                # write the five files after every mutation (default false)
```

- Without `scoutDir`, `scout_export` with no `targetDir` writes to `./dsh-scout/<caseId>/`;
- With `autoPersist: true`, every `scout_start` / `scout_add_source` / `scout_ingest` / `scout_search` / `scout_add_claim` / `scout_verify_*` persists automatically; a failed write does not break the main flow.

## Design boundaries

- Its built-in `scout_search` only turns search results into registered sources; it does not replace dedicated browser or MCP providers for deep retrieval.
- It does not send applications, emails, or personal identity data to third parties.
- It does not turn funding, company self-description, or a job posting into verified success claims.
- It is not legal, investment, or medical advice.

See [the product contract](docs/dsh-scout-product-contract.md) for the full MVP boundary and acceptance criteria.

## Community

This is an independent community plugin for DeepSeek Harness. The repository uses the `dsh-plugin`, `deepseek-harness`, `due-diligence`, `company-research`, `job-research`, `hr-tech`, and `evidence-based` topics for discovery.
