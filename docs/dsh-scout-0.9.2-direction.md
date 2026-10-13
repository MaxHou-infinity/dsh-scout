# dsh-scout 0.9.2 迭代方向与功能规格

- 评估对象：`dsh-scout@0.9.1`（HEAD `01b51a8 Address conformance audit findings: Skill source and peer metadata`）
- 运行面基准：DSH `0.2.0-rc.2`（npm `latest`/`next`）；`alpha` = `0.2.1-alpha.2`
- 日期：2026-10-12
- 前序文档：[0.9.1 迭代方向分析报告](dsh-scout-0.9.1-direction.md)、[0.9.1 独立验证报告（第三轮·最终）](verification-0.9.1.md)、[产品契约](dsh-scout-product-contract.md)
- 证据来源：本仓库源码与文档；`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh`（0.2.0-rc.2 随包发布的 `.d.ts` 与实现）；本机实测

---

## 0. 一句话结论

0.9.1 四道门禁全绿、验收套件 22/22、`GO` 已签发。**但这份 `GO` 自己点明了最大盲区 U11**：导出、导入、惰性回填、跨语言对齐这四条**修复最密集**的路径，在真实 DSH 宿主上**没有任何自动化证据**——`test:profile` 只真实调用了 `scout_start` 和 `scout_report` 两个工具（[verification-0.9.1.md:267](verification-0.9.1.md)）。

所以 0.9.2 的主题不是"加功能"，而是：

> **把 0.9.1 声称的"已验证"补成真的已验证，顺手清掉三轮验证留下的文档税。**

功能级升级（`storageDomain` 持久化重写、client 面板）留给 0.10.0，理由是它们各自需要一次完整 feature release 的设计决策，而不是 patch。

**一句话取舍**：0.9.2 的唯一 KPI 是"未验证项 U11 归零"，不是"新增能力"。

---

## 1. 现状盘点：0.9.1 留下了什么

**本次实测基线（2026-10-12，HEAD `01b51a8`）**：`npm test` = **97/97 pass**（验证报告签发时为 95，其后 `64ec814` / `01b51a8` 又补了 2 条）。`test:profile` / `pack:dry-run` / `check:release` 的结论沿用第三轮验证报告（四道门禁全绿）。

三类遗留，性质完全不同，处理方式也不同。**不要混为一谈。**

| 类别 | 项 | 性质 | 0.9.2 处置 |
|---|---|---|---|
| **已知边界**（刻意设计） | D10：精选面试问题整组 all-or-nothing 对齐，部分编辑时 `en` 报告仍含 ~79 个 CJK 字符 | 不是缺陷，是"宁可保守不猜用户意图"的取舍 | **需拍板**（见 §5 D-1） |
| | `case.json.language` 是"渲染语言"而非"文件内容语言"，手工改写的外来文件不做校正 | 信任假设 | 文档补一句 |
| | `alignCaseDefaults` 只在 `decide` 路径生效 | 实现边界 | 文档补一句 |
| **未验证项** | **U11**：导出/导入/回填/跨语言四条路径在真实宿主上无门禁 | **最大风险** | **0.9.2 核心（F2）** |
| | U1：真实 LLM / agent loop 无门禁（无 API key） | 环境限制 | 保持，列入 U-台账 |
| | U2：`/scout` 的 `command/run` + `command/done` 真实落盘未验证 | 可用真实会话补 | 0.9.2 尝试（F2 附带） |
| | U3/U4/U8：真实 fs provider、真实磁盘故障、真实 web provider | 假 double 替代 | 0.10.0 联调 |
| **明确推迟项** | `@deepseek-ai/schemastery` `^3.18.2` → `~3.18.4` | 宿主系列锁 `~3.18.4`，存在行为漂移 | 0.9.2（F4，S） |
| | npm 发布 / git tag（0.9.1 只做本地交付） | 分发 | **需拍板**（见 §5 D-2） |
| | O10：render 整串硬上限余量薄（改到 3 以内会越界） | 潜在回归点 | 0.9.2（F5，S） |

### 1.1 一条需要纠正的过时记忆

0.9.1 开发过程中的观察项 **D7（`scout_ingest` 草稿硬编码中文、`en` 报告含 78 个 CJK 字符）已在第二轮关闭**，不是遗留缺陷：

- 实现已走 i18n：`src/index.ts:850-851` 用 `formatScoutString(strings.ingest.autoConfidenceNote, …)` 与 `strings.ingest.autoNextAction`；
- `src/i18n.ts` 的 `ZH_CN` 与 `EN` 两张表 **17 个键完全对齐**（无单侧键）；
- 守护测试把 78 这个数字写成了**历史特征化注释**、断言是正向的：`tests/acceptance.test.mjs:1114` 注释记录旧缺陷，`:1137-1139` 断言 ingest 路径下英文报告 / 落盘 `report.md` / 派生问题 **CJK 全为 0**。

**结论：该结论已过期，不应再作为待办输入。** 真正会影响对外表述的只剩 D10（整组对齐，~79 CJK）。

---

## 2. 三条方向

### 2.1 优化方向：证据密度 > 功能数量

0.9.1 已经把 16 项交付清单做完，插件的**功能面是齐的**（12 工具 + `/scout` 命令 + `scout` Skill + 双语 + 覆盖度）。此时继续加功能的边际收益最低，而"改了 4 条最复杂的路径、却只在假 ctx 下测过"的风险最高。

所以优化方向锁定三件事，按优先级：

1. **让最复杂的路径进真实宿主**（F2）——这是唯一能把 U11 从"未验证"变成"有门禁"的动作；
2. **让对外表述与实现逐字一致**（F3）——三轮验证反复出现文档税（D2–D6、D9），是系统性成本；
3. **把"薄余量"变成"有断言的安全边界"**（F5）——O10 这类问题今天不痛，改一次就痛。

### 2.2 迭代方向：小步、可判定、每条都带门禁

| 版本 | 主题 | 出口条件 | 量级 |
|---|---|---|---|
| **0.9.2** | 收口 + 证据补齐 | U11 不再是"未验证"；文档零已知不符；四道门禁全绿 | 1 个迭代 |
| **0.9.3**（可选） | 真实 provider 联调 | `scout_search` 对接真实 web provider 通过（U8）；`/scout` 真实落盘（U2） | 1 个迭代，需 API key |
| **0.10.0** | 能力升级 | `storageDomain` 持久化 + client 面板 + `presentationMeta` 载荷 | 完整 feature release |

**不建议**把 0.10.0 的内容拆碎塞进 0.9.x：`storageDomain` 会改变 owner 语义（现在是按 `SessionId` 分桶），client 面板需要 `dsh.client` + client bundle + 双 tsc program + HMR 验证——两者都必须作为**一次设计决策**落地，而不是补丁。

### 2.3 内容方向：不新增第 13 个工具

产品契约 §6 的非目标保持不变（不做通用搜索、不自动投递、不做评分排名）。0.9.2 **不新增工具、不新增命令、不新增 Skill 条目**。

---

## 3. 0.9.2 交付清单

| # | 项 | 类型 | 主要触碰 | 量级 | 依赖 |
|---|---|---|---|---|---|
| **F1** | 面试问题逐条对齐（关 D10） | fix | `src/index.ts:388-414`、`tests/acceptance.test.mjs`、README/CHANGELOG | S | **需拍板 D-1** |
| **F2** | 真实宿主端到端门禁（关 U11） | test/feat | `scripts/profile-smoke.mjs` | **M** | — |
| **F3** | 文档收口（P2/P3 全部） | docs | `README.md`、`README.en.md`、`CHANGELOG.md`、产品契约 | S | — |
| **F4** | `schemastery` 对齐 `~3.18.4` | chore | `package.json`、`pnpm-lock.yaml` | S | — |
| **F5** | render 整串上限加固 | fix | `src/index.ts`（`MAX_RENDER_BYTES` 余量） | S | — |
| **F6** | 发布链路（npm + tag + GitHub） | chore | `package.json`、`.github/workflows/release.yml` | S | **需拍板 D-2** |

**建议执行顺序**：F2 → F1 → F3 → F4/F5 → F6。
理由：F2 是唯一可能**发现新缺陷**的项，先做才能保证后面的文档按最终行为写（避免 D9 那种"修完再改文档、改完又过期"的循环）。

---

## 4. 功能详细规格

### F1 — 面试问题逐条对齐（关 D10）

**要解决的问题。** 现在的判定是**整组 all-or-nothing**（`src/index.ts:395-397`）：

```ts
const curatedIsUntouched = curated.length === factory.length
  && curated.every((question, index) => question === factory[index])
```

只要用户改过其中任意一条，整组原样保留。实测后果：只改 1 条后，`en` 部署的报告仍含 **~79 个 CJK 字符**（4 条 zh 出厂问题未对齐），而 `decisionObjective` / `role.fitQuestion` 因为逐字段判定**已经对齐**（[verification-0.9.1.md:135](verification-0.9.1.md)）。

**目标行为。** 长度与出厂数组相同时，**按下标逐条比较、逐条替换**；用户改过的那条保持原样，其余出厂条目对齐到部署语言。

**实现规格。** 把上面的三行判定改为下标映射，长度不同则整组保留：

```ts
const factory = source.defaults.interviewQuestions
const target = strings.defaults.interviewQuestions
const curated = scoutCase.interviewQuestions ?? []
const aligned = curated.length === factory.length
  ? curated.map((question, index) => question === factory[index] ? target[index] : question)
  : curated
```

改动量约 3 行，位置不变（`alignCaseDefaults` 内）。

**行为矩阵（必须逐行有测试）。**

| 场景 | 期望 |
|---|---|
| 整组未编辑 → `en` | 5 条全部对齐，报告 CJK = 0（现状已满足，不得回归） |
| 只改第 3 条 → `en` | 第 3 条原样保留（中文），其余 4 条对齐为英文；报告 CJK 仅剩用户那条 |
| 整组替换为自定义 → `en` | 整组原样保留（长度不同时走"整组保留"分支） |
| 长度相同但全部自定义 → `en` | 逐条比较，无一条等于出厂值 ⇒ 等价于整组保留 |
| `en` case → `zh-CN`（反向） | 对称成立 |
| 往返 `zh → en → zh` | 逐项还原为 zh 出厂值 |
| 同语言 | no-op（`case.json` 与 0.9.0 构建产物逐字段相同） |

**验收。**
1. 新增/改写 `tests/acceptance.test.mjs` 中 `D10 (documented boundary)` 用例，从"钉住边界"改为**正向契约断言**（套件里再次归零"断言缺陷存在"的用例）；
2. 断言改用 i18n 出厂常量，不硬编码字符串；
3. `en` 报告在"只改 1 条"场景下的 CJK 计数**从 79 降到 = 用户那条的长度**，用计数断言而非"是否为 0"；
4. README `:239` / CHANGELOG `:15` 的措辞同步改为"**按下标逐条**对齐未编辑的出厂条目"。

**风险。** 失去了"宁可保守"的语义——如果用户**故意**把某条改回出厂原文，那条会被对齐。可接受：用户改回出厂值本身就等于放弃自定义意图。**这一条需要你确认（§5 D-1）。**

---

### F2 — 真实宿主端到端门禁（关 U11）★ 本版本的核心

**要解决的问题。** 0.9.1 的修复密度集中在四条路径上，而它们的证据全部来自**假 ctx 下的独立探测 + 真实构建产物差分**：

> `test:profile` 只真实调用 `scout_start` + `scout_report`，**不经过标记、导出、回填与跨语言导入代码路径**。这是本次交付最大的验证盲区。（[verification-0.9.1.md:267](verification-0.9.1.md)）

**已有基础设施（可直接扩展，不需要重写）。** `scripts/profile-smoke.mjs` 已经具备一条真实通路：

- 真实打 tarball（`:171`）→ 隔离 `DSH_HOME` + 隔离 profile（`:169-170`）；
- 写入一个**验证插件** `verify-lifecycle.mjs` + `verify-lifecycle.patch.yml` 注入 `tools` 服务（`:172-173, :186`）；
- 验证插件通过公开 API `ctx.tools.execute({ callId, name, arguments, signal })` **真实发起工具调用**（`:219`）；
- 断言方式：验证插件每观察到一个事实就打印一行 `DSH_SCOUT_GATE <json>`，**全部断言留在宿主脚本里**（`:182-184`）——单一断言位置，这是好设计，要沿用。

**目标：把 U11 的四条路径全部走一遍真实宿主。**

新增场景链（在同一个 smoke 生命周期内，分两次进程启动）：

| 步 | 动作 | 断言 |
|---|---|---|
| 1 | `scout_start` + `scout_add_source` + `scout_add_claim`（或 `scout_ingest` 带草稿） | `isError === false`；`value` 为对象 |
| 2 | `scout_export { targetDir: <绝对路径> }` | `persisted === true`、`complete === true`；磁盘上 **6 个文件**存在；`export.complete.json.complete === true` |
| 3 | **进程退出**，用同一 `DSH_HOME` / profile**第二次启动** | 冷启动成功 |
| 4 | `scout_report { caseId }`（不先 import） | **惰性回填成功**；决策与第 2 步一致；`events.jsonl` 出现 `case_rehydrated` |
| 5 | 第二个 profile：patch 带 `language: en`，`scout_import` 第 2 步的 zh 导出 | 报告 / 落盘 `report.md` **CJK = 0**；`case.json.language === 'en'` |
| 6 | 卸载 | registry 无残留（沿用现有 disposer 断言） |

**必须显式处理的实现细节（否则门禁会假绿）。**

1. **`agent` 未设置时的路径基准。** smoke 里 `exec.agent` 是 `undefined`，而插件的 cwd 取自 `exec.agent?.session?.header?.cwd`（`src/index.ts:427`）⇒ `cwd` 为 `undefined` ⇒ `fs.resolve()` 落到 **DSH 进程的 cwd**（`process.cwd()`，即 gate 临时目录）。**因此第 2 步必须传绝对 `targetDir`**，或者在 profile patch 的插件 config 里给绝对 `scoutDir`。两者都要在门禁里显式写死，不要依赖进程 cwd——否则门禁在 CI 上会因为工作目录不同而时绿时红。
2. **`scoutDir` 的配置注入。** 插件 `Config.scoutDir` 可以从 patch 的 `config:` 传入，这是把一个绝对临时目录喂给插件的最干净方式。
3. **两个 profile 要共用同一个 `scoutDir`**，否则第 5 步导入不到第 2 步的导出。
4. **`language` 也走 profile patch 的 `config:`**（第 5 步的 `en` profile），而不是改代码。

**验收。**
1. `DSH_BIN=$(which dsh) npm run test:profile` 在 gate 输出里能看到上述 6 步各自的 gate 行；
2. **加一条负向对照**：故意删掉 `export.complete.json` 后重新启动，断言 `scout_report` **不**回填（证明回填真的在读标记，而不是恰好命中了别的东西）——沿用现有 `output-schema negative control` 的写法（`:66` `SKIP_NEGATIVE_CONTROL`）；
3. 门禁脚本头部注释（`:5-53`）更新"WHAT THIS GATE PROVES"，把**已覆盖**与**仍未覆盖**两栏都写实——这是该文件的好传统，必须延续；
4. `check:release` 四个精确版本（`0.1.0-rc.6` / `0.1.2-rc.1` / `0.2.0-rc.2` / `0.2.1-alpha.2`）在**扩展后的门禁**下仍全绿——**这同时验证了新门禁本身在四个 DSH 版本上都能跑**。

**风险与代价。**
- 门禁从"单进程、两个工具调用"变成"双进程、多工具、双 profile"，**执行时间和脆弱度都会上升**。缓解：把第 5 步（跨语言）做成可跳过项（沿用 `DSH_SCOUT_SMOKE_SKIP_*` 的既有开关风格），本地全跑、夜间全跑、PR 快速路径可选跳。
- **可能暴露新的真实缺陷**——这正是先做 F2 的理由。如果第 4 步回填失败、或第 5 步 CJK 不为 0，那就是 0.9.1 的假绿被抓到，F2 应当**先出缺陷报告再修**，而不是顺手改绿。

---

### F3 — 文档收口

三轮验证累计 6 条文档不符（D2–D6 已关、D9 已关），验证报告仍留了三条**不阻塞 GO 但必须清**的项（[verification-0.9.1.md:286-292](verification-0.9.1.md)）：

| 优先级 | 位置 | 改法 |
|---|---|---|
| P2 | `README.md:239` / `README.en.md:239` / `CHANGELOG.md:15` / 产品契约:13 | 「案例自带文案」收窄为「**未编辑的出厂默认**（精选面试问题按 §F1 的规则逐条判定）」；用户编辑过的保持原样 |
| P3 | README「语言」段落 | 补一句：`case.json.language` 是**本部署渲染语言**，不是文件内容语言；手工改写的外来文件不做自洽性校正 |
| P3 | README 回填段落 | 补一句：`alignCaseDefaults` 只在 `decide` 路径生效；直接读磁盘 `case.json` 的第三方工具看不到对齐 |
| P3 | `CHANGELOG.md` / 代码注释 | O7：torn 窗口内 `eventCount` 描述**失败的那次尝试**；O8：`scout_export.files` 返回 6 个名字而标记内只列 5 个数据文件；O10：整串上限实为 ≤1019 B |

**验收**：按 verification §5 的复核方法重做一遍对照（逐条"文档措辞 ↔ 实现行号"），并把结论写回 `docs/verification-0.9.2.md`。

---

### F4 — `schemastery` 版本对齐

**现状**：插件声明 `^3.18.2`（`package.json` dependencies），宿主系列锁 `~3.18.4`。`^` 允许解析到 `3.19.x` ⇒ 存在**行为漂移**风险。

**为什么不会误判 Config**：身份识别走 `Symbol.for("schemastery")` 全局符号，所以跨版本不会把 Config 认错——这是 0.9.1 已经确认的。**但行为漂移仍是真实风险**，且这个改动是零成本的。

**规格**：`"@deepseek-ai/schemastery": "~3.18.4"`，重跑 `pnpm install` 更新 lock，确认 `pnpm pack --dry-run` 不变。

**验收**：`npm test` / `test:profile` / `check:release` 全绿；`package.json` 与 lock 一致。

---

### F5 — render 整串上限加固

**现状**（O10）：整串 render 的上限是「裁到 ≤1015 B 再追加 3 B 省略号」，**实际上界 1019 B**（实测最坏 1018 B）。文档写 `< 1024`，结论一致，但**余量只有 5 B**：如果将来把 `MAX_RENDER_BYTES - 8` 的余量改到 3 以内，就会越界。

**规格**：把"截断 + 省略号"的最终结果也纳入同一个预算断言，或者把省略号长度写进常量并让裁切长度由它推导：

```ts
const ELLIPSIS = '...'
const cut = MAX_RENDER_BYTES - Buffer.byteLength(ELLIPSIS)   // 由省略号推导，不写魔数
```

**验收**：新增一条对抗性测试，用**多字节**（CJK / emoji，注意 UTF-8 变长与代理对）输入把 render 推到边界，断言 `Buffer.byteLength(final) <= 1024`。现有 `tests/acceptance.test.mjs:443-450` 已有 CJK 对抗用例，扩展它即可。

---

### F6 — 发布链路（依赖拍板 D-2）

0.9.1 明确只做本地交付（不发 npm、不推远端、不打 tag）。0.9.2 若发布，需完成：

1. `package.json` version → `0.9.2`；`CHANGELOG.md` 补 `## [0.9.2]`；
2. `npm publish`（`prepare` 已配置为 `npm run build`，发布的是构建产物 `dist/`）；
3. GitHub tag + release；
4. **注意本项目的一条既定规则**：打磨完成的代码推送到**自己的仓库**（`git@github.com:MaxHou-infinity/dsh-scout.git`），不要推到 Hermes bundled 目录。

**验收**：`npm view dsh-scout version` 返回新版本；全新临时 `DSH_HOME` 下 `dsh plugin --profile x add dsh-scout` 从 **npm 真实安装**成功（而不是 `file:` / tarball 路径）。

---

## 5. 需要你拍板的两个决策点

### D-1 · F1 是否改成逐条对齐？

| 选项 | 收益 | 代价 |
|---|---|---|
| **A. 逐条对齐（推荐）** | `en` 报告在部分编辑场景下 CJK 从 ~79 降到"仅用户那一条"；消除文档与实现的表述落差 | 失去"宁可保守"语义；用户把某条改回出厂原文时会被对齐 |
| **B. 保持整组（现状）** | 语义最保守 | 对外表述必须长期带着"整组未被编辑才对齐"的限定；`en` 报告可能混排 |
| C. 保持整组 + 只在文档收窄 | 零代码风险 | 混排问题留着，0.10.0 仍要面对 |

**建议 A。** 理由：`decisionObjective` / `role.fitQuestion` 已经是逐字段判定，`interviewQuestions` 保持整组是**同一函数内的不一致**；而用户"改回出厂原文"在语义上就是不再要求自定义，"被对齐"不违反任何合理预期。

### D-2 · 0.9.2 是否发布 npm？

| 选项 | 说明 |
|---|---|
| **A. 发布（推荐）** | 0.9.1 的功能面向 npm 用户完全不可见；且 `check:release` 已证明四个 DSH 版本可装 |
| B. 继续只做本地交付 | 风险最低，但"0.9.2 的价值"只存在于本仓库 |

**建议 A**，且**在 F2 之后**发布——先让最大盲区有门禁，再把版本推出去。

---

## 6. 0.10.0 预先规格（先记约束，不做实现）

写在 0.9.2 文档里是为了**防止实现时才发现约束**。以下全部来自 [0.9.1 方向报告 §4.3/§8](dsh-scout-0.9.1-direction.md) 的已验证结论。

### G1 — `ctx.storageDomain` 持久化重写

把 case 从"内存 Map + 五文件导出"迁到 DSH 原生持久化接缝（`dsh-base/cordis.patch.yml:165-174` 默认已挂 `storage` + `storage-json` + `storage-domain`，`root = dshHomePath('storages')`）。

**三个必须先设计好的约束（踩中任一条都会返工）：**

1. **没有内建的 workspace / session / owner 分区** —— domain 按全局名打开，第二次 `open` 报 `already-open`；**scope 必须编进 record key**。这直接对撞现在的 owner 语义（按 `SessionId` 分桶），所以必须与"**case 是否跨会话共享**"这个**产品问题**一起决策。
2. **没有迁移机制** —— `version-mismatch` 是**拒绝**而不是升级。只能靠 `layout:'per-record'` + `compatibleVersions` + 可选新字段来预留演进空间。
3. **`KvUnit` 不串行化并发写** —— 所有制表变更必须走 `KvTable.update(key, fn)` 做原子读改写；**记录不得原地修改**。

**落地后 `scoutDir` 五文件的定位降级**为"可携带快照"（export/import 保留，用于换机器与交付）。

### G2 — client 面板（Web GUI 二次开发）

**已核实存在的接缝**（本次在 0.2.0-rc.2 上逐个验证）：

| 接缝 | 位置 | 用途 |
|---|---|---|
| `tool.call.toolview` | `@deepseek-ai/dsh-client-ui-tool`（keyed slot） | 给 `scout_*` 工具调用注册自定义卡片；**未注册的工具名走 generic 卡片** |
| `shell.overlay` | `@deepseek-ai/dsh-client-ui-layout`（list/root） | 常驻浮层：决策 / 证据台账 / 覆盖度看板 |
| `output.presentationMeta(args, value): JsonValue` | `@deepseek-ai/dsh-tools/lib/types/index.d.ts:112` | 结构化载荷 → `tool/result.meta`，**随会话日志持久化**，宿主与 client 共用同一份投影 |

**代价（这就是它是一个 feature release 而不是 patch 的原因）**：
- 必须声明 `dsh.client`（`platform: 'web'`）+ 真实存在的 `exports["./client"]`；
- 需要 **client bundle 构建**（tsdown preset）+ **双 tsc program**（host / client 分离，避免同名 Context 声明合并冲突）；
- **client import 纯度门禁**：跨插件的**值**导入禁止，协作只能走 service / remote / slot；只有纯类型 import 可以跨包；
- **HMR 验证**：client HMR 需要 `tsdown --watch` 持续重写 `lib/client.js`，只有 bundle 内容变化可以热更；package manifest / exports / 插件集合变化需要重启；
- `render` 的**文本承载不了结构化载荷**——所以 `presentationMeta` 必须与 client 面板**同期落地**，单独做没有可见收益（0.9.1 已据此推迟）。

**一个重要的设计取舍**：client 面板只读地**投影**已有的工具返回值与 `presentationMeta`，**不要**让面板成为新的真相源——真相源仍是 case 状态与事件流。

### G3 — 其余 0.10.0 候选

| 项 | 状态 |
|---|---|
| 会话内显式里程碑 | **仍不自造 session event**（红线不变：`Session.append()` 写不进 `ignorable`，读路径会拒绝未知非 ignorable 事件，导致插件自己写的会话无法恢复）。等上游提供可写 `ignorable` 的 append 路径 |
| `scout_compare` 升级 | 从 Markdown 拼表 → **共享维度矩阵**；仍不引入总分 |
| 证据策略可扩展 | `authorityHostSuffixes` 之外，支持按来源类型的 E 级上限规则 + "多源交叉才可 E3"的策略开关 |

---

## 7. 0.9.2 验证矩阵

| 门禁 | 命令 | 通过标准 |
|---|---|---|
| 单元 + 验收 | `npm test` | 全绿；`tests/acceptance.test.mjs` 里"断言缺陷存在"的用例数 = **0**（F1 后 D10 边界用例也转为正向） |
| **真实宿主端到端** | `DSH_BIN=$(which dsh) npm run test:profile` | 扩展后的 6 步场景全部出 gate 行；负向对照证明回填确实在读标记 |
| 打包 | `pnpm pack --dry-run` | 6 个 `exports` 目标齐全（含 `locale/*.json`、`icon`） |
| 版本矩阵 | `npm run check:release` | 4 个精确版本在**扩展后的门禁**下 4/4 PASS |
| 双语文档一致性 | 人工对照 | README / README.en / CHANGELOG / 产品契约 与实现逐条吻合（verification §5 方法） |
| 兼容门禁 | `--dump-config` | `# == dsh-scout` 层存在且**插件行是 enabled**（peer 不匹配 = **静默禁用**，只看进程能起来会漏判） |
| 工作树 | `git diff --check` | 无空白错误 |

**升级一条夜间门禁建议**：`compatibility-nightly` 应把「**超出声明范围**（预期）」与「**范围内但失败**（回归）」**分开报**——`<0.3.0-0` 注定在 DSH 发 `0.3.0-alpha.1` 那天让 alpha 通道变红，而那时多半只是**声明范围**过期，不是真坏。

---

## 8. 风险登记

| 风险 | 影响 | 缓解 |
|---|---|---|
| **F2 暴露新的真实缺陷** | 0.9.2 范围扩大 | 这是**设计意图**：先出缺陷报告、再决定修在哪一版。F2 排在 F1 之前正是为此 |
| 扩展后的门禁变慢 / 变脆 | CI 时长与假红 | 跨语言步骤做成可跳过开关；PR 快速路径与夜间全量分离 |
| F1 改变对外语义 | 用户可能依赖"整组保留" | 默认行为对**未编辑**场景零变化；CHANGELOG 的 `Changed` 段落明确写清，按 SemVer 走 patch |
| 0.10.0 的 `storageDomain` 改 owner 语义 | 数据迁移失败 | 与"case 是否跨会话共享"一起决策；保留 export/import 作为逃生门 |
| client 面板引入前端构建复杂度 | 拉长交付周期 | 严格按最小运行面：**只在 G2 落地时声明 `dsh.client`**，此前不构建 client bundle |

---

## 附录：本次评估的实测命令

```sh
# 基线：0.9.1 交付状态
cd "<repo>"
git log --oneline -1                    # 01b51a8
wc -l src/*.ts tests/*.mjs scripts/*.mjs

# 核实 D7 已关闭（原"78 CJK"结论已过期）
grep -n "ingest" src/index.ts                        # :850-851 走 formatScoutString
grep -c "[一-龥]" src/index.ts src/model.ts           # index.ts:1（Skill 正文）, model.ts:0
# src/i18n.ts 的 ZH_CN / EN 键集对比 → 17 / 17，无单侧键

# 核实 0.10.0 接缝真实存在（DSH 0.2.0-rc.2）
grep -ro "tool\.call\.[a-zA-Z.]*" .../dsh-client-ui-tool/lib/      # tool.call.toolview
grep -ro "shell\.[a-zA-Z.]*" .../dsh-client-ui-layout/lib/          # shell.overlay
grep -n "presentationMeta" .../dsh-tools/lib/types/index.d.ts       # :112

# 核实路径基准行为（影响 F2 设计）
grep -n "header?.cwd" src/index.ts                   # :427 exec.agent 可选 ⇒ agent 未设时 cwd 为 undefined
```
