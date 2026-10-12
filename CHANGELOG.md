# Changelog

本文件记录 `dsh-scout` 的显著变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

本文件从 0.9.1 开始记录；0.9.0 及更早版本的变更见仓库的 git tag。

## [0.9.1] - 2026-10-12

0.9.1 是本地迭代版本（不发 npm、不推远端、不打 tag）。主题不是加功能，而是把 0.9.0 已经写好的能力接到 DSH 正确的接缝上：**插件在真实 DSH 里要表现正确、便宜、可解释**。

### Added

- **`/scout` 命令**：注册 `ctx.commands.register({ name: 'scout', … })`，提供 `status` / `questions` / `report` / `export` 四个子动作（用法：`/scout status <caseId> | /scout questions <caseId> | /scout report <caseId> | /scout export <caseId> [targetDir]`）；宿主在处理前后自动落 `command/run` + `command/done` 事件（这两个名字都在宿主已知事件词表内，因此会话可重建）。
- **`scout` Skill**：由插件直接注册（`ctx.skills.register`，不需要落文件、不需要 client bundle），内含标准尽调工作流（start → search/ingest → claim → verify_identity → report → questions）与四条证据纪律。插件卸载时条目随 disposer 消失。
- **`language: 'zh-CN' | 'en'` 配置**（默认 `zh-CN`）：控制报告、面试问题、对比报告，以及 `scout_ingest` 采集草稿自动写入的说明文字（`confidenceNote` / `nextAction`）的语言；默认值对既有用户零变化。
- **报告新增 `## Coverage` 调查覆盖度区块**：对全部 11 个调查维度给出「已核验 / 待核验 / 未调查」计数，并单列未调查维度；`scout_questions` 会优先为未调查维度生成问题。
- **导出完成标记 `export.complete.json`**：内容形如 `{ schemaVersion, caseId, complete, files, eventCount }`；写入时**先置 `complete: false`，五个数据文件全部落盘后再改写为 `complete: true`**——所以陈旧标记不会为半份导出宣称完整（覆盖写场景下，上一次成功导出的标记会在新文件写入前先被降级）。
- **惰性回填**：缓存未命中时，若 `<scoutDir>/<caseId>/` 存在五文件导出，则读回案例并追加 `case_rehydrated` 事件；错误信息会提示可用的 caseId / 建议 `scout_import`。
- **分发契约字段**：`engines.dsh`（`>=0.1.0-rc.6 <0.3.0-0`）、`dsh.manifestVersion: 1`、`locale/en.json` + `locale/zh.json`（已写进 `exports`，否则会被 ESM resolver 静默忽略）、包内 `icon`。
- **本 CHANGELOG**。

### Changed

- **工具输出契约**：变更类工具（8 个，含 `scout_import`）不再回吐整份 case JSON。每次调用返回结构化对象 `value`（决策、计数、本次增量、下一步，以及变更类工具在 `autoPersist` 路径真正尝试过落盘时的 `persist`）加上 **< 1KB 的紧凑 `render`**；全量数据仍由 `scout_report`（Markdown 报告）与 `scout_export`（五文件）提供。`scout_export` 不带 `persist` 键，用顶层 `persisted` / `complete` / `error` 表达落盘结果。工具名与语义不变。
- **`scout_export` 返回解析后的绝对路径**（`targetDir`）：此前返回的是相对字符串，用户无从知道文件写到了哪。
- **重复 URL 不再产生重复来源**：`scout_ingest` / `scout_search` 按规范化 URL 复用已登记来源，避免同一 URL 搜两次就稀释报告里的「关键证据」配额。

### Fixed

- **`autoPersist` 失败不再静默**：返回值带 `persist.persisted = false` + `persist.error`，模型与用户能直接看到这次没有落盘；落盘失败时**不产生** `case_exported` 事件，磁盘上的 `events.jsonl` 不会声称一次并未完成的导出。
- **导出顺序统一为「先记事件、后写文件」**：`scout_export` 此前先写文件后记事件，导致磁盘上的 `events.jsonl` 永远不含本次导出的事件，与 `autoPersist` 路径产出不同的事件流；现在两条路径一致，「导出 → 导入 → 再导出」的事件序列稳定。
- **`fs` / `web` 改为调用时解析**：不再在 `apply()` 时用 `ctx.get()` 快照服务。此前能工作只是因为真实 profile 里 `dsh-scout` 恰好排在 `fs` / `web` 之后；行序变化、只装部分 bundle、会话级服务覆盖时，服务其实存在而插件会一直报 "service unavailable"。
- **写盘转发 `exec.signal`**：`scout_export` 的写盘可被取消。
- **`scout_import` 如实报告导出完整性**：它读完成标记的 `complete` **字段**（不是「标记文件是否存在」）。没有标记的旧导出、或标记为 `complete: false` 的导出，只要五个数据文件都已落盘仍可导入，但返回 `complete: false`，由调用方决定是否信任该快照（五个数据文件缺任何一个，例如在写 `claims.json` 时中断的全新导出，仍是硬失败）。
- **导出路径以会话 cwd 为基准**：`scoutDir` 的相对路径不再落到 DSH 进程的当前目录。

### Note

- **四版本真实矩阵已跑通**：0.9.1 候选 tarball 在 `0.1.0-rc.6` / `0.1.2-rc.1` / `0.2.0-rc.2` / `0.2.1-alpha.2` 四个**精确版本**上通过安装、冷启动、工具挂载、真实工具调用门禁（含 `signal` 字段与 `output.schema` 校验）与卸载；四个 binary 均从 npm 真实取用（非本机 DSH），`npm run check:release` 实测输出 `dsh-scout release gate: PASS (4 DSH versions, >=0.1.0-rc.6 <0.3.0-0)`。超出声明范围（如 `0.3.0-alpha.1`）仍按预期不满足。
- **核对版本范围请带 `includePrerelease`**：`engines.dsh` / peer 的 `>=0.1.0-rc.6 <0.3.0-0` 在**默认 semver 语义**下会被判为**不满足** `0.1.2-rc.1`、`0.2.0-rc.2`、`0.2.1-alpha.2`——这是 node-semver 的预发布规则：预发布版本只被「同 major.minor.patch 元组且带预发布」的比较器接受。DSH 的检查带 `{ includePrerelease: true }`（`dsh-app-boot/lib/index.js:300`），在该标志下四个实测版本全部满足，`0.3.0-alpha.1` 正确不满足。semver 7.8.5 实测：`0.1.0-rc.6` plain=true / incl=true；`0.1.2-rc.1`、`0.2.0-rc.2`、`0.2.1-alpha.2` plain=false / incl=true；`0.3.0-alpha.1` plain=false / incl=false。**以 DSH 的判定为准。**

### Not in this release（本轮明确不做）

诚实列出边界，避免把「没做」读成「已支持」：

- **client 面板**（case 看板 / 浮层卡片）：要注册 client 的 `tool.call.toolview` / `shell.overlay` slot，需要 `dsh.client` + client bundle + 双 tsc program + HMR 验证——这是一个完整 feature release 的工作量，不是 patch。
- **自造 session event**（把 case 状态写进会话日志）：在 DSH 0.2.0-rc.2 上走不通，是红线。`Session.append()` 无法写入 `ignorable`，而持久化读路径拒绝任何不在 `KNOWN_SESSION_EVENT_TYPES` 内且非 ignorable 的事件类型，自造事件会导致**插件自己写的会话在重启 / 恢复时无法重建**。详见[产品契约 §5.1](docs/dsh-scout-product-contract.md)。
- **`ctx.storageDomain` 持久化重写**：这是 DSH 原生的正确接缝，但要引入 domain schema、生命周期与迁移策略，并改变现在的 owner 语义（按 `SessionId` 分桶）。0.9.1 先用「文件惰性回填」解决大部分痛感，重写排到 0.10.0。
- **评分 / 排名 / 批量对比扩展**：产品契约 §6 非目标，保持边界。
- **`@deepseek-ai/schemastery` 版本对齐**（`^3.18.2` → 宿主系列的 `~3.18.4`）：本轮明确不做。
- **`presentationMeta` 载荷**：没有 client 消费者时没有可见收益，与 client 面板一起在 0.10.0 落地。
- **npm 发布 / git tag**：本轮只做本地交付。
