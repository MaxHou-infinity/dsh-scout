# dsh-scout 安装验收 checklist

状态：0.9.3 新增（评审 §5.6）。
用途：每次**发版前手工跑一次**，覆盖自动化门禁结构上覆盖不到的那条 lane——桌面 App 的 `desktop` profile 由 Electron 应用独占，CLI 无法管理它。

两条 lane 的分工：

| Lane | 入口 | 载体 | 触发时机 |
|---|---|---|---|
| **Lane D** | 桌面 App（侧边栏插件页 / 设置 → 内置插件 → 插件列表 / `plugin_manager` 工具） | 本文档的手工 checklist | 每次发版前一次；桌面 DSH 运行时升级后一次 |
| **Lane C** | CLI（`npm run test:profile`） | `scripts/profile-smoke.mjs`（自动化） | 每次 `npm test` / CI / `npm run check:release` |

每一步都写「动作」+「判据」；判据只引用**可观察现象或命令**，不写"看起来正常"这类无法复核的表述。

## 0. 记录表（每次跑完填）

| 字段 | 本次记录 |
|---|---|
| 日期 | |
| 桌面 App / `desktopVersion`（D1） | |
| node / pnpm（D1） | |
| 安装的 `dsh-scout` 版本 | |
| 是否走了版本豁免（D2b） | |
| 结论（GO / NO-GO）与异常 | |

参考实现：`docs/dsh-scout-install-ux-review.md` §6 的实测记录（2026-10-13，`dsh-scout@0.9.2`，桌面运行时 `0.2.0-rc.2`，node 24.21.0 + pnpm 11.7.0，插件总数 198 → 199）。下面的步骤是它的可重复版本；`plugin_manager` 的操作名取自 DSH 插件管理器文档，App 版本不同可能改名，**判据以可观察结果为准**。

> **证据等级声明（如实标注，别夸大）**：本文档里 GUI 两页的**界面名称、分组与状态词**来自源码取证（`dsh-client-ui-plugin-manager`、`dsh-client-ui-settings-plugins`、`dsh-client-ui-settings-plugin-inventory`、`dsh-host-plugin-inventory` 的 locale 词典与 wire 类型）+ profile 组合实测；**GUI 本身没有做过活体验证**（没有 GUI 自动化，没有任何人实际点开这两页核对过渲染结果）。因此凡以这两页界面为判据或入口的步骤都带 **｜待人工点一次确认** 标记（D3 / D4 / D6）——第一次跑这条 lane 的人**同时是在验证 checklist 本身**；发现界面文案与本文档不符时，以实际界面为准并回来订正本文档。

## Lane D：桌面 App

### D1. 确认运行时版本

**动作**：在 App 里执行 `plugin_manager` 的 `list_version_exemptions`（它同时返回当前运行时版本与已有豁免），或打开**侧边栏 → 插件页**里某个插件的详情页看 `v{version}` 标签（设置里的插件列表**不显示版本号**）。再交叉核对 `~/.dsh/dsh-runtimes/*/runtime.json`。

**判据**：

- 拿到一个**精确**的 DSH 运行时版本（评审与 2026-10-13 本机实测均为 `0.2.0-rc.2`），填入记录表；
- `runtime.json` 的 `desktopVersion` 与上一步一致；同时记录 `node` / `pnpm`（实测 `24.21.0` / `11.7.0`，用于确认"桌面 App 自带运行时、无需安装 Node"这条文档表述仍然成立）；
- 两者不一致 → **停**：后面所有兼容性判定都依赖这个精确版本。

### D2. 确认兼容性

**动作**：读 `dsh-scout@<version>` 的 `peerDependencies`（本版本只有一条 DSH peer：`@deepseek-ai/dsh-tools: ">=0.1.0-rc.6 <0.3.0-0"`），对照 D1 的精确版本。

**判据**：

- 该范围在 **`includePrerelease: true`** 语义下满足 D1 的版本（示例：`0.2.0-rc.2` 满足）。注意默认 semver 语义会把它判成不满足——**以 DSH 的判定为准**（DSH 用 `evaluatePluginCompatibility()`，带 `includePrerelease: true`）；
- 满足 → 进入 D3；
- 不满足：先区分「声明范围过期」（DSH 升到了范围之外，插件其实还能跑）与「真实回归」（范围内却失败）。前者走 D2b 或换用声明兼容的插件版本；后者**停**，不要安装。

### D2b.（仅当 D2 不满足）精确版本豁免

**动作**：`plugin_manager` 的 `set_version_exemption`（`target: dsh-scout@<version>`、`runtimeVersion: <D1 的精确版本>`、`enabled: true`、`acceptRisk: true`），或手写 profile 目录下的 `compatibility.json`。

**判据**：

- 豁免写进 `~/.dsh/profiles/desktop/compatibility.json`（与 `package.json`、`cordis.patch.yml` 并列），形如 `{ "dsh-scout@0.9.3": ["0.2.0-rc.2"] }`——平铺 JSON：精确 `package@version` → 允许的精确 DSH 版本数组；
- 只有「这一个包版本 + 这一个 DSH 版本」这一对被授权：不随插件或 DSH 升级继承；**不授权**依赖的安装脚本；生效时机是下一次组合；
- 手写文件**绕过**工具/CLI 的 `acceptRisk` 风险确认：不兼容的插件可能崩溃或损坏数据。写法不合规的记录会被读取方忽略并给出告警（不会让 profile 不可用）；
- 授予豁免前 `list_version_exemptions` 里应看不到这对组合；授予后能查到。写完复跑 D3。

### D3. App 内安装

**动作**：在**侧边栏 → 插件页**（安装、启用、停用、移除都在这一页；版本要在插件详情页里看）安装，spec 写**精确版本** `dsh-scout@0.9.3`（等价操作：`plugin_manager` 的 `install_bundle`，`target` 为该 spec）。不要用裸包名。｜待人工点一次确认（安装入口所在页面）

**判据**：

- 操作成功，无兼容性拒绝。拒绝的形态是 `incompatible-version` 错误，附每个被拒包的 `name` / `version` / `runtimeVersion` / 未满足的 `peers`；registry spec 会在 pnpm 运行前失败（什么都没下载、没有构建脚本执行），git / tarball spec 在抓取后判定；
- pnpm 输出里出现最小发布年龄的豁免记录（`Added 1 entry to minimumReleaseAgeExclude`）——说明 pnpm 放行了这个刚发布的版本；
- **待决定的依赖构建脚本为空**：本包不跑安装脚本（registry 安装实测 `pendingBuilds: []`）；
- profile 清单已更新：`~/.dsh/profiles/desktop/package.json` 的 `dependencies` 出现 `"dsh-scout": "0.9.3"`，`dsh.profile.bundles` 出现 `dsh-scout`；
- 失败时**回滚**判据：`package.json` 与 `pnpm-lock.yaml` 回到安装前的内容（与安装前备份/`git diff` 比对一致），没有半装状态。

### D4. 生效验证（不是"装上了"，是"挂上了"）

**动作**：先看**侧边栏 → 插件页**（回答"装的是哪一版"），再看**设置 → 内置插件 → 插件列表**（回答"装没装、为什么没生效"）；如果 App 有诊断视图，最后看 bundle 与 loader 行。

**判据**（两个 GUI 面回答两个不同的问题，不要混用）：

- **面 1 · 侧边栏 → 插件页**：`dsh-scout` 出现在「已安装」里；**打开它的详情页**，标题旁带 `v0.9.3` 标签（`BundleInfo.version`）——**版本号只在这一页**，列表卡片上只有「实验性 / 异常」状态标签。｜待人工点一次确认
- **面 2 · 设置 → 内置插件 → 插件列表**：`dsh-scout` 行显示 **已启用**（不是 **已停用** / **启动失败** / **条件启用**），运行状态 **运行中**（不是 **启动失败** / **等待依赖** / **未运行**）。这一页按「会话插件 / 全局插件」分组，两组都要看；**它不显示版本号**（wire 行只有 `entryId` / `moduleName` / `meta` / `enabled` / `fiberPhase`），而且**是只读检查面**——启用 / 停用 / 移除都在侧边栏插件页做。｜待人工点一次确认
- 关键依据（为什么可以放心让用户看 GUI）：启动时被禁用的插件行——peer 版本不匹配是其中一种——会被投影到这一页的「已停用」，宿主侧就是 `enabled: !entry.disabled`（`dsh-host-plugin-inventory/lib/index.js:131`）。丢进 `/dev/null` 的那行 stderr，答案在 GUI 里。
- bundle 清单里 `dsh-scout` 为 installed + enabled，rowId 为 `dsh-scout`（评审实测）；
- loader 行 `include:dsh-scout` 的 fiber phase 为 active（评审实测字段名 `fiberPhase`）；
- **插件总数 +1**：记录安装前后的两个数字（评审实测 198 → 199）；
- 面 2 里看不到 `dsh-scout` 行 → 回到 D3 的 profile 清单核对；显示「已停用」/「启动失败」→ 走 D7。

### D5. 功能验证（不重启，当前会话）

**动作与判据**（每条都要看到现象）：

1. 新开一轮对话 → 工具列表出现 **12 个 `scout_*` 工具**（名字见 README「工具清单（12 个）」：`scout_start` / `scout_add_source` / `scout_ingest` / `scout_search` / `scout_add_claim` / `scout_verify_identity` / `scout_verify_claim` / `scout_report` / `scout_questions` / `scout_compare` / `scout_export` / `scout_import`）；
2. 真实调用 `scout_start`（例：`caseId=dsh-scout-install-check`）→ 返回结构化 `value`，含 `caseId` 回显，且不是错误结果；
3. 真实调用 `scout_report` → 返回 Markdown 报告（含决策与 `## Coverage` 覆盖度区块）；
4. `scout` Skill 出现在技能目录且可加载；
5. `/scout status <caseId>` 命中（命令已注册），且输出里能看到插件版本——用于确认运行时真正加载的是哪个版本（桌面看不到 stderr / 日志，这是唯一的版本自证面）。

### D6. 收尾与回滚

**判据**：

- `~/.dsh/profiles/desktop/package.json`、`cordis.patch.yml`、`pnpm-lock.yaml` 均已更新（内容或 mtime 相对安装前变化）；
- 若在 profile 的 `cordis.patch.yml` 里给 `id: dsh-scout` 配了绝对 `scoutDir`：`scout_export` 返回的 `targetDir` 落在该目录下（证明 profile patch 真的生效）；
- **回滚**：在**侧边栏 → 插件页**移除 `dsh-scout`（服务方法 `removeBundle`）→ 新开一轮对话时 12 个 `scout_*` 工具全部消失，profile 清单不再含 `dsh-scout`，无 registry 残留。｜待人工点一次确认（移除入口所在页面）

### D7. 失败形态对照（静默，不是报错）

- 症状：插件"装上了"，但工具不出现、`/scout` 不命中；
- **桌面 App 没有可看的输出**：实测 Electron 主进程的 fd0/fd1/fd2 全部指向 `/dev/null`（host 进程的 fd1/fd2 是通向主进程的管道，主进程再 pipe 到 `/dev/null`），`~/Library/Logs/DeepSeek Harness/` 为空目录、全盘没有 DSH 运行日志；`ctx.logger()` 也没有落盘出口（cordis 只有内存 ring buffer exporter，其 `startupLogs` 只在 `StartupError` 分支被挂上）。**插件被 disabled 时它自己不可能输出任何东西**；
- 因此**桌面排障入口只有一个：设置 → 内置插件 → 插件列表**（它是**唯一**能看到禁用原因的面）。判据：`dsh-scout` 行显示 **已停用** / **启动失败** → 插件被宿主拒绝加载（peer 不匹配导致的 `row.disabled` 正是投影成「已停用」，宿主侧 `enabled: !entry.disabled`）；显示 **已启用 + 运行中** 但工具不出现 → 回到 D5 的工具注入判据（先确认是否在新会话里看）。**版本号不在这一页**，要确认装的是哪一版，回到**侧边栏 → 插件页**打开该插件的详情页看 `v{version}`；
- **CLI 用户**才保留 stderr 那句：`dsh: disabling profile plugin <row>: <reason>`（恰好一行，不是显眼的红色报错）；
- 定位顺序：兼容性三层（声明 / 生效 / 不校验）→ 豁免（D2b）→ 回滚（D6）；
- 桌面用户**不能**用 CLI 排查：`dsh plugin --profile desktop` 的 `list` / `add` / `allow-version` **全部**被拒绝，报 `error: profile "desktop" is managed exclusively by the Electron application`（CLI 参数解析层按 profile 名的硬编码拒绝，不是权限或配置问题）。

## Lane C：CLI（自动化门禁）

**命令**：`npm run test:profile`（= `node scripts/profile-smoke.mjs`）。`npm run check:release` 的顺序是：README 版本引用守卫（毫秒级，两份 README 的安装 / 制品引用必须等于 `package.json` 的 version）→ `npm test` → 在四个精确 DSH 版本（`0.1.0-rc.6` / `0.1.2-rc.1` / `0.2.0-rc.2` / `0.2.1-alpha.2`）上各跑一遍 `test:profile` → `pnpm pack --dry-run`。

六步链（0.9.2 扩展，0.9.3 未改动 `scripts/profile-smoke.mjs`），每步的判据就是脚本断言的证据：

1. **注册 + 创建**：`--dump-config` 出现 `# == dsh-scout` 层；12 个工具已挂载；真实调用 `scout_start` / `scout_add_source` / `scout_add_claim` 均 `isError === false`，`scout_start` 的 `value` 是对象且回显 caseId，render 预算内；
2. **导出**：`scout_export`（绝对 `targetDir`）→ `persisted === true`、`complete === true`，磁盘上 6 个文件，`export.complete.json` 为 `complete: true`；
3. **冷重启**：同一 `DSH_HOME` / profile 起第二个进程，pid 与第一个不同；
4. **惰性回填**：第二个进程里不做 `scout_import`，`scout_report` 仍返回导出的案例，决策一致，后续导出的 `events.jsonl` 含指向 `<scoutDir>/<caseId>` 的 `case_rehydrated`；
5. **跨语言导入**：`language: en` 的第二个 profile 导入 zh 导出 → `complete === true`，render 与 `report.md` 的 CJK = 0（zh 报告作非空对照），`case.json.language = en`，ASCII 用户自撰内容逐字保留；
6. **卸载**：`dsh plugin --profile <profile> remove dsh-scout` 后组合里没有 dsh-scout 层，真实启动报告 12 个工具全部缺失——无残留。

负向对照（保证绿不是空的）：`output.schema` 敏感性（注册一个声明对象 schema 却返回字符串的工具，必须得到 `ToolOutputError` / `INVALID_TOOL_OUTPUT`）、完成标记缺失、完成标记 `complete:false`。

**PASS 判据**：输出 `dsh-scout profile smoke: PASS (dsh-scout <version>, dsh <DSH_VERSION>)`，随后 `verified:` 前缀行逐项列出证据；任何 skip 都会**在同一行**报为覆盖降级（`DSH_SCOUT_SMOKE_SKIP_CROSS_LANGUAGE` / `DSH_SCOUT_SMOKE_SKIP_REHYDRATION_CONTROL` / `DSH_SCOUT_SMOKE_SKIP_NEGATIVE_CONTROL`）。

**环境**：默认 `DSH_VERSION=0.2.0-rc.2`；隔离临时 `DSH_HOME`（`mkdtemp`，`finally` 删除）；全程只用绝对 `scoutDir` / `targetDir`；全量约 16 秒（M 系列 Mac、pnpm store 已热）。

**它明确覆盖不到的**（脚本头部逐条写明）：真实 LLM / agent loop 与 approval 策略、相对路径（`agent` 未设置时 `cwd` 为 `undefined`）、`autoPersist`、真实进程中断（撕裂导出靠改写标记复现）、其余 6 个工具仅断言注册、`report.md` / `case.json` 只做结构断言（没有 golden 文件）。

### Lane C 与 Lane D 的差异

| 维度 | Lane C（CLI 自动化） | Lane D（桌面 App 手工） |
|---|---|---|
| profile | 临时自建 profile（`mkdtemp` 下） | `desktop`（Electron 独占） |
| 安装 spec | 打包 tarball（`pnpm pack` 产物） | registry 精确版本 `dsh-scout@0.9.3` |
| 调用方式 | 脚本里的 `ctx.tools.execute()` | 真实 App 会话 |
| 工具覆盖 | 6 个真调用，其余 6 个仅断言注册 | 12 个工具全部注入当前会话并可见 |
| `/scout` 与 Skill | 未覆盖 | 命中 / 可加载 |
| LLM 与 approval | 不经过 | 经过（人判断） |
| 耗时 / 可重复性 | 约 16 秒，全自动 | 手工，无固定耗时 |
| 运行频率 | 每次 `npm test` / CI / 发版 | 发版前一次 |

## 为什么 Lane D 必须手工

- `desktop` profile 被 Electron 应用独占：CLI 在**参数解析层**按 profile 名拒绝 `dsh plugin --profile desktop <任何子命令>`（`add` / `list` / `allow-version` 全部命中同一条判断）。因此现有自动化门禁（CLI + 隔离 profile + tarball）**结构上无法**指向它——这不是"还没写脚本"，而是没有可脚本化的入口；
- App 的插件管理器是 App 内的页面 / 会话内工具（`plugin_manager`），挂不进 CI；
- 这正是 0.9.2 及以前文档缺口的来源：门禁全绿，桌面用户第一步仍然撞墙（README 的三条"已验证路径"对桌面用户全部不可用）。

## 触发时机

- **每次发版前**手工跑一遍 Lane D 全链（D1 → D6 至少各一次，最好带一次 D2b 的豁免演练与一次 D7 的失败对照）；
- **桌面 DSH 运行时升级后**（`desktopVersion` 变化）补跑 D1–D5——这是兼容矩阵新增一个精确版本的信号，Lane C 的四版本矩阵不会自动覆盖桌面运行时；
- Lane C 自动化：`npm test`（每次改动）、`npm run test:profile`（改动宿主接缝时）、`npm run check:release`（发版前，含四版本矩阵与打包检查）。
