# Changelog

本文件记录 `dsh-scout` 的显著变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

本文件从 0.9.1 开始记录；0.9.0 及更早版本的变更见仓库的 git tag。

## [0.9.3] - 2026-10-13

**待发布**：本条目描述冻结为 0.9.3 的工作树；npm 元数据（tarball / shasum / integrity / provenance / git tag）在发布后补记。

0.9.3 的主题是**安装体验**，不加功能、不改运行时契约。缘起是一份在真实桌面 App 上完整走完安装的评审：README 的「三条已验证路径」对桌面 App 用户**全部不可用**——桌面版的 `desktop` profile 被 Electron 应用独占，CLI 对它的所有 `dsh plugin` 子命令都按 profile 名硬拒绝（`error: profile "desktop" is managed exclusively by the Electron application`，连兼容性逃生门 `allow-version` 一起拒绝），而桌面 App 恰恰是这类插件最主流的入口。本版把「App 内安装」补成主路径，并给安装补上可执行的判据。

### Added

- **README 新增「路径 0：桌面 App」**（README.md / README.en.md 逐段同步）：说明 `desktop` profile 的独占拒绝与「这是按 profile 名的硬拒绝、所有 `dsh plugin` 子命令都会命中」，给出**侧边栏 → 插件页**里的安装串 `dsh-scout@0.9.3`，并写明装完无需重启——实测 12 个 `scout_*` 工具即时注入当前会话。
- **README 新增「装上了吗（成功判据）」**：桌面**四条**判据，且**区分两个 GUI 面**——**侧边栏 → 插件页**的「已安装」里找到 `dsh-scout`、打开**详情页**看 `v0.9.3`（版本号只在这一页）→ **设置 → 内置插件 → 插件列表**看该行**已启用 + 运行中**（不是**已停用**/**启动失败**/**条件启用**；这一页不显示版本号）→ 新开一轮对话出现 12 个 `scout_*` 工具 → `/scout status <caseId>` 命中且输出末尾带 `· dsh-scout 0.9.3`；CLI 用 `dsh --profile <your-profile> --dump-config | grep -A2 'dsh-scout'`，并点明「组合进去 ≠ 运行时挂上了」，最可靠的判据始终是那 12 个工具与 `/scout`。
- **README 新增「卸载与升级」**：CLI 的 `add dsh-scout@<new-version>` / `remove dsh-scout` 与桌面 App 的**侧边栏 → 插件页**两条写法，并说明安装失败会回滚 profile 清单与 lockfile。
- **README 补 `compatibility.json` 手动豁免路径**（评审 P2-3）：桌面用户拿不到 `allow-version`，文档给出 profile 目录下该文件的平铺 JSON 写法（精确 `package@version` → 精确 DSH 版本数组，示例 `{"dsh-scout@0.9.3": ["0.2.0-rc.2"]}`），并复述同一组边界、`--accept-risk` 风险确认与「写法不合规的记录被忽略并告警」的读取行为。
- **门禁守护 README 的版本引用**（评审 P2-4）：README / README.en.md 里**活的**版本引用——`dsh-scout-<version>.tgz`、安装命令里的 `dsh-scout@<version>` 操作数、`compatibility.json` 的 `"dsh-scout@<version>"` 键、git ref `#v<version>`——必须等于 `package.json` 的 version。守卫同时落在 `tests/package.test.mjs`（每次 `npm test`、CI，毫秒级）与 `scripts/check-release.mjs` 最前面（独立第二实现，README 过期时不必先跑完整套单测与约两分钟的四版本矩阵）。历史提及（实测矩阵、路线图、发布叙述）按设计不在守卫范围。

### Changed

- **安装章节上移到「快速上手」之后**，三条 CLI 路径降级为「CLI / 自建 profile 用户适用」；`scout-demo` 这类**虚构** profile 名改为显式占位符 `<your-profile>`，附「怎么知道我的 profile 名」（没有 `dsh profile list` 子命令，直接 `ls ~/.dsh/profiles`）与「照抄示例名不会报错、只会把插件静默装进另一个 profile」的陷阱说明。
- **git 安装路径保留但降级**到「其他安装方式与取舍」表，标注**不推荐**：仓库不含 `dist/`，`prepare` 会跑 `tsc` 并安装 devDependencies，是三条路径里唯一会执行代码的；只保留「需要未发布提交时」的理由。示例 ref 由不可执行的 `#<commit>` 改为**真实 tag**（`github:MaxHou-infinity/dsh-scout#v0.9.3`；仓库自 `v0.3.0` 起共 10 个 tag，`v0.9.1` 是本地迭代版、未打 tag——评审「git tag 为空」的判断与事实不符）。
- **主安装命令显式锁版本**（`dsh-scout@0.9.3`，不再是裸包名）：pnpm ≥ 11 的最小发布年龄（minimum release age）保护会让刚发布的版本被静默跳过、回退到旧版；该说明从「注意事项」降为路径 0 下的一句注解，现象 / 原因 / `minimumReleaseAgeExclude` 特征全部保留。
- **Node 要求的适用范围**：「Node ≥ 22.19」只对 CLI / 门禁路径成立；桌面 App 自带 node / pnpm 运行时（实测 node 24.21.0 + pnpm 11.7.0），无需安装 Node。
- **桌面场景建议绝对 `scoutDir`**：默认 `./dsh-scout` 依赖 cwd，桌面会话的 cwd 语义与 CLI 不同；文档建议在 `~/.dsh/profiles/desktop/cordis.patch.yml` 里给 `id: dsh-scout` 配绝对路径，并提示该文件由 App 维护、手改前先退出 App。
- **`/scout status <caseId>` 的输出尾部新增 `· dsh-scout 0.9.3`**：纯追加，原有前缀逐字节不变，`status` 之外的子动作不受影响。这是 0.9.3 唯一的**用户可见输出变化**，用途是让桌面用户自证「运行时真正加载的是哪个版本」——桌面既看不到 stderr、也没有运行日志。版本号取自源码常量 `PLUGIN_VERSION`（`src/index.ts`），随发布手动 bump，不从 `package.json` 运行时读取。
- **加载横幅（评审 §5.3）不做，改为让状态在两个 GUI 面里可读**：取证显示桌面 App 的 stderr 不可见——Electron 主进程的 fd0/fd1/fd2 全部指向 `/dev/null`（host 进程的 fd1/fd2 是通向主进程的管道，主进程再 pipe 到 `/dev/null`），`~/Library/Logs/DeepSeek Harness/` 为空目录、全盘没有 DSH 运行日志，`ctx.logger()` 也没有落盘出口（cordis 只有内存 ring buffer exporter，其 `startupLogs` 只在 `StartupError` 分支挂上）——加一行加载横幅**没有用户看得到**。落点改为文档与验收 checklist 写清 GUI 里**两个各答一个问题**的面：① **侧边栏 → 插件页**（`dsh-client-ui-plugin-manager`）是**管理面**，回答安装 / 启用 / 移除与**装的是哪版**（**详情页**标题旁的 `v{version}`，来自 `BundleInfo.version`；列表卡片只有「实验性 / 异常」状态标签）；② **设置 → 内置插件 → 插件列表**（`dsh-client-ui-settings-plugin-inventory`）是**只读检查面**，回答**装没装 / 为什么没生效**——按「会话插件 / 全局插件」分组，用**已启用 / 已停用 / 启动失败 / 条件启用**标签与**运行中 / 启动失败 / 等待依赖 / 未运行**运行状态说话，**不显示版本号**（wire 行只有 `{ entryId, moduleName, meta?, enabled, fiberPhase }`）。关键依据：启动时被禁用的插件行（peer 版本不匹配是其中一种）已被投影到这一页的「已停用」——宿主侧就是 `enabled: !entry.disabled`（`dsh-host-plugin-inventory/lib/index.js:131`）——所以那行被丢进 `/dev/null` 的 stderr，答案早就在 GUI 里；**插件被 disabled 时它自己不可能输出任何东西**，这正是「没有任何报错」在桌面必须去 GUI 查的理由。

### Docs

- **新增 `docs/install-verification.md`**：把桌面 App 安装固化成可执行的手工验收 checklist（Lane D）——确认运行时版本 → 确认兼容性 → App 内安装 → 生效验证（**侧边栏 → 插件页**看「已安装 + `v0.9.3`」，**设置 → 内置插件 → 插件列表**看「已启用 + 运行中」，辅以 bundle installed+enabled / loader 行 fiber active / 插件总数变化）→ 功能验证（12 个 `scout_*` 工具即时注入、`scout_start` + `scout_report` 真实调用、`/scout status` 输出带版本）——并写明它与现有 CLI 门禁（Lane C：`npm run test:profile` 的六步链）的差异、自动化门禁为什么覆盖不到 Electron 独占 profile、每条 lane 的触发时机，以及一条**如实标注的残差**：GUI 两页只做过源码取证 + profile 组合实测，**没有 GUI 活体验证**，判据标为「待人工点一次确认」。仓库内文档，不在 npm 包内。
- **安装评审原件入库**：`docs/dsh-scout-install-ux-review.md`（桌面 App 上的完整实测记录），仓库内文档，不在 npm 包内。
- 产品契约的安装 / 分发段落与 README 的新安装模型对齐（桌面 App 为主路径），并把 `compatibility.json` 的手动豁免路径记进契约的兼容性段落。

### Known boundaries

- **桌面 App 的 `desktop` profile 只能由 App 管理**：CLI 对它的 `add` / `list` / `allow-version` 等所有子命令都按 profile 名拒绝。这是 DSH 参数解析层的硬编码判断（`rejectElectronProfile`），不是权限或配置问题；0.9.3 不改 DSH，只在文档里如实说明，并给出**侧边栏 → 插件页**安装与手动豁免两条替代路径。
- **README 版本守卫只覆盖「活的」引用**：历史版本串（实测矩阵里的 `dsh-scout@0.9.2`、路线图条目、发布叙述）按设计不参与断言，所以它防的是「忘改安装串」，不是「历史叙述过期」。

## [0.9.2] - 2026-10-13

**已发布**（2026-10-13）：npm `dsh-scout@0.9.2`（`dist-tags.latest` = `0.9.2`），tarball `https://registry.npmjs.org/dsh-scout/-/dsh-scout-0.9.2.tgz`（**23 个文件**），shasum `bedb4a656709d5d0e77d5f4b410e2173c0b8eb31`，integrity `sha512-UIJOP8KalLqiEBssFB3+sw+cP1+R78nNZzwA/Wg5gT1o/NLOBgWccURdgbqk4fNdJwGKYVyNvbRuy4RZYrusDw==`，带 **Sigstore provenance**（透明日志 `https://search.sigstore.dev/?logIndex=3244828180`），由 GitHub Actions 以 `npm publish --provenance --access public` 发布；git tag `v0.9.2`（annotated，指向 `64138a0`）与 GitHub Release `v0.9.2`（附件 `dsh-scout-0.9.2.tgz`，130,691 B）同批创建；发布 workflow run `38406696598` success（16m59s：四版本 release gate → `pnpm pack` → npm publish → GitHub Release）。发布前验收：`npm test` **118/118**、`test:profile` PASS（六步真实宿主链）、`pnpm pack --dry-run` 干净、`env -u DSH_BIN npm run check:release` **4/4 PASS**；独立验证 [verification-0.9.2.md](docs/verification-0.9.2.md)（仓库文档，不在 npm 包内）判定 **GO**，无新缺陷。

0.9.2 是 0.9.1 的收口版本：把 0.9.1 验证报告点名的最大盲区（**U11**）补成真实宿主门禁，清掉三轮独立验证留下的文档税，并关闭 0.9.1 的两个已知边界（**D10**、**O10**）。

### Added

- **真实宿主端到端门禁（关闭 U11）**：`scripts/profile-smoke.mjs` 从「单进程、两个工具调用」扩展为**六步场景链**，在最多六个真实宿主进程里依次跑：创建（`scout_start` + `scout_add_source` + `scout_add_claim`）→ 导出（绝对 `targetDir`、6 个文件、完成标记 `complete: true`）→ 冷重启（同一 `DSH_HOME`/profile 的第二个进程）→ 惰性回填（不 `scout_import`，断言决策不变并落 `case_rehydrated`）→ 跨语言导入（`en` profile 导入 zh 导出，报告与 `report.md` 的 CJK = 0）→ 卸载（无 registry 残留）。另加两条**完成标记负向对照**：删掉 `export.complete.json`、把标记改成 `complete: false`，两者都必须拒绝回填——证明第 4 步真的在读标记，而不是恰好命中别的东西。全量约 16 秒（M 系列 Mac、pnpm store 已热），可用 `DSH_SCOUT_SMOKE_SKIP_CROSS_LANGUAGE` / `DSH_SCOUT_SMOKE_SKIP_REHYDRATION_CONTROL` 走 PR 快速路径，跳过会在 PASS 行如实报为**覆盖降级**、不静默。**四版本矩阵在扩展后的门禁下 4/4 通过**（`0.1.0-rc.6` / `0.1.2-rc.1` / `0.2.0-rc.2` / `0.2.1-alpha.2`）；「已覆盖 / 仍未覆盖」两栏写在脚本头部注释里（仍未覆盖：真实 LLM / agent loop 与 approval 策略、相对路径、`autoPersist`、真实进程中断、其余 6 个工具仅断言注册）。

### Changed

- **精选面试问题改为按下标逐条对齐**（关闭 0.9.1 的「整组 all-or-nothing」边界，即 D10）：长度与出厂数组相同时，逐个下标比较——该下标仍是出厂默认的条目替换为本部署语言的同下标默认值，**用户改过的那条保持原样**；长度与出厂数组不同时，整组视为用户自撰、原样保留。判定依据是「是否等于该下标的出厂默认」，不是编辑历史：把某条改回出厂原文，那条会被对齐。**默认行为对未编辑场景零变化**——整组未被编辑时，对齐结果与 0.9.1 逐条相同；`zh-CN` 部署对既有 case 仍是 no-op（`case.json` 的 `decisionObjective` / `interviewQuestions` / `role.fitQuestion` 三个字段逐字段不变）。
- **`@deepseek-ai/schemastery` 由 `^3.18.2` 对齐到 `~3.18.4`**：宿主系列锁 `~3.18.4`，而 `^` 允许解析到 `3.19.x`，存在静默行为漂移；`Config` 的身份识别走全局符号，跨版本不会认错，这次只是把版本面收齐。`peerDependencies` 与 `engines.dsh` 范围**没有变化**。

### Fixed

- **render 整串上限改为由省略号长度推导**（原 O10）：0.9.1 的裁切预算是固定余量 `MAX_RENDER_BYTES - 8`（1016 B）——裁到 ≤1015 B 再追加 3 B 省略号，含省略号的**精确上界是 1018 B**（实测最坏 1018 B），距 1024 B 预算余 **6 B**；余量只剩 1 B（调用点写 `MAX_RENDER_BYTES - 1`）时上界变成 1025 B，就会越界。现在省略号自身的 UTF-8 长度先从预算里扣掉、再按码元裁切，整串（含省略号）**不超过 1024 B**；对抗性测试把 ASCII 输入推到整整 1024 B，并对 CJK 与 emoji（代理对、UTF-8 变长）断言不超过预算。

### Docs

- **`case.json.language` 的语义**：它是**本部署的渲染语言**，不是文件内容的语言；手工改写的外来文件不做自洽性校正。
- **`alignCaseDefaults` 的生效范围**：只在 `decide` 路径生效——重算决策的工具调用与缓存未命中时的惰性回填经过它（回填由**第一个访问该 case 的工具调用**触发，所以冷启动后即使只调 `scout_report` 也可能带上一次对齐），只创建案例的 `scout_start` 不经过；直接读磁盘 `case.json`、从不经过插件的第三方工具看不到对齐。
- **导出标记的两处细节**：`eventCount` 在导出中断时描述的是**失败的那次尝试**期望的事件数，与磁盘 `events.jsonl` 行数可能不同，读取方以 `complete` 为准；标记里的 `files` 只列 **5 个数据文件**，而 `scout_export` 返回值里的 `files` 是 **6 个名字**（五个数据文件 + 标记自身）——同名不同义，两者都正确。
- **新增门禁发现记录**：`docs/dsh-scout-0.9.2-gate-findings.md` 记录 F2 暴露的 G1（见下），并附最小复现脚本 `scripts/repro-decision-reason-drift.mjs`——两者都是仓库内文档 / 诊断件，**不在 npm 包内**，也不进测试套件。

### Known boundaries

- **G1 · 冷启动回填会重写决策理由的措辞（0.9.2 有意不修，推迟 0.10.0）**：对「`scout_start` 之后从未发生会重算决策的调用」就导出、冷启动（或 `scout_import`）的案例，回填路径会重跑决策，把 `decisionReason` 由初始文案 `defaults.initialDecisionReason` 换成 `decisionReasons.identity`，并补上 `decisionReasonCode`；**`decision`（`VERIFY`）不变**，证据账本 / 覆盖率 / 面试问题 / `caseId` 都不受影响。触发窗口比「一次写操作都没有」略大：会重算决策的是 `scout_add_claim` / `scout_ingest` / `scout_search` / `scout_verify_identity` / `scout_verify_claim` / `scout_import`；只登记来源的 `scout_add_source` 在同一进程内不重算决策，但冷启动后第一次访问该 case 的工具调用（含 `scout_report` / `scout_add_source`）会先走惰性回填 → `decide`，所以「创建后只登记过来源、然后导出并重启」的案例同样会看到措辞变化。0.9.2 不修的两个理由：正确修法会改动 0.9.0/0.9.1 冻结的全新案例首屏文案基线；且把「重启前后理由必须一致」写成断言会违反本项目「测试套件里断言缺陷存在的用例数为 0」的硬规矩。复现步骤、代码路径与 0.10.0 的候选修法见 [0.9.2 门禁发现](docs/dsh-scout-0.9.2-gate-findings.md)。

## [0.9.1] - 2026-10-12

0.9.1 是本地迭代版本（不发 npm、不推远端、不打 tag）。主题不是加功能，而是把 0.9.0 已经写好的能力接到 DSH 正确的接缝上：**插件在真实 DSH 里要表现正确、便宜、可解释**。

### Added

- **`/scout` 命令**：注册 `ctx.commands.register({ name: 'scout', … })`，提供 `status` / `questions` / `report` / `export` 四个子动作（用法：`/scout status <caseId> | /scout questions <caseId> | /scout report <caseId> | /scout export <caseId> [targetDir]`）；宿主在处理前后自动落 `command/run` + `command/done` 事件（这两个名字都在宿主已知事件词表内，因此会话可重建）。
- **`scout` Skill**：由插件直接注册（`ctx.skills.register`，不需要落文件、不需要 client bundle），内含标准尽调工作流（start → search/ingest → claim → verify_identity → report → questions）与四条证据纪律。插件卸载时条目随 disposer 消失。
- **`language: 'zh-CN' | 'en'` 配置**（默认 `zh-CN`）：控制报告、面试问题、对比报告，以及 `scout_ingest` 采集草稿自动写入的说明文字（`confidenceNote` / `nextAction`）的语言；它还会对齐案例自带、**仍是出厂默认**的文案，但判定粒度不同——`decisionObjective` / `role.fitQuestion` 是**逐字段**（该字段仍是出厂默认即对齐），精选面试问题在 0.9.1 是**整组 all-or-nothing**（整组逐项未被编辑才对齐；改过任意一条则整组保留创建语言，`en` 报告此时仍含约 79 个 CJK 字符），**0.9.2 起改为按下标逐条**：长度与出厂数组相同时逐条替换，用户改过的那条保持原样，长度不同则整组原样保留（见 `[0.9.2]`）。**用户编辑过的文案保持原样**；与案例自带语言相同时是 no-op，默认值对既有用户零变化。
- **报告新增 `## Coverage` 调查覆盖度区块**：对全部 11 个调查维度给出「已核验 / 待核验 / 未调查」计数，并单列未调查维度；`scout_questions` 会优先为未调查维度生成问题。
- **导出完成标记 `export.complete.json`**：内容形如 `{ schemaVersion, caseId, complete, files, eventCount }`；写入时**先置 `complete: false`，五个数据文件全部落盘后再改写为 `complete: true`**——所以陈旧标记不会为半份导出宣称完整（覆盖写场景下，上一次成功导出的标记会在新文件写入前先被降级）。**`eventCount` 只有在 `complete: true` 时才与 `events.jsonl` 的行数一致**；导出中断时它记录的是那次失败尝试期望的事件数，请以 `complete` 为准（读取方不要只比较 `eventCount`）。标记里的 `files` 只列**五个数据文件**，而 `scout_export` 返回值里的 `files` 是这次调用写出的**六个名字**（五个数据文件 + 标记自身）——同名不同义，两者都正确。
- **惰性回填仅限完整导出**：缓存未命中时，只有当 `<scoutDir>/<caseId>/` 的完成标记为 `complete: true` 时才读回案例并追加 `case_rehydrated` 事件；**0.9.0 的旧导出没有完成标记，不会被自动回填**，需用 `scout_import` 显式恢复；错误信息会提示可用的 caseId / 建议 `scout_import`。
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
- **`scout` Skill 补上必填的 `source`**：`SkillRegistration` 只把 `invocation` / `provider` 变成可选，`source` 仍是非可选字段，而注册表只为 `provider` 补默认值。此前注册**不会报错**（`validateRuntimeSkill` 不校验 `source`），模型侧技能目录也不受影响（只含 name/description），但 `ctx.skills.list()` 返回的 `SkillSummary` 违反其自身声明的非可选字段——`source` 读回 `undefined`。现注册为 `source: 'runtime'`；真实宿主实测由 `{"name":"scout","provider":"runtime"}` 变为 `{"name":"scout","source":"runtime","provider":"runtime"}`。
- **`@deepseek-ai/dsh-tools` 不再标为 optional peer**：它是构建产物 `dist/index.js` 里真实的运行时 `import`（`@deepseek-ai/cordis` 只有类型导入、会被擦除，故保持 optional）。这**不影响** DSH 的兼容门禁（`evaluatePluginCompatibility` 只读 `peerDependencies`，无视 `peerDependenciesMeta`），只是让安装期信号与真实依赖关系一致。

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

### Known boundaries

刻意保留的行为边界（不是待修缺陷，但读文档的人需要知道）：

- **精选面试问题整组对齐**（0.9.1 的边界；0.9.2 起改为**按下标逐条**对齐，见 `[0.9.2]` Changed）：0.9.1 采用 **all-or-nothing** 判定——整组逐项都仍是出厂默认时才对齐到部署语言；用户改过其中任意一条，整组保留创建语言（其余未编辑的条目也不会逐条转换），`en` 部署的报告此时仍含约 79 个 CJK 字符。这是当时有意保守（不猜用户意图）。
- **惰性回填只认完整导出**：只有完成标记 `complete: true` 的导出才会在缓存未命中时自动回填；0.9.0 的旧导出没有该标记，不会被自动恢复，需用 `scout_import` 显式导入。
- **`case.json.language` 是渲染语言、不是内容语言**：案例对齐只按这个标签判定，**不校验标签与内容是否自洽**；手工把 `language` 改成与内容不符的值再导入时，插件会按「语言相同」提前返回、不做校正。正常导出 / 导入 / 升级路径不受影响（0.9.0 旧导出的 `language` 恒为 `zh-CN`，与其内容一致）。
- **对齐只在 `decide` 路径生效**：它随决策重算运行（`scout_add_claim` / `scout_ingest` / `scout_search` / `scout_verify_identity` / `scout_verify_claim` / `scout_import`）与缓存未命中时的惰性回填运行（回填由第一个访问该 case 的工具调用触发，所以冷启动后即使只调 `scout_report` 也可能带上一次对齐），对齐结果随之落到内存 case 与之后的导出；只创建案例的 `scout_start` 不经过它。直接读磁盘 `case.json`、从不经过插件的第三方工具看不到对齐。
