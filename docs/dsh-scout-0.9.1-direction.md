# dsh-scout 0.9.1 迭代方向分析报告

- 评估对象：`dsh-scout@0.9.0`（仓库 HEAD `3406a4e fix: support DSH 0.2 in dsh-scout 0.9.0`）
- 运行面基准：DSH `0.2.0-rc.2`（npm `latest`/`next`）；`alpha` = `0.2.1-alpha.2`
- 评估日期：2026-10-12
- 证据来源：本仓库源码与文档；`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh`（0.2.0-rc.2 随包发布的 `.d.ts` 与实现）；本机实测（见附录 B）

---

## 0. 一句话结论

0.9.0 已经把"能不能装进 DSH 0.2"这件事做完了；**0.9.1 的价值不再是加功能，而是把插件从"能跑"推到"在真实 DSH 里表现正确、便宜、可解释"**。

具体是五条方向，且每条都能在 patch 版本内收口：

| 方向 | 一句话 | 0.9.1 落点 |
|---|---|---|
| D1 状态可信 | case 不再只活在内存里，导出必须是忠实快照，失败不再静默 | P0-1 / P0-2 / P0-3 / P0-4 |
| D2 输出契约 | 工具不再把整份 case JSON 回吐给模型，改成"结构化值 + 紧凑摘要" | P0-5 |
| D3 分发契约 | 补齐官方 manifest 字段与插件管理器展示元数据 | P1-1 / P1-2 |
| D4 可解释与双语 | 报告给出"调查覆盖度"，输出语言可配置 | P1-3 / P1-4 |
| D5 显式入口 | 给人一条 `/scout` 命令，给模型一份 Skill，而不是只靠自然语言 | P1-5 / P1-6 |
| **红线** | 不要自造 session event：插件自己 append 的事件会让会话在恢复时拒绝重建 | 见 §4.3 / §8 |

**建议不做**：client 面板、自造 session event、storage 持久化重写、评分模型——前两项有硬约束或需要一个完整 feature release 的工作量，后两项是 0.10.0 的事（理由见 §4.3、§7）。

---

## 1. 基线：0.9.0 的实测状态（不是推测）

| 检查 | 命令 | 结果 |
|---|---|---|
| 单元测试 | `npm test` | **34/34 通过**，68ms |
| 真实 profile 组合 | `DSH_BIN=$(which dsh) npm run test:profile` | **PASS（dsh 0.2.0-rc.2）**：打包 → 隔离 profile 安装 → `--dump-config` 含 `# == dsh-scout` 层 → smoke 断言的 6 个工具挂载（插件实际共 12 个） → 卸载 disposer 触发 |
| 真实 profile 行序 | 临时 profile `--dump-config` | 共 95 行配置；`dsh-scout` 是**第 95 行**（转储第 363 行），在 `web`(328)/`tools`(346)/`fs-sandbox`(356) 之后 |
| npm 分发 | `npm view dsh-scout version` | `0.9.0`（npm 上仅 0.8.0 / 0.8.1 / 0.9.0） |
| DSH 版本通道 | `npm view @deepseek-ai/dsh dist-tags` | `latest`=`next`=`0.2.0-rc.2`，`alpha`=`0.2.1-alpha.2`；两者都落在声明范围 `>=0.1.0-rc.6 <0.3.0-0` 内；`0.3.x` 尚不存在 |
| 仓库外反馈 | GitHub API | 3 stars / 0 open issues ⇒ 路线图目前是**自驱动**的，没有外部 issue 积压可以当输入 |

这一层的含义很重要：**0.9.0 没有"坏了"，0.9.1 是主动补强，不是救火。** 所以判断标准应该是"哪些差距会在真实使用中真实伤人"，而不是"还能加什么"。

---

## 2. 评估基准（三把尺子）

1. **DSH 官方 manifest / 运行时契约**（0.2.0-rc.2 随包发布的类型与实现）
   - `@deepseek-ai/dsh-package-manifest/lib/types/types.d.ts:22`：`engines` = "Runtime requirements; **DSH compatibility is declarative until a reader enforces it**"
   - `@deepseek-ai/dsh-app-boot/lib/index.js:286`：`evaluatePluginCompatibility()` 才是**真正生效**的检查，且只检查名字为 `@deepseek-ai/dsh` 或 `@deepseek-ai/dsh-*` 的 `peerDependencies`
   - `@deepseek-ai/dsh-tools/lib/types/index.d.ts:105`：`ToolOutputDefinition` = 受校验的 `schema` + `render` + 可选 `presentationMeta`
   - `@deepseek-ai/dsh-session/lib/types/known-event-types.d.ts:9`：外部插件事件必须带 `ignorable` 标记
2. **DSH 插件开发规范**（本会话加载的 `dsh-plugin-development` skill）
   - §4.6：路径显式指定，不走 `cwd` 默认值；写盘要原子、要并发语义
   - §4.3/§4.1：长生命周期资源归 fiber；可选 service 用 `ctx.get()`/`ctx.inject` 惰性绑定，不要在 `apply()` 抢跑
   - §4.4：`output.schema` 与 `render` 是同一 DSL 的两面，要给模型稳定、紧凑、可判定的文本
3. **项目自己的产品契约**（`docs/dsh-scout-product-contract.md`）
   - §5："配置：来源目录、报告目录、**并发数、超时**和**输出语言**必须是可配置字段"
   - §5："如果未来需要让 case 状态进入模型上下文，必须为其设计可回放的 session event"
   - §2：九段式调查卡；§8：同一 fixture 可重放并得到结构稳定的结果
4. **官方文档归档**（本地 `docs/upstream/deepseek-harness-site/`，已逐条核对原文）
   - `__en__develop__framework__service.html`："Optional: omit `inject` and query with `ctx.get()` **at the use site**"；且"缺少 provider 时 fiber 停在 PENDING，静默、不报错"
   - `__en__reference__.html`："**Model-visible means logged.** Anything that reaches a model request must be reconstructable from the log, and a runtime invariant asserts it."
   - `__en__reference__subsystems__session.html`："A plugin **may** declaration-merge extra `SessionEventMap` types. These are **log-only**…"
   - `__en__develop__basic__config.html`：Config 必须是 Schemastery schema，"Do not export a plain object as `Config`"；"两套部署可能想设成不同值的，都必须是配置字段"

---

## 3. 方向判断：0.9.1 该修哪一类问题

把上面的尺子和实测对撞，差距集中在四类，且都指向同一个根因：**0.9.0 的模型是"内存中的对象 + 手工导出"，而 DSH 给插件准备了"契约化的输出、可绑定的服务、可声明的清单"三套机制，插件只用到了工具注册这一套。**

于是 0.9.1 的方向不是"加第 13 个工具"，而是**把已经写好的能力接到正确的接缝上**。

---

## 4. 差距清单与 0.9.1 建议内容

### 4.1 P0 — 必须修（正确性 / 成本 / 契约）

#### P0-1 自动落盘失败被静默吞掉（数据可信度缺陷）

- 现象：`maybePersist()` 在写盘失败时 `return scoutCase`，**错误对象被直接丢弃**——没有事件、没有返回值、模型和用户都不知道这次没落盘。
- 证据：`src/index.ts:137-144`；对照 `scout_export` 会把 `error` 放进返回值（`src/index.ts:533-539`），两条路径行为不一致。
- 影响：一个主打"证据可追溯"的插件，却对"我的数据其实没存下来"保持沉默。这是本清单里**最不体面的一条**。
- 建议：`maybePersist` 返回 `{ case, persist?: { persisted, targetDir, error } }`，把失败写进工具返回值（`persistError` 字段 + 一行醒目的文本），并追加 `case_export_failed` 事件；如果宿主支持，用 `exec.deferContext()` 给模型一条提示（`dsh-tools/lib/types/index.d.ts:305-312`）。
- 验收：新增测试"写盘失败时返回值含 `persistError`，且 case 不携带 `case_exported` 事件"。

#### P0-2 导出不是忠实快照（`case_exported` 事件永远不在文件里）

- 现象：`scout_export` **先写文件、后记事件**，所以磁盘上的 `events.jsonl` 永远不含它自己这次导出的事件；而 `maybePersist` 是**先记事件、后写文件**。同一份数据，两条路径产出不同的事件流。
- 证据：`src/index.ts:525-532`（先 persist 再 `recordEvent`）vs `src/index.ts:138-143`（先 `recordEvent` 再 persist）。
- 影响：`events.jsonl` 自称"可回放事件流"，但"导出→导入→再导出"会持续漂移；用事件流做审计的前提被削弱。
- 建议：统一为"先记事件、后写文件"；`scout_export` 的事件流里应包含本次导出记录。
- 验收：导出→导入→再导出，两次 `events.jsonl` 的事件类型序列一致；补一条 round-trip 断言。

#### P0-3 进程重启 / 会话恢复后 case 消失，且没有自动恢复路径

- 现象：case 只存在 `const cases = new Map()`（`src/index.ts:86`），键是 `exec.agent?.id`——而 `Agent.id` 的类型就是 `SessionId`（`@deepseek-ai/dsh-agent/lib/types/types.d.ts:11-14`）。DSH 默认挂载会话持久化（`dsh-base/cordis.patch.yml:130` 的 `session-persistence-jsonl`），会话可以被恢复继续，**但插件那侧的 Map 是空的**，任何后续工具调用直接抛 `Unknown case`（`src/index.ts:88-92`）。
- 影响：README 承诺的"换会话、换机器都能接着尽调"实际依赖用户手动 `scout_import`；恢复会话后模型看到的是一堵墙，而不是"请先 scout_import"这类可自我修复的提示。
- 建议（0.9.1 范围）：**缓存未命中时惰性回填**——若配置了 `scoutDir` 且 `<scoutDir>/<caseId>/` 存在，则读取五文件恢复进 Map，并记一条 `case_rehydrated` 事件；找不到时给出的错误要包含"可用 caseId 列表 / 建议 scout_import"。
- 顺带修一个更基础的定位问题：`exec.agent` 是**可选**的（`dsh-tools/lib/types/index.d.ts:229`），而会话/工作区只能从 `exec.agent.session` / `session.header.cwd` 拿（`dsh-session/lib/types/types.d.ts:69`）。回填与导出都应该用**会话的 cwd** 作为基准目录，而不是让 `fs.resolve()` 落到进程 cwd——这同时解决了第 11 项。
- 注意一条运行时不变量："**Model-visible means logged**"——凡是进入模型请求的东西都必须能从日志重建。回填本身是合规的（它的结果仍然通过工具返回值进日志），但**必须记事件、并在返回值里说明数据来自哪个目录**，否则模型会看到"凭空出现"的 case 状态。
- 验收：同一 profile 下 `scout_start` + `scout_export` → 重启 DSH → `scout_report` 成功且决策一致。

#### P0-4 可选服务在 `apply()` 时被快照（潜在失效，今天侥幸没坏）

- 现象：`const fs = ctx.get('fs')`、`const web = ctx.get('web')` 在插件加载那一刻取值（`src/index.ts:95-96`）。cordis 的 `get()` 语义是"**读一次，未（尚未）提供时返回 undefined**"（`@deepseek-ai/cordis/src/reflect.ts:9-19`），不具响应性。
- **官方指引正好相反**：`__en__develop__framework__service.html` 写的是"Optional: omit `inject` and query with `ctx.get()` **at the use site**"——也就是**在调用点取**，而不是在 `apply()` 里抢跑。
- 今天为什么没事：真实 profile 里 `dsh-scout` 排在最后一行（附录 B），`fs`/`web` 都已就绪——**当前只是顺序上的运气**。
- 什么时候会坏：自定义 patch 调整行序、只装部分 bundle 的 profile、服务被替换/会话级覆盖（`strict` 语义只认"当前活跃 fiber"提供的实现）、`dsh plugin add --patch` 改动层次。
- 影响：一旦命中，`scout_search` / `scout_export` / `scout_import` 会在整个进程生命周期里报"service unavailable"，而服务其实存在。更糟的是这类失败**没有加载期报错**（缺 provider 时 fiber 只是静默 PENDING），只能靠运行时才发现。
- 建议：把取值挪进 `execute()`（调用时 `ctx.get('fs')`），或改用 `ctx.inject(['fs','web'], child => …)` 做幂等重绑（服务变化时会卸载重跑）；顺手把工具描述里的失败语义写清楚。
- 验收：新增测试"先 `apply()` 再注册 fs/web 假服务，工具仍可用"。

#### P0-5 工具把整份 case JSON 回吐给模型（成本缺陷 + 输出契约缺陷）

- 现象：12 个工具的 `output.schema` **全是 `{ type: 'string' }`**，`render` 只是把字符串原样包一层（如 `src/index.ts:158-160`）；所有变更类工具 `return JSON.stringify(nextCase, null, 2)`（`src/index.ts:178, 223, 587, 624, 660, 694`）。
- 实测成本：20 来源 + 25 主张的案例，**单次工具调用回吐 17,339 字节（≈4.5k tokens）**；且每条变更都会把"当时的全量 case"再吐一次，随台账增长单调递增。一次约 30 次变更调用的尽调，按末态估算上界约 130k tokens，实际落在数十 k tokens 量级——这些 tokens 全部用于重复已看过的内容。对照：`scout_report` 只有 15KB —— **唯一的全量出口本来就已经存在了**。
- 违约点：DSH 的 `output.schema` 是"对每个成功返回值强制校验的 JSON Schema"，`execute` 的契约是"只返回声明的无损 JSON 值"（`dsh-tools/lib/types/index.d.ts:105-128`）；PTC 模式下生成的 SDK 类型也会跟着退化（`lib/types/py-types.d.ts:10-11`）。字符串输出等于把校验、类型和呈现能力全部放弃，再让模型自己 `JSON.parse`。
- 建议：
  1. `output.schema` 改为结构化对象（`{ ok, caseId, decision, counts, delta, nextActions, persistError? }`）；
  2. `render` 输出**紧凑、可判定**的摘要（决策 + 本次增量 + 未核验阻断项 + 下一步），目标单次 < 1KB；
  3. 全量仍由 `scout_report` / `scout_export` 承担；
  4. `presentationMeta`（`index.d.ts:111-112`，随会话日志持久化）**暂不单独做**——见 §4.3，没有 client 消费者时它没有可见收益。
- 验收：真实组合里断言 `result.value` 是对象、`result.isError === false`、且 `content` 字节数 < 1KB（见 §6 的门禁升级）。

> **版本语义提醒**：P0-5 是模型可见的变更。若坚持"patch 只做修复"，可把它拆到 0.10.0；但本仓库自身有先例——`v0.8.1` 就是同时改了 `src/index.ts`、`src/model.ts`、`package.json` exports 和测试的 patch 版本。建议按"成本即缺陷"纳入 0.9.1。

### 4.2 P1 — 建议纳入（分发契约与可解释性）

#### P1-1 官方 manifest 字段缺失：没有 `engines.dsh`，也没有 `dsh.manifestVersion`

- 现状：`package.json` 只声明了 `peerDependencies`，没有 `engines.dsh`，`dsh` 下只有 `bundle`。
- 官方契约：`engines.dsh` 是**作者声明兼容范围**的字段，注释明确写着"DSH compatibility is declarative until a reader enforces it"（`dsh-package-manifest/lib/types/types.d.ts:22, 54-64`）；`dsh.manifestVersion?: 1`（同文件 `:30`）。
- 关键区别（值得写进 README）：
  - **生效的**是 `evaluatePluginCompatibility()`：只认 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 的 peer（名字过滤在 `dsh-app-boot/lib/index.js:294`），用 `semver.satisfies(runtime, range, { includePrerelease: true })` 判定（`:300`）；不匹配时给出警告并要求在 profile 里用 `dsh plugin allow-version` 做**精确版本豁免**（`compatibility.json`，只接受精确版本）。
  - **准入条件的关键是 `includePrerelease: true`**：没有它，`<0.3.0-0` 的比较元组是 `0.3.0` ≠ `0.2.0`，`0.2.0-rc.2` 会被判为**不匹配**——也就是说这条 range 的写法本身依赖这个标志位，不能想当然地简化。
  - **失败形态是"静默不加载"，不是报错**：不匹配时该行被 `row.disabled = true`（`dsh-app-boot/lib/index.js:2085-2089`），只在 stderr 打一行 `dsh: disabling profile plugin <label>: <reason>`（`:2057-2061`）。用户看到的现象是"插件没生效"。⇒ 夜间兼容检查应该**同时断言插件行是启用状态**，而不只是断言进程能起来。
  - 所以 `@deepseek-ai/cordis: ">=4.0.2 <5"` **完全不被 DSH 校验**；整个兼容门禁实际只由 `@deepseek-ai/dsh-tools` 这一条 range 扛着。`@deepseek-ai/schemastery` 同理——顺带一个加固点：插件的 `^3.18.2` 可能解析到 3.19.x，而宿主系列锁 `~3.18.4`（身份识别走 `Symbol.for("schemastery")` 全局符号，所以不会误判 Config，但存在行为漂移），建议对齐成 `~3.18.4`。
  - 0.2.0-rc.2 的运行时里没有任何代码读取 `engines.dsh`（全树 grep 无命中）——但声明它仍是官方作者契约，且未来 reader 不会替你做默认推断。
- 建议：加 `"engines": { "node": ">=22.19.0", "dsh": ">=0.1.0-rc.6 <0.3.0-0" }` 与 `"dsh": { "manifestVersion": 1, "bundle": {…} }`，并在 README 里把"声明 vs 生效 vs 豁免逃生门"三件事讲清。
- 验收：`--dump-config` / 安装路径不变；README 兼容性表格补一列"声明字段"。

#### P1-2 插件管理器里"看不见司察"：没有本地化元数据，也没有图标

- 现状：`description` 只有英文，没有 `icon`，没有 `locale/`。
- 官方契约：`readPluginMeta()`（`dsh-app-boot/lib/index.js:1969-1994`）会读 `${specifier}/locale/en.json` 及**同目录**的 `<lang>.json`（字段 `meta.title` / `meta.description`），回退到 `package.json` 的 `name` / `description`；`icon` 支持 SVG/PNG/JPEG/WebP、≤256 KiB、必须落在包目录内（`iconOf()`，同文件 `:1860-1876`）。
- **坑**：locale 文件是走 **Node ESM resolver** 解析的（`resolvePluginResource()`，`:1884-1891`），而 `ERR_PACKAGE_PATH_NOT_EXPORTED` 被当作"不存在"静默忽略（`missingResource()`，`:1892-1895`）。⇒ **没写进 `exports` 的 `locale/*.json` 等于没写**。
- 建议：新增 `locale/en.json` + `locale/zh.json`（`meta.title` = "Scout" / "司察 Scout"，`meta.description` 中英各一），补 `exports` 的 `"./locale/en.json"`、`"./locale/zh.json"`，加一个 ≤256 KiB 的图标并在 `files` 里带上；`description` 建议同时给中英（当前只有英文）。
- 验收：装进 profile 后，插件管理器/inventory 行的标题与描述按语言显示，图标可见；`pnpm pack --dry-run` 包含 locale 与图标。

#### P1-3 产品契约 §5 的配置缺口：输出语言 / 并发 / 超时

- 现状：`Config` 只有 `scoutDir` / `autoPersist` / `authorityHostSuffixes`（`src/index.ts:39-52`），而契约 §5 明确要求"来源目录、报告目录、并发数、超时和输出语言必须是可配置字段"。
- 更实际的问题：报告与面试问题**硬编码中文**（`src/model.ts:482-559`、`:652-735`，`language: 'zh-CN'` 固化在 `:179`）。一个英文 README、发在 npm 上的插件，英文用户拿到的是中文报告且无法切换。
- 建议：0.9.1 至少加 `language: 'zh-CN' | 'en'`（默认 `zh-CN`，保持现状不破坏），把报告/问题文案收进一张小字典；并发/超时在文档里显式标注"DSH 工具默认串行（未声明 `isConcurrencySafe` 即 exclusive），故不设并发配置；超时按需在 0.10 引入"。**契约里的字段要么实现，要么明确说明为什么不做**，不要留着不解释。
- 验收：`language: 'en'` 时 `scout_report` 全英文；默认行为对既有用户零变化。

#### P1-4 报告缺少"调查覆盖度"

- 现状：模型有 11 个维度（`src/model.ts:31-44`），契约 §2 承诺九段式调查卡，但报告只按**主张状态**分组（`src/model.ts:482-559`），`decideCase` 只强制 3 个必需维度（`:416-419`）。没有任何地方告诉模型"融资与商业化这一维度你根本没查"。
- 影响：这是**最能提升产品力的一个小改动**——覆盖度直接驱动 agent 的下一步动作，也让报告从"证据清单"变成"尽调进度"。
- 建议：`renderReport` 增加 `## Coverage` 块：每个维度给出 `已核验 / 待核验 / 未调查` 计数，并列出"未调查维度"作为显式下一步；`scout_questions` 优先为未调查维度生成问题。
- 验收：给一个只查了 identity 的 case，报告里 9 个维度标注为"未调查"，问题清单随之变化。

#### P1-5 加一个宿主侧控制入口：`/scout` 命令

- 现状：全部能力只通过 12 个工具暴露，用户没有任何"显式驱动"的入口（GUI 里只能靠自然语言）。
- 为什么这次能做、且成本很低：`ctx.commands.register(definition)` 对第三方完全开放（`dsh-commands/lib/types/index.d.ts:89-94`），`CommandInvocation` 直接带 `agent` 与 `signal`（`:18-36`），而且宿主会在 handler 前后自动落 **`command/run` + `command/done`**——这两个名字**在宿主已知事件词表内**，所以它是本版本里"既开放、又天然可重建"的唯一 UX 接缝（对比：自造 session event 会让会话无法恢复，见 §4.3）。
- 建议：注册一条 `scout` 命令，把最常用的三个动作变成显式指令（如 `/scout status <caseId>`、`/scout report <caseId>`、`/scout export <caseId>`），实现上直接复用现有工具逻辑；不做交互式多轮。
- 验收：真实 profile 里 `/scout status demo` 返回当前决策与证据计数；会话日志里能看到成对的 `command/run`/`command/done`。

#### P1-6 把"尽调方法"注册成 Skill

- 现状：工具的调用顺序、证据纪律、什么时候该 `verify_identity`，全靠模型读 12 段英文工具描述自己拼。
- 可用接缝：`ctx.skills.register({name, description, content, …})` 由插件直接注册，**不需要落文件、不需要 client bundle**（`dsh-skill/lib/types/index.d.ts:248-257`；注册是 layer-first-wins，重复注册只 warn 并返回空 disposer）。
- 建议：把 `scout` 的标准工作流（start → search/ingest → claim → verify_identity → report → questions）与四条证据纪律写成一段 `content` 注册进去，让模型按固定流程走，而不是每次即兴发挥。
- 验收：技能目录里出现 `dsh-scout` 条目，模型调用工具的顺序在真实任务里稳定下来；卸载后条目消失（disposer 生效）。

### 4.3 P2 — 明确推迟到 0.10.0 及以后（附理由）

| 候选 | 为什么不是 0.9.1 |
|---|---|
| **client 面板（case 看板/浮层）** | 宿主侧 `ToolCallView` 只有 `GenericCall \| TerminalCall \| DiffCall`，`ToolResultView` 只有 `Generic \| Terminal \| Diff \| Search \| Read \| Web`（`dsh-tools/lib/types/presentation.d.ts:41, 130`）；要自定义卡片必须注册 client 的 keyed slot `tool.call.toolview`（`dsh-client-ui-tool/README.md`："Unregistered Tool names use the generic card"）。这意味着 `dsh.client` + client bundle + 双 tsc program + HMR 验证，是**一个完整 feature release 的工作量**，不是 patch。 |
| **会话事件（把 case 写进 session log）—— 0.2.0-rc.2 里实际走不通** | 这是本次审计**最硬的一条约束**，也直接否决了产品契约 §5 的既有计划。类型层确实开放：`SessionEventMap` 可 declaration-merge，官方文档也写着"A plugin may declaration-merge extra `SessionEventMap` types"（`__en__reference__subsystems__session.html`）。**但落盘读路径不认**：`validateStoredEvents()` 对任何不在 `KNOWN_SESSION_EVENT_TYPES`（构建期生成的 59 个名字）里的 type，只要 `ignorable !== true` 就抛错——*"refusing to interpret the log"*（`dsh-session-persistence/lib/index.js:184`）；而 `Session.append()` 构造的信封只有 `{type, seq, time, data, ...surfaceMetadata}`，**没有任何路径能写入 `ignorable`**（`dsh-session/lib/index.js:1441-1459`，`surfaceMetadata` 只带 `sourceEventSeqs`/`surfaceOp`）。⇒ 插件自己 append 的事件会让**自己写的会话在重启/恢复时无法重建**。唯一的例外是**创建期 seed 事件**（`assertSessionEventEnvelope` 的白名单里包含 `ignorable`，`dsh-session/lib/types/index.js:141,154`），活会话里追加没有出路。⇒ **0.9.1 必须做的是改写路线图，不是实现它。** |
| **`ctx.storageDomain` 持久化重写** | 这是 DSH 原生的正确接缝（`dsh-base/cordis.patch.yml:165-174` 默认就挂了 `storage` + `storage-json` + `storage-domain`，`root = dshHomePath('storages')`；`defineDomain` + `ctx.storageDomain.open()`，读同步、写持久、`domain/changed` 有序）。但它要引入 domain schema、生命周期与迁移策略，并改变 owner 语义（现在是 `SessionId` 分桶）。P0-3 的"文件回填"能先解决 80% 的痛，重写留到 0.10.0 统一做。 |
| **评分/排名、批量对比扩展** | 产品契约 §6 明确列为非目标。保持边界。 |

**这条约束改写了什么：** 原本"让 case 状态进入模型上下文 = 设计可回放 session event"（产品契约 §5）的路线要改成下面这条**已经在已知词表内、因而天然可重建**的组合：

| 需求 | 0.2.0-rc.2 里可用的接缝 | 证据 |
|---|---|---|
| 用户显式操控（`/scout start …`） | `ctx.commands.register(def)` —— **对第三方完全开放**，且宿主会在处理前后自动落 `command/run` + `command/done`，这两个名字都在 `KNOWN_SESSION_EVENT_TYPES` 里 | `dsh-commands/lib/types/index.d.ts:89-94`；`dsh-session` 生成词表 |
| 让 UI/面板拿到结构化 case 数据 | `output.presentationMeta(args, value)` → 持久化在 `tool/result.meta`（无损 JSON，随会话日志走） | `dsh-tools/lib/types/index.d.ts:111-112, 198-204`；`dsh-session/lib/types/types.d.ts:387` |
| 跨会话/跨重启保存台账 | `ctx.storageDomain`（见 §4.3 第三行） | `dsh-storage-domain/lib/types/index.d.ts` |
| 把"尽调方法"交给模型 | `ctx.skills.register({name, description, content, …})` —— 无需落文件、无需 client | `dsh-skill/lib/types/index.d.ts:248-257` |

原本的会话事件方案在 0.2.0-rc.2 应视为**红线**：任何自造事件类型都会让插件自己写的会话在恢复时拒绝重建。

---

## 5. 0.9.1 交付清单（可直接当 issue 用）

| # | 项 | 类型 | 主要触碰 | 验收 | 量级 |
|---|---|---|---|---|---|
| 1 | P0-1 落盘失败可见化 | fix | `src/index.ts` | 失败返回值含 `persistError`，有测试 | S |
| 2 | P0-2 导出忠实快照 | fix | `src/index.ts` + 测试 | 两次导出事件序列一致 | S |
| 3 | P0-3 惰性回填（缓存未命中→读导出目录） | feat(small) | `src/index.ts` | 重启后 `scout_report` 可用 | M |
| 4 | P0-4 服务调用时绑定 | fix | `src/index.ts` | 后注册 fs/web 仍可用 | S |
| 5 | P0-5 输出契约重做（结构化值 + 紧凑 render） | fix/feat | `src/index.ts`（12 个工具） | 单次 <1KB 且 `value` 为对象 | M |
| 6 | P1-1 `engines.dsh` + `dsh.manifestVersion` | chore | `package.json`、README | 声明与 peer 范围一致并解释差异 | S |
| 7 | P1-2 locale + icon + exports | chore | `package.json`、`locale/`、`exports` | 插件管理器显示中英文标题与图标 | S |
| 8 | P1-3 `language` 配置 | feat(small) | `src/model.ts`、`src/index.ts` | `en` 全英文；默认零变化 | M |
| 9 | P1-4 覆盖度区块 | feat(small) | `src/model.ts` | 未调查维度可见并驱动问题 | S |
| 10 | 来源 URL 去重 | fix | `src/model.ts` | 重复 `scout_search` 不新增来源 | S |
| 11 | 导出路径报绝对路径 + `scoutDir` 显式化 | fix | `src/index.ts` | 返回值含解析后的绝对路径；默认目录行为有文档 | S |
| 12 | 兼容策略与豁免文档 | docs | README / compat 模板 | 夜间红 ≠ 必然不兼容，写明 `allow-version` | S |
| 13 | 五文件导出加"完整"语义 + 转发 `exec.signal` | fix | `src/index.ts` | 中断的导出能被识别为不完整；导出可取消 | S |
| 14 | P1-5 `/scout` 命令入口（复用工具逻辑） | feat(small) | `src/index.ts` | 命令可用；日志有 `command/run`+`command/done` | M |
| 15 | P1-6 注册 `scout` Skill（工作流 + 四条纪律） | feat(small) | `src/index.ts` | 技能目录可见、卸载即消失 | S |
| 16 | 改写产品契约 §5：撤回自造 session event 计划 | docs | `docs/dsh-scout-product-contract.md` | 改为 command + `presentationMeta` + `storageDomain` 路线 | S |

补充说明（第 11 项的证据）：`fs.resolve(path, opts?)` 的语义是"相对路径按 `opts.cwd` 解析"（`dsh-fs/lib/types/index.d.ts:90-97`），而插件调用时**不传 cwd**，所以默认 `scoutDir: 'dsh-scout'` 会落到 DSH 进程的当前目录；更麻烦的是 `ScoutFsTarget.displayPath` 声明了却从未使用（`src/index.ts:54-57`），工具返回的 `targetDir` 是**相对字符串**，用户根本不知道文件写到了哪。两行代码的事，体验差别很大。

第 10 项的动机：`addSource` 只拦 `sourceId` 重复（`src/model.ts:211-213`），而 `scout_search` / `scout_ingest` 每次都按序号发新 id（`src/index.ts:285-290, 426-431`），同一 URL 搜两次就在台账里出现两条来源，报告和 3 条"关键证据"配额都被稀释。

第 13 项的动机：`persistFiles` 是**五次串行写**（`src/index.ts:100-112`），单文件是否原子取决于 fs backend，但**这五个文件不是一个原子单元**；中途崩溃/中断会留下半份导出，而 `importCaseFromFiles` 对缺失文件是硬失败（`src/model.ts:603-612`），用户看到的是"导出目录坏了"而不是"上次导出没写完"。同时调用 **没有传 `exec.signal`**（`fs.writeText(target, content, expected?, signal?, sandboxPolicy?)`，`dsh-fs/lib/types/index.d.ts:221`），所以 `scout_export` 无法被取消。最小修法：先写 `<dir>/.tmp-*` 再整体改名的"目录级发布"，或写一个 `manifest.json`/完成标记让导入方能区分"未完成"与"损坏"。

---

## 6. 验证与发布门禁升级（0.9.1 必须做的一件事）

现状的 `scripts/profile-smoke.mjs` 只断言"工具挂上了"（`required` 名单 + `ctx.tools.get`）。它能证明插件能加载，**证明不了工具调用是对的**——P0-1/P0-5 这类问题它一个都抓不到。

好消息是 DSH 给了不用 LLM 就能打通的路径：`ctx.tools.execute({ callId, name, arguments })` 是公开 API（`dsh-tools/lib/types/index.d.ts:765`），返回 `ToolExecutionSuccess = { isError, value, content, meta? }`（同文件 `:413-423`）。于是可以让 profile-smoke 里的验证插件**真的发一次工具调用**，并断言：

1. `result.isError === false`；
2. `typeof result.value === 'object'`（P0-5 的可机检形式）；
3. `Buffer.byteLength(JSON.stringify(result.content)) < 1024`（token 预算门禁）；
4. 声明的 `output.schema` 能收下这个值（违反会抛 `ToolOutputError`，同文件 `:405-410`）；
5. 卸载后 registry 与 DOM/资源无残留（沿用现有 disposer 断言）。

> **实现 P0-5 时的一个硬性细节**：结构化输出的 `object` 节点**必须显式声明 `additionalProperties: boolean`**（`dsh-tools/lib/types/schema.d.ts:58-62` 的 `ObjectValueSchemaSpec`）；虽然运行时校验器容忍缺失（`lib/types/json-schema.d.ts:33-34`），但类型层会直接编译不过。另外要发往未来 UI 面板的结构化数据应走 `output.presentationMeta` → `tool/result.meta`，**`render` 的文本承载不了结构化载荷**。

另外两条门禁建议：
- **`check:release` 保留四版本实测**（现在覆盖 `0.1.0-rc.6 / 0.1.2-rc.1 / 0.2.0-rc.2 / 0.2.1-alpha.2`），但**把"范围外"和"范围内容错"分开报**——`<0.3.0-0` 注定在 DSH 发 `0.3.0-alpha.1` 那天让 alpha 通道变红，而那时多半只是**声明范围**过期，不是真坏。夜间 job 应输出"超出声明范围（预期）/ 范围内但失败（回归）"两种结论，README 同步补上 profile 级精确豁免（`dsh plugin allow-version` / `compatibility.json`）的说明。
- **补一条回放确定性测试**：同一 fixture 在无网络下重放得到结构稳定的结果（产品契约 §8 已承诺）。当前 `recordEvent` 用 `new Date().toISOString()`（`src/index.ts:124`），时间戳会进 `events.jsonl`；断言应只比较结构性字段，或者给事件注入可控时钟。

---

## 7. 风险与取舍

| 取舍 | 说明 | 建议 |
|---|---|---|
| patch 语义 vs 模型可见变更 | P0-5 改的是工具返回值形状 | 纳入 0.9.1 并把"工具名与语义不变、全量仍有出口"写进 release note；若想严格守 patch，退一步把它拆成 0.10.0 的 headline |
| 惰性回填 vs 显式 import | 自动回填会让"磁盘上的旧 case"悄悄回到上下文 | 回填必须记 `case_rehydrated` 事件并在返回值里说明来源目录，保持可审计 |
| 双语 vs 文案量 | 报告是中文字符串拼接，抽字典要动 `renderReport`/`renderComparison` | 0.9.1 只覆盖报告与问题清单；工具描述先保持英文（模型侧影响大） |
| 持久化重写 | `storageDomain` 是正解但会改 owner 语义 | 0.10.0 做，且与"case 是否跨会话共享"这个产品问题一起决策 |

---

## 8. 0.10.0 之后（产品级方向，先记录不做）

1. **可恢复的尽调工作台**：case 落 `ctx.storageDomain`，跨会话/跨重启存活，`domain/changed` 驱动 UI 与外部集成；`scoutDir` 五文件导出降级为"可携带快照"。
   - 三个必须先设计好的约束：**没有内建的 workspace/session/owner 分区**（domain 按全局名打开，第二次 open 报 `already-open`；scope 必须编进 record key）；**没有迁移机制**（`version-mismatch` 是拒绝而非升级，只能靠 `layout:'per-record'` + `compatibleVersions` + 可选新字段）；**`KvUnit` 不串行化并发写**，所有制表变更要走 `KvTable.update(key, fn)` 做原子读改写，记录也不得原地修改。
2. **client 面板**：注册 `tool.call.toolview` + `shell.overlay`（两个 slot 键均已在 0.2.0-rc.2 的类型里核实存在），把决策/证据台账/覆盖度做成常驻卡片；同期再把 `presentationMeta` 的载荷接上，让宿主与 client 共用同一份投影。
3. **会话内的显式里程碑**：**不要自造 session event**（见 §4.3 与 §6 的红线）。等上游提供可写 `ignorable` 的 append 路径之后再做；在那之前，"用户显式动作"用 `command/run`+`command/done`，"结构化 UI 载荷"用 `tool/result.meta`，"持久状态"用 `storageDomain`。
4. **批量与对比升级**：把 `scout_compare` 从"Markdown 拼表"升级为共享维度矩阵；仍不引入总分。
5. **证据策略可扩展**：`authorityHostSuffixes` 之外，支持按来源类型的 E 级上限规则与"多源交叉才可 E3"的策略开关。

---

## 附录 A：证据索引

| 结论 | 证据位置 |
|---|---|
| 工具输出全为字符串 | `src/index.ts:158-160`（及全部 12 个工具）；`:178,223,587,624,660,694` |
| 落盘失败被吞 | `src/index.ts:137-144` |
| 导出顺序不一致 | `src/index.ts:525-532` vs `:138-143` |
| 内存 Map / 无回填 | `src/index.ts:86-92`；`@deepseek-ai/dsh-agent/lib/types/types.d.ts:11-14` |
| 服务 apply 时快照 | `src/index.ts:95-96`；`@deepseek-ai/cordis/src/reflect.ts:9-19` |
| 输出契约 | `@deepseek-ai/dsh-tools/lib/types/index.d.ts:105-128, 413-423, 765` |
| 输出违约异常 `ToolOutputError` | 同文件 `:405-410` |
| 呈现视图封闭集合 | `@deepseek-ai/dsh-tools/lib/types/presentation.d.ts:41, 130` |
| client slot 才是自定义卡片入口 | `@deepseek-ai/dsh-client-ui-tool/README.md:12,36,39`（"Unregistered Tool names use the generic card"；`ctx.slots.inject('tool.call.toolview', …)`） |
| manifest 声明字段 | `@deepseek-ai/dsh-package-manifest/lib/types/types.d.ts:22-30, 54-64` |
| 实际生效的兼容检查 + 豁免 | `@deepseek-ai/dsh-app-boot/lib/index.js:286-322` |
| 插件展示元数据与 locale 解析 | 同文件 `:1860-1876, 1884-1895, 1969-1994` |
| 会话事件必须 `ignorable` | `@deepseek-ai/dsh-session/lib/types/known-event-types.d.ts:9-19`；`types.d.ts:497-507` |
| **append 无法写 `ignorable`**（红线） | `@deepseek-ai/dsh-session/lib/index.js:1441-1459`（信封只含 `type/seq/time/data` + `surfaceOp`/`sourceEventSeqs`） |
| **读路径拒绝未知且非 ignorable 的事件** | `@deepseek-ai/dsh-session-persistence/lib/index.js:184`（`validateStoredEvents`） |
| seed 事件是唯一例外 | `@deepseek-ai/dsh-session/lib/types/index.js:133-158`（白名单含 `ignorable`） |
| 会话 cwd 可作路径基准 | `@deepseek-ai/dsh-session/lib/types/types.d.ts:69`；`exec.agent` 可选 `dsh-tools/lib/types/index.d.ts:229` |
| 结构化 `object` 需 `additionalProperties` | `@deepseek-ai/dsh-tools/lib/types/schema.d.ts:58-62` |
| peer 不匹配 = 静默禁用 | `@deepseek-ai/dsh-app-boot/lib/index.js:294, 300, 2057-2061, 2085-2089` |
| 命令入口对第三方开放 | `@deepseek-ai/dsh-commands/lib/types/index.d.ts:18-36, 89-94` |
| 技能可由插件注册 | `@deepseek-ai/dsh-skill/lib/types/index.d.ts:248-257` |
| storage 域接缝 | `@deepseek-ai/dsh-storage/README.md`；`@deepseek-ai/dsh-storage-domain/README.md`；`dsh-base/cordis.patch.yml:165-174` |
| fs 写入/解析契约 | `@deepseek-ai/dsh-fs/lib/types/index.d.ts:90-97, 221`；`lib/types/types.d.ts:108` |
| 产品契约要求 | `docs/dsh-scout-product-contract.md` §2/§5/§6/§8 |
| 可选 service 应在调用点取 | 官方归档 `__en__develop__framework__service.html`（"query with `ctx.get()` at the use site"） |
| Model-visible means logged | 官方归档 `__en__reference__.html` |
| 插件可 declaration-merge 事件，但 log-only | 官方归档 `__en__reference__subsystems__session.html` |
| Config 必须是 Schemastery schema | 官方归档 `__en__develop__basic__config.html`（"Do not export a plain object as `Config`"） |
| 补丁层整体替换 config、四层顺序、`--dump-config` 门禁 | 官方归档 `__en__develop__basic__publish.html`、`__en__reference__.html` |

## 附录 B：本次实测命令与结果

```sh
# 1) 单元测试
npm test                       # 34/34 pass

# 2) 真实组合（本机 dsh 0.2.0-rc.2）
DSH_BIN=$(which dsh) npm run test:profile
# → dsh-scout profile smoke: PASS (dsh 0.2.0-rc.2)

# 3) 真实 profile 行序（临时 DSH_HOME，测后已删除）
dsh plugin --profile order add file:<tarball>
dsh --profile order --dump-config
# → 95 行；- id: dsh-scout 在最后一行（363），位于 web(328)/tools(346)/fs-sandbox(356) 之后

# 4) 输出体积实测（20 来源 + 25 主张）
# full case JSON = 17,339 bytes（≈4.5k tokens）；report.md = 15,156 bytes

# 5) 版本通道
npm view @deepseek-ai/dsh dist-tags   # latest/next=0.2.0-rc.2, alpha=0.2.1-alpha.2
npm view dsh-scout version            # 0.9.0
```

> 本报告为一次性分析产物，未修改任何源码；如需保留请自行移动到 `docs/` 之外或纳入版本管理。
