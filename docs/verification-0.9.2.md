# dsh-scout 0.9.2 独立验证报告（GO/NO-GO）

- **验证对象**：`dsh-scout@0.9.2`（工作树；`package.json` version = `0.9.2`，`@deepseek-ai/schemastery` = `~3.18.4` → 实测解析 `3.18.4`）
- **验证者**：`verifier`（独立于全部实现者：`lead` / `gate-dev`(T1/T9) / `impl-dev`(T2) / `docs-dev`(T3/T4/T8)）
- **本轮范围**：复现四道门禁；自建独立对抗套件复核 F1（面试问题按下标逐条对齐）；**独立复核 F2 门禁是否真门禁（含故障注入）**；复核 F4（版本对齐）与 F5（render 整串上限）；逐条复核文档措辞（沿用 [verification-0.9.1.md §5](verification-0.9.1.md) 的方法）；给出 GO/NO-GO
- **环境**：macOS（Darwin 24.6.0 / arm64）；Node `v26.8.1`；npm `12.0.2`；pnpm `11.25.0`；本机 `dsh 0.2.0-rc.2`（`/opt/homebrew/bin/dsh`）
- **验证者写入范围**：仅新增 `tests/verification-0.9.2.test.mjs`（**15 项**）与本文档。未修改任何实现 / 门禁 / 文档文件（`src/**`、`scripts/**`、`tests/` 既有 4 个套件、`package.json`、`pnpm-lock.yaml`、`README*`、`CHANGELOG.md`、`docs/dsh-scout-product-contract.md`、`docs/dsh-scout-0.9.2-gate-findings.md` 一律未动）。故障注入全部在 `/tmp` 副本上执行，**未改仓库**。未执行 `git commit` / `git push` / `npm publish` / `git tag`。
- **本轮新发现实现缺陷：0 条**（详见 §5）

### 冻结树指纹（sha256[0:16]）

**实现 + 门禁 + 测试集（18 个文件）聚合指纹：`40ff54ae340535d0`**
（聚合方式：对 `hash  path` 排序清单整体取 sha256。该聚合值在本次验证开始时与结束时**完全相同** —— 见下表两次采样。**该聚合刻意不含验证者自己新增的套件**；把 `tests/verification-0.9.2.test.mjs` 计入后的聚合是 `770be14fd53c6d63`，两者都可复现，见附录 A。）

| 文件 | sha256[0:16] | 文件 | sha256[0:16] |
|---|---|---|---|
| `src/index.ts` | `cc6e63154458788c` | `tests/acceptance.test.mjs` | `2068261ce38e5e33` |
| `src/model.ts` | `36ec4764db9b1240` | `tests/model.test.mjs` | `3fd661f859a81d36` |
| `src/i18n.ts` | `9627087ba04a220c` | `tests/tools.test.mjs` | `e6e3016fd10b5886` |
| `scripts/profile-smoke.mjs` | `70ade56bff662abd` | `tests/package.test.mjs` | `fc902b33ddf5a0e3` |
| `scripts/check-release.mjs` | `ddcb645259540c3e` | `package.json` | `4b9d90b5a82fb682` |
| `scripts/repro-decision-reason-drift.mjs` | `c4d6c6f0d85b3385` | `pnpm-lock.yaml` | `edaacbf5b19d818b` |
| `scripts/archive-official-docs.mjs` | `702dce5e5d7e8a22` | `locale/en.json` | `0510da397c3c3c8c` |
| `scripts/enrich-official-docs-index.mjs` | `45d32a1586c4663f` | `locale/zh.json` | `b07cee57af7913cd` |
| `cordis.patch.yml` | `308362ed55000652` | `tsconfig.json` | `8f078d0790882d1f` |

**本次验证新增的验证者文件**（不属于冻结集，仅验证证据）：

| 文件 | sha256[0:16] |
|---|---|
| `tests/verification-0.9.2.test.mjs` | `0a9ce644ede6cb82` |

**被复核的文档（本轮文档最终版，验证者在这些指纹上完成逐条复核）**：

| 文件 | sha256[0:16] | 文件 | sha256[0:16] |
|---|---|---|---|
| `README.md` | `20d389a135d9dca6` | `CHANGELOG.md` | `5af9267b2b4ae385` |
| `README.en.md` | `989d465e4a7e1814` | `docs/dsh-scout-product-contract.md` | `28b5d1e19d40b91c` |
| `docs/dsh-scout-0.9.2-gate-findings.md` | `a43a1a085dfe26ba` | `docs/verification-0.9.1.md` | `e7346708dad34a8a` |

> 时序说明（重要）：`docs/dsh-scout-0.9.2-gate-findings.md` 在 21:25:26 由 T9 订正（指纹由 `0df5d64dd1759b12` → `a43a1a085dfe26ba`）。§4.2 的复核是对**订正后**版本做的；订正前后差异见 §4.2。其余文档在其后未再变动。

---

## 0. 方法与证据等级

1. **门禁复现**：`npm test`、`DSH_BIN=$(which dsh) npm run test:profile`、`pnpm pack --dry-run`、`npm run check:release` 全部在本机重跑，原始输出摘要见 §1。
2. **独立验收套件**：新建 `tests/verification-0.9.2.test.mjs`（15 项），**不复用也不导入** `tests/acceptance.test.mjs` 的断言；自带最小 Cordis 形 ctx 与内存 `fs` double。断言里的每一处文案都取自 `scoutStrings()` 出厂表，无硬编码出厂句。角度清单见 §2。
3. **故障注入（F2 的核心证据）**：把仓库复制到 `/tmp`，对 `scripts/profile-smoke.mjs` 做 5 组注入 + 1 组 SKIP 开关实跑，验证"门禁变红的位置正好是它声称在守的位置"，而不是"恰好没命中"。结果见 §3.5。**未修改仓库内任何文件。**
4. **文档逐条复核**：对 `README.md` / `README.en.md` / `CHANGELOG.md` / 产品契约的每条措辞，指到 `src/index.ts` / `src/model.ts` 的具体行号或实测行为（§4）。
5. **差分与边界**：D10/O10 的"修复前 → 修复后"用 0.9.1 报告的历史观测值 + 本轮实测值对照（§5）；`alignCaseDefaults` 的手改外来文件信任假设用专门探测复核（§4.4 O-4）。

证据等级：本文所有"实测输出"均为本机真实命令 / 真实门禁 / 真实 `/tmp` 副本注入的输出；凡推断或无法复现的，在 §6 / §7 明确标注。

---

## 1. 门禁复现（原始输出摘要）

### 1.1 `npm test`

```console
$ npm test                    # 冻结基线：独立套件尚未加入时
ℹ tests 103
ℹ pass 103
ℹ fail 0
ℹ duration_ms 207.755917
exit=0

$ npm test                    # 加入验证者独立套件之后（最终状态）
ℹ tests 118
ℹ pass 118
ℹ fail 0
ℹ duration_ms 171.88325
exit=0
```

- 基线 **103/103 全绿**，与 Lead 给的基线一致。
- 加入本轮 15 项后 **118/118 全绿**，无一条既有用例因新增文件翻红（已单独确认 `tests/package.test.mjs` 不对 `tests/` 做目录扫描，不会因新套件而失败）。
- **「断言缺陷存在」的用例数：0**。独立核验方式：`tests/*.mjs` 中唯一出现 `characterization` 的位置是 `tests/acceptance.test.mjs:28-29` 的**历史说明注释**（"Round 1 pinned six defects as characterization tests … All seven were fixed"），不存在任何标记为 still-open / documented-boundary 的钉缺陷用例；本轮 15 项亦全为正向契约（其中的 `=== false` 断言全部是"不得注入 / 不得残留出厂句"的正向否定式契约，不是特征化）。

**结论：通过。**

### 1.2 `DSH_BIN=$(which dsh) npm run test:profile`

```console
$ DSH_BIN=$(which dsh) npm run test:profile          # 21:23:48 → 21:24:04（约 16 s）
dsh-scout profile smoke: PASS (dsh-scout 0.9.2, dsh 0.2.0-rc.2)
  scenario chain: 7 gate lines (6 steps + the completion-marker control)
  step 1 registry+create: PASS (12 tools mounted, fs seam present, scout_start/add_source×2/add_claim isError=false, value=object, scout_start content=166B < 1024, zh report 382 Han chars)
  step 2 export: PASS (persisted=true complete=true, targetDir absolute & equal to the requested path, 6/6 files on disk, marker complete=true, decision=VERIFY)
  step 3 cold restart: PASS (second boot on the same DSH_HOME/profile, pid 91109 → 91110)
  step 4 lazy rehydrate: PASS (scout_report with no import returned decision=VERIFY, 2 sources + 1 claim restored, case_rehydrated persisted to events.jsonl)
  step 5 cross-language: PASS (en profile imported the zh export: complete=true, render CJK=0, report.md CJK=0 vs zh report.md 382 Han chars, case.json.language=en, ASCII subject preserved)
  negative control marker: PASS (marker deleted → isError=true "Unknown case"; marker complete:false → same refusal; payload files untouched both times)
  step 6 uninstall: PASS (dsh-scout layer gone from --dump-config; post-removal boot mounted 0/12 tools and the verifier still ran)
  verified: … | 12 tools mounted | scout_start(…, content=166B < 1024) | scout_export(absolute targetDir, 6/6 files, marker complete=true) | cold restart (pid change) | lazy rehydration (decision VERIFY, case_rehydrated persisted) | cross-language import (case.json.language=en, CJK=0, zh control 382 Han chars) | uninstall (0 tools left) | output-schema negative control (ToolOutputError observed) | completion-marker negative controls (missing marker AND complete:false both refused rehydration)
  not covered: no agent/LLM/approval path (agent unset ⇒ absolute dirs only), 6/12 tools executed, report asserted structurally, autoPersist stays false, token budget covers rendered content only
exit=0
```

**结论：通过。** 六步全部出 PASS 行，两个完成标记负向对照与 output-schema 负向对照均生效。U11 所点名的四条路径（导出 / 跨语言导入 / 惰性回填 / 卸载）本轮**有真实宿主门禁**（该门禁的"是不是真门禁"另由 §3 独立复核）。

### 1.3 `pnpm pack --dry-run`

```console
$ pnpm pack --dry-run
package: dsh-scout@0.9.2
Tarball Contents
assets/icon.svg                 docs/fixtures/dsh-scout/snapmaker-hr-head.json   scripts/check-release.mjs
CHANGELOG.md                    LICENSE                                          scripts/profile-smoke.mjs
cordis.patch.yml                locale/en.json                                   tests/acceptance.test.mjs
dist/i18n.d.ts                  locale/zh.json                                   tests/model.test.mjs
dist/i18n.js                    package.json                                     tests/package.test.mjs
dist/index.d.ts                 README.en.md                                     tests/tools.test.mjs
dist/index.js                   README.md
dist/model.d.ts                 docs/dsh-scout-product-contract.md
dist/model.js
Tarball Details
dsh-scout-0.9.2.tgz
exit=0
```

- 打包内容 **24 个文件**，与 0.9.1 一致（新增的 `tests/verification-0.9.2.test.mjs` **不在** `files` 白名单内，已复跑确认仍未被打进 tarball）。
- `exports` 的 6 个目标（`dist/index.js` / `dist/index.d.ts` / `cordis.patch.yml` / `locale/en.json` / `locale/zh.json` / `package.json`）与 `icon` 全部存在于包内。
- 诊断件（`scripts/repro-decision-reason-drift.mjs`）与未发布文档（`docs/dsh-scout-0.9.2-*.md` / `docs/verification-*.md`）均不在包内。

**结论：通过。**

### 1.4 `npm run check:release`（4 个精确 DSH 版本）

```console
$ npm run check:release            # 21:24:14 → 21:25:47（93 s），DSH_BIN=<unset>
dsh-scout release gate
  declared engines.dsh: >=0.1.0-rc.6 <0.3.0-0
  range semantics: node-semver includePrerelease:true (mirrors dsh-app-boot evaluatePluginCompatibility:300)
  profile matrix: 0.1.0-rc.6, 0.1.2-rc.1, 0.2.0-rc.2, 0.2.1-alpha.2 (default matrix)
  out-of-range failures: fatal, reported as OUT OF DECLARED RANGE
[ok] dsh 0.1.0-rc.6     — profile smoke passed (satisfies engines.dsh ">=0.1.0-rc.6 <0.3.0-0")
[ok] dsh 0.1.2-rc.1     — profile smoke passed (satisfies engines.dsh ">=0.1.0-rc.6 <0.3.0-0")
[ok] dsh 0.2.0-rc.2     — profile smoke passed (satisfies engines.dsh ">=0.1.0-rc.6 <0.3.0-0")
[ok] dsh 0.2.1-alpha.2  — profile smoke passed (satisfies engines.dsh ">=0.1.0-rc.6 <0.3.0-0")
dsh-scout release gate: PASS (4 DSH versions, >=0.1.0-rc.6 <0.3.0-0)
exit=0
```

方法学要点（否则这道门禁可能是假的）：**启动前确认 `DSH_BIN` 未设置**，因此 `profile-smoke.mjs` 对每个版本走 `npx --yes @deepseek-ai/dsh@<version>`，四个 binary 均**从 npm 真实取用**（日志中每个版本都有独立的 `npm notice run npx` + 全新的临时 tarball 路径 `…/dsh-scout-profile-gate-<随机>/`）。若把本机 `dsh 0.2.0-rc.2` 通过 `DSH_BIN` 导出，这道门禁会把同一个 binary 跑四遍而报 4/4 —— 本轮**没有**踩这个坑。

耗时说明：任务说明预估 20 分钟量级；本机 pnpm / npx 缓存已热，实测 **93 秒**（四次门禁各自约 16–20 s，加 `npm test` 与打包）。四次运行中扩展后的六步门禁在四个版本上均输出同一组 PASS 行，即 **0.9.1 报告里"门禁只跑两个工具"的结论已不适用于 0.9.2**。

**结论：通过。**

---

## 2. 独立验收套件：`tests/verification-0.9.2.test.mjs`（15 项）

自带最小 Cordis 形 ctx + 内存 `fs` double，**不导入** `tests/acceptance.test.mjs`。角度（与既有验收套件的差分）：

| # | 角度 | 为什么它比"照抄矩阵"更硬 |
|---|---|---|
| V1 | **错排（derangement）**：把 zh 出厂 5 条轮转一位后导入 `en` | 5 条**全是**出厂值、但都不等于自己那一格 ⇒ 一条都不许对齐。这排除了"值属于出厂集合就替换"的实现，证明比较是**按下标** |
| V2 | **重复值**：5 格全填 `factory[0]` | 期望 `[en0, zh0, zh0, zh0, zh0]`：只有第 0 格对齐。值相同却只有一格替换 ⇒ 再次证明是位置映射而非值去重 |
| V3 | **逐下标穷举**：5 个下标各自单独编辑（0..4 全跑） | 不只测"第 3 条"；每格都断言 `countCjk(en 报告) === countCjk(用户那条)`，并断言**其余 4 格**的 en 出厂句被渲染 |
| V4 | **长度门单独隔离**：取 `factory.slice(0, n-1)` | 内容 100% 等于出厂、仅仅长度不同 ⇒ 必须整组保留；同一内容在出厂长度下则必须对齐。这是 `length === factory.length` 条件最锋利的一刀 |
| V5 | 超长组（factory + 1）与**空数组** | 长度分支的两个边界；空数组没有下标可映射 |
| V6 | 等长但全自定义 | 等价于整组替换，且 zh / en 出厂句都不得出现 |
| V7 | **反向 `en → zh-CN`** | sentinel 断言：objective / fitQuestion / 5 条 en 出厂句**一条都不许**出现在 zh 工件里 |
| V8 | **往返 `zh → en → zh`** | 两跳后逐项 == zh 出厂值、`language` 回到 `zh-CN`、用户那条仍在 |
| V9 | **逐字节保留**：`'\u00a0第3️⃣问：😀👨‍👩‍👧 e\u0301 \u200b  '` | NBSP + CJK + keycap + ZWJ 家庭 emoji（代理对）+ 组合符 + 零宽空格 + 首尾空格；严格相等 + `Buffer.compare` 逐字节相等 + 报告里原样渲染 |
| V10 | **同语言 no-op（强形式）**：有证据的 case | 逐键 diff **必须为空数组**（不是"除某些键外"），并断言这确非空谈（源 case 真的是未编辑出厂组、报告真的渲染 5 条 zh 出厂句） |
| V11 | 同语言 no-op（**裸 `scout_start`** 案例） | 移动的键必须 ⊆ 文档化的导入重算键 `{decision, decisionReason, decisionReasonCode}`；作者字段全部不变；理由必须落在 i18n 两个出厂常量之一，且**不得**是 en 文案；`decisionReasonCode` 必须属于 `DECISION_REASON_CODES` |
| V12 | **惰性回填路径**（全新 harness、空缓存、不调 `scout_import`） | 部分编辑 + 跨语言；`case_rehydrated` 事件（含源目录）**证明走的是回填路径**而不是导入；重算后导出的 case.json 向量正确、`language=en` |
| V13 | **幂等 / 不动点** | 已对齐的 en 导出再导入另一个 en 部署，逐项不变，漂移只允许落在文档化重算键上 |
| V14 | **F5 整串上限** | 4 种对抗形状（3 B CJK / 4 B emoji / 混合 1-3-4 B / ZWJ 序列）各 3 条长 action 把 render 推过预算：断言 `Buffer.byteLength(text) <= 1024`、断言**至少一条真的被裁**（否则断言空洞）、断言 UTF-8 上线形式也不超预算、断言结构化 `value.nextActions` 仍保留调用方全文；另有"未超预算的 render 不得带省略号"的反向对照 |
| V15 | **F2 门禁形状**（静态 tripwire） | 断言门禁脚本里仍声明着：绝对路径守卫、`survivingPayload`、`Unknown case`、pid 变化、两个对照都要求 12 工具注册表健康、`case_rehydrated`、三个 `=== '1'` 逃逸开关与 `coverage degraded`、五个场景名。行为层证据在 §3.5（故障注入），本项只防"守卫被悄悄删掉" |

结果：**15/15 通过**，`duration_ms ≈ 100 ms`，**不需要真实 `dsh` binary**（保持 `npm test` 的无外部依赖性质）。

透明说明：这套件在迭代中我自己写出过 3 处**断言笔误**并已修正（都不是产品缺陷）：① V3 最初断言"编辑格的 en 出厂句也应出现"——那格被用户文案替换，本就不该出现；② V8 最初用 `∑countCjk(zh 出厂) ± 用户条` 估算 zh 报告 CJK，忽略了 zh 报告框架本身（标题 / 标签 / 理由）也是中文；③ V14 最初在同一个 case 上累积 4 种形状，`deriveNextActions` 只保留 3 条，第 4 条被挤出 `nextActions`。三处均已按"先测量、再断言"改正。

---

## 3. 独立复核：F2 门禁是不是**真**门禁

> 实现者声称"用故障注入（相对 targetDir / 不删 marker / 错语言 patch）验证过门禁非假绿"。以下是我**独立**读脚本 + 独立注入后的结论：**该声称成立**。注入全部在 `/tmp` 副本执行，仓库零改动。

### 3.1 四条路径是否真的走到

| 路径 | 真实走到的证据（脚本内断言） |
|---|---|
| **导出** | `scout_export { targetDir: <绝对路径> }` 真调用；断言 `persisted===true`、`complete===true`、`value.files` 含 6 个名字、磁盘 `readdir` 恰好 6 个文件、`export.complete.json.complete===true` 且 `caseId` 一致、`case.json.language==='zh-CN'`、`claims.json` 长度 1 |
| **跨语言导入** | 第二 profile `scout-smoke-en`（patch `language: en`）调用 `scout_import { sourceDir: <第 2 步的 zh 导出> }`；断言 `complete===true`、caseId 回显、**`scout_report` 渲染 CJK === 0**、ASCII 主体逐字存活、决策与导出时一致、`case.json.language==='en'`、落盘 `report.md` CJK === 0 |
| **惰性回填** | 第二个真实进程**不调 `scout_import`** 直接 `scout_report`；断言决策一致、主体存活、随后导出的 `events.jsonl` 里含 `case_rehydrated` **且事件文本含 `<scoutDir>/<caseId>`**、sources/claims 数量跨进程还原 |
| **卸载** | `dsh plugin remove dsh-scout` 后 `--dump-config` **不含** `# == dsh-scout`；随后用 verifier-only patch 再起一个进程，断言 `missing === 12 个工具全缺` **并同时断言 lifecycle 三行**（`DSH_SCOUT_LOAD` / `DSH_SCOUT_UNLOAD` / `done`）——所以"0 个工具"不是死进程冒充的 |

非空洞性设计（我复核认为成立）：**第 5 步"en CJK=0"在上游被"zh 报告 CJK>0"与"zh report.md CJK>0"两个正向对照锁住**（实测 382 个汉字），否则一个"只有英文"的插件也能让第 5 步变绿。**第 6 步"0 工具"被 verifier 自身的 lifecycle 行锁住**。

### 3.2 `targetDir` 是否真的是绝对路径（CI 工作目录陷阱）

**是，而且不止一层。** 证据链：

1. `gateRoot = await mkdtemp(join(tmpdir(), 'dsh-scout-profile-gate-'))` → `tmpdir()` 在 macOS 上是绝对路径，`zhExportDir = join(gateRoot, 'scout-data', caseId)` 因此是绝对路径；
2. 所有 `dsh` 子进程都显式 `cwd: gateRoot`（不是 `process.cwd()`），`pnpm pack` 的产物也落在 `gateRoot`；
3. `scoutDir` 通过 profile patch 的 `config:` 注入**绝对路径**，并且门禁**验证这个注入真的到达了插件层**：`--dump-config` 的 `# == dsh-scout, patched by` 段里必须含 `scoutDir: <gateRoot>/scout-data` 与 `language: 'zh-CN'`；
4. 导出返回值另有断言：`isAbsolute(value.targetDir)` **且** `realpath(value.targetDir) === realpath(请求的绝对目录)`（两侧都过 `realpath`，避免 `/var` vs `/private/var` 误判）。

注入验证（INJ-1）：把 `zhExportDir` 改成相对路径 `'scout-data/<caseId>'`，并把 `boot()` 的 `cwd` 改成 `tmpdir()`（模拟 CI 工作目录不同）。门禁**变红**，诊断逐字为：

```console
dsh-scout profile smoke gate FAILED
  expected: value.targetDir resolves to "scout-data/smoke-case-001" (absolute, as passed)
  actual:   "/private/var/folders/…/T/scout-data/smoke-case-001" → "/private/var/folders/…/T/scout-data/smoke-case-001"
```

即：相对路径确实落到了**进程 cwd**（这个陷阱是真的），而门禁确实抓得住它。

**一处如实说明（不是缺陷）**：仅凭"相对路径"本身并不足以让门禁变红——如果进程 cwd 恰好等于 `gateRoot`，相对路径会解析到与绝对路径**同一个位置**，断言仍会通过。真正让门禁与 CI 工作目录解耦的是**构造**（`mkdtemp` 给出的绝对路径 + 显式 `cwd: gateRoot`），`isAbsolute` 与 realpath 断言是第二层。这个区分是我注入时实测出来的，写在这里以免把"断言"当成"构造"。

### 3.3 两个 completion-marker 负向对照是否真的会拒绝回填

**是，且不是"目录不存在"冒充的。** 三重证据：

1. **对照 A（删标记）**：`rm(export.complete.json)` 后重启，断言 `scout_report` `isError===true`、错误消息同时含 `Unknown case` **与** caseId。注入 INJ-2（把 `rm(markerPath)` 注释掉、标记保留）→ 门禁**变红**：`marker control A: with export.complete.json deleted, scout_report still returned a case / actual: isError === false`。 ⇒ 对照 A 的绿灯来自"标记真的被读"，不是"反正都会失败"。
2. **对照 B（`complete:false`）**：把标记改写成 `{…, complete:false}`（五个数据文件仍在），重启后必须同样被拒；并额外断言 `value === null` 且拒绝时没有渲染出 case 正文。 ⇒ "存在即信任"被排除。
3. **"目录不存在"冒充被单独堵住**：两个对照都先 `readFile(markerPath)` 保存原文，之后再断言 `readdir(zhExportDir)` 里**五个数据文件仍在**（`survivingPayload`）。注入 INJ-3b（删掉五个数据文件、保留目录与标记）→ 门禁**变红**，诊断是守卫**自己**的那句：
   ```console
   marker control: the payload files did not survive the marker controls, so this run does
   not isolate the completion marker (a missing export directory would explain the refusal).
   directory: …/scout-data/smoke-case-001
   entries:   ["export.complete.json"]
   ```
4. 两个对照还各自调用 `assertRegistry(entry)` 与 `assertLifecycle(entry)`：**只有 12 个工具全部挂载、且 verifier 自身加载/卸载正常时，拒绝才计入对照** ⇒ 插件加载失败造成的拒绝不会被误当成"标记生效"。

补充观测（非缺陷）：另做一版更粗暴的注入 INJ-3（把整个导出**目录**删掉而不是删标记），门禁同样变红，但红在"对照 B 回写标记时目录已不存在"的未捕获 `ENOENT` 上，而不是走完守卫自己的诊断。真实门禁不会删目录，所以这只是注入实验的细节；从诊断质量看，`survivingPayload` 才是那条能给出准确理由的守卫（故我另跑 INJ-3b 单独验证它）。

### 3.4 三个 SKIP 开关会不会**静默**降低覆盖率

**不会静默，但确实会降低覆盖率并保持 exit 0。** 三点如实说明：

1. 三个开关都是显式 opt-in（`process.env.X === '1'`），默认全跑；
2. 实跑 `DSH_SCOUT_SMOKE_SKIP_CROSS_LANGUAGE=1`（未改动门禁）→ exit=0，但**三处**同时播报降级：step 行 `step 5 cross-language: SKIPPED (… — coverage degraded: the en import path has no real-host gate)`、汇总行的 `cross-language SKIPPED`、以及 `verified:` 行里第 5 步位置；
3. `SKIP_REHYDRATION_CONTROL=1` 同理（step 行写明 "STEP 4 has no control proving it reads the marker"）；`SKIP_NEGATIVE_CONTROL=1` **只**在探针无法注册时把硬失败降为警告，探针一旦跑起来就仍然强制断言 `ToolOutputError`（读源码确认，见 `:1131-1149`）。

⇒ 结论：SKIP 不可能"悄悄"发生（有文字记录），但**CI 若长期带着 SKIP 跑，门禁会长期是绿的而覆盖降级**。这是设计取舍（0.9.2 方向 §F2 明确要求做成可跳过），已由 README:280 与 CHANGELOG 的 0.9.2 段如实写明"跳过的项会在 PASS 行如实报为覆盖降级"。**不阻塞 GO**，但列入 §6 已知边界。

### 3.5 故障注入台账（全部在 `/tmp` 副本，仓库零改动）

| 注入 | 期望 | 实测 | 关键诊断 |
|---|---|---|---|
| **INJ-1** `zhExportDir` 改相对路径 + `boot()` cwd 改 `os.tmpdir()` | 红 | **exit=1 ✅** | `expected: value.targetDir resolves to "scout-data/…" (absolute, as passed)`；实际解析到 `/private/var/folders/…/T/scout-data/…` |
| **INJ-2** 对照 A 不删标记 | 红 | **exit=1 ✅** | `marker control A: … still returned a case / actual: isError === false` |
| **INJ-3** 对照 A 改删**整个目录** | 红 | **exit=1 ✅** | 红在回写标记的未捕获 ENOENT（见 §3.3 补充观测） |
| **INJ-3b** 对照 A 改删**五个数据文件**（保留目录 + 标记） | 红 | **exit=1 ✅** | `marker control: the payload files did not survive … entries: ["export.complete.json"]` |
| **INJ-4** en profile 的 language 改成 `zh-CN` | 红 | **exit=1 ✅** | `cross-language assertion: the en deployment rendered Han characters… actual: 382 Han characters` |
| **SKIP** 未改动门禁 + `DSH_SCOUT_SMOKE_SKIP_CROSS_LANGUAGE=1` | 绿 + 播报降级 | **exit=0 ✅** | step 行 / 汇总行 / `verified:` 行三处 `SKIPPED` + `coverage degraded` |

**5 组注入 + 1 组开关：全部与预期一致。** 实现者"已用故障注入验证门禁非假绿"的声称，本轮由独立复现**予以确认**。

---

## 4. 文档逐条复核（verification §5 方法：措辞 ↔ 实现行号 / 实测行为）

### 4.1 F1 措辞

| 位置 | 现文（要点） | 实现 | 判定 |
|---|---|---|---|
| `README.md:239` | 精选面试问题是**按下标逐条**——长度与出厂数组相同时，该下标仍是出厂默认的条目替换为本部署语言的同下标默认值，**用户改过的那条保持原样**；长度不同时整组视为用户自撰、原样保留。判定依据是「是否等于该下标的出厂默认」，不是编辑历史 | `src/index.ts:414-416`：`curated.length === factory.length ? curated.map((q,i) => q === factory[i] ? target[i] : q) : curated`；比较双方 `:408`（zh 出厂）/`:409`（en 出厂） | **一致** |
| `README.en.md:239` | "decided **entry by entry, by index** … an entry still equal to its factory slot is replaced by this deployment's default at the same index and **an entry the user edited is kept verbatim** … The test is 'does this entry equal its factory slot', not edit history" | 同上 | **一致（与中文同行号、同义）** |
| `CHANGELOG.md:17`（`## [0.9.2]` → Changed 第 1 条） | 同上规则 + "**默认行为对未编辑场景零变化**——整组未被编辑时，对齐结果与 0.9.1 逐条相同；`zh-CN` 部署对既有 case 仍是 no-op（`decisionObjective` / `interviewQuestions` / `role.fitQuestion` 三个字段逐字段不变）" | 未编辑整组 ⇒ 逐条替换 == 整组替换（V4-full 实测 == en 出厂组）；zh 同语言早返回 `:405` ⇒ V10 实测 case.json **逐键零移动**（比"三个字段"更强） | **一致（实测强于措辞）** |
| `docs/dsh-scout-product-contract.md:13` | "精选面试问题按**下标逐条**判定（长度与出厂数组相同时逐条替换，用户改过的那条保持原样；长度不同则整组原样保留）" | 同上 | **一致** |
| `README.md:128` / `README.en.md:128` | "上限就是渲染预算本身（`MAX_RENDER_BYTES = 1024` B）：省略号自身的 UTF-8 长度先从预算里扣掉、再按码元裁切，因此**含省略号的整串也不会超过 1024 B**" | `src/index.ts:234` `MAX_RENDER_BYTES = 1024`；`:237` `ELLIPSIS = '…'`；`:256-262` `suffixBytes = utf8Length(ELLIPSIS)` 后 `> limit - suffixBytes`；`:292` 传 `MAX_RENDER_BYTES`（不再是 `- 8`） | **一致** |

**「判定依据是是否等于该下标的出厂默认，不是编辑历史」这条最容易被写成空话，我用 V2 单独证伪了它的反命题**：5 格全填 `factory[0]` 时，实测结果恰好 `[en0, zh0, zh0, zh0, zh0]` —— 只有"该下标的出厂默认仍是出厂默认"的第 0 格被对齐。文档措辞与实现逐字吻合。

### 4.2 G1 Known boundary（含 T9 订正前后差异）

`CHANGELOG.md` Known boundaries 的 G1 段现在写：会重算决策的是 `scout_add_claim` / `scout_ingest` / `scout_search` / `scout_verify_identity` / `scout_verify_claim` / `scout_import`；只登记来源的 `scout_add_source` 在同一进程内不重算，但冷启动后第一次访问该 case 的工具调用（含 `scout_report` / `scout_add_source`）会先走惰性回填 → `decide`。

**我按源码独立复核（grep `decide(` 全部出现位置）**：

```text
:436  const decide = …            ← 定义
:638  decide(recordEvent(restored, 'case_rehydrated', …))   ← rehydrate（惰性回填）
:722  scout_add_claim
:893  scout_ingest
:967  scout_search
:1166 scout_import
:1227 scout_verify_identity
:1260 scout_verify_claim
```

⇒ **恰好 7 个调用点**，CHANGELOG / README:259 / 契约 的"6 个工具 + 回填"清单与源码**完全一致**；`scout_start`（`:673-700`）、`scout_add_source`（`:1177`）、`scout_export`（`:1071`）、`scout_report`（`:1017`）、`scout_questions`（`:1119`）、`scout_compare`（`:980`）自身都不调 `decide`，其中后 5 个走 `requireCase`（`:646-653`）→ 缓存未命中 → `rehydrate` → `decide`。所以"回填由第一个访问该 case 的工具调用触发"这句是准确的。

**订正前后差异（T9，21:25:26 落地）**：订正前 `docs/dsh-scout-0.9.2-gate-findings.md` §1 写"任一后续写工具（`scout_add_source` / `scout_add_claim` / …）都会调用 `decide()`"，这是**错的**（`scout_add_source` 不调）。订正后的 §1 / §3 已改为"7 个调用点 + 缓存未命中经 `requireCase → rehydrate → decide`"，与源码一致；文档内也留了修订说明（谁、何时、按什么证据）。**触发窗口比原文描述略大，严重度不变（低 / cosmetic）**。

**G1 的行为描述我也做了独立行为复核**（V11，裸 `scout_start` → 导出 → **同语言**导入）：实测 `decisionReason` 由 `defaults.initialDecisionReason`（`尚未完成公司主体和岗位授权核验。`）变为 `decisionReasons.identity`（`公司主体仍未核验，不能直接推进。`）、`decisionReasonCode` 由缺失变为 `identity`、`decision` 稳定 `VERIFY/VERIFY`、作者字段逐个不变 —— 与 G1 的描述**逐字吻合**。

**纪律遵守**：G1 是 Lead 已批准的推迟项，本轮**未**把它当新缺陷、**未**加任何红断言、**未**要求 0.9.2 修它（与项目"「断言缺陷存在」用例数必须为 0"的硬规矩一致）。

### 4.3 版本抬头 / 其余交付项

| 项 | 复核 | 判定 |
|---|---|---|
| `package.json` version = `0.9.2` | 实测 `node -p require('./package.json').version` 经门禁输出确认（`package: dsh-scout@0.9.2`）；`pnpm pack --dry-run` 的 `Tarball Details` 为 `dsh-scout-0.9.2.tgz` | **一致** |
| **F4** `@deepseek-ai/schemastery` = `~3.18.4` | `package.json:65` 为 `~3.18.4`；`node -p require('@deepseek-ai/schemastery/package.json').version` → **`3.18.4`**；README:217 / CHANGELOG:18 的"由 `^3.18.2` 对齐到 `~3.18.4`、`peerDependencies` 与 `engines.dsh` 范围没有变化"与 `package.json:48-53` 逐条吻合 | **一致** |
| **F5** 文档口径 | `README:128` / `README.en:128` / 契约:23 / CHANGELOG:22 四处都说"含省略号不超过 1024 B、预算由省略号自身的 UTF-8 长度推导"；实测上界 1024（见 §5.3） | **一致** |
| 产品契约当前版本段 | `docs/dsh-scout-product-contract.md:19` 为 "**v0.9.2（当前版本）**是收口版本…**不新增工具、不新增命令、不新增 Skill 条目**"；全库 `grep "当前版本"` **仅此一处**，无残留的"0.9.1 当前版本" | **一致** |
| 路线图 | `README.md:294` / `README.en.md:294` 均含 `v0.9.2`（真实宿主端到端门禁关闭 U11 / 按下标逐条对齐关闭 D10 / render 加固 / schemastery 对齐） | **一致** |
| `README.md:280` / `README.en.md:280` 对 `test:profile` 的描述 | "六步真实宿主场景链…另有三条负向对照：`output.schema` 敏感性、标记缺失、标记 `complete:false`…全量约 16 秒…三个 SKIP 开关…跳过的项在 PASS 行如实报为覆盖降级…**仍未覆盖**：真实 LLM / agent loop 与 approval 策略、相对路径、`autoPersist`、真实进程中断、其余 6 个工具只断言注册" | 与门禁脚本逐条吻合（实测 16 s；`not covered` 行逐字对应） | **一致** |
| 发布事实 | README / CHANGELOG **未**出现"已发布 npm / tag v0.9.2"声明（T8 明确要求发布前不写），与当前尚未 tag / publish 的状态自洽 | **一致** |

### 4.4 观察项（非缺陷，仅记录）

| # | 观察 | 影响 | 处置 |
|---|---|---|---|
| O-1 | **裁切可能切在代理对中间，留下一个孤立代理项**。实测：4 B emoji 形状下，render 末尾码元为 `U+D83D`（孤立高代理项）。`utf8Length` 把它按 3 B 计（UTF-8 编码会变成 U+FFFD），所以 `≤ 1024 B` 的契约**仍然成立**（实测该形状 979 B；`src/index.ts:249-255` 的注释已把这一点写成有意取舍："a lone surrogate left by slicing a pair still encodes as 3 bytes, so the measured length stays the conservative one"）。模型侧最坏看到一个 `�` | 纯 cosmetic，且**不是 0.9.2 引入的**（0.9.1 的码元裁切同样如此），F5 只改了预算推导 | 记录，不报缺陷、不阻塞 |
| O-2 | `CHANGELOG.md:22` 的历史数字"含省略号的实际上界**约 1019 B**（实测最坏 1018 B）"。按 0.9.1 代码推导：`clampUtf8(text, 1024-8=1016)` 且循环条件为 `> limit-1` ⇒ 裁到 ≤ 1015 B，再追加 3 B ⇒ 精确上界是 **1018 B**。"约 1019" 比可推导值高 1 B，但已用"约"字限定，且括号里给出的**实测值 1018 是准确的** | 历史描述，1 B 量级；0.9.2 自身"不超过 1024 B"的表述精确且已验证 | 记录，不报缺陷 |
| O-3 | 门禁 stdout 的 `scenario chain: 7 gate lines` 里，`gate lines` 指的是脚本自己的 7 条 step 摘要，**不是**宿主 verifier 打印的 `DSH_SCOUT_GATE` 行（后者数量远多于此） | 纯标签措辞，无任何断言依赖它 | 记录，不报缺陷 |
| O-4 | `README.md:239` / `README.en.md:239` 的信任假设"对齐只按 `language` 标签判定，不校验标签与内容是否自洽；手工把 `language` 改成与内容不符的值再导入时，插件会按「语言相同」提前返回、不做校正"。**专门探测复核**：把 zh case 的 `language` 保持 `zh-CN`、内容替换为 en 出厂文案后导入 zh-CN 部署 → 导出的 `language` 仍为 `zh-CN`，objective / questions 仍是 en 出厂文案（未被校正） | 与 `src/index.ts:403-405` 的早返回一致 | **文档准确**，属已文档化的信任假设，记录不报缺陷 |

---

## 5. 缺陷台账

### 5.1 本轮结论

**0.9.2 本轮独立验证未发现任何新的实现缺陷、门禁缺陷或文档不符。** 四道门禁全绿；F1 / F5 的实现与规格逐行吻合；F2 门禁经 5 组独立故障注入确认非假绿；文档逐条复核全部一致（4 条观察项见 §4.4，均非缺陷）。验证过程中修掉的 3 处问题**全部是我自己套件的断言笔误**（见 §2 透明说明），不涉及产品代码。

### 5.2 D10 关闭（F1：整组 all-or-nothing → 按下标逐条）

| 阶段 | 内容 |
|---|---|
| **观察（0.9.1，第三轮报告 §2 边界）** | 只要用户改过任一条精选面试问题，整组原样保留 ⇒ 只改 1 条后，`en` 部署的报告仍含 **约 79 个 CJK 字符**（4 条未对齐的 zh 出厂问题）；而 `decisionObjective` / `role.fitQuestion` 因逐字段判定已对齐 —— 同一函数内两种粒度不一致 |
| **修复（0.9.2 / T2，F1）** | `src/index.ts:414-416`：`curated.length === factory.length ? curated.map((q,i) => q === factory[i] ? target[i] : q) : curated`；长度不同整组保留。旧代码 `curatedIsUntouched = length 相同 && every(...)` 整组判定被删除（`git diff` 已核对只有这一处语义变更 + 注释） |
| **本轮实测** | **确定性证据（V3）：5 个下标各自单独编辑时，`en` 报告的 CJK 计数恒等于「用户那条自身的 CJK 数」（本夹具取值 9），不再是 0、也不再是 ~79**；并断言其余 4 格的 en 出厂句确实被渲染。另经 V1 / V2 证明"按下标"而非"按值集合"；V4 证明长度门是唯一保留整组的条件；V5 覆盖空组与超长组；V6 覆盖等长全自定义；V7 / V8 / V9 覆盖反向、往返与逐字节保留；V12 覆盖惰性回填路径 |
| **真实宿主证据** | `test:profile` 的 zh→en 路径在真实 dsh 0.2.0-rc.2（及 0.1.0-rc.6 / 0.1.2-rc.1 / 0.2.1-alpha.2）上跑通：`case.json.language=en`、render 与 `report.md` 的 CJK = 0（ASCII fixture，故工厂文案必须完全对齐才能为 0），且 zh 侧 CJK=382 作为正向对照 |
| **判定** | **D10 关闭。** |

### 5.3 O10 关闭（F5：render 整串上限加固）

| 阶段 | 内容 |
|---|---|
| **观察（0.9.1，第三轮报告 O10）** | 裁切预算写死为 `MAX_RENDER_BYTES - 8`，再追加 3 B 省略号：旧循环条件为 `utf8Length(clipped) > limit - 1`，即裁到 ≤ 1015 B，加 3 B ⇒ 可推导的**精确上界 1018 B**，距 1024 B 只剩 **6 B** 余量（0.9.1 文档按"约 1019"表述则为 5 B）；把余量改到 3 以内就会越界 |
| **修复（0.9.2 / T2，F5）** | `src/index.ts:237` 新增 `ELLIPSIS = '…'`；`:258` `suffixBytes = utf8Length(ELLIPSIS)`；`:260` 循环条件改为 `> limit - suffixBytes`；`:292` 调用从 `clampUtf8(…, MAX_RENDER_BYTES - 8)` 改为 `clampUtf8(…, MAX_RENDER_BYTES)`。`git diff` 已核对：除这两处与注释外无其他改动 |
| **本轮实测** | ① **上界**：4 种对抗形状（3 B CJK / 4 B emoji / 混合 / ZWJ 序列）各把 render 推过预算，实测 `1022 / 979 / 977 / 1022` B，**全部 ≤ 1024**，且全部以省略号收尾（证明裁切真的发生）；② **紧致性**：`tests/acceptance.test.mjs:496-500` 用 ASCII 合成信封断言 `bytes === 1024` **恰好等于预算**（我复核了该断言，并确认它断言的是相等而非 ≤）；③ **不空转**：V14 另断言"未超预算的 render 不得带省略号"；④ **不丢数据**：结构化 `value.nextActions` 仍保留调用方全文（实测逐条 `includes` 成立）；⑤ **真实宿主**：门禁实测 `scout_start content=166B < 1024` |
| **判定** | **O10 关闭。** 上界由"约 1018 B / 余量 5 B"变为"**精确 ≤ 1024 B**"，且余量与省略号字节数绑定，后续改常量不会再越界。 |

### 5.4 G1（推迟项，独立复核描述准确，不计缺陷）

见 §4.2。要点：**描述准确**（7 个 `decide` 调用点与文档清单完全一致，行为实测逐字吻合）；**严重度低**（`decision` 稳定）；**0.9.2 不修**（正确修法会动 0.9.0/0.9.1 冻结的文案基线，且写红断言违反本项目硬规矩）；**不阻塞 GO**。

---

## 6. 已知边界（不是缺陷，但限定对外表述）

1. **SKIP 开关可以让门禁变绿而覆盖降级**（§3.4）。默认全跑；一旦 CI 长期带 `DSH_SCOUT_SMOKE_SKIP_*` 运行，U11 的四条路径就**又回到无门禁状态**。对外表述必须写"默认全跑 + 跳过会播报降级"，不能写"门禁永远覆盖四条路径"。
2. **门禁只走绝对路径**（`agent` 未设置 ⇒ 插件 `cwd` 为 `undefined`）。"相对 `targetDir` + 真实 agent cwd"这条路径**按设计不在门禁内**（§3.2 的注入实验正是为了证明这一点被显式处理，而不是被忽略）。README:280 已如实列出。
3. **`autoPersist` 在真实宿主上仍为默认 `false`**，因此"每次变更自动落盘"未被真实宿主门禁覆盖（脚本 `not covered` 行已写明）。
4. **撕裂导出靠改写标记复现**，不是真实进程中断（`kill -9` / ENOSPC 未测）。
5. **12 个工具里只有 6 个被真实执行**（`scout_start` / `scout_add_source` / `scout_add_claim` / `scout_export` / `scout_report` / `scout_import`）；其余 6 个只断言注册。这是 Lead 已批准的取舍（"REQUIRED_TOOLS 12 项"用于注册表断言）。
6. **门禁用 ASCII fixture 是有意为之**（Lead 已批准）：用户自撰文案永不翻译，所以只有全 ASCII 的用户文案才能让"CJK = 0"成为一个可判定的断言；非空洞性由 zh 侧 CJK > 0 的正向对照保证。
7. **`case.json.language` 是渲染语言，不是内容语言**；手工改写的外来文件不做自洽性校正（README:239 已写明，§4.4 O-4 已实测复核）。
8. **`alignCaseDefaults` 只在 `decide` 路径生效**；直接读磁盘 `case.json` 的第三方工具看不到对齐（README:259 / 契约:12 已写明）。
9. **G1**：冷启动回填会把初始决策理由措辞换成规范理由（`decision` 不变），0.9.2 有意不修（§4.2 / §5.4）。

---

## 7. 未能验证的项

沿用 [verification-0.9.1.md §7](verification-0.9.1.md) 的 U 台账，标注本轮状态：

| # | 项 | 本轮状态 |
|---|---|---|
| **U11** | 导出 / 导入 / 回填 / 跨语言四条路径在真实宿主上的端到端行为 | **✅ 已关闭**：`test:profile` 六步真实宿主门禁 + 两个完成标记负向对照 + output-schema 对照；四个 DSH 版本 4/4 通过；门禁本身经 5 组独立故障注入确认非假绿（§3.5） |
| U1 | 真实 LLM / agent loop：模型侧参数生成、agent 级工具可见性、approval / tool-policy、流式 | **仍未验证**（无 API key；门禁 `agent` 未设置） |
| U2 | `/scout` 在真实宿主上的 `command/run` + `command/done` 落盘 | **仍未验证**（门禁不跑 commands 服务） |
| U3 | 真实 fs provider 下 `targetDir` 的绝对路径化 | **部分关闭**：绝对路径 + 真实 fs 已在真实宿主上验证（含解析后路径断言）；**"相对 `targetDir` + 真实 agent cwd"仍未验证**，且按设计不在门禁内 |
| U4 | 真实磁盘故障（ENOSPC / EACCES / kill -9 / 跨设备 rename） | **仍未验证**（注入式 double + 改写标记） |
| U5 | DSH 源码里 `engines.dsh` 是否真无读者、`evaluatePluginCompatibility()` 判定 | **仍未验证**（未逐行审计 DSH 源码） |
| U6 | GitHub Actions 实际运行结果 | **仍未验证**：0.9.2 尚未 push / tag（T6/T7 在验证之后）。本地等价物 `check:release` 已复现 4/4 |
| U7 | `docs/upstream/**` 与方向报告的内容正确性 | **仍未验证**（非交付物，按纪律未触碰） |
| U8 | `scout_search` 对接真实 web provider | **仍未验证**（只有 stub） |
| U9 | npm 发布链路 | **仍未验证**：验证时 `package.json` 已 bump 到 0.9.2，但未 publish / tag；README 与 CHANGELOG **未**声称已发布（与状态自洽） |
| U10 | URL 规范化的全部边界 | **仅抽样**（实现者测试已覆盖，本轮未逐例重跑） |
| U12 | 多语言在真实模型会话中的可读性（模型是否按部署语言回答、宿主是否消费 `case.json.language`） | **仍未验证**（无 agent 会话） |
| **U13**（新） | `autoPersist=true` 在真实宿主上的自动落盘 | **未验证**：门禁有意保持默认 `false` |
| **U14**（新） | 真实进程中断下的撕裂导出（kill -9 / 磁盘满） | **未验证**：仅"改写标记"复现 |
| **U15**（新） | 其余 6 个工具在真实宿主上的执行行为 | **未验证**：仅断言注册 |
| **U16**（新） | 门禁在 CI（非 macOS、冷 pnpm store）上的耗时与稳定性 | **未验证**：本机 warm cache 实测 16 s；冷 store / 慢 CI 未测 |

---

## 8. 最终交付判断：**GO**

### 8.1 结论

**GO。** 0.9.2 的核心 KPI（把 U11 从"未验证"变成"有门禁"）**达成且可复核**：四条路径在真实 DSH 宿主上有可执行的六步门禁与三个负向对照，并且这道门禁经我 5 组独立故障注入确认**不是假绿**。四道门禁全绿；F1 的逐条对齐规则在 10 个对抗角度下均成立（含 5 个下标的穷举）；F4 / F5 有实测证据；文档与实现逐条吻合；**本轮 0 条新缺陷**。

### 8.2 理由

1. **四道门禁独立复现通过**：`npm test` **118/118**（含本轮 15 项；冻结基线 103/103）；`test:profile` **PASS**（dsh 0.2.0-rc.2，六步 + 三个负向对照，约 16 s）；`pnpm pack --dry-run` exit=0、24 个文件、6 个 exports 目标齐全；`check:release` **4 个精确 DSH 版本 4/4 PASS**、exit=0（且确认 `DSH_BIN` 未设置，四个 binary 真的从 npm 取）。
2. **U11 关闭有独立证据**：真实宿主的导出 / 跨语言导入 / 惰性回填 / 卸载四条路径各有可执行断言；`case_rehydrated` 事件指认回填路径；pid 变化证明冷重启；12 工具注册表 + lifecycle 断言堵住"插件没加载"的假绿；CJK=0 有 zh 侧 382 汉字正向对照。
3. **门禁非假绿经对抗验证**：INJ-1 相对路径 + 异地 cwd → 红；INJ-2 不删标记 → 红；INJ-3b 删数据文件 → 守卫自己报错；INJ-4 错语言 → 红；SKIP 开关 → 绿但三处播报降级。**5/5 与预期一致。**
4. **F1 逐条对齐在最锋利的两个角度上成立**：错排（V1）与重复值（V2）都证明实现走的是**下标比较**，与 README:239 的措辞"判定依据是是否等于该下标的出厂默认，不是编辑历史"逐字吻合；V3 的计数断言给出 D10 的量化关闭证据。
5. **零回归 / 零新缺陷**：`zh-CN` 同语言路径在**有证据的 case** 上是 `case.json` **逐键零移动**（V10）——比 0.9.1 声称的"三个字段不变"更强的 no-op；出厂常量、`decision` 稳定性、render 上界、导出文件集与 0.9.1 结论全部保持。
6. **验收套件纪律达标**：「断言缺陷存在」的用例数 **0**；本轮 15 项全部是正向契约；G1 按 Lead 决定记录而非钉红。
7. **文档与实现一致**：F1 措辞（中英 `:239`）、F5 口径（中英 `:128` / 契约:23 / CHANGELOG:22）、F4（`~3.18.4` → 3.18.4）、当前版本段（契约:19）、路线图（中英 `:294`）、`test:profile` 描述（中英 `:280`）、G1 Known boundary（CHANGELOG + 订正后的 findings）逐条对照实测，**无不符**；4 条观察项（§4.4）均非缺陷。

### 8.3 交付前建议（不阻塞 GO）

| 优先级 | 项 | 改动 |
|---|---|---|
| P3 | §4.4 O-2：`CHANGELOG.md:22` 的历史上界"约 1019 B"可改为"约 1018 B"（括号里的实测值已经是对的） | 文档 1 处，历史描述 |
| P3 | §4.4 O-3：门禁 stdout 的 `scenario chain: N gate lines` 措辞可改为 `step summaries` | 门禁输出 1 词 |
| P4 | §4.4 O-1：若将来在意"孤立代理项"，可在裁切后回退到完整码点边界（**本轮不建议在 0.9.2 动**：会改动已冻结的裁切行为与 `acceptance.test.mjs` 的"恰好 1024 B"断言） | 留给后续版本 |

### 8.4 把 GO 变成 NO-GO 的条件

1. **冻结树变化而未重跑门禁**：`src/**`、`scripts/profile-smoke.mjs`、`package.json`、`pnpm-lock.yaml` 任一偏离 §0 指纹（实现集聚合 `40ff54ae340535d0`）后，必须重跑四道门禁；未重跑即发布 ⇒ NO-GO。
2. **`npm test` 出现任何 fail**（尤其：套件里重新出现"断言缺陷存在"的用例，或把 G1 写成红断言 ⇒ 直接违反项目硬规矩）⇒ NO-GO。
3. **`test:profile` 六步任一不再出 PASS 行**；或两个完成标记负向对照不再拒绝回填；或**默认行为**被改成带 `DSH_SCOUT_SMOKE_SKIP_*` 运行 ⇒ NO-GO（跳过即 U11 回到无门禁）。
4. **`check:release` 不再 4/4**：任一"声明范围内但失败（回归）"⇒ NO-GO；`DSH_ALLOW_OUT_OF_RANGE=1` 或 `DSH_BIN` 被导出导致四版本退化为同一 binary ⇒ 该结论无效，等同 NO-GO。
5. **打包内容变化**：`pnpm pack --dry-run` 不再是这 24 个文件、或 `exports` 六个目标缺失、或 `tests/verification-0.9.2.test.mjs` / `scripts/repro-*.mjs` / `docs/verification-*.md` 进入发布包 ⇒ NO-GO。
6. **对外表述回退或超范围承诺**：① 若 README/CHANGELOG 回退到"整组未被编辑才对齐"⇒ 与 F1 实现不符，NO-GO；② 若承诺"任何跨语言导入后工件**严格单语言**"⇒ 与"用户自撰文案永不翻译"冲突（用户写中文就必然有中文），NO-GO；③ 若承诺 `case.json.language` 描述文件内容语言、或承诺插件会校正标签与内容不符的手改文件 ⇒ 与 §6.7 信任假设冲突，NO-GO。
7. **发布声明与事实不符**：包内 README / CHANGELOG 若出现"已发布 npm"或 tag 声明而实际未发布（或反之，发布了却未同步）⇒ 文档假陈述，NO-GO。
8. **在 0.9.2 内修 G1**：正确修法会改动 zh-CN/en 全新案例的首屏理由文案基线；未同时重跑 `tests/acceptance.test.mjs` 的 0.9.0 字节兼容基线差分与四道门禁 ⇒ NO-GO。
9. **本文档或独立套件被修改后未重跑**：`docs/verification-0.9.2.md`（本轮为待产出文件）或 `tests/verification-0.9.2.test.mjs`（`0a9ce644ede6cb82`）一旦变更，本报告的 GO 即失效，需重跑 §1 与 §2 后再签发。

---

## 附录 A：复现本报告的完整命令清单

```sh
cd "<repo>"

# 四道门禁
npm test                                                    # 118/118（含本轮 15 项；冻结基线 103/103）
DSH_BIN=$(which dsh) npm run test:profile                   # PASS (dsh 0.2.0-rc.2)，约 16 s
pnpm pack --dry-run                                         # 24 个文件，exit=0
env -u DSH_BIN npm run check:release                        # 必须不带 DSH_BIN；4/4 PASS，约 93 s

# 独立验收套件（也可单独运行，无需 dsh binary）
node --test tests/verification-0.9.2.test.mjs               # 15/15

# 冻结树指纹（实现集聚合；刻意排除验证者自己新增的套件）
find . -type f \( -path ./node_modules -o -path ./.git -o -path ./.pnpm-store -o -path ./dist \) -prune -o -type f -print \
  | grep -vE '^\./(node_modules|\.git|\.pnpm-store|dist)/' | grep -v '\.DS_Store' | LC_ALL=C sort \
  | while IFS= read -r f; do printf '%s  %s\n' "$(shasum -a 256 "$f" | cut -c1-16)" "$f"; done \
  | grep -E '  \./(src/|scripts/|tests/|package\.json|pnpm-lock\.yaml|locale/|cordis\.patch\.yml|tsconfig\.json)' \
  | grep -v 'verification-0.9.2.test.mjs' | LC_ALL=C sort | shasum -a 256 | cut -c1-16
# → 40ff54ae340535d0（18 个文件）
# 去掉上面那行 grep -v（即把验证者套件计入）→ 770be14fd53c6d63（19 个文件）

# F4 解析版本
node -p "require('@deepseek-ai/schemastery/package.json').version"   # → 3.18.4

# 故障注入（在 /tmp 副本上，绝不改仓库）
rsync -a --exclude node_modules --exclude .git --exclude dist "<repo>/" /tmp/copy/ && \
  ln -s "<repo>/node_modules" /tmp/copy/node_modules
# 逐组按 §3.5 的锚点改写 /tmp/copy/scripts/profile-smoke.mjs，然后：
(cd /tmp/copy && DSH_BIN=$(which dsh) node scripts/profile-smoke.mjs); echo "exit=$?"   # 注入组必须 exit≠0
```

## 附录 B：本次验证的边界声明

- 本报告只对 §0 指纹所列的**这一个**工作树状态负责；`tests/verification-0.9.2.test.mjs` 的加入不改变 `files` 白名单与打包内容（已复跑确认）。
- 全部故障注入在 `/tmp/t5-inject/**` 副本上完成；仓库内 `scripts/profile-smoke.mjs` 的本轮指纹 (`70ade56bff662abd`) 与验证开始时一致。
- 本轮未执行 `git commit` / `git push` / `git tag` / `npm publish`，未触碰 `docs/upstream/**`、`scripts/archive-official-docs.mjs`、`scripts/enrich-official-docs-index.mjs`。
- 报告中的"实测输出"为终端原文摘录（省略号 `…` 表示省略的无关行），未改写数字或诊断文本。
