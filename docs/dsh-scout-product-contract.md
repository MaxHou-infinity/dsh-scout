# dsh-scout 产品契约

状态：Draft 0.1
目标：把公司与岗位尽调收敛为一个可复现、可追溯、能支持下一步行动的 DSH 场景插件。

当前实现进度：首个公开切片已经覆盖 session 隔离的内存 case、封闭来源类型、主体核验、claim 证据历史、保守三态决策、结构化报告、卸载清理和临时 DSH profile 安装门禁；v0.2 已落地持久化五文件导出（`scout_export` / `scout_import`，含可回放事件流 `events.jsonl` 与导入后决策重算）；v0.3 已落地可配置存储（`scoutDir` / `autoPersist` 插件配置）与面试问题生成（`scout_questions`）；v0.4 已落地信息采集登记（`scout_ingest`：批量登记采集结果并按 URL 自动推断来源类型与证据等级）；v0.5 已落地公司/岗位对比（`scout_compare`：2–5 案例并排对比报告与合并面试问题）；v0.6 已落地采集→主张流转（`scout_ingest` 支持 claim 草稿，登记来源同时自动添加主张）；v0.7 已落地 Provider 深度集成（`scout_search`：接入 DSH Web Provider，搜索结果自动登记为来源）；v0.8.x 完成 npm 首发与 DSH 0.2 rc 通道对齐（`exports` 映射、Schemastery `Config` 声明、profile smoke 门禁）；v0.9.0 适配 DSH 0.2 运行时，并建立四个精确版本的兼容矩阵与夜间兼容检查。

**v0.9.1** 把插件从「能跑」推到「在真实 DSH 里表现正确、便宜、可解释」，主题是接缝而不是新功能：

- **输出契约**：变更类工具不再回吐整份 case JSON，改为「结构化对象 `value` + 整串（含省略号）不超过 1 KB 的紧凑 render」；全量数据仍由 `scout_report` / `scout_export` 提供。
- **落盘可信度**：`autoPersist` 失败可见化（返回值 `persist.persisted=false` + `persist.error`）；导出统一为「先记事件、后写文件」；导出目录写 `export.complete.json` 完成标记（**先置 `complete:false`、五文件写完再置 `complete:true`**）；`scout_import` 读标记的 `complete` 字段，缺失或不完整时报告 `complete: false`；写盘转发 `exec.signal`。
- **服务绑定与路径**：`fs` / `web` 改为调用时解析（不再在 `apply()` 时快照）；导出返回解析后的绝对路径；缓存未命中时，**只有完整导出**（完成标记 `complete: true`）才从 `<scoutDir>/<caseId>/` 惰性回填并记 `case_rehydrated`（0.9.0 旧导出无完成标记，需显式 `scout_import`）。案例对齐只在 `decide` 路径生效（重算决策的工具调用与缓存未命中时的惰性回填经过它；回填由第一个访问该 case 的工具调用触发，所以冷启动后即使只调 `scout_report` 也可能带上一次对齐）；**直接读磁盘 `case.json`、从不经过插件的第三方工具看不到对齐**。
- **可解释与双语**：新增 `language: 'zh-CN' | 'en'`（默认 `zh-CN`），未编辑的出厂默认文案会自动对齐到部署语言——精选面试问题按**下标逐条**判定（长度与出厂数组相同时逐条替换，用户改过的那条保持原样；长度不同则整组原样保留），`decisionObjective` / `role.fitQuestion` 逐字段判定；报告新增 `## Coverage` 调查覆盖度区块。
- **显式入口**：新增 `/scout` 命令（`status` / `questions` / `report` / `export` 四个子动作）与插件注册的 `scout` Skill。
- **分发契约**：`engines.dsh`、`dsh.manifestVersion: 1`、`locale/en.json` + `locale/zh.json`（必须写进 `exports`，否则被静默忽略）、包内 `icon`。

0.9.1 明确不做的事见 [CHANGELOG](../CHANGELOG.md)：client 面板、自造 session event、`ctx.storageDomain` 持久化重写、评分与排名（0.9.2 沿用同一非目标）。

**v0.9.2**是收口版本：把 0.9.1 验证报告点名的最大盲区（U11）补成真实宿主门禁，并清掉三轮独立验证留下的文档税。本版本**不新增工具、不新增命令、不新增 Skill 条目**：

- **F2 · 真实宿主端到端门禁（关闭 U11）**：`scripts/profile-smoke.mjs` 扩展为六步真实宿主场景链——创建 → 导出 → 冷重启 → 惰性回填 → 跨语言导入 → 卸载，另加完成标记「缺失 / `complete:false`」两条负向对照；四版本矩阵在扩展后的门禁下 4/4 通过。**仍未覆盖**：真实 LLM / agent loop 与 approval 策略、相对路径、`autoPersist`、真实进程中断，以及其余 6 个工具（仅断言注册）。
- **F1 · 面试问题按下标逐条对齐（关闭 D10）**：精选面试问题由「整组 all-or-nothing」改为按下标逐条——长度与出厂数组相同时逐条替换，用户改过的那条保持原样；长度不同则整组原样保留。默认行为对**未编辑**场景零变化。
- **F5 · render 整串上限加固（关闭 O10）**：整串（含省略号）不超过 1024 B，裁切预算由省略号自身的 UTF-8 长度推导（不再依赖手写余量）。
- **F4 · 依赖对齐**：`@deepseek-ai/schemastery` 由 `^3.18.2` 改为 `~3.18.4`，与宿主系列一致；`peerDependencies` 与 `engines.dsh` 范围不变。
- **已知边界 G1（有意不修，推迟 0.10.0）**：冷启动惰性回填会把决策理由措辞由初始文案换成 `decisionReasons.identity`（并补 `decisionReasonCode`），`decision` 不变；详见 [0.9.2 门禁发现](dsh-scout-0.9.2-gate-findings.md)（仓库文档，不在 npm 包内）。

**v0.9.3（当前版本）**不改运行时契约，主题是**安装体验**：此前 README 的三条「已验证路径」全是 `dsh plugin --profile <name> add …`，而桌面 App 的 `desktop` profile 被 Electron 应用独占，桌面用户第一步就撞墙——0.9.3 把「App 内安装」写成主路径，并给安装补上可执行判据。安装模型、分发源取舍与兼容性豁免见 §5.3；桌面路径的手工验收见 [安装验收 checklist](install-verification.md)（仓库文档，不在 npm 包内）；评审原件见 [安装评审](dsh-scout-install-ux-review.md)（同上）。本版本**不新增工具、命令或 Skill 条目**。

## 1. 产品承诺

给定一个公司和一个岗位，`dsh-scout` 不承诺“找到所有信息”，而承诺在证据边界内回答：

> 这个机会是否值得进入下一轮？如果值得，面试中必须验证什么？

所有重要结论必须绑定来源、证据等级和下一步动作；无法验证的内容必须保留为 `unknown` 或 `needs_verification`，不能被润色成事实。

## 2. 首个用户流程

输入：

- 公司名称或官网
- 岗位名称或岗位链接
- 用户目标（默认：是否值得进入下一轮）

流程：

1. 确认公司主体：名称、注册主体、品牌名和地域；存在歧义时暂停。
2. 建立九段式调查卡：公司与创始人、产品与技术、市场与竞争、融资与商业化、组织与 HR、风险、岗位匹配、面试反问、待核验事项。
3. 采集并归档来源；保存抓取时间、来源类型和原始链接。
4. 将事实、推断、用户提供信息和未知项分开。
5. 生成三态判断：`PROCEED`、`VERIFY` 或 `STOP`。
6. 输出报告、证据清单、风险清单和面试问题。

## 3. 首版输出物

每个 case 生成一个可复制的目录：

```text
scout-cases/<case-id>/
  case.json
  sources.json
  claims.json
  events.jsonl
  report.md
  export.complete.json   # 0.9.1 起：完成标记（先置 complete:false，五文件落盘后改写 complete:true）
```

0.9.1 起，五个数据文件之外还有一个完成标记 `export.complete.json`，内容形如 `{ schemaVersion, caseId, complete, files, eventCount }`。写入顺序是：**先**把标记写成 `complete: false`，五个数据文件全部落盘后**再**改写为 `complete: true`。因此**陈旧标记不会为半份导出宣称完整**——在覆盖写场景下，上一次成功导出的标记会在新文件写入前先被降级为 `complete: false`。

标记里的 `eventCount` **只有在 `complete: true` 时才与磁盘上 `events.jsonl` 的行数一致**：导出中断时，它记录的是那次失败尝试**期望**的事件数，可能与实际行数不同。读取方请以 `complete` 为准，不要只看 `eventCount`。

标记里的 `files` 只列**五个数据文件**；`scout_export` 返回值里的 `files` 是这次调用写出的**六个名字**（五个数据文件 + 标记自身）。同名不同义，两者都正确。

`scout_import` 读的是标记里的 **`complete` 字段**，而不是「标记文件是否存在」：标记缺失或 `complete: false` 时，只要**五个数据文件都已落盘**，导入仍会进行，但返回值报告 `complete: false`，让调用方自己决定是否信任这份快照。也就是说：中断的导出只要五个数据文件都在，仍可导入，但会被如实标为不完整；五个数据文件缺任何一个（例如在写 `claims.json` 时中断的全新导出）仍是硬失败。

首版不要求精确的总分。报告必须包含：

- 一句话判断和判断状态
- 3 个支持判断的关键证据
- 3 个阻断或待核验风险
- 岗位可能的真实任务与权限假设
- 面试反问清单：**上限 12 条**；案例自带的精选问题**永远保留名额**，其余名额按「待办下一步 → 缺失必需维度 → 未调查维度」的优先级填充
- 下一步最小核验动作

## 4. 证据模型

证据等级是来源质量标签，不是事实真伪的自动证明：

| 等级 | 含义 |
| --- | --- |
| `E0` | 未找到证据或仅为模型猜测 |
| `E1` | 用户提供、招聘信息或公司自述 |
| `E2` | 独立媒体、公开数据库或多源交叉信息 |
| `E3` | 工商、监管、官方文件或可直接复核的一手资料 |

每条 claim 至少包含：`claim_id`、`text`、`status`、`evidence_level`、`source_ids`、`confidence_note` 和 `next_action`。

允许的 `status`：`verified`、`reported`、`inferred`、`contradicted`、`unknown`、`needs_verification`。

## 5. DSH 插件边界

首版作为外部 bundle，优先使用现有工具、子 Agent、任务和文件系统能力：

- 工具：启动 case、核验 claim、比较公司、生成面试问题、导出报告。
- 事件观察：记录工具结果和来源归档，不重写 Agent Loop。插件自己的 `events.jsonl` 事件只存在于导出文件里，**不写进 session log**（理由见 §5.1）。
- 配置：来源目录、报告目录和输出语言必须是可配置字段。`scoutDir` / `autoPersist` 已在 v0.3 落地，`language`（`'zh-CN' | 'en'`，默认 `'zh-CN'`）在 0.9.1 落地——`case.json` 里的 `language` 是**本部署的渲染语言**，不是文件内容的语言：对齐只按这个标签判定，不校验标签与内容是否自洽，手工改写的外来文件不做校正。**并发数与超时 0.9.1 明确不做**：DSH 工具默认串行（未声明 `isConcurrencySafe` 即 exclusive），插件这一层没有可并发的调度面；超时按需在 0.10.0 引入。契约里的字段要么实现、要么写明为什么不做，不留未解释的占位。
- 生命周期：所有 watcher、后台任务、连接和临时文件都必须在卸载时清理。

### 5.1 撤回「自造 session event」计划（红线）

0.9.0 的路线图曾写：「如果未来需要让 case 状态进入模型上下文，必须为其设计可回放的 session event」。**该计划在 DSH 0.2.0-rc.2 上撤回**——这不是取舍，而是硬约束：

- 类型层确实开放：`SessionEventMap` 可以 declaration-merge，官方文档也写明「A plugin may declaration-merge extra `SessionEventMap` types」。但**落盘读路径不认**：`validateStoredEvents()` 对任何不在 `KNOWN_SESSION_EVENT_TYPES`（构建期生成的 59 个名字）内、且 `ignorable !== true` 的事件类型直接抛错（*refusing to interpret the log*，`@deepseek-ai/dsh-session-persistence/lib/index.js:184`）。
- 而 `Session.append()` 构造的信封只有 `{ type, seq, time, data, …surfaceMetadata }`，**没有任何路径能写入 `ignorable`**（`@deepseek-ai/dsh-session/lib/index.js:1441-1459`；`surfaceMetadata` 只带 `sourceEventSeqs` / `surfaceOp`）。唯一例外是创建期的 seed 事件（`assertSessionEventEnvelope` 的白名单包含 `ignorable`，`dsh-session/lib/types/index.js:141,154`），活会话里追加没有出路。
- 后果：插件自造的事件会让**插件自己写的会话在重启 / 恢复时无法重建**。一个主打「证据可追溯」的插件不能拿用户的会话日志去赌这个。

### 5.2 替代路线：只用宿主已知词表内的接缝

| 需求 | 0.2.0-rc.2 里可用的接缝 | 落地版本 |
| --- | --- | --- |
| 用户显式动作（`/scout status` / `questions` / `report` / `export`） | `ctx.commands.register(def)`；宿主在处理前后自动落 `command/run` + `command/done`，两个名字都在 `KNOWN_SESSION_EVENT_TYPES` 内 | 0.9.1 |
| 结构化 UI 载荷 | `output.presentationMeta(args, value)` → 持久化在 `tool/result.meta`（无损 JSON，随会话日志走） | 0.10.0（0.9.1 不引入：没有 client 消费者时它没有可见收益） |
| 跨会话 / 跨重启保存台账 | `ctx.storageDomain`（`defineDomain` + `ctx.storageDomain.open()`，读同步、写持久、`domain/changed` 有序） | 0.10.0（会改变 owner 语义，需与「case 是否跨会话共享」一起决策） |
| 把「尽调方法」交给模型 | `ctx.skills.register({ name, description, content, … })`——无需落文件、无需 client bundle，卸载即消失 | 0.9.1 |

> 一句话规则：**不要自造 session event。** 用户显式动作走 `command/run` + `command/done`，结构化 UI 载荷走 `output.presentationMeta` → `tool/result.meta`，持久状态走 `ctx.storageDomain`。

### 5.3 安装与分发模型（0.9.3）

两条入口，安装方式不同，不要混用：

| 你在哪运行 | 目标 profile | 安装方式 |
| --- | --- | --- |
| 桌面 App（DeepSeek Harness） | `desktop` | **侧边栏 → 插件页**（唯一路径） |
| CLI / headless / 自建 profile | 你自己的 profile 名 | `dsh plugin --profile <your-profile> add dsh-scout@<exact-version>` |

- **`desktop` 由应用独占**：CLI 对它的**所有** `dsh plugin` 子命令都在参数解析层按 profile 名拒绝（`rejectElectronProfile`，`error: profile "desktop" is managed exclusively by the Electron application`），连兼容性逃生门 `allow-version` 一起拒绝。所以桌面场景既没有 CLI 判据，也没有可脚本化的自动化门禁——这正是 0.9.2 及以前的门禁盲区。
- **spec 一律写精确版本**：pnpm ≥ 11 默认启用最小发布年龄（minimum release age）供应链保护，裸包名会把刚发布的版本静默跳过、回退到旧版；写精确版本后 pnpm 会把它记入 profile 的 `minimumReleaseAgeExclude`。
- **分发源与代价**：npm（自带 `dist/`，不跑安装脚本，**推荐**）、本地 tarball（离线 / 自测）、git（仓库不含 `dist/`，`prepare` 会跑 `tsc` 并安装 devDependencies——**不推荐**，只在需要未发布提交时使用，ref 写真实 tag 如 `#v0.9.3`）。git 是唯一会执行代码的路径。
- **Node 适用范围**：`engines.node >= 22.19` 只对 CLI / 门禁路径成立；桌面 App 自带运行时（实测 node 24.21.0 + pnpm 11.7.0），无需安装 Node。
- **成功判据与排障面（两个 GUI 面，别混）**：**侧边栏 → 插件页**是**管理面**，回答「装的是哪版」——`dsh-scout` 在「已安装」里，**详情页**标题旁带 `v{version}`（`BundleInfo.version`），安装 / 启用 / 停用 / 移除都在这里；**设置 → 内置插件 → 插件列表**是**只读检查面**，回答「装没装 / 为什么没生效」——该行**已启用 + 运行中**（不是**已停用** / **启动失败** / **条件启用**），按「会话插件 / 全局插件」分组，**不显示版本号**（wire 行只有 `{ entryId, moduleName, meta?, enabled, fiberPhase }`）。再加上新开一轮对话是否出现 12 个 `scout_*` 工具、`/scout status <caseId>` 是否命中且输出末尾带 `· dsh-scout <version>`。CLI 的 `--dump-config` 只证明「组合进去了」，**不等于**运行时挂上了——不匹配时插件行被置为 disabled，且**这一行只对 CLI 用户可见**（stderr 打 `dsh: disabling profile plugin <row>: <reason>`）。桌面 App 没有可见 stderr、没有运行日志（实测 Electron 主进程的 fd0/fd1/fd2 指向 `/dev/null`，日志目录为空），插件被 disabled 时它自己不可能输出任何东西——但**答案就在 GUI 里**：启动时被禁用的行会被投影成插件列表里的「已停用」（宿主侧 `enabled: !entry.disabled`，`dsh-host-plugin-inventory/lib/index.js:131`），所以插件列表是桌面唯一的排障入口。
- **版本豁免（桌面手动路径）**：桌面用户用不了 `allow-version`，需要在 `~/.dsh/profiles/desktop/compatibility.json` 手写豁免——平铺 JSON：精确 `package@version` → 允许的精确 DSH 版本数组，例如 `{ "dsh-scout@0.9.3": ["0.2.0-rc.2"] }`。与工具 / CLI 写入的是同一组边界：只接受精确版本、只授权「这一个包版本 + 这一个 DSH 版本」这一对、不随升级继承、不授权依赖安装脚本、下一次组合生效；手写绕过 `acceptRisk` 风险确认，写法不合规的记录会被忽略并告警（不会让 profile 不可用）。
- **验收**：桌面路径由发版前手工 checklist 覆盖（`docs/install-verification.md`：Lane D 桌面 App / Lane C CLI，含两条 lane 的差异与触发时机，仓库文档、不在 npm 包内）；CLI 自动化仍是 `npm run test:profile` 的六步链与 `npm run check:release` 的四版本矩阵。

## 6. 明确非目标

- 不重做通用搜索、浏览器或 MCP provider。
- 不自动发送求职邮件、提交申请或联系第三方。
- 不把公司融资、估值、专利数量或招聘规模直接转化为成功判断。
- 不把个人简历、身份信息或求职意图默认发送给第三方服务。
- 不提供法律、投资或医疗结论。
- 不在首版实现完整 Web UI、实时数据库或公司评分排行榜。
- client 面板与 `ctx.storageDomain` 持久化重写排在 **0.10.0**（见 §5.2）：后者要引入 domain schema、生命周期与迁移策略，并改变现在的 owner 语义（按 `SessionId` 分桶）。在它们落地之前，跨会话持久化仍由五文件导出 / 导入承担。

## 7. 首个验收案例

使用 `docs/fixtures/dsh-scout/snapmaker-hr-head.json` 作为离线 fixture，验证：

1. 公司主体存在未确认时，case 不能直接进入 `PROCEED`。
2. 用户历史材料可以作为 `E1/reported`，不能冒充当前独立事实。
3. 至少一个 claim 能从 `needs_verification` 转为 `verified`，并保留来源变化。
4. 报告能生成面试问题，而不是只输出摘要。
5. 没有来源的高影响结论必须显示为未知或待核验。

## 8. 成功标准

首个 MVP 通过的条件：

- 一个真实 case 可以从输入运行到报告导出。
- 每个高影响结论都能追溯到 claim 和 source。
- 同一 fixture 在无网络模式下可重放并得到结构稳定的结果。
- 失败时输出缺失证据和下一步动作，而不是编造补全。
- 插件可以加载、卸载、重载，不遗留 watcher、任务或连接。
