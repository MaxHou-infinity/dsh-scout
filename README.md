# dsh-scout

[English](README.md) | [简体中文](README.zh-CN.md)

Evidence-driven company and job intelligence for DeepSeek Harness.

`dsh-scout` helps an agent answer a concrete question:

> Is this company and role worth taking to the next round, and what must I verify in the interview?

The plugin keeps facts, reported information, inference, unknowns, sources, and next actions separate. It starts conservatively at `VERIFY` until the company identity and high-impact claims are supported.

## Current scope

This repository contains the first runnable, session-isolated slice:

- `scout_start`: create an in-memory diligence case.
- `scout_add_source`: register a source.
- `scout_add_claim`: attach an evidence-bounded claim.
- `scout_verify_identity`: confirm the legal entity from an `E3` source.
- `scout_verify_claim`: promote a claim while retaining its prior evidence state.
- `scout_report`: render the current Markdown report.

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

This is an independent community plugin for DeepSeek Harness. The repository uses the `dsh-plugin` topic for discovery.
