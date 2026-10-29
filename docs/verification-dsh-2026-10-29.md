# DSH channel verification repair — 2026-10-29

Status: compatibility verification repair; not published to npm. The package version remains
0.9.3. A subsequent patch release should receive its own version and release gates.

## Observed failure

GitHub Actions run [40783860402](https://github.com/MaxHou-infinity/dsh-scout/actions/runs/40783860402)
passed `latest` and `next` but failed `alpha` (`0.2.2-alpha.2`). The job used
Node 22 although that DSH version requires Node >=24.9. Independently of that
warning, its tool service changed from single-call execution to batch execution.
The old verifier omitted `calls`; the new scheduler failed at `toolCalls.map()`
and wrapped the TypeError in `ToolBatchExecutionError`. Reproducing on Node 26
confirmed that upgrading Node alone would not repair the verifier.

Official package evidence: `@deepseek-ai/dsh-tools@0.2.2-alpha.2`,
`lib/types/index.d.ts`, `lib/types/executor.d.ts`, `lib/types/batch.js`.

## Repair

- Nightly channel checks use Node 24. The existing CI and release workflow stay
  on Node 22 for the older verified matrix; plugin Node and DSH ranges are unchanged.
- The smoke adapter selects the batch contract through the public `setExecutor`
  capability present in the inspected alpha API. It does not access the private
  `selectExecutor` method, inspect function arity, or retry after a failed call.
- Batch calls carry raw JSON-string arguments. Exactly one result with the
  original call ID and an explicit boolean `isError` is required. Tool errors and
  infrastructure rejections both remain failures of the appropriate assertions.
- Error diagnostics include bounded nested causes and partial settled call IDs,
  without dumping partial result values or additional context.
- The helper is included in the npm files allowlist because the shipped smoke
  script imports it. Unit tests evaluate serialized helper source in an isolated
  VM, matching the real-host verifier's embedding mechanism.
- Plugin business source, declared compatibility ranges and dependency versions
  are unchanged.

## Validation

Node 22.19.0 and 24.9.0 binaries were downloaded from nodejs.org to a temporary
directory and checked against its SHASUMS256.txt. No system runtime was replaced.

| Node | DSH versions | Result |
| --- | --- | --- |
| 22.19.0 | 0.1.0-rc.6, 0.1.2-rc.1, 0.2.0-rc.2, 0.2.1-alpha.2 | Pass |
| 24.9.0 | 0.2.1-rc.2 (`latest`), 0.2.1-rc.4 (`next`), 0.2.2-alpha.2 (`alpha`) | Pass |

Each matrix uses `npm run check:release`, including 140 unit tests, the full
profile gate for each exact version, and the pack dry run. No smoke escape
switches are enabled. Current channels were resolved from npm on 2026-10-29.

```sh
# Node 22.19 on PATH: original release matrix
npm run check:release

# Node 24.9 on PATH: current channel matrix
DSH_VERSIONS='0.2.1-rc.2 0.2.1-rc.4 0.2.2-alpha.2' npm run check:release
```

The full profile gate checks install, 12 registered tools, six executed tools,
export, cold restart, lazy rehydration, cross-language import, uninstall and
output-schema/completion-marker negative controls. It does not cover a real
LLM/Agent/approval path, Desktop UI, all 12 tool bodies, relative paths or
autoPersist=true. The existing script documents these limits in detail.

These results are local validation. Remote Ubuntu validation is a separate gate;
consult the CI and DSH compatibility Actions runs for the repair commit. Neither
a successful remote check nor this record implies a newly published npm version.

Local evidence retained for this run:

- `/private/tmp/dsh-repair-node22-matrix.log`: exit 0; 140/140 tests; 4/4 profiles; pack dry run passed.
- `/private/tmp/dsh-repair-node24-matrix.log`: exit 0; 140/140 tests; 3/3 profiles; pack dry run passed.
- `/private/tmp/dsh-repair-final-unit.log`: final documentation/fixture changes included; 140/140 tests.
