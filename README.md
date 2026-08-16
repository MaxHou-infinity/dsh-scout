# dsh-scout · 司察 (Scout)

[![license MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![node >=22.19](https://img.shields.io/badge/node-%3E%3D22.19-brightgreen)](package.json)
[![dsh-tools 0.1.0-rc.6](https://img.shields.io/badge/dsh-tools-0.1.0--rc.6-4b32c3)](package.json)
[![tests 13 passing](https://img.shields.io/badge/tests-13%20passing-green)](tests/model.test.mjs)
[![中文 README](https://img.shields.io/badge/README-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-2ea44f)](README.zh-CN.md)

**司察（Scout）** — evidence-driven company & job due-diligence plugin for [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness). 面向 DeepSeek Harness 的证据驱动型公司尽调与岗位背调插件。

`dsh-scout` helps an agent answer a concrete question:

> Is this company and role worth taking to the next round, and what must I verify in the interview?

The plugin keeps facts, reported information, inference, unknowns, sources, and next actions separate. It starts conservatively at `VERIFY` until the company identity and high-impact claims are supported.

## Naming

- **Scout** — a scout is sent ahead to reconnoiter a company and a role before you commit: background check, due diligence, evidence gathering, interview prep. The English package and repository name stays `dsh-scout` for stable install references.
- **司察** (sī-chá) — 中文名："司"谐音 scout，"察"取考察、审查、侦察之意，二字点明"证据驱动的公司与岗位尽调"这一核心功能。

## Current scope

This repository contains the first runnable, session-isolated slice:

- `scout_start`: create an in-memory diligence case.
- `scout_add_source`: register a source.
- `scout_add_claim`: attach an evidence-bounded claim.
- `scout_verify_identity`: confirm the legal entity from an `E3` source.
- `scout_verify_claim`: promote a claim while retaining its prior evidence state.
- `scout_report`: render the current Markdown report (evidence summary counts, impact-sorted key evidence/risks/role hypotheses, a **verification checklist**, URL-linked source list, and interview questions).

The first case fixture is [Snapmaker HR Head](docs/fixtures/dsh-scout/snapmaker-hr-head.json). Its historical material is deliberately marked as `E1` and is not treated as current verification.

Case state is currently in memory and isolated by DSH agent/session identity. Durable five-file export, configurable storage, and provider-backed collection are the next implementation slice; this repository does not yet claim the full product contract is complete.

## Development

```sh
pnpm install
pnpm test
pnpm run check:release
```

The tests cover the conservative decision default, evidence-level constraints, identity verification, session isolation, report rendering, and tool cleanup on unload. `check:release` additionally packs the plugin, installs it into an isolated temporary DSH profile, verifies `--dump-config`, checks all six tools after mount, and observes the Cordis unload disposer. The gate uses `DSH_BIN` or a local `dsh` binary when available; otherwise it downloads the exact official CLI version `0.1.0-rc.6` through `npx`.

## Install into a DSH profile

The package is an installable DSH bundle:

```sh
dsh plugin --profile scout-demo add github:MaxHou-infinity/dsh-scout#<commit>
dsh --profile scout-demo --dump-config
```

Git installs fetch source and run `prepare`. pnpm may require an explicit `allowBuilds` entry for `dsh-scout`; only allow a pinned source you have reviewed. The current package targets `@deepseek-ai/dsh-tools` `0.1.0-rc.6` and `@deepseek-ai/cordis` `4.0.x`.

## Design boundaries

- It does not replace generic web search, browser, or MCP providers.
- It does not send applications, emails, or personal identity data to third parties.
- It does not turn funding, company self-description, or a job posting into verified success claims.
- It is not legal, investment, or medical advice.

See [the product contract](docs/dsh-scout-product-contract.md) for the full MVP boundary and acceptance criteria.

## Community

This is an independent community plugin for DeepSeek Harness. The repository uses the `dsh-plugin`, `deepseek-harness`, `due-diligence`, `company-research`, `job-research`, `hr-tech`, and `evidence-based` topics for discovery.
