# dsh-scout 0.9.2 门禁发现 · G1：冷启动惰性回填会重写决策理由措辞

| 项 | 值 |
|---|---|
| 编号 | **G1**（0.9.2 门禁 F2 的首个产出） |
| 发现者 | T1 / F2 真实宿主端到端门禁（`scripts/profile-smoke.mjs` 的探索探针，随后由专用最小复现确认） |
| 插件版本 | 发现时 `dsh-scout 0.9.1`（`package.json` 现为 `0.9.2`）：本文的复现输出与代码路径行号取自 0.9.1 工作树；截至本次订正（2026-10-13），`src/index.ts` 仍是同一修订（hash 见下一行），因此行号仍然有效 |
| 宿主版本 | dsh `0.2.0-rc.2`（本地 `which dsh`）；同一路径在 0.1.0-rc.6 / 0.1.2-rc.1 / 0.2.1-alpha.2 上未单独复现，但走的是同一份插件代码 |
| 代码修订 | `src/index.ts` working-tree hash `cb42b35d7d41a906d4480c653cc4ebf98497b93f`；`src/model.ts` / `src/i18n.ts` 与该修订下未修改 |
| 严重度 | **低（cosmetic）**：`decision` 稳定，漂移的是模型可见的「理由」整句 |
| 状态 | **推迟到 0.10.0**（Lead 2026-10-13 决策）——0.9.2 **不修代码、不加红断言**；本文档即为长期记录，并进入 CHANGELOG 的 Known boundaries |
| 复现脚本 | [`scripts/repro-decision-reason-drift.mjs`](../scripts/repro-decision-reason-drift.mjs)（诊断件，不进测试套件、不进发布包） |
| 修订 | **2026-10-13 由 gate-dev（文档作者）订正 §1 / §3 / §4**：原文误称「任一后续写工具都会调用 `decide()`」；据源码 `src/index.ts` 的 7 个 `decide` 调用点（`:638` 回填 + `:722/:893/:967/:1166/:1227/:1260` 六个工具）与 `requireCase → rehydrate → decide` 链改正，**触发窗口随之略放大，严重度不变**。由 docs-dev 在 T8 比对源码发现、Lead 独立核实后派发 T9 |

---

## 1. 观察

对**`scout_start` 之后从未发生「会重算决策的调用」**的案例（此后只登记过来源、只看过报告、只导出过，都不算重算）：

- 进程内首次 `scout_report` 与随后导出的 `case.json` 使用 **初始文案**：
  `尚未完成公司主体和岗位授权核验。`（i18n `defaults.initialDecisionReason`，`src/i18n.ts:235`），
  且 `case.json` **没有** `decisionReasonCode` 字段。
- 冷启动后对同一案例 `scout_report`（惰性回填，无需先 `scout_import`），回填路径会重新跑一遍决策：
  理由变成 `公司主体仍未核验，不能直接推进。`（i18n `decisionReasons.identity`，`src/i18n.ts:181`），
  再次导出后 `case.json.decisionReasonCode === "identity"`。

`decision` 两处都是 `VERIFY`，**判定不变**；变的是渲染进 `scout_report` 正文的那一行理由，以及落盘 `case.json` 的 `decisionReason` / `decisionReasonCode`。

关键细节（决定影响面大小）——**以源码为准**：

- `decide()` 全文件只有 **7 个调用点**：`src/index.ts:638`（`rehydrate` 惰性回填）、`:722`（`scout_add_claim`）、`:893`（`scout_ingest`）、`:967`（`scout_search`）、`:1166`（`scout_import`）、`:1227`（`scout_verify_identity`）、`:1260`（`scout_verify_claim`）。**缓存命中的同一进程内**，只有这 6 个*工具*调用会把初始文案换成规范文案；
- **缓存未命中时相反**：`requireCase`（`:646-664`）会先 `rehydrate`（`:652` → `decide` `:638`），所以**任何**访问该 case 的工具调用（含 `scout_report` / `scout_export` / `scout_add_source`）都会触发一次重算与重对齐——冷启动后哪怕只调 `scout_report` 也会带上这次规范化；
- `scout_start`（`:673-700`）既不调 `requireCase` 也不调 `decide()`，是**唯一**完全绕过 `decide` 的工具，初始文案（`model.ts:234`）只由它写入；
- `scout_add_source`（`:1177-1208`）、`exportCase`（`:541`）、`maybePersist`（`:554`）都**不调** `decide()`：登记来源与落盘自身都不会重算，所以「只登记过来源、只导出过」的案例在缓存命中时**仍保留初始文案**；
- 因此 G1 的窗口是「`scout_start` 之后从未发生会重算决策的调用」，比「一次写操作都没有」**略大**；该窗口内的案例一旦导出、冷启动（或 `scout_import`），磁盘上的初始文案就会被回填路径的规范文案替换——短暂态先被**固化到磁盘**，再被改写，于是成为跨进程可见的差异。

## 2. 最小复现

```sh
node scripts/repro-decision-reason-drift.mjs
```

两个真实 DSH 进程、同一个 `DSH_HOME`/profile、`scoutDir` 由 profile patch 注入绝对路径：

1. 进程 1（`create`）：`scout_start` → `scout_report` → `scout_export`（落到 `<scoutDir>/<caseId>`）；
2. 进程 2（`rehydrate`）：`scout_report`（不 import，走惰性回填）→ `scout_export`（落到 `<scoutDir>/<caseId>-again`）。

**原始输出（实测，逐字）**：

```text
fresh scout_report     : - 理由：尚未完成公司主体和岗位授权核验。 | code: null
exported case.json     : "尚未完成公司主体和岗位授权核验。" | code: null
rehydrated scout_report: - 理由：公司主体仍未核验，不能直接推进。 | code: null
re-exported case.json  : "公司主体仍未核验，不能直接推进。" | code: "identity"
decision before/after  : VERIFY / VERIFY
```

说明：`scout_report` 的读工具信封只有 `{caseId, decision, report, coverage}`，不暴露 `decisionReasonCode`，所以那两行的 `code` 恒为 `null`；`decisionReasonCode` 只能在 `case.json` 里观察到。

**脚本全文**（仓库副本与产出上面输出的原件有两处差异，`diff` 已核对：① 头部多了 5 行说明注释；② tarball 名改为从 `package.json` 的 `name`/`version` 派生——原件把 `dsh-scout-0.9.1.tgz` 写死，0.9.2 bump 后会失效。**产生上面输出的代码逻辑两处均未改动**）：

```js
#!/usr/bin/env node
// Minimal repro: does a case that was created but never mutated report the same
// decision REASON before and after a cold restart (lazy rehydration)?
//
// Finding: docs/dsh-scout-0.9.2-gate-findings.md (found by the F2 real-host gate).
// This is a diagnostic artifact, not part of the test suite and not part of the
// published package (package.json `files` does not list it). It packs the current
// working tree, so do not run it while another build or pack is in flight.
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const repo = '/Users/maxhou/Desktop/Max 项目-2026/deepseek harness development'
const root = await mkdtemp(join(tmpdir(), 'reason-probe-'))
const home = join(root, 'home')
const scoutDir = join(root, 'scout-data')
const caseId = 'reason-case-001'
const exportDir = join(scoutDir, caseId)
await mkdir(scoutDir, { recursive: true })
const packageJson = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'))
const tarball = join(root, `${packageJson.name}-${packageJson.version}.tgz`)
const verifier = join(root, 'verify.mjs')

await writeFile(verifier, `
export const inject = ['tools']
const emit = (kind, payload) => process.stdout.write('PROBE ' + JSON.stringify(Object.assign({ kind: kind }, payload)) + '\\n')
const CASE_ID = process.env.P_CASE_ID
const EXPORT = process.env.P_EXPORT
const SCENARIO = process.env.P_SCENARIO
let n = 0
const call = async (ctx, name, args) => {
  n += 1
  const r = await ctx.tools.execute({ callId: 'p-' + name + '-' + n, name, arguments: args, signal: new AbortController().signal })
  emit('call', { tool: name, isError: r.isError === true, value: r.value === undefined ? null : r.value, error: r.isError ? r.error : null })
}
export async function apply(ctx) {
  const d = Date.now() + 5000
  while (!ctx.tools.get('scout_report') && Date.now() < d) await new Promise(r => setTimeout(r, 25))
  if (SCENARIO === 'create') {
    await call(ctx, 'scout_start', { caseId: CASE_ID, companyName: 'Reason Probe Co', roleTitle: 'HRBP', location: 'Shanghai' })
    await call(ctx, 'scout_report', { caseId: CASE_ID })
    await call(ctx, 'scout_export', { caseId: CASE_ID, targetDir: EXPORT })
  } else {
    await call(ctx, 'scout_report', { caseId: CASE_ID })
    await call(ctx, 'scout_export', { caseId: CASE_ID, targetDir: EXPORT + '-again' })
  }
  emit('done', {})
  queueMicrotask(() => ctx.appExit(0))
}
`)
await writeFile(join(root, 'p.yml'), `- id: dsh-scout\n  config:\n    scoutDir: ${JSON.stringify(scoutDir)}\n- insert:\n    - id: reason-probe\n      name: ${JSON.stringify(verifier)}\n`)
spawnSync('pnpm', ['pack', '--pack-destination', root], { cwd: repo, stdio: 'ignore' })
const env = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_MODE: 'DISABLED' }
spawnSync('dsh', ['plugin', '--profile', 'reason', 'add', `file:${tarball}`], { cwd: root, env, stdio: 'ignore' })

const boot = scenario => {
  const r = spawnSync('dsh', ['--profile', 'reason', '--patch', join(root, 'p.yml')], {
    cwd: root,
    env: { ...env, P_SCENARIO: scenario, P_CASE_ID: caseId, P_EXPORT: exportDir },
    encoding: 'utf8',
  })
  return r.stdout.split('\n').filter(l => l.startsWith('PROBE ')).map(l => JSON.parse(l.slice(6)))
}
const reason = value => (value?.report ?? '').split('\n').find(line => /^-\s*(理由|Reason)/.test(line)) ?? '(none)'

const first = boot('create')
const second = boot('rehydrate')
const firstReport = first.filter(g => g.kind === 'call' && g.tool === 'scout_report')[0]
const secondReport = second.filter(g => g.kind === 'call' && g.tool === 'scout_report')[0]
const exportedCase = JSON.parse(await readFile(join(exportDir, 'case.json'), 'utf8'))
const reexportedCase = JSON.parse(await readFile(join(exportDir + '-again', 'case.json'), 'utf8'))
console.log('fresh scout_report     :', reason(firstReport.value), '| code:', JSON.stringify(firstReport.value?.decisionReasonCode ?? null))
console.log('exported case.json     :', JSON.stringify(exportedCase.decisionReason), '| code:', JSON.stringify(exportedCase.decisionReasonCode ?? null))
console.log('rehydrated scout_report:', reason(secondReport.value), '| code:', JSON.stringify(secondReport.value?.decisionReasonCode ?? null))
console.log('re-exported case.json  :', JSON.stringify(reexportedCase.decisionReason), '| code:', JSON.stringify(reexportedCase.decisionReasonCode ?? null))
console.log('decision before/after  :', exportedCase.decision, '/', secondReport.value?.decision)
console.log('root:', root)
```

运行注意：脚本里的 `repo` 是绝对路径常量（换机器需改这一行）；它会 `pnpm pack` 当前工作树（会触发一次构建），因此**不要**与其它 build/pack/门禁并发跑。

复现本身也演示了 §1 说的窗口：`create` 场景只调 `scout_start` → `scout_report` → `scout_export`，**三个都不重算决策**，所以初始文案完好地落进了 `case.json`——这正是它跨进程可见的前提。

## 3. 代码路径

| 位置 | 行为 |
|---|---|
| `src/model.ts:207` `createCase` → `:233-234` | `decision: 'VERIFY'` 硬编码，`decisionReason: t.defaults.initialDecisionReason`，**不写** `decisionReasonCode` |
| `src/index.ts:673-700` `scout_start.execute`（`createCase` 在 `:685`） | 既不调 `requireCase` 也不调 `decide()` —— **唯一**完全绕过 `decide` 的工具；初始文案只在这里写入 |
| `src/model.ts:512` `decideCase` → `:515-522` | 由 `assessDecision` 重算 `decision` / `decisionReason` / `decisionReasonCode`；无证据时给出 `decisionReasons.identity` |
| `src/index.ts:646-664` `requireCase` → `:652` `rehydrate` → `:638` `decide` | **缓存未命中时**：任何访问该 case 的工具调用都经此回填（`rehydrate` 是 7 个 `decide` 调用点之一），因此回填同时完成重算与重对齐——同一个工具调用**是否**重算，取决于缓存命中与否 |
| `src/index.ts:722` / `:893` / `:967` / `:1227` / `:1260` | **缓存命中时**重算决策的工具调用：`scout_add_claim` / `scout_ingest` / `scout_search` / `scout_verify_identity` / `scout_verify_claim` |
| `src/index.ts:1166` `scout_import.execute` | 显式导入同样 `decide(recordEvent(restored, 'case_imported', …))`，与回填路径一致（第 7 个调用点） |
| `src/index.ts:1060` / `:1103` / `:1144` / `:1010` | `scout_report` / `scout_export` / `scout_questions` / `scout_compare` 也走 `requireCase`，但自身**从不**调 `decide`：缓存命中时保持原样，缓存未命中时因回填而被动重算 |
| `src/index.ts:1177-1208` `scout_add_source`（`requireCase` 在 `:1190`）、`:541` `exportCase`、`:554` `maybePersist` | **不调 `decide`**：登记来源与落盘都不会重算，所以「只登记过来源 / 只导出过」的案例在缓存命中时仍保留初始文案 |
| `src/model.ts:675` `renderReport` | 报告头的「理由 / Reason」行直接渲染 `scoutCase.decisionReason`，所以磁盘上的措辞变化会出现在模型可见输出里 |
| `src/model.ts:756-757` `exportCaseFiles` | 落盘 `decisionReason`，`decisionReasonCode` 仅在存在时写入 |

对照的 i18n 常量：

- zh-CN：`src/i18n.ts:235` `尚未完成公司主体和岗位授权核验。` vs `:181` `公司主体仍未核验，不能直接推进。`
- en：`src/i18n.ts:374` `Company identity and role authority have not been verified yet.` vs `:320` `The company identity is not verified yet, so we cannot proceed.`
  （en 侧是**同构推断**：代码路径完全相同，本次只实测了 zh-CN。）

## 4. 影响面

**不影响的**：

- `decision`（`VERIFY`）在两个进程、两种路径下都稳定；门禁 F2 已把「决策跨进程一致」作为硬断言，实测通过；
- 证据账本（sources/claims）、覆盖率、面试问题、`caseId` 等一律不变；
- 不涉及数据损坏：`decisionReasonCode` 从「缺失」补成 `"identity"` 反而是更规范的状态。

**受影响的**：

1. **模型可见文案**：`scout_report` 正文的「理由：…」整句，在「`scout_start` 后从未发生会重算决策的调用 → 导出/重启/导入」这条路径上会换一句。用户看到的是"同一个案例，重启后理由说法变了"。
2. **落盘工件**：`case.json` 的 `decisionReason` 变化，并新增 `decisionReasonCode` 字段（第三方直接读盘的工具会看到字段出现）。
3. **文案冻结基线风险**：`tests/acceptance.test.mjs` 里 `scout_ingest drafts its claim notes in the deployment language` 用例钉住了「zh-CN 草稿文案不变的 0.9.0 字节兼容基线」（该断言当前在工作树 `:1194`，`tests/` 正在被 F1 改动，行号会变）。任何"让初始理由规范化"的修法都会动到该基线，这也是本条不宜塞进 0.9.2 的第二个理由。

**触发概率**：低，但窗口比「一次写操作都没有」**略大**。只要 `scout_start` 之后从未发生会重算决策的调用就会命中——典型情形是只 `scout_add_source` 登记了来源、只 `scout_report` 看过一眼、或直接 `scout_export`（这三类在同一进程内都不重算），该案例导出后冷启动（或 `scout_import`）就会看到措辞变化。用户一旦调用 `scout_add_claim` / `scout_ingest` / `scout_search` / `scout_verify_identity` / `scout_verify_claim`，同一进程内初始文案即被规范化，之后导出/重启也就不会再漂移。

## 5. 为什么 0.9.2 不修（Lead 决策，记录在案）

1. 本项目硬规矩：**测试套件里「断言缺陷存在」的用例数必须为 0**。若把「重启前后 `decisionReason` 必须一致」写成断言，0.9.2 会带着一条红用例，无法发布；因此门禁 F2 **只**断言 `decision` 一致，本条以本文档 + CHANGELOG Known boundaries 的形式记录，而不是用测试钉住缺陷。
2. 正确修法会改变 **zh-CN 全新案例的模型可见文案**，属于 0.9.0/0.9.1 冻结的文案基线之外的变更，超出 Max 已批准的 0.9.2 范围。
3. 该差异不影响任何判定或数据，推迟不会造成错误决策。

## 6. 建议修法与影响面（供 0.10.0 决策）

| 方案 | 做法 | 影响面 |
|---|---|---|
| **A（推荐）** | 让 `scout_start` 也走 `decide()`，并删除 `defaults.initialDecisionReason`（或让它等于 `decisionReasons.identity`） | 全路径只有一种规范理由；**代价**：zh-CN/en 全新案例的首屏理由文案变化，需同步 `tests/acceptance.test.mjs` 的字节兼容基线、README/产品契约里引用该文案的段落；需要 Max 批准文案变更 |
| B | 保留初始文案，但在 `createCase` 里同时写入 `decisionReasonCode`，并让 `decide()` 在「无证据且理由码未变」时保留既有 `decisionReason` | 文案稳定；**代价**：`decide()` 变成有状态的条件逻辑，削弱"决策理由总是可从证据重算"的纯函数性质，与 0.9.1 起"回填即规范化"的设计取向相反 |
| C | 文档化边界：在 README/产品契约声明「回填/导入会以当前证据重算决策理由，初始文案只在创建进程内有效」 | 零代码风险；**代价**：不改行为，用户仍会看到措辞漂移 |
| D | 让初始文案与规范文案逐字相同（仅改 i18n 常量） | 差异消失；**代价**：等价于方案 A 的文案变更，且失去"尚未开始调查"的友好首屏提示 |

建议：0.10.0 走 **A**（并在 CHANGELOG 里作为文案变更显式列出）；若 Max 偏好保留友好首屏提示，则退到 **C**。

## 7. 本条与门禁的关系

- F2 门禁（`scripts/profile-smoke.mjs`）**已经**覆盖了本条所在的整条路径（导出 → 冷启动 → 惰性回填 → 跨语言导入），并断言其中一切**功能性**事实：`persisted`/`complete`、6 文件、marker 语义、`case_rehydrated` 事件、决策一致、跨语言 CJK=0；
- 门禁**故意不**断言理由措辞一致（见 §5.1）。因此本条是"门禁把这条路径第一次真实跑起来之后暴露出来的**相邻**问题"，而不是门禁失败；
- 若将来 0.10.0 采纳方案 A，应在门禁里把「重启前后 `decisionReason` 一致」升级为**正向契约断言**（此时它才不再是"断言缺陷存在"）。
