# dsh-scout 0.9.1 独立验证报告（第三轮 · 最终）

- **验证对象**：`dsh-scout@0.9.1`，**HEAD = `7075668`**（D8 修复已提交）+ docs 侧未提交的 D9 修订
- **验证者**：`verifier`（独立于全部实现者：`lead` / `model-i18n` / `packaging` / `verify-harness` / `docs`）
- **本轮范围**：验证 D8（跨语言导入的存储型文案）修复、复核 D9（回填措辞）修订、重跑四道门禁、给出最终 GO/NO-GO
- **环境**：macOS；Node `v26.8.1`；npm `12.0.2`；pnpm `11.25.0`；本机 `dsh 0.2.0-rc.2`（`/opt/homebrew/bin/dsh`）
- **验证者写入范围**：仅 `tests/acceptance.test.mjs`（**22 项**）与 `docs/verification-0.9.1.md`。未修改任何实现文件，未执行 `git commit` / `git push` / `npm publish`，未触碰 `docs/upstream/**`
- **三轮轨迹**：第一轮发现 6 条缺陷 → 第二轮 5 条关闭 + D1 部分关闭（残留 D8）→ **第三轮 D8 关闭、D9 关闭**。每轮都给出「**观察 → 修复内容 → 本轮实测**」。

### 冻结树指纹（第三轮，sha256[0:16]）

| 文件 | 第三轮 | 第二轮 | 文件 | 第三轮 | 第二轮 |
|---|---|---|---|---|---|
| `src/index.ts` | `fbcbb5b3b20c1e49` | `5197983d…` | `tests/tools.test.mjs` | `513b672550b04877` | `d9f41196…` |
| `src/model.ts` | `36ec4764db9b1240` | 同 | `tests/package.test.mjs` | `b93e8900b5e888e3` | 同 |
| `src/i18n.ts` | `9627087ba04a220c` | 同 | `README.md` | `792f8c17404b46af` | `3154c7de…` |
| `package.json` | `65112476a9b1f931` | 同 | `README.en.md` | `fb5bdc7cdc59f5fa` | `8e6f97b7…` |
| `locale/en.json` | `0510da397c3c3c8c` | 同 | `docs/dsh-scout-product-contract.md` | `834941e86fef9245` | `0f276d99…` |
| `locale/zh.json` | `b07cee57af7913cd` | 同 | `CHANGELOG.md` | `1bac3590ac50260a` | `2f9b5dc2…` |
| `assets/icon.svg` | `dffaac14e7d43fd8` | 同 | `scripts/profile-smoke.mjs` | `74159ed7d17a27f4` | 同 |
| `scripts/check-release.mjs` | `ddcb645259540c3e` | 同 | | | |

> docs 四个文件在我验证期间被 `docs` 队友按 D9 修订（工作树未提交）；上表是**我复核并确认措辞与实现一致**的那一版。`src/` 三个文件与 `package.json` 在第三轮期间未再变动。

---

## 0. 方法与证据等级

1. **门禁复现**：`npm test`、`DSH_BIN=$(which dsh) npm run test:profile`、`pnpm pack --dry-run`、`npm run check:release` 全部重跑。
2. **独立验收套件**：`tests/acceptance.test.mjs` 从 20 项扩展到 **22 项**。`D8 (still open)` 特征化测试**改写为正向断言**；新增一条「用户编辑值必须原样保留、未编辑字段仍独立对齐」的对抗用例（角度由我自定，不是照抄实现者测试）；`D10` 按 Lead 结论保留为**已知边界**（不是缺陷）。
3. **差分探测**：与真实 0.9.0 构建产物（commit `3406a4ee` 编译）逐字节对比 `zh-CN` 报告，并额外对比**同语言下 `case.json` 的三个存储型字段**，证明 `alignCaseDefaults` 对 zh-CN 原生 case 是 no-op。
4. **对抗性场景**：8 组跨语言/编辑场景（含反向、逐字段独立、部分编辑、往返、回填路径）。

证据等级：所有"实测输出"均为本机真实命令 / 真实构建产物输出；凡推断或无法复现的，明确标注为**无法验证**。

---

## 1. 门禁复现（第三轮原始输出摘要）

### 1.1 `npm test`

```console
$ npm test
ℹ tests 95
ℹ suites 0
ℹ pass 95
ℹ fail 0
ℹ duration_ms 172.63
```

对比：本轮开始时为 `95 项 / 94 pass / 1 fail`（那条失败是我的用例笔误，见 §6 O11）；修正后 **95/95**，其中 `tests/acceptance.test.mjs` **22/22**。

**结论：通过。**

### 1.2 `DSH_BIN=$(which dsh) npm run test:profile`

```console
$ DSH_BIN=$(which dsh) npm run test:profile
dsh-scout profile smoke: PASS (dsh 0.2.0-rc.2)
  verified: dump-config layer | 6 tools mounted | scout_start(isError=false, value=object with caseId echo, content=166B < 1024) | scout_report(isError=false, rendered=1250 chars, subject present) | appExit | DSH_SCOUT_UNLOAD | output-schema negative control (ToolOutputError observed)
  observed value keys: scout_start=["ok","caseId","decision","identity","counts","changed","nextActions"] scout_report=["caseId","decision","report","coverage"]
  not covered: no agent/LLM/approval path (agent unset), only scout_start+scout_report executed, report asserted structurally, token budget covers rendered content only
```

**结论：通过。**

### 1.3 `pnpm pack --dry-run`

```console
$ pnpm pack --dry-run
Tarball Contents
assets/icon.svg            docs/fixtures/dsh-scout/snapmaker-hr-head.json   scripts/check-release.mjs
CHANGELOG.md               LICENSE                                        scripts/profile-smoke.mjs
cordis.patch.yml           locale/en.json                                 tests/acceptance.test.mjs
dist/i18n.d.ts             locale/zh.json                                 tests/model.test.mjs
dist/i18n.js               package.json                                   tests/package.test.mjs
dist/index.d.ts            README.en.md                                   tests/tools.test.mjs
dist/index.js              README.md
dist/model.d.ts            docs/dsh-scout-product-contract.md
dist/model.js
Tarball Details
dsh-scout-0.9.1.tgz
```

`exports` 的 6 个目标（`dist/index.js` / `dist/index.d.ts` / `cordis.patch.yml` / `locale/{en,zh}.json` / `package.json`）逐个 `existsSync` 全部存在。

**结论：通过。**

### 1.4 `npm run check:release`（4 个精确 DSH 版本）

```console
$ npm run check:release
[ok] dsh 0.1.0-rc.6     — profile smoke passed (satisfies engines.dsh ">=0.1.0-rc.6 <0.3.0-0")
[ok] dsh 0.1.2-rc.1     — profile smoke passed (satisfies engines.dsh ">=0.1.0-rc.6 <0.3.0-0")
[ok] dsh 0.2.0-rc.2     — profile smoke passed (satisfies engines.dsh ">=0.1.0-rc.6 <0.3.0-0")
[ok] dsh 0.2.1-alpha.2  — profile smoke passed (satisfies engines.dsh ">=0.1.0-rc.6 <0.3.0-0")
dsh-scout release gate: PASS (4 DSH versions, >=0.1.0-rc.6 <0.3.0-0)
exit=0
```

**结论：通过。**

---

## 2. D8 关闭验证：跨语言导入的存储型文案

**第一轮观察（D1）**：配置 `en` 导入 zh-CN case 后，`scout_report` 英文而落盘 `report.md` 中文；`case.json` 写 `language:"zh-CN"` + 英文 `decisionReason`。
**第二轮观察（D8，D1 修复后的残留）**：渲染语言与 `case.json.language` 已统一，但 `createCase` 一次性本地化的 `decisionObjective` / `interviewQuestions` / `role.fitQuestion` 仍保持创建语言 → 英文报告含 `- Objective: 判断是否值得进入下一轮，并准备面试反问` 与 5 条中文精选问题；问题清单中英混排（实测 7 英 + 5 中）；`case.json` 声明 `language:"en"` 却携带中文 prose。

**修复内容**（`src/index.ts`，`decide` 包装器内新增 `alignCaseDefaults`）：

```ts
const declared = isScoutLanguage(scoutCase.language) ? scoutCase.language : undefined
const source = scoutStrings(declared)
if (source.language === strings.language) return scoutCase      // 同语言 → no-op
// decisionObjective / role.fitQuestion：逐字段比较，等于出厂默认才替换
// interviewQuestions：长度相同且逐项相等（整组未编辑）才整体替换
```

**本轮实测**（独立探测，8 组场景）：

| 场景 | 实测 |
|---|---|
| zh case → `en` 部署（`scout_import`） | 报告 CJK **0**、问题清单 CJK **0**；`case.json`：`language:"en"`、`decisionObjective` CJK 0、`role.fitQuestion` CJK 0、`interviewQuestions[0]` CJK 0；精选尾巴 == `scoutStrings('en').defaults.interviewQuestions` |
| en case → `zh-CN` 部署（反向） | 报告中 **0 条**英文出厂句子（对 objective / fitQuestion / 5 条问题逐个做 sentinel 断言）；`case.json`：`language:"zh-CN"`、三个字段全部为 zh 出厂值 |
| **惰性回填路径**（非 `scout_import`） | 同样对齐：rehydrate 后的英文报告 CJK 0 |
| **往返 `zh → en → zh`** | 三个字段**逐项还原**为 zh 出厂值（`language:"zh-CN"`） |
| zh 原生单语言 | **no-op**：`case.json` 三个字段与 0.9.0 构建产物**逐字段相同**（见 §4 A1） |
| 只编辑 `decisionObjective` → `en` | 编辑值**原样保留**（`用户自定义目标（勿改）`）；`interviewQuestions` / `fitQuestion` **仍然对齐**（逐字段独立） |
| 只编辑 `role.fitQuestion` → `en` | 编辑值原样保留；`decisionObjective` / `interviewQuestions` 仍然对齐 |
| 整组替换 `interviewQuestions` | 用户 5 条原样保留、报告渲染用户文本、旧出厂句子不出现 |

**结论：通过（D8 关闭）。** 报告、问题清单与 `case.json` 在跨语言导入后**单语言且自洽**；用户编辑的内容不会被覆盖。

**边界（Lead 已确认接受，记入 §3「已知边界」，不记为缺陷）**：`interviewQuestions` 采用**整组 all-or-nothing** 判定——只要用户改过其中任一条，整组原样保留，因此其余未编辑的出厂条目仍停留在创建语言。实测：只改 1 条后，`en` 部署的报告仍含 **79 个 CJK 字符**（4 条 zh 出厂问题），而 `decisionObjective` / `fitQuestion` 因为逐字段判定**已对齐**。`D10 (documented boundary)` 用例钉住这一行为。

---

## 3. 最终缺陷台账（三轮汇总）

| ID | 第一轮/第二轮发现 | 第三轮状态 | 守护测试（`tests/acceptance.test.mjs`） |
|---|---|---|---|
| **G1** | 惰性回填不校验完成标记 | **已关闭**（第二轮） | `rehydration requires a completion marker asserting complete:true …` |
| **G2** | 1 KB render 预算不强制 | **已关闭**（第二轮） | `the 1 KB render budget holds even against adversarial caller-supplied text` |
| **G3** | 覆盖写失败留下陈旧 `complete:true` | **已关闭**（第二轮） | `an interrupted overwrite downgrades the completion marker …` |
| **D1** | 落盘 `report.md` 与 `scout_report` 语言不一致 | **已关闭**（第二轮） | `a case crossing a language boundary renders every surface …` |
| **D7** | `scout_ingest` 草稿硬编码中文 | **已关闭**（第二轮） | `scout_ingest drafts its claim notes in the deployment language` |
| **D8** | 跨语言导入的存储型文案不重定位 | **已关闭（第三轮）** | `a case crossing a language boundary is single-language in both directions, on the import and rehydrate paths` |
| **D2–D6** | 5 条文档不符 | **已关闭**（task-9） | §5 复核 |
| **D9** | 回填措辞在 G1 修复后变陈旧 | **已关闭（第三轮）** | §5 复核 |
| **D10** | 部分编辑的问题数组不被对齐 | **已知边界**（刻意设计，非缺陷） | `D10 (documented boundary): …` |

**当前 `tests/acceptance.test.mjs` 里没有任何一条「断言缺陷存在」的用例**：6 条缺陷锚定全部改写为正向断言；`D10` 是唯一保留的边界用例，命名与注释都标明它是**有意的取舍**而非待修问题。

### 已知边界（不是缺陷，但会限定对外表述）

1. **`interviewQuestions` 的对齐是整组 all-or-nothing**（D10）。部分编辑时其余出厂条目不会被对齐。理由：实现无法判断用户改了哪一条，保守不猜更安全。**建议文档补一句**：「精选面试问题**整组**仍是出厂默认时才会对齐；只要用户改过其中任一条，整组原样保留」（目前 `README.md:239` / `CHANGELOG.md:15` 写的是「仍是出厂默认的文案」，逐条读会以为可以逐条对齐）。
2. **`case.json` 的 `language` 字段是「本部署渲染语言」，不是「文件内容的语言」**。若有人手工把 `language` 改成与内容不符的值再导入，`alignCaseDefaults` 会因「语言相同」提前返回、不做任何校正，报告就会混排。这是**外来文件的信任假设**：工具不会去猜用户手写文件的自洽性。（0.9.0 → 0.9.1 的正常升级路径不受影响：旧导出的 `language` 恒为 `zh-CN`，与其内容一致。）
3. **`alignCaseDefaults` 只在 `decide` 路径生效**（`scout_start` 之后的每一次决策重算、`scout_import`、`rehydrate`、以及每次变更工具调用）。因此对齐结果会随第一次 `decide` 落到内存 case 与后续导出；直接读磁盘 `case.json` 而从不经过插件的第三方工具看不到对齐。

### 观察项（非缺陷）

- **O7**：torn 窗口内标记的 `eventCount` 描述**失败的那次尝试**，与磁盘 `events.jsonl` 行数不同（实测 4 vs 2）。语义正确（`complete:false` 是契约），但建议文档补一句。
- **O8**：`scout_export.files` 返回 **6** 个名字，标记内部的 `files` 只列 **5** 个数据文件——语义不同但都合理，建议文档点明。
- **O9**：`zh-CN` 报告的 8 个 `## …` 章节标题仍是英文常量。这是 0.9.0 起的既有形状（§4 A1 差分证明），不是回归；但它意味着「`en` 报告无 CJK」只能靠 CJK 计数证明。
- **O10**：整串 render 上限是「裁到 ≤1015 B 再追加 3 B 省略号」，实际上界 **1019 B**（实测最坏 1018 B），文档写 `< 1024` 结论一致；若将来把 `MAX_RENDER_BYTES - 8` 的余量改到 3 以内就会越界。
- **O11**：本轮开始时 `user-edited case prose …` 用例失败，原因是我把 `editAndMove` 的返回字段 `report`（已是字符串）又当对象取了一次 `.report`。**这是我测试里的笔误，不是实现缺陷**；已改为返回 `reportText` 并修正三处引用。

---

## 4. 跨轮回归与差分（第三轮重跑）

### A1 — `zh-CN` 兼容性差分（0.9.0 真实构建产物）

```console
$ git archive 3406a4ee | tar -x -C /tmp/scout-baseline-r3   # package.json version = 0.9.0
$ (cd /tmp/scout-baseline-r3 && npx tsc -p tsconfig.json)   # BASELINE 0.9.0 BUILD OK
$ node baseline-diff.mjs
coverage block lines: 16
zh-CN report byte-identical to 0.9.0 after removing the Coverage block? true
questions quota 0.9.0: {"total":12,"kept":0,"of":5} | 0.9.1: {"total":12,"kept":5,"of":5}
zh-native case.json decisionObjective unchanged: true
zh-native case.json interviewQuestions unchanged: true
zh-native case.json fitQuestion unchanged: true
```

**结论：通过。** 这同时独立验证了 `alignCaseDefaults` 的 **no-op 承诺**：不只是报告，**同语言下 `case.json` 的三个存储型字段也与 0.9.0 逐字段相同**（第二轮我用的是报告级差分，本轮加到了文件级）。

> 方法学提醒：基线必须显式取 `3406a4ee`；`git archive HEAD` 在第二轮之后会取到 0.9.1 自身。

### 其余第一/二轮差分结论（第三轮复核仍成立）

- 12 个工具的 render 字节：8 个 mutation envelope 120–238 B、`scout_export` 40 B、`scout_questions` 804 B；`scout_report` 10464 B / `scout_compare` 2155 B（文档已排除的全量产物）；对抗性输入 261 / 684 / 1018 B。
- 12 个工具逐个过 `validateJsonSchemaValue(tool.output.schema, value)` = 0 违规，另有 24 个篡改负向对照。
- `scout_import` 完整性矩阵 6 行、连续三次导出、写入顺序（标记先降级后闭合）等第二轮结论全部仍然成立（对应测试本轮全绿）。

---

## 5. 文档复核

### 5.1 task-9 修订的 D2–D6（第二轮已确认，第三轮无回退）

| # | 结论 | 复核方式 |
|---|---|---|
| D2 | **一致** | `README.md:125` / `README.en.md:125` 写「… / `scout_import`，共 8 个」，并补 `sourceDir` / `complete`；与实测 8 个 envelope 工具吻合 |
| D3 | **一致** | `README.md:129` 改为「只出现在变更类工具的 `autoPersist` 路径」，并说明 `scout_export` 用顶层 `persisted`/`complete`/`error`；与 `output.schema` 一致 |
| D4 | **一致** | 契约与 README 的「五文件齐备才可导入，缺一个即硬失败」与 §N2 矩阵逐行吻合 |
| D5 | **一致** | 标记两阶段写入（先 `complete:false`，后 `complete:true`）与 `persistFiles` 实现一致 |
| D6 | **一致** | 契约:68「上限 12 条；精选问题永远保留名额」与 `headBudget = 12 - curated.length` 一致 |

### 5.2 D9（第三轮关闭）

第二轮我报告：G1 修复后，四处文档仍写「存在导出即回填」。本轮复核 —— **已全部修订，且措辞与实现逐字吻合**：

| 位置 | 现文（要点） |
|---|---|
| `README.md:259` | 「**只有完整导出**（完成标记 `complete: true`）才会被惰性回填…**0.9.0 的旧导出没有完成标记，不会被自动回填**，需要用 `scout_import` 显式恢复」 |
| `README.en.md:259` | "**only a complete export** (completion marker `complete: true`) is lazily rehydrated… **a 0.9.0 export has no completion marker and is never auto-rehydrated**" |
| `CHANGELOG.md:18` | 「**惰性回填仅限完整导出**：只有当…完成标记为 `complete: true` 时才读回案例…0.9.0 的旧导出…需用 `scout_import` 显式恢复」 |
| `docs/dsh-scout-product-contract.md:12` | 「缓存未命中时，**只有完整导出**（完成标记 `complete: true`）才从 `<scoutDir>/<caseId>/` 惰性回填…（0.9.0 旧导出无完成标记，需显式 `scout_import`）」 |

**结论：一致（D9 关闭）。** 四处措辞与我第二轮实测的 6 行完整性矩阵完全对应。

### 5.3 语言行为文档（D8 修复后）

`README.md:239` 与 `CHANGELOG.md:15` 已写明：`language` 影响报告 / 面试问题 / 对比报告 / 采集草稿文案，并**覆盖案例自带、仍是出厂默认的文案（调查目标 / 岗位授权问题 / 精选面试问题）**，**用户编辑过的保持原样**，同语言时 no-op。

**唯一需要收窄的措辞**：最后一项「精选面试问题」在**部分编辑**时不会被对齐（§3 已知边界 1）。建议改成：「精选面试问题**整组**仍是出厂默认时才会对齐；只要用户改过其中任一条，整组原样保留」。这是文档精度问题，不影响交付判断。

---

## 6. 结论句复核（Lead 指定）

> 「0.9.1 的多语言覆盖报告框架、决策理由、采集草稿与案例自带文案（未编辑的出厂默认会自动对齐部署语言；用户编辑过的保持原样）」

**判定：成立，但需要一处限定。**

| 分句 | 实测结论 |
|---|---|
| 报告框架 | **成立**：标题、空态、标签、Coverage 全走 i18n；`en` 报告 CJK 0 |
| 决策理由 | **成立**：`decideCase(case, { language })`；跨语言导入后 `case.json.decisionReason` 为部署语言（实测英文） |
| 采集草稿 | **成立**：D7 关闭；`en` 下 `confidenceNote` / `nextAction` 为英文，CJK 0 |
| 案例自带文案：未编辑的出厂默认自动对齐 | **对 `decisionObjective` / `role.fitQuestion` 成立（逐字段）**；对 `interviewQuestions` **仅当整组未被编辑时成立** |
| 案例自带文案：用户编辑过的保持原样 | **成立**：编辑值逐字节保留（已用自定义中文目标、自定义 fit question、整组自定义问题三组场景验证） |
| （隐含）同语言 no-op | **成立**：报告与 `case.json` 三个字段都与 0.9.0 逐字段相同 |

**建议改法**（二选一）：
- **A（推荐，零代码改动）**：把「案例自带文案」那半句改成「**未编辑的出厂默认**会自动对齐部署语言（精选面试问题需**整组**未被编辑）；用户编辑过的保持原样」。
- **B（可选增强，约 3 行）**：把 `interviewQuestions` 的对齐从「整组比较」改成「长度与出厂数组相同时**按下标**比较、逐条替换」，这样部分编辑也能对齐其余条目（用户改过的那条仍保留）。代价是失去「宁可保守」的语义，需要你确认。

---

## 7. 未能验证的项

| # | 未能验证的项 | 原因 |
|---|---|---|
| U1 | 真实 LLM / agent loop：模型侧参数生成、agent 级工具可见性、approval / tool-policy、流式 | 无 API key、无 agent 会话；`test:profile` 亦在 `agent` 未设下执行。**这一层仍无任何自动化门禁** |
| U2 | `/scout` 在真实宿主上的 `command/run` + `command/done` 落盘 | 需要真实 DSH 会话与真实 `commands` 服务；三轮均用假 double |
| U3 | 真实 fs provider 下 `targetDir` 的绝对路径化 | fs double 原样返回 `displayPath` |
| U4 | 真实磁盘故障（ENOSPC / EACCES / kill -9 / 跨设备 rename） | 注入式 `writeText` 抛错；「标记先降级」在真实 kill 下**理应**同样成立（写序在前），但未实测 |
| U5 | DSH 源码里 `engines.dsh` 是否真无人读取、`evaluatePluginCompatibility()` 判定 | 未逐行审计 DSH 源码 |
| U6 | GitHub Actions 实际运行结果 | 未触发远端工作流；本地等价物 `check:release` 已复现 |
| U7 | `docs/upstream/**` 与 `docs/dsh-scout-0.9.1-direction.md` 的内容正确性 | 非交付物且按纪律禁止触碰 |
| U8 | `scout_search` 对接真实 web provider | 只有 stub |
| U9 | npm 发布链路 | 0.9.1 明确不发 npm |
| U10 | URL 规范化的全部边界 | 已有实现者测试；我只做抽样 |
| **U11** | **本轮修复在真实 DSH 宿主上的端到端行为（导出 / 导入 / 回填 / 语言对齐路径）** | `test:profile` 只真实调用 `scout_start` + `scout_report`，**不经过标记、导出、回填与跨语言导入代码路径**；这些修复的证据全部来自假 ctx 下的独立探测 + 真实构建产物差分。**这是本次交付最大的验证盲区** |
| **U12** | 多语言在**真实模型会话**中的可读性（模型是否真的按部署语言回答、`case.json` 语言标签是否被宿主消费） | 无 agent 会话；宿主是否读取 `case.json.language` 未验证 |

---

## 8. 最终交付判断：**GO**

### 8.1 结论

**GO。** 三轮发现的问题**全部关闭**（6 条实现缺陷 + 6 条文档不符），两条刻意保留的**已知边界**已文档化并限定了对外表述；四道门禁全绿；`zh-CN` 兼容性在报告与 `case.json` 两个层面都与真实 0.9.0 构建产物一致。

### 8.2 理由

1. **四道门禁独立复现通过**：`npm test` **95/95**（验收套件 22/22）；`test:profile` PASS（dsh 0.2.0-rc.2）；`pnpm pack --dry-run` 内容与 exports 目标齐全；`check:release` 四个精确 DSH 版本 **4/4** PASS，exit=0。
2. **D8 关闭有独立证据**：8 组跨语言/编辑场景，含反向、逐字段独立、惰性回填路径、`zh→en→zh` 往返、同语言 no-op；断言用的是 i18n 出厂常量而非硬编码字符串。
3. **零回归**：`zh-CN` 报告与 `case.json` 三个存储型字段都与 0.9.0 逐字段相同；render 预算、完整性矩阵、导出/导入事件序列等第二/三轮结论全部保持。
4. **验收套件里不再有「断言缺陷存在」的用例**：6 条全部改写为正向契约；唯一保留的 `D10` 明确标注为有意取舍。
5. **文档与实现一致**：D2–D6（第二轮）与 D9（第三轮）逐条对照实测，措辞与行为吻合。

### 8.3 交付前建议（不阻塞 GO）

| 优先级 | 项 | 改动 |
|---|---|---|
| P2 | §6 结论句按建议 A 收窄「案例自带文案」为「整组未被编辑的出厂默认」 | 文档 1 处（README:239 / CHANGELOG:15 同义句） |
| P3 | §3 已知边界 2、3 补一句说明（`language` 是渲染语言、手工改写的外来文件不做校正） | 文档 1–2 句 |
| P3 | O7 / O8 / O10 的注释与说明 | 注释/文档 |

### 8.4 把 GO 变成 NO-GO 的条件

- 若对外承诺「**任何**跨语言导入后报告、问题清单与 `case.json` 都严格单语言」→ 与 **D10** 冲突（部分编辑的问题数组会保留其余出厂条目）。按建议 A 收窄表述后即成立。
- 若对外承诺「`case.json` 的 `language` 字段描述文件内容的语言」→ 与 **§3 已知边界 2**（手工改写外来文件不做校正）冲突。正常升级与导入路径不受影响。
- 文档若在交付前再次大改（尤其 README 的 `language` / 回填段落），建议按本报告的复核方法重跑 §5，而不是默认沿用结论。

---

## 附录 A：`tests/acceptance.test.mjs` 的构成（22 项）

| 组 | 内容 |
|---|---|
| 输出契约 | 12 工具编译后 schema 全量校验 + 24 负向对照；render 预算（含对抗性输入与整串硬上限）；参数强制 |
| 持久化 | autoPersist 失败可见性；标记内容一致性；内存/磁盘事件数；撕裂导出（标记降级 + 写入顺序）；连续三次导出；完整性矩阵 6 行；回填需 `complete:true` |
| 服务绑定 | 后挂服务可用、provider 替换生效、cwd/signal 透传、卸载清理 |
| 回填 | 缓存未命中回填 + `case_rehydrated` + caseId 守卫 |
| 多语言 | `en` 全链路（含落盘 `report.md`）；ingest 草稿双语；`zh-CN` 兼容形状；跨语言导入的报告/导出一致性；**跨语言单语言化（导入 + 回填 + 往返）**；**用户编辑值保留 + 逐字段独立对齐**；`D10 (documented boundary)` |
| 宿主入口 | `/scout` 四子动作 + Skill 内容与卸载 |

**特征化（断言现状）用例数量：0 条缺陷锚定 + 1 条已知边界（`D10`）。**

## 附录 B：复现本报告的完整命令清单

```sh
cd "<repo>"
npm test                                              # 95/95（验收套件 22/22）
DSH_BIN=$(which dsh) npm run test:profile             # PASS (dsh 0.2.0-rc.2)
pnpm pack --dry-run                                   # 打包内容与 exports 目标核对
npm run check:release                                 # 4 个精确 DSH 版本 4/4 PASS

# 与真实 0.9.0 的逐字节差分 —— 必须用 0.9.0 提交，不能用 HEAD（HEAD 已是 0.9.1）
git archive 3406a4ee | tar -x -C /tmp/scout-baseline-r3
ln -s "$PWD/node_modules" /tmp/scout-baseline-r3/node_modules
(cd /tmp/scout-baseline-r3 && npx tsc -p tsconfig.json)

# 独立验收套件（也可单独运行）
node --test tests/acceptance.test.mjs                 # 22/22
```
