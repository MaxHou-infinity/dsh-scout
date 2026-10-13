# dsh-scout · 司察（Scout）

[![ci](https://github.com/MaxHou-infinity/dsh-scout/actions/workflows/ci.yml/badge.svg)](https://github.com/MaxHou-infinity/dsh-scout/actions/workflows/ci.yml)
[![license MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![node >=22.19](https://img.shields.io/badge/node-%3E%3D22.19-brightgreen)](package.json)
[![DSH 兼容性夜间检查](https://github.com/MaxHou-infinity/dsh-scout/actions/workflows/compatibility-nightly.yml/badge.svg)](https://github.com/MaxHou-infinity/dsh-scout/actions/workflows/compatibility-nightly.yml)
[![tests passing](https://img.shields.io/badge/tests-passing-green)](tests/model.test.mjs)
[![English README](https://img.shields.io/badge/README-English-blue)](README.en.md)

**司察（Scout）** —— 面向 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) 的**证据驱动型公司与岗位尽调 / 背调插件**。

一句话说清楚：**它让 AI 帮你回答——"这家公司和这个岗位，值得进入下一轮吗？面试中还有哪些事项必须核验？"** 并且，每一个结论都挂靠真实的来源，绝不把"公司自述"或"融资新闻"当成已经核实的事实。

## 命名

- **Scout**：侦察兵先于你抵达目标——背调、尽调、取证、面试准备。包名与仓库名保持 `dsh-scout`，让安装引用稳定。
- **司察**（sī-chá）："司"呼应 scout，"察"意为考察、明察，概括了这款插件"用证据调查一家公司与一个岗位"的核心动作。

---

## 为什么需要它？（它解决什么痛点）

假设你收到一个面试邀约或 Offer：

- 招聘 JD 说公司"全球第一、估值百亿"——**这是公司的宣传口径，不是事实**；
- 媒体报道说"融资 20 亿美元"——**可能只是媒体转述，甚至已被公司否认**；
- 你需要在面试前判断：公司主体真实吗？岗位的汇报线、授权、薪资靠谱吗？**该问哪些问题**？

司察（dsh-scout）把这件事做成一条可复现的工作流：**收集来源 → 登记证据 → 添加结论 → 核验主体 → 生成带证据边界的尽调报告**。报告明确区分「已核验」「待核验」「未知」，并直接给出面试行动清单。

---

## 它的心智模型：证据等级（核心概念）

所有结论（claim）都受**证据等级**约束，等级上限由它所引用的来源决定：

| 等级 | 含义 | 例子 |
|---|---|---|
| **E0** | 无来源 / 模型推断 | 没有来源支撑的猜测，只能标 `unknown` 或 `needs_verification` |
| **E1** | 用户提供 | 你自己从内部渠道拿到的信息 |
| **E2** | 权威第三方 | 独立媒体、招聘平台（BOSS/猎聘）、工商聚合库（天眼查/爱企查）、维基百科 |
| **E3** | 官方一手 | 国家企业信用信息公示系统（gsxt.gov.cn）、监管公告、官方备案 |

**四条纪律（插件强制，不可绕过）：**

1. 一条主张的 `evidenceLevel` **不能超过**它引用的最强来源（E1 来源撑不起 E3 结论）；
2. **没有来源**的高影响结论，只能标记为 `unknown` 或 `needs_verification`；
3. **主体核验**（scout_verify_identity）必须挂接 E3 官方登记来源，否则拒绝执行；
4. 决策默认**保守**：只要主体未核验、或有阻断级结论未核实，就保持 `VERIFY`，不会假装"已通过"。

> 这保证了：**证据不足时，报告会诚实地告诉你"还没核实"，而不是给你一个夸大的结论。**

---

## 一个案例（case）的生命周期

```
scout_start          创建案例（默认决策 VERIFY）
   │
scout_search         调用 Web Provider 搜索，结果自动登记为来源
   │
scout_ingest         批量登记采集结果（可随来源自动登记主张）
   │
scout_add_source     登记来源（sourceType + evidenceLevel）
   │
scout_add_claim      添加结论（受证据边界约束）
   │
scout_verify_identity 用 E3 官方源核验公司主体（可选但强烈建议）
   │
scout_verify_claim   用更强证据把结论提升为 verified（保留历史）
   │
scout_report / scout_questions  生成报告 / 派生面试问题
   │
scout_compare        多个案例并排对比（决策/主体/风险/问题）
   │
scout_export / scout_import  落盘持久化（五文件 + 完成标记），换会话可恢复
```

也可以用显式入口驱动：`/scout status|questions|report|export`（见下文「命令与 Skill」）。

## 快速上手（一段完整示例）

以"判断某公司 HR 岗位是否值得推进"为例，Agent 会这样工作：

```text
① scout_start(caseId=acme-hr, companyName=某科技公司, roleTitle=HRBP, location=深圳)
② 搜索公司工商信息 → scout_add_source(sourceId=s1, sourceType=company_registry/…, evidenceLevel=E2)
③ 抓取官方招聘 JD → scout_add_source(sourceId=s2, sourceType=company_official, evidenceLevel=E2)
④ 提炼职责/资格/薪资 → scout_add_claim(claimId=c1, status=verified, evidenceLevel=E2, …)
   没有来源支撑的高影响项（如"汇报线"）→ status=unknown / needs_verification
⑤ 尝试 gsxt 官方核验 → scout_verify_identity(…)
⑥ scout_report → 生成报告
```

生成的报告包含：

- **判断**：`PROCEED` / `VERIFY` / `STOP`（附理由）
- **Key supporting evidence**：最有力的已核验结论
- **Blocking or unresolved risks**：阻断推进的风险与未知项
- **Verification checklist**：所有待核验的阻断/重要事项 + 各自的下一步动作（直接当面试行动清单用）
- **Coverage（0.9.1 新增）**：11 个调查维度各自的「已核验 / 待核验 / 未调查」计数，并单列**未调查维度**——报告因此不只是证据清单，也是尽调进度
- **Claim ledger**：全部结论台账（状态/证据等级/影响/来源/置信说明）
- **Sources**：带 URL 的来源清单（可点击回溯）
- **Interview questions**：建议的面试反问（未调查维度的问题优先）

## 安装

先确认你在哪运行——两条入口的安装方式完全不同，**不要混用**：

| 你在哪运行 | 目标 profile | 安装方式 |
|---|---|---|
| **桌面 App（DeepSeek Harness）** | `desktop` | **App 内安装**（唯一路径，见下） |
| CLI / headless / 自建 profile | 你自己的 profile 名 | `dsh plugin --profile <your-profile> add …` |

### 路径 0：桌面 App（推荐）

桌面版的 `desktop` profile 由 Electron 应用独占，CLI 无法管理它——`dsh plugin --profile desktop list` 与 `add` 都会被直接拒绝：

```text
error: profile "desktop" is managed exclusively by the Electron application
```

这是 CLI 里**按 profile 名**的硬拒绝，该 profile 的**所有** `dsh plugin` 子命令都会命中——包括下面兼容性小节里的 `allow-version`。请在**侧边栏 → 插件页**（安装、启用、移除都在这一页）里安装：

```sh
dsh-scout@0.9.3
```

> 版本务必显式写死。pnpm ≥ 11 默认启用最小发布年龄（minimum release age）供应链保护，裸包名会让刚发布的版本被静默跳过、回退到旧版（0.9.2 发布后立即安装曾解析到 0.9.0）；写上精确版本后 pnpm 会把它记入 profile 的 `minimumReleaseAgeExclude`（输出里打印 `Added 1 entry to …`）。

装完不需要重启：实测 12 个 `scout_*` 工具即时注入当前会话。桌面会话的 cwd 与 CLI 不同，建议在 profile 的 `cordis.patch.yml` 里给 `scoutDir` 配绝对路径（见下文「配置」）。

### 路径 1：CLI（npm，推荐）

```sh
# 把 <your-profile> 换成你自己的 profile 名，不要照抄示例
dsh plugin --profile <your-profile> add dsh-scout@0.9.3
```

<details>
<summary>怎么知道我的 profile 名？</summary>

`dsh` 没有 `profile list` 子命令（`profile` 会被当成 profile 名解析并报错），直接看目录：

```sh
ls ~/.dsh/profiles          # 或用 $DSH_HOME/profiles
```

列出的每个名字都是可用 profile 名（如 `web`，或你自建的 profile）。`desktop` 由 App 独占，CLI 对它执行任何 `dsh plugin` 子命令都会被拒绝。
</details>

**不要照抄示例名**（例如 `scout-demo`）：CLI 会照常创建并使用它、不报任何错——结果是插件装进了另一个 profile，你以为装好了却完全没生效。

### 路径 2：本地 tarball（离线 / 可复现）

```sh
pnpm pack                                        # 生成 dsh-scout-0.9.3.tgz
dsh plugin --profile <your-profile> add "file:$PWD/dsh-scout-0.9.3.tgz"
```

### 其他安装方式与取舍

| 来源 | 自带构建产物 | 执行安装脚本 | 建议 |
|---|---|---|---|
| npm（路径 1） | ✅ 自带 `dist/` | ❌（实测 `pendingBuilds: []`） | **推荐** |
| 本地 tarball（路径 2） | ✅（`pnpm pack` 产物） | ❌ | 离线 / 自测 |
| git：`github:MaxHou-infinity/dsh-scout#v0.9.3` | ❌（仓库不含 `dist/`） | ✅ `prepare` 会跑 `tsc`，并安装 devDependencies | **不推荐**；只在需要未发布提交时使用 |

git 路径的 ref 必须是**真实存在的 tag 或 commit**：仓库自 `v0.3.0` 起共 10 个 tag（`v0.3.0` … `v0.9.2`；`v0.9.1` 是本地迭代版、未打 tag），本次发布创建 `v0.9.3`。它也是三条路径里唯一会执行代码的：仓库不含 `dist/`，装完必然在本地构建，pnpm 可能要求为 `dsh-scout` 显式添加 `allowBuilds`（只放行你审查过的固定版本）。

> 桌面 App 自带 node / pnpm 运行时（实测 node 24.21.0 + pnpm 11.7.0），**无需**安装 Node；「Node ≥ 22.19」只对 CLI / 门禁路径成立。

### 装上了吗（成功判据）

**桌面 App**

1. **侧边栏 → 插件页**：`dsh-scout` 出现在「已安装」里；**打开它的详情页**，标题旁带 `v0.9.3`——版本号只在这一页（列表卡片上只有「实验性 / 异常」状态标签）；
2. **设置 → 内置插件 → 插件列表**：`dsh-scout` 行是 **已启用**、运行状态 **运行中**，不是 **已停用** / **启动失败** / **条件启用**（这一页**不显示版本号**）；
3. 新开一轮对话，工具列表里出现 12 个 `scout_*` 工具；
4. 输入 `/scout status <caseId>` 能命中命令，且输出末尾带插件版本（`· dsh-scout 0.9.3`）——桌面看不到 stderr 与日志，这是确认运行时真正加载了哪个版本的自证面。

**CLI**

```sh
# 组合树里应出现 dsh-scout 那一层
dsh --profile <your-profile> --dump-config | grep -A2 'dsh-scout'
```

但**组合进去 ≠ 运行时挂上了**：最可靠的判据始终是「12 个 `scout_*` 工具是否出现」「`/scout` 是否命中」。

CLI 在运行时不兼容时会把插件行置为 disabled，进程只在 stderr 打一行 `dsh: disabling profile plugin <row>: <reason>`——现象是"插件没生效"，不是显眼的红色报错。**桌面 App 看不到 stderr**（实测 Electron 主进程的 fd0/fd1/fd2 都指向 `/dev/null`，`~/Library/Logs/DeepSeek Harness/` 为空目录、全盘没有 DSH 运行日志），桌面排障只能走 GUI：**设置 → 内置插件 → 插件列表**按「会话插件 / 全局插件」分组，用 **已启用 / 已停用 / 启动失败 / 条件启用** 标签与 **运行中 / 启动失败 / 等待依赖 / 未运行** 运行状态回答"装没装、为什么没生效"（这一页**没有版本号**）——启动时被禁用的插件行（peer 不匹配是其中一种）会以「已停用」出现在这里，宿主侧的投影就是 `enabled: !entry.disabled`；那行被丢进 `/dev/null` 的 stderr，答案其实已经在 GUI 里。装的是哪一版，去**侧边栏 → 插件页**打开该插件的详情页看 `v{version}`。

### 卸载与升级

```sh
dsh plugin --profile <your-profile> add dsh-scout@<new-version>   # 升级：换成目标版本，同样写死
dsh plugin --profile <your-profile> remove dsh-scout              # 卸载
```

桌面 App 请在**侧边栏 → 插件页**里升级 / 移除。安装失败会回滚 profile 清单与 lockfile。

### DSH 兼容性

DSH 对插件的兼容性有**三个层次**，不要混为一谈：

| 层次 | 位置 | 谁在执行 | 不匹配会怎样 |
|---|---|---|---|
| **声明** | `package.json` 的 `engines.dsh`（`>=0.1.0-rc.6 <0.3.0-0`） | 目前**没有任何代码**读取（DSH 0.2.0-rc.2 运行时不读 `engines.dsh`；官方 manifest 的注释写明 *"DSH compatibility is declarative until a reader enforces it"*） | 只表达作者意图，不拦截任何东西 |
| **生效** | `peerDependencies` 中名字为 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 的范围（本仓库只有 `@deepseek-ai/dsh-tools: ">=0.1.0-rc.6 <0.3.0-0"` 一条） | DSH 安装检查 + profile 启动预检 `evaluatePluginCompatibility()` | 安装阶段拒绝，或启动时禁用该插件行 |
| **不被校验** | `@deepseek-ai/cordis: ">=4.0.2 <5"`（以及 `@deepseek-ai/schemastery`） | DSH 的 peer 名字过滤只认 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` | 由 pnpm 解析，DSH 不做兼容判定 |

三个必须知道的细节：

1. **预发布版本参与匹配。** 判定用 `semver.satisfies(runtime, range, { includePrerelease: true })`。上界写成 `<0.3.0-0` 正是为了在开启 prerelease 的前提下排除 `0.3.0-alpha` 及以后；反过来说，这条 range 的写法**依赖这个标志位**——去掉它，`0.2.0-rc.2` 会被判成不匹配。**用其它工具核对这条范围时请带上 `includePrerelease`**：按默认 semver 语义（node-semver 的预发布规则——预发布版本只被「同 major.minor.patch 元组且带预发布」的比较器接受），`0.1.2-rc.1` / `0.2.0-rc.2` / `0.2.1-alpha.2` 都会被判为**不满足**（semver 7.8.5 实测：`0.1.0-rc.6` 两种语义均为 true；后三者 plain=false / incl=true；`0.3.0-alpha.1` 两者均为 false）。**以 DSH 的判定为准。**
2. **失败的形态是「静默不加载」，不是报错。** 安装时能预判的 spec（`add` 一个 registry 包）会在 pnpm 执行前直接拒绝并打印豁免命令；git / tarball spec 在安装后判定，失败会回滚 profile 清单与 lockfile。而**已经在 profile 里、启动时才发现不匹配**的插件行会被置为 disabled，本进程只在 stderr 打一行 `dsh: disabling profile plugin <row>: <reason>`——用户看到的现象是"插件没生效"（工具不在、`/scout` 不在），不是一条显眼的红色报错。**这一行只对 CLI 用户可见**；桌面 App 的 stderr 指向 `/dev/null`、没有运行日志（见上文「装上了吗」），桌面上的状态只能在**设置 → 内置插件 → 插件列表**里看（装在哪个版本则看**侧边栏 → 插件页**）。
3. **这一条 `@deepseek-ai/dsh-tools` peer 就是全部门禁。** 改 peer 范围等于改兼容承诺。

#### 逃生门：profile 级精确版本豁免

如果只是**声明范围过期**（例如 DSH 发了 `0.3.0-alpha.1`，而插件其实还能跑），可以不做新版本、直接在 profile 里豁免：

```sh
dsh plugin --profile <name> version-exemptions   # 查看当前豁免与运行时版本
dsh plugin --profile <name> allow-version <package>@<version> --dsh-version <exact-dsh-version> --accept-risk
dsh plugin --profile <name> revoke-version <package>@<version> --dsh-version <exact-dsh-version>
```

豁免记录写在 profile 目录下、与 `package.json` / `cordis.patch.yml` 并列的 `compatibility.json`（精确 `package@version` → 允许的精确 DSH 版本列表）。四条边界：

- **只接受精确版本**，不接受 range；
- 只授权「这一个包版本 + 这一个 DSH 版本」这一对，**不随插件或 DSH 升级继承**；
- **不授权**依赖的安装脚本；
- 生效时机是**下一次组合**：live profile 会重新组合并挂载，startup-only profile 需要重启。

授予豁免需要显式风险确认（CLI 的 `--accept-risk`，插件管理器里是 `acceptRisk: true`），DSH 会在写入前打印风险警告——不兼容的插件可能崩溃或损坏数据。

**桌面 App 用户**：`allow-version` 与其它 `dsh plugin` 子命令一样被按 profile 名拒绝，需要手动写这个文件。它是一个平铺的 JSON 对象——精确 `package@version` → 允许的精确 DSH 版本数组，例如桌面 App 的运行时为 `0.2.0-rc.2` 时：

```json
{
  "dsh-scout@0.9.3": ["0.2.0-rc.2"]
}
```

手写同样受上面四条边界约束（只接受精确版本、只授权「这一个包版本 + 这一个 DSH 版本」这一对、不授权安装脚本、下一次组合生效），并且**绕过了 CLI 的 `--accept-risk` 风险确认**——不兼容的插件可能崩溃或损坏数据。运行时的精确版本可从 `~/.dsh/dsh-runtimes/*/runtime.json` 的 `desktopVersion` 读取；写法不合规的记录会被忽略并给出告警，不会让 profile 不可用。

#### 已实测版本矩阵

**`dsh-scout@0.9.3` 候选 tarball 已在四个精确 DSH 版本上实测通过**（2026-10-13 发布前，隔离 profile，四个 binary 均从 npm 真实取用、非本机 DSH）：覆盖安装、冷启动、工具挂载、**六步真实宿主门禁**（`scout_start` → 导出 → 冷重启 → 惰性回填 → 跨语言导入 → 卸载，外加「标记缺失 / `complete:false`」两个负向对照）和卸载。完整门禁由 `npm run check:release` 执行，实测输出：

```text
dsh-scout release gate: PASS (4 DSH versions, >=0.1.0-rc.6 <0.3.0-0)
```

| DSH 版本 | npm 渠道（2026-10-12 核对） | 0.9.3（候选 tarball）结果 |
| --- | --- | --- |
| `0.1.0-rc.6` | 兼容范围下界 | 通过 |
| `0.1.2-rc.1` | 旧版回归 | 通过 |
| `0.2.0-rc.2` | `latest` / `next` | 通过 |
| `0.2.1-alpha.2` | `alpha` | 通过 |

本表此前记录过 **0.9.0** 与 **0.9.1** 候选 tarball 的结果；0.9.3 沿用同一 `peerDependencies` 与 `engines.dsh` 范围（**没有变化**）：本版改的是安装文档与诊断面——README 安装章节补上桌面 App 主路径、README 版本引用守卫、`/scout status` 输出带插件版本——依赖与运行时契约未动，并用同一道门禁在同样四个精确版本上复跑通过（4/4），故更新为本版本。npm 渠道那一列仍是 2026-10-12 的核对结果，本次复跑未重新核对。上一版 **0.9.2 已发布到 npm**（`dist-tags.latest` = `0.9.2`）：发布 workflow（run `38406696598`）在 `pnpm pack` 之前跑了同一道四版本门禁，所以当时这张表记录的 0.9.2 四版本通过，就是最终发布的那份。0.9.1 新增的 `/scout` 命令与 Skill 走可选绑定，宿主没有对应服务时静默跳过，不影响加载。

未来的 `0.2.x` 版本虽落在声明范围内，仍需实际验证。[夜间兼容检查](https://github.com/MaxHou-infinity/dsh-scout/actions/workflows/compatibility-nightly.yml)每天解析 npm 的 `latest`、`next`、`alpha` 到精确版本，再运行测试和隔离 profile 检查。徽章显示该工作流最近一次运行结果；以上表格记录已完成的精确版本验证。

> **夜间变红不等于插件坏了**：它可能只是声明范围过期（例如 DSH 发布 `0.3.0-alpha.1`）。`check:release` 会把「超出声明范围（预期）」与「范围内但失败（回归）」分开报告——前者应当更新声明范围，或按上面的精确版本豁免处理，而不是当成回归去修。

## 工具清单（12 个）

| 工具 | 作用 |
|---|---|
| `scout_start` | 创建尽调案例 |
| `scout_add_source` | 登记信息来源（含证据等级） |
| `scout_ingest` | 批量登记采集结果（自动推断来源类型/证据等级，可随来源一键登记主张草稿） |
| `scout_search` | 调用 DSH Web Provider 搜索并自动登记结果来源（type/evidence 按 URL 推断） |
| `scout_add_claim` | 添加证据受限的主张 |
| `scout_verify_identity` | 用 E3 官方源核验法定主体 |
| `scout_verify_claim` | 用更强证据提升主张为 verified |
| `scout_report` | 渲染当前 Markdown 报告 |
| `scout_questions` | 从案例派生去重、按优先级排序的面试问题清单（上限 12 条；案例自带的精选问题保留名额） |
| `scout_compare` | 2–5 个案例的并排对比报告（决策/主体/关键结论/风险/面试问题） |
| `scout_export` | 持久化五文件导出（case/sources/claims/events/report）+ 完成标记 |
| `scout_import` | 从导出目录恢复案例并重算决策（容忍旧导出，报 `complete`） |

### 输出契约（0.9.1 起）

变更类工具（`scout_start` / `scout_add_source` / `scout_ingest` / `scout_search` / `scout_add_claim` / `scout_verify_identity` / `scout_verify_claim` / `scout_import`，共 8 个）**不再把整份 case JSON 回吐给模型**：

- `value` 是**结构化对象**：`{ ok, caseId, decision, identity, counts: { sources, claims, verified, open }, changed: { kind, ids }, nextActions, persist? }`；
- `render` 是**整串不超过 1 KB 的紧凑摘要**：决策 + 本次增量 + 未核验阻断项 + 下一步。上限就是渲染预算本身（`MAX_RENDER_BYTES = 1024` B）：省略号自身的 UTF-8 长度先从预算里扣掉、再按码元裁切，因此**含省略号的整串也不会超过 1024 B**；
- `persist: { persisted, targetDir, error? }` **只出现在变更类工具的 `autoPersist` 路径**（未尝试落盘时该键省略）。**落盘失败不再静默**：`persist.persisted === false` + `persist.error`，且不会产生 `case_exported` 事件。`scout_export` **不带 `persist` 键**，它用**顶层** `persisted` / `complete` / `error` 表达同一件事；
- **全量数据仍由 `scout_report`（Markdown 报告）与 `scout_export`（文件）提供**——模型看到的是摘要，不是台账全文。

读类工具各有自己的形状：`scout_report` → `{ caseId, decision, report, coverage }`；`scout_questions` → `{ caseId, questions }`；`scout_compare` → `{ caseIds, report }`；`scout_export` → `{ caseId, targetDir, files, persisted, complete, error? }`，其中 `targetDir` 是**解析后的绝对路径**。`scout_import` 复用变更类信封，并额外带 `sourceDir`（恢复来源目录）与 `complete`（导出是否完整）。

### 命令与 Skill（0.9.1 新增）

| 入口 | 作用 |
|---|---|
| `/scout` 命令 | `status` / `questions` / `report` / `export` 四个子动作（复用工具逻辑）。宿主会在处理前后自动落 `command/run` + `command/done` 事件——两者都在宿主已知事件词表内，所以会话日志天然可重建 |
| `scout` Skill | 插件直接注册的尽调工作流（`ctx.skills.register`，不需要落文件、不需要 client bundle）：start → search/ingest → claim → verify_identity → report → questions + 四条证据纪律；卸载即消失 |

命令用法（与实现一致）：

```text
/scout status <caseId> | /scout questions <caseId> | /scout report <caseId> | /scout export <caseId> [targetDir]
```

两者都是**可选绑定**：宿主没有 `commands` / `skills` 服务时静默跳过，不影响插件加载与工具使用。

## 配置（可选）

在 DSH profile 的 `cordis.patch.yml` 中为 `dsh-scout` 配置：

```yaml
- id: dsh-scout
  config:
    scoutDir: /path/to/scout-cases   # 默认导出目录；case 落在 <scoutDir>/<caseId>/（默认 'dsh-scout'）
    autoPersist: true                # 每次变更后自动写五文件（默认 false）
    language: en                     # 'zh-CN'（默认）或 'en'
    authorityHostSuffixes:           # E3 权威源主机后缀白名单（默认覆盖政府/公司登记/交易所域名）
      - gov.cn
```

- 相对 `scoutDir` 以**会话的 cwd** 为基准解析，不再落到 DSH 进程的当前目录；
- **桌面 App**：`scoutDir` 的默认值 `./dsh-scout` 依赖 cwd，而桌面会话的 cwd 语义与 CLI 不同，建议在 `~/.dsh/profiles/desktop/cordis.patch.yml` 里给 `id: dsh-scout` 直接写绝对路径；该文件由 App 维护，手改前先退出 App，避免写入被覆盖；
- `autoPersist: true` 时，每次变更后自动落盘；**失败可见**：返回值带 `persist.persisted=false` + `persist.error`，且不会写 `case_exported` 事件；
- `language` 影响报告、面试问题、对比报告，以及 `scout_ingest` 采集草稿自动写入的说明文字（`confidenceNote` / `nextAction`）；它还会对齐案例自带、**仍是出厂默认**的文案，判定粒度不同：`decisionObjective` / `role.fitQuestion` 是**逐字段**（该字段仍是出厂默认即对齐）；精选面试问题是**按下标逐条**——长度与出厂数组相同时，该下标仍是出厂默认的条目替换为本部署语言的同下标默认值，**用户改过的那条保持原样**；长度与出厂数组不同时，整组视为用户自撰、原样保留。判定依据是「是否等于该下标的出厂默认」，不是编辑历史（把某条改回出厂原文，那条会被对齐）。与案例自带语言相同时是 no-op，默认 `zh-CN` 对既有用户零变化。另外，`case.json` 里的 `language` 是**本部署的渲染语言**，不是文件内容的语言：对齐只按这个标签判定，**不校验标签与内容是否自洽**，所以手工把 `language` 改成与内容不符的值再导入时，插件会按「语言相同」提前返回、不做校正（正常的导出 / 导入 / 升级路径不受影响：0.9.0 旧导出的 `language` 恒为 `zh-CN`，与其内容一致）。

## 数据持久化

案例默认在内存中、按会话隔离；`scout_export` 把案例写成一个可复制的目录：

```
case.json              案例主体（含决策状态）
sources.json           来源清单
claims.json            结论台账
events.jsonl           可回放事件流（case_started / source_added / claim_added /
                       identity_verified / claim_verified / case_exported /
                       case_imported / case_rehydrated）
report.md              当前报告快照
export.complete.json   0.9.1 起：完成标记（先写 complete:false，五文件落盘后改写 complete:true）
```

- 导出顺序是「**先记 `case_exported` 事件、后写文件**」，所以磁盘上的 `events.jsonl` 包含本次导出；「导出 → 导入 → 再导出」的事件序列稳定；
- 完成标记 `export.complete.json` 的内容形如 `{ schemaVersion, caseId, complete, files, eventCount }`：**写入前先置 `complete: false`**，五个数据文件全部落盘后再改写为 `complete: true`——所以**陈旧标记不会为半份导出宣称完整**（覆盖写场景下，上一次成功导出的标记会在新文件写入前先被降级）。`scout_import` 读的是标记里的 **`complete` 字段**，而不是「标记文件是否存在」；**`eventCount` 只有在 `complete: true` 时才与磁盘上 `events.jsonl` 的行数一致**（导出中断时它记录的是那次失败尝试期望的事件数），读取方请以 `complete` 为准、不要只比较 `eventCount`；标记里的 `files` 与 `scout_export` 返回值里的 `files` **同名不同义**——标记只列**五个数据文件**，`scout_export` 返回的是这次调用写出的**六个名字**（五个数据文件 + 标记自身），两者都正确；
- `scout_import` 能导入**没有完成标记**的旧导出；标记缺失或 `complete: false` 时，只要**五个数据文件都已落盘**，导入仍会进行，但返回值报 `complete: false`，由调用方决定是否信任这份快照（五个数据文件缺任何一个、例如在写 `claims.json` 时中断的全新导出，仍是硬失败）；
- **会话恢复是否自动回填，取决于导出是否完整**：缓存未命中时，**只有完整导出**（完成标记 `complete: true`）才会被惰性回填，并追加 `case_rehydrated` 事件，让"凭空出现"的 case 状态仍然可审计；**0.9.0 的旧导出没有完成标记，不会被自动回填**，需要用 `scout_import` 显式恢复。对齐本身只在 `decide` 路径生效——重算决策的工具调用（`scout_add_claim` / `scout_ingest` / `scout_search` / `scout_verify_identity` / `scout_verify_claim` / `scout_import`）与缓存未命中时的惰性回填会经过它；回填由**第一个访问该 case 的工具调用**触发（`requireCase`），所以冷启动后即使只调 `scout_report` 也可能带上一次对齐，而只创建案例的 `scout_start` 不经过。对齐结果随第一次 `decide` 落到内存 case 与之后的导出；**直接读磁盘 `case.json`、从不经过插件的第三方工具看不到对齐**。

## 何时不要用（设计边界）

- 它内置的 `scout_search` 仅做搜索到来源的登记；**不替代**专用浏览器或 MCP Provider 的深度抓取；
- 它**不会**自动投递简历、发送求职邮件，或把你的身份信息交给第三方；
- 它**不会**替你把融资信息、公司自述或招聘启事当成已核实的事实；
- 它**不构成**法律、投资或医疗建议；
- 主体核验依赖 E3 官方源，若 gsxt 等无法访问，报告会如实标记"待核验"；
- **0.9.1 与 0.9.2 明确不做**：client 面板、自造 session event、`ctx.storageDomain` 持久化重写、评分 / 排名。理由与边界见 [CHANGELOG](CHANGELOG.md)；其中「自造 session event 会让插件自己写的会话无法重建」是硬约束，见[产品契约 §5.1](docs/dsh-scout-product-contract.md)。

完整 MVP 边界与验收标准见[产品契约](docs/dsh-scout-product-contract.md)；首个示例案例见 [Snapmaker HR Head](docs/fixtures/dsh-scout/snapmaker-hr-head.json)。

## 开发与测试

```sh
pnpm install
pnpm test                 # 构建 + 单元测试（决策默认值/证据约束/主体核验/会话隔离/报告渲染/导出导入往返/自动持久化/面试问题/采集→主张流转/多语言/分发包契约）
pnpm run check:release    # 四个精确 DSH 版本的 profile 门禁 + 打包内容检查
```

`test:profile` 会在隔离 profile 里跑一条**六步真实宿主场景链**：创建（`scout_start` + `scout_add_source` + `scout_add_claim`）→ 导出（绝对 `targetDir`、6 个文件、完成标记 `complete: true`）→ 冷重启（同一 `DSH_HOME`/profile 的第二个进程）→ 惰性回填（不 `scout_import`，断言决策不变并落 `case_rehydrated`）→ 跨语言导入（`en` profile 导入 zh 导出，报告与 `report.md` 的 CJK = 0）→ 卸载（无 registry 残留），另有三条负向对照：`output.schema` 敏感性、标记缺失、标记 `complete:false`。全量约 16 秒，可用 `DSH_SCOUT_SMOKE_SKIP_CROSS_LANGUAGE` / `DSH_SCOUT_SMOKE_SKIP_REHYDRATION_CONTROL` / `DSH_SCOUT_SMOKE_SKIP_NEGATIVE_CONTROL` 跳过，跳过的项会在 PASS 行如实报为覆盖降级。**仍未覆盖**（脚本注释里逐条写明）：真实 LLM / agent loop 与 approval 策略、相对路径（`agent` 未设置时 `cwd` 为 `undefined`，门禁只用绝对路径）、`autoPersist` 自动落盘、真实进程中断（撕裂导出靠改写标记复现）、其余 6 个工具只断言注册。`check:release` 随后用四个精确 DSH 版本复跑同一条门禁（并把「超出声明范围（预期）」与「范围内失败（回归）」分开报），最后检查打包内容。

## 路线图

- ✅ v0.1：证据纪律、三态决策、结构化报告、会话隔离
- ✅ v0.2：五文件持久化导出 + 事件流 + 导入恢复
- ✅ v0.3：可配置存储（`scoutDir` / `autoPersist`）+ 面试问题生成（`scout_questions`）
- ✅ v0.4：信息采集登记（`scout_ingest`：批量登记搜索结果/抓取页面，自动推断来源类型与证据等级）
- ✅ v0.5：公司/岗位对比（`scout_compare`：多案例并排对比报告，合并面试问题）
- ✅ v0.6：采集→主张流转（`scout_ingest` 支持 claim 草稿：登记来源的同时自动添加主张）
- ✅ v0.7：Provider 深度集成（`scout_search`：DSH Web Provider 搜索，结果自动登记为来源）
- ✅ v0.8：首个 npm 发布（0.8.0）；0.8.1 声明 Schemastery `Config`、补 `exports` 映射、修可选服务注入；0.8.2 对齐 DSH 0.2 rc 通道
- ✅ v0.9.0：适配 DSH 0.2 运行时；四个精确版本的兼容矩阵 + 夜间兼容检查 + 兼容 issue 模板
- ✅ v0.9.1：输出契约（结构化值 + 紧凑摘要）、落盘可信度、服务调用时绑定与惰性回填、`language` 与 `## Coverage`、`/scout` 与 `scout` Skill、分发契约（`engines.dsh` / `manifestVersion` / locale / icon）
- ✅ v0.9.2：真实宿主端到端门禁（六步场景链 + 完成标记负向对照，关闭 0.9.1 验证报告里的 U11 盲区）、精选面试问题**按下标逐条**对齐（关闭 D10）、render 整串上限加固、`@deepseek-ai/schemastery` 对齐 `~3.18.4`
- ⏭ v0.10.0（计划）：client 面板、`ctx.storageDomain` 持久化重写、`presentationMeta` 载荷、对比矩阵升级与可扩展证据策略（**评分仍不做**）

## 社区

面向 DeepSeek Harness 的独立社区插件（Topic：`dsh-plugin`、`deepseek-harness`、`due-diligence`、`company-research`、`job-research`、`hr-tech`、`evidence-based`）。安装或启动遇到问题时，请用[兼容性问题模板](https://github.com/MaxHou-infinity/dsh-scout/issues/new?template=compatibility.yml)提供精确版本和脱敏日志；也欢迎其他 Issues / PR。

版本变更记录见 [CHANGELOG](CHANGELOG.md)。
