# dsh-scout 0.9.3 独立验证报告（GO/NO-GO）

- **验证对象**：`dsh-scout@0.9.3`（工作树；`package.json` version = `0.9.3`，相对 HEAD 只改了这一行；`@deepseek-ai/dsh-tools` peer 与 `engines.dsh` 仍是 `>=0.1.0-rc.6 <0.3.0-0`，`@deepseek-ai/schemastery` = `~3.18.4` → 实测解析 `3.18.4`）
- **验证者**：`verifier-093`（独立于本轮全部实现者；只新增 `tests/verification-0.9.3.test.mjs`（8 项）与本文档，**未修改任何既有文件**——见 §0 的两次指纹采样）
- **本轮范围**：复现四道门禁；**对抗性攻击 README 版本守卫**（本轮重点）；独立复核两个 GUI 面的论断（源码取证，且同时取证 CLI 安装与**桌面 App 自身 bundle**）；复核 `/scout status` 纯追加；回归检查 0.9.2 冻结表述未被回退；复核桌面 profile 的 CLI 拒绝；文档↔实现逐条吻合；独立确认 `docs/install-verification.md` 的诚实度；给出 GO/NO-GO
- **环境**：macOS（Darwin 25.5.0 / arm64）；Node `v26.8.1`；npm `12.0.2`；pnpm `11.25.0`；本机 `dsh 0.2.0-rc.2`（`/opt/homebrew/bin/dsh`）；**桌面 App 正在运行**（`/Applications/DeepSeek Harness.app`，其运行时 `~/.dsh/dsh-runtimes/dsh-primary-runtime/runtime.json` → `desktopVersion 0.2.0-rc.2`、node 24.21.0、pnpm 11.7.0）
- **本轮新发现缺陷：4 条**（F-1 / F-2 / F-3 在**新一轮的 README 版本守卫**里；F-4 是**中文文档用了英文 GUI 标签**。**0 条在运行时产品代码里**）。详见 §7
- **结论**：**GO**（见 §10；守卫缺陷不阻塞发布，但必须随下一轮文档改动修掉）

---

## 0. 冻结树指纹（sha256[0:16]）

**实现 + 门禁 + 测试集（18 个文件）聚合指纹：`e863c712b2562c0a`**

（聚合方式：对 `hash path` 排序清单整体取 sha256。**本次验证开始时与结束时两次采样完全相同**；聚合刻意不含验证者自己新增的套件。验证期间跑过 `npm test` / `pnpm pack` / `check:release`，只重建了 `.gitignore` 覆盖的 `dist/`，**没有任何既有文件被改动**——见下文的差分证据。）

| 文件 | sha256[0:16] | 文件 | sha256[0:16] |
|---|---|---|---|
| `src/index.ts` | `3142abab04518acb` | `tests/acceptance.test.mjs` | `a65f7b70612def0e` |
| `src/model.ts` | `36ec4764db9b1240` | `tests/package.test.mjs` | `4b325ee2bd85031f` |
| `src/i18n.ts` | `9627087ba04a220c` | `tests/model.test.mjs` | `3fd661f859a81d36` |
| `scripts/profile-smoke.mjs` | `70ade56bff662abd` | `tests/tools.test.mjs` | `e6e3016fd10b5886` |
| `scripts/check-release.mjs` | `b57164b1e271828d` | `package.json` | `684424dc1fd54c45` |
| `scripts/repro-decision-reason-drift.mjs` | `c4d6c6f0d85b3385` | `pnpm-lock.yaml` | `edaacbf5b19d818b` |
| `scripts/archive-official-docs.mjs` | `702dce5e5d7e8a22` | `locale/en.json` | `0510da397c3c3c8c` |
| `scripts/enrich-official-docs-index.mjs` | `45d32a1586c4663f` | `locale/zh.json` | `b07cee57af7913cd` |
| `cordis.patch.yml` | `308362ed55000652` | `tsconfig.json` | `8f078d0790882d1f` |

> 交叉证据：`scripts/profile-smoke.mjs` 仍是 **`70ade56bff662abd`**，与 [verification-0.9.2.md](verification-0.9.2.md) §0 记录的完全一致 ⇒ `docs/install-verification.md:120` 的「0.9.2 扩展，0.9.3 未改动 `scripts/profile-smoke.mjs`」**逐字属实**。

**被复核的文档（本轮文档最终版）**：

| 文件 | sha256[0:16] | 文件 | sha256[0:16] |
|---|---|---|---|
| `README.md` | `883cb4b8cf9c01f1` | `docs/install-verification.md` | `59dc9db2eb5f356e` |
| `README.en.md` | `213932f9c8f346bc` | `docs/dsh-scout-install-ux-review.md` | `20f35348a157ae3d` |
| `CHANGELOG.md` | `362850103ce30fbb` | `docs/dsh-scout-product-contract.md` | `4eaf9ab5358c8ef4` |

> 轮次说明：本节与 §11.0 的文档哈希是**各自轮次**的冻结记录；**最新命中**（发布提交签核）见 §12.1 —— `README.md` = `449698ba62805998`、`README.en.md` = `e51283083b1a6596`、`tests/package.test.mjs` = `c256de118efc8253`。

**本次验证新增的文件**（不属于冻结集，仅验证证据）：

| 文件 | sha256[0:16] |
|---|---|
| `tests/verification-0.9.3.test.mjs` | `6d9bc45f844387ef` |

> 本文档自身的哈希不入表（写入动作本身会改变它）。一旦本文档被改动，§10.4 第 10 条即要求重跑 §1 与 §2 后重新签发。

**「未改动任何既有文件」的差分证据**（验证开始时对当时存在的 **209 个**非 `node_modules/.git/dist/.pnpm-store` 文件逐个取 sha256，结束时再次采样并逐条比对；结束时多出的正是本轮新增的两个文件）：

```console
$ diff <(start fingerprints, 不含本轮新增文件) <(end fingerprints, 不含本轮新增文件)
（无输出 —— 逐字节相同）
$ grep 'verification-0.9.3' end-fingerprints
6d9bc45f844387ef  ./tests/verification-0.9.3.test.mjs      ← 唯一新增
```

---

## 0bis. 方法与证据等级

1. **门禁复现**：四道门禁在冻结树上重跑，原始输出摘要见 §1。门禁 1（`npm test` 基线）在**我新增套件之前**测得，随后再加跑一次含新套件的全量（124 → 132）。
2. **对抗套件**：`tests/verification-0.9.3.test.mjs`（**8 项**，全绿），**不复用也不导入**既有四个套件的断言：自带最小 Cordis 形 ctx、自带 README 引用抽取器、**从外部驱动被验证的 README 守卫**（在 `/tmp` 里逐条变更后跑真守卫，而不是相信守卫自己的 fixture）。
3. **守卫攻击（本轮重点）**：把仓库快照复制到 `/tmp/guard0973/**`，对 README 施加 **34 组独立变更**（21 组形态矩阵 + 12 组两实现交叉复核 + 1 组 F-3 分歧用例；矩阵之前另有若干探路用例，未计入），分别跑**两个实现**：`tests/package.test.mjs`（每次 `npm test`/CI 的毫秒级守卫）与 `scripts/check-release.mjs` 的 preflight（`PATH` 用桩 stub 掉 npm/pnpm，使退出码只由 preflight 决定；preflight 本身是**未改动的出厂代码**）。仓库零改动。
4. **GUI 取证**：对 `@deepseek-ai/dsh` 0.2.0-rc.2 的 npm 安装**与**桌面 App 自己的 `app.asar`（用脚本解析 asar header 提取出四个真实 bundle）**分别取证**，避免把「CLI 安装里的源码」当成「桌面 App 渲染的东西」。
5. **活体测量**：桌面 App 正在运行，直接 `lsof` 读取 Electron 主进程与 dsh host 子进程的 fd 0/1/2（§3.3）。
6. **文档逐条复核**：沿用 [verification-0.9.2.md §5](verification-0.9.2.md) 的方法——每条措辞指到具体 `file:line` 或实测行为（§5）。
7. **纪律**：本套件「断言缺陷存在」的用例数 **0**（§4.4 给出核验方式）；本轮发现的守卫缺陷写入本文档，**不写成红断言**，也未修改任何实现去「修」它们。

证据等级：本文所有「实测输出」均为本机真实命令 / 真门禁 / 真 `/tmp` 副本注入 / 真 `lsof` 的输出；凡属二手（评审单次实测）、推断或无法复现的，在 §8 / §9 明确标注。

---

## 1. 四道门禁复现（原始输出摘要）

### 1.1 `npm test` — 冻结基线 **124/124**，加新套件后 **132/132**

```console
$ npm test                     # 冻结基线：验证者套件加入之前
ℹ tests 124
ℹ pass 124
ℹ fail 0
ℹ duration_ms 171.744625
exit=0

$ npm test                     # 加入本轮 8 项之后（最终状态）
ℹ tests 132
ℹ pass 132
ℹ fail 0
ℹ duration_ms 1893.255625
exit=0
```

- 冻结基线 **124/124 全绿**，与 Lead 给的基线一致（该 124 含 `tests/verification-0.9.2.test.mjs` 的 15 项）。
- 新增 8 项后 **132/132 全绿**，无一条既有用例翻红；最终态的全量耗时为 **1.89 s**（其中约 1.8 s 是本轮套件的守卫变更矩阵 + preflight 用例）。

**结论：通过。**

### 1.2 `DSH_BIN=$(which dsh) npm run test:profile` — PASS（16 s）

```console
$ DSH_BIN=$(which dsh) npm run test:profile                      # 16 s
dsh-scout profile smoke: PASS (dsh-scout 0.9.3, dsh 0.2.0-rc.2)
  scenario chain: 7 gate lines (6 steps + the completion-marker control)
  step 1 registry+create: PASS (12 tools mounted, fs seam present, scout_start/add_source×2/add_claim isError=false, value=object, scout_start content=166B < 1024, zh report 382 Han chars)
  step 2 export: PASS (persisted=true complete=true, targetDir absolute & equal to the requested path, 6/6 files on disk, marker complete=true, decision=VERIFY)
  step 3 cold restart: PASS (second boot on the same DSH_HOME/profile, pid 56709 → 56710)
  step 4 lazy rehydrate: PASS (scout_report with no import returned decision=VERIFY, 2 sources + 1 claim restored, case_rehydrated persisted to events.jsonl)
  step 5 cross-language: PASS (en profile imported the zh export: complete=true, render CJK=0, report.md CJK=0 vs zh report.md 382 Han chars, case.json.language=en, ASCII subject preserved)
  negative control marker: PASS (marker deleted → isError=true "Unknown case"; marker complete:false → same refusal; payload files untouched both times)
  step 6 uninstall: PASS (dsh-scout layer gone from --dump-config; post-removal boot mounted 0/12 tools and the verifier still ran)
  not covered: no agent/LLM/approval path (agent unset ⇒ absolute dirs only), 6/12 tools executed, report asserted structurally, autoPersist stays false, token budget covers rendered content only
exit=0
```

**结论：通过。** 六步 + 完成标记负向对照全部出 PASS 行；`scout_start content=166B < 1024` 与 zh 报告 382 汉字仍在，说明 0.9.3 的改动没有触碰 render 预算与 i18n 文案基线。

### 1.3 `pnpm pack --dry-run` — 23 个文件

```console
$ pnpm pack --dry-run
package: dsh-scout@0.9.3
Tarball Contents
assets/icon.svg  CHANGELOG.md  cordis.patch.yml  dist/{i18n,index,model}.{js,d.ts}
docs/dsh-scout-product-contract.md  docs/fixtures/dsh-scout/snapmaker-hr-head.json
LICENSE  locale/en.json  locale/zh.json  package.json  README.en.md  README.md
scripts/check-release.mjs  scripts/profile-smoke.mjs
tests/{acceptance,model,package,tools}.test.mjs
Tarball Details
dsh-scout-0.9.3.tgz
exit=0
```

- 打包内容 **23 个文件**（计数订正见 §11.1：本节初版写「24」是沿用 [verification-0.9.2.md](verification-0.9.2.md) §1.3 的同一处计数错误；文件集本身与 0.9.2 相同，见下），`exports` 的 6 个目标 + `icon` 全部在包内。
- `tests/verification-0.9.3.test.mjs`、`docs/install-verification.md`、`docs/dsh-scout-install-ux-review.md`、`docs/verification-*.md`、`scripts/repro-*.mjs` **均不在**包内 ⇒ CHANGELOG「仓库内文档，不在 npm 包内」的自述属实。

**结论：通过。**

### 1.4 `env -u DSH_BIN npm run check:release` — 4/4 PASS（91 s）

```console
$ env -u DSH_BIN npm run check:release          # 开始时 DSH_BIN before: [<unset>]；23:09:16 → 23:10:47
dsh-scout release gate
  declared engines.dsh: >=0.1.0-rc.6 <0.3.0-0
  range semantics: node-semver includePrerelease:true (mirrors dsh-app-boot evaluatePluginCompatibility:300)
  profile matrix: 0.1.0-rc.6, 0.1.2-rc.1, 0.2.0-rc.2, 0.2.1-alpha.2 (default matrix)
  out-of-range failures: fatal, reported as OUT OF DECLARED RANGE
  readme release references: 20 checked (4 inside the success-criteria section), all pinned to 0.9.3
ℹ tests 124 / pass 124 / fail 0                      ← 门禁内部先跑 npm test（当时本轮套件尚未加入）
[ok] dsh 0.1.0-rc.6     — profile smoke passed (satisfies engines.dsh ">=0.1.0-rc.6 <0.3.0-0")
[ok] dsh 0.1.2-rc.1     — profile smoke passed (satisfies engines.dsh ">=0.1.0-rc.6 <0.3.0-0")
[ok] dsh 0.2.0-rc.2     — profile smoke passed (satisfies engines.dsh ">=0.1.0-rc.6 <0.3.0-0")
[ok] dsh 0.2.1-alpha.2  — profile smoke passed (satisfies engines.dsh ">=0.1.0-rc.6 <0.3.0-0")
dsh-scout release gate: PASS (4 DSH versions, >=0.1.0-rc.6 <0.3.0-0)
exit=0
```

方法学要点（否则这道门禁可能是假的）：**启动前确认 `DSH_BIN` 未设置**（日志首行 `DSH_BIN before: [<unset>]`，且命令显式用 `env -u DSH_BIN`），因此每个版本走 `npx --yes @deepseek-ai/dsh@<version>`，四次运行各自打印**全新的随机临时目录**（`…/dsh-scout-profile-gate-joEEzL/`、`…-7WdYXI/`、`…-kF0vzW/`、`…-f3rMCx/`）与各自的 `pnpm pack` 产物，四个 binary 均从 npm 真实取用；每次冷启动的 pid 都变化（`57659→57724` / `58653→58714` / `59599→59673` / `60782→60842`）。

**结论：通过。** 91 s（与 0.9.2 的 93 s 同量级；pnpm store 已热）。

---

## 2. 攻击 README 版本守卫（本轮重点）

> 任务书要求：证明守卫不是戏法，并**独立尝试绕过它**——「找到任何能带着过期版本过绿的写法，都是真缺陷」。下面区分**期望被抓住的 9 种形态**（对照组）与**我实际绕过去的写法**（假阴性台账）。

### 2.1 守卫的结构（先读清楚它到底守什么）

| 实现 | 位置 | 覆盖 |
|---|---|---|
| 毫秒级守卫（每次 `npm test`/CI） | `tests/package.test.mjs`（`RELEASE_REFERENCE_PATTERNS` 5 条 + 成功判据小节扫描 + 6 道防假绿） | 两份 README |
| preflight（`check:release` 最前面，独立第二实现） | `scripts/check-release.mjs:206-383` | 两份 README |

- 5 条形态：`dsh-scout-<v>.tgz`（无条件）、`dsh-scout@<v>`（**仅在**「安装动词操作数 / 独占一行 / 带引号的 JSON 键」三种位置才算 live）、`dsh-scout#v<v>`（无条件）、` · dsh-scout <v>`（状态横幅，要求 `·` 分隔符）、`本次发布创建 \`v<v>\``（短语锚定）。
- 1 条小节扫描：成功判据小节里**所有**裸版本 token 必须等于 `package.json` version（小节标题锚点解析失败 = 直接失败，不是跳过）。
- 6 道防假绿：每份 README 至少 1 条 live 引用、至少 1 条 release-tag claim（短语没命中就红）、小节里至少 1 个 token、小节锚点必须解析、短语非空、失败必须带 `file:line`。

### 2.2 对照组：9 种「经典过期写法」全部被抓住（守卫不是戏法）

在 `/tmp` 副本里逐条改动 README，跑**真守卫**：

| # | 变更（把 0.9.3 改成过期值） | 毫秒级守卫 | preflight |
|---|---|---|---|
| C1 | 安装动词操作数 `add dsh-scout@0.9.2` | **RED** | **RED** |
| C2 | 成功判据小节里的裸 token `v0.9.2` | **RED** | — |
| C3 | 小节标题改成 `装上了吗？（成功判据）` | **RED**（锚点失败，不静默跳过） | — |
| C4 | 预发布形态 `dsh-scout@0.9.3-rc.1` | **RED** | — |
| C5 | `compatibility.json` 键 `"dsh-scout@0.9.2"` | **RED** | — |
| C6 | tarball 名 `dsh-scout-0.9.2.tgz` | **RED** | — |
| C7 | tag claim `本次发布创建 \`v0.9.2\`` | **RED** | **RED** |
| C8 | 状态横幅 `· dsh-scout 0.9.2` | **RED** | — |
| C9 | git ref `#v0.9.2` | **RED** | — |

> preflight 列：只对标注的两实现交叉用例实测（C1、C7 与 §2.3 全部攻击行、防假绿的 V1）；其余行的 preflight 未单测，标 `—`，不做推断。

防假绿也真的会响：把 tag claim 的短语改成「本次**将**创建」（规则再也匹配不到任何东西）→ **RED**，诊断逐字为 `README.md: no "release tag claim" reference matched. Either the sentence ... was reworded ... or it was removed`。小节标题后追加 HTML 锚点（`### 装上了吗（成功判据） <a id=…>`）→ **RED**（锚点正则失败即失败，方向正确：宁可误报不放过）。

⇒ **守卫不是戏法**：9/9 对照组变红，两道防假绿在「规则失效」时也会红，失败都带 `file:line`。

### 2.3 假阴性台账：能带着过期版本过绿的写法（**真缺陷**）

以下每一行都在冻结树上独立复现（变更 → 跑真守卫 → 观察颜色）：

| # | 写法（等效于「装的不是 0.9.3」） | 毫秒级守卫 | preflight | 归类 |
|---|---|---|---|---|
| R1 | 独占一行写成 `dsh-scout@^0.9.2` | **GREEN** | **GREEN** | **F-1** 范围写法 |
| R2 | 独占一行写成 `dsh-scout@>=0.9.2` | **GREEN** | — | **F-1** |
| R3 | 独占一行写成 `dsh-scout@=0.9.2`（semver 视为精确 `0.9.2`） | **GREEN** | — | **F-1** |
| R4 | 安装操作数写成 `add dsh-scout@~0.9.2` | **GREEN** | **GREEN** | **F-1** |
| R5 | 入口表里塞一行：\| 桌面 App（旧版） \| `desktop` \| `dsh-scout@0.9.2` \| | **GREEN** | **GREEN** | 位置型盲区 |
| R6 | **成功判据小节内**写 `` 安装 `dsh-scout@0.9.2` 后打开详情页，标题旁带 `v0.9.3` `` | **GREEN** | **GREEN** | **F-2**（小节契约被违反） |
| R7 | 正文冒号后写 `` 安装命令：`dsh-scout@0.9.2` `` | **GREEN** | **GREEN** | 位置型盲区 |
| R8 | 在 tag claim 那一行追加 `（旧版安装串为 \`dsh-scout@0.9.2\`）` | **GREEN** | **GREEN** | 位置型盲区 |
| R9 | 小节**之外**的正文写 `本次安装的是 v0.9.2` | **GREEN** | **GREEN** | 设计如此（裸 token 只守小节） |
| R10 | 正文标签行 `安装串：dsh-scout@0.9.2` | **GREEN** | **GREEN** | 位置型盲区 |
| R11 | HTML 注释 `<!-- 安装 dsh-scout@0.9.2 -->` | **GREEN** | **GREEN** | 位置型盲区（且不渲染） |
| R12 | 小节内同一行既有 live 引用 `i dsh-scout@0.9.3`、又有过期裸 token `` `v0.9.2` `` | **GREEN** | **RED** | **F-3** 两个实现不一致 |
| — | 把 Path 0 的 spec 直接删成裸包名 `dsh-scout`（版本引用凭空消失） | **GREEN** | — | 防假绿是**每文件至少 1 条**，不是每条（设计如此） |

关键输入的语义确认（`semver@7.8.5` 实测，非推断）：

```console
0.9.3          validRange="0.9.3"                 satisfies0.9.2=false
=0.9.2         validRange="0.9.2"                 satisfies0.9.2=true   ← 与精确写死 0.9.2 等价
~0.9.2         validRange=">=0.9.2 <0.10.0-0"     satisfies0.9.2=true
^0.9.2         validRange=">=0.9.2 <0.10.0-0"     satisfies0.9.2=true
>=0.9.2        validRange=">=0.9.2"               satisfies0.9.2=true
```

即 R1–R4 不是「无意义的写法」：`=0.9.2` 装的就是 0.9.2；`~0.9.2` / `^0.9.2` 在最小发布年龄挡住 0.9.3 时也回落到 0.9.2——正是这份 README 自己警告的那个场景。

### 2.4 当前文档集合本身是干净的（独立复核，不依赖守卫）

- **我自写的抽取器**（与两个出厂的都不共享代码）在两份 README 上得到：各 **8 条 live 引用**（install pin 3 / tarball 2 / git ref 1 / tag claim 1 / status banner 1），**全部等于 `0.9.3`**。
- 与出厂 preflight 的计数**互相印证**：preflight 报 `20 checked (4 inside the success-criteria section)` = 我的 16 条 + 两份 README 小节内各 2 个裸 token（`v0.9.3` 与横幅里的 `0.9.3`）——数字对得上，说明两边都没有数漏。
- 成功判据小节内**没有**非 `0.9.3` 的版本 token（我的独立小节定位器复核）。

**§2 结论**：守卫兑现了它的**窄承诺**（「忘改安装串」会红：9/9 对照组、2/2 防假绿、当前树 0 条过期引用），但**没有兑现它的宽表述**（「活的版本引用必须等于 package.json 的 version」）：范围写法（F-1）与小节内的 `@` 形态（F-2）能带着过期版本过绿，且两个实现在「同行 live 引用」上有分歧（F-3）。三条都记入 §7，**不阻塞发布**（当前文档无过期引用），但它们是真缺陷。

---

## 3. 独立复核：两个 GUI 面的论断（源码取证）

取证对象有两份，**分别**验证，避免「用 CLI 安装里的源码去证明桌面 App 的界面」：
`A` = npm 安装 `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/**`（0.2.0-rc.2）；
`B` = 桌面 App 自己的 `Contents/Resources/app.asar` 内 `/dsh/node_modules/@deepseek-ai/**`（从 asar header 解出，同名文件哈希与 A 不同——那是**同一源码的两次构建**：CSS 类名前缀 A=`X_2TxG_`、B=`ZVcBiW_`——但断言所需的**结构、行号、词典值完全一致**）。

| # | 待复核论断 | 取证结果 | 判定 |
|---|---|---|---|
| 3.1 | 侧边栏 Plugins 页的版本 Tag **只在插件详情页**渲染，列表卡片上没有版本 | `PackageCard`（列表卡片）的 `tags` 只有 `beta ? statusBeta : null` 与 `status==="problem" ? statusProblem : null`（A `client.js:2231,2235`；B 同行号）；版本 Tag 只在 `detailMain > titleRow`：`t("versionTag",{version: pkg.version})`（A `client.js:2468,2470`；B 同行号）。词典 zh `statusBeta:"实验性"` / `statusProblem:"异常"` / `versionTag:"v{version}"`；`BundleInfo.version?: string`（`dsh-plugin-manager/lib/types/types.d.ts:44-46`），页面里的 `pkg.version` 来自 `{...bundle.version === void 0 ? {} : {version: bundle.version}}`（A/B 均 `:796`） | **成立** |
| 3.2 | 设置 → **内置插件** → 插件列表**没有**版本字段 | wire 行 = `{ entryId, moduleName, enabled: !entry.disabled, fiberPhase, meta? }`（`dsh-host-plugin-inventory/lib/index.js:128-134`）；客户端 `dsh-client-ui-settings-plugin-inventory/lib/client.js` **全文出现 "version" 的次数 = 0**（A 与 B 均为 0）；客户端只读 `entry.entryId/moduleName/enabled/fiberPhase/meta` 与 `row.*` | **成立** |
| 3.3 | `enabled: !entry.disabled` 把 peer 不匹配投影成 GUI「已停用」 | `dsh-host-plugin-inventory/lib/index.js:131` **逐字**为 `enabled: !entry.disabled,`（A 与 B **同一行号**）；客户端把 `entry.enabled===true/false/undefined` 映射为「已启用 / 已停用 / 条件启用」、`fiberPhase==="failed"` 映射为「启动失败」、`active/pending/null` 映射为「运行中 / 等待依赖 / 未运行」（zh 词典在 B `client.js`，键 `enabledTag/disabledTag/conditionalTag/failedTag/active/pending/unobserved`）。注意优先级：`failed` 覆盖 `enabled` ⇒ 既是 disabled 又 failed 的行显示「启动失败」；被预设提供的行显示「预设中启用」而不是「已停用」（`presetEnabledTag`） | **成立**（文档的「已停用 / 启动失败 → 被宿主拒绝加载」覆盖了两种投影） |
| 3.4 | 设置里的中文导航名是「**内置插件**」 | `dsh-client-ui-settings-plugins/lib/client.js:143-144`：`nav: "内置插件", title: "内置插件"`（en `:135-136` = "Built-in plugins"） | **成立** |

补充取证（文档里其它 GUI 相关断言）：

- 分组名「会话插件 / 全局插件」= zh 词典 `presetTitle:"会话插件" / globalTitle:"全局插件"`，与文档/README 一致；`plugin_manager` 工具的动作名也逐个对上：`dsh-plugin-manager/lib/types/tools.js:13,16` 的 `name:'plugin_manager'`、`enum:['list_plugins','list_bundles','set_plugin','set_bundle','install_bundle','remove_bundle','list_version_exemptions','set_version_exemption']` ⇒ `docs/install-verification.md` D1/D2b/D3 用的 `list_version_exemptions` / `set_version_exemption`（`target`+`runtimeVersion`+`enabled`+`acceptRisk`）/ `install_bundle` **都真实存在**。
- 侧边栏入口：`PANEL_ID="plugins"`，`ctx.slots.inject("sidebar.panellist", …)` 且 `label: () => t("panel")`，zh 词典 `panel:"插件"`、en `panel:"Plugins"`（A/B 同）。
- ⚠️ **F-4**：中文文档（README.md:123/177/191/200/215 与 `docs/install-verification.md:10/34/65/77/81/105/111`）一律写「**侧边栏 → Plugins 页**」，但**中文界面渲染的是「插件」**（`panel:"插件"`）。英文 README 写 "sidebar → Plugins page" 与英文界面一致。详见 §7 F-4。

### 3.3 桌面「看不到 stderr / 没有日志」——活体复核（不是照抄评审）

App 正在运行，直接读进程 fd：

```console
$ lsof -p 61133 -a -d 0,1,2      # Electron 主进程
DeepSeek  61133  0r  CHR 3,2  /dev/null
DeepSeek  61133  1u  CHR 3,2  /dev/null
DeepSeek  61133  2u  CHR 3,2  /dev/null
$ lsof -p 61176 -a -d 0,1,2      # dsh host 子进程（app.asar/dsh/.../dsh-desktop-host）
DeepSeek  61176  0r  CHR 3,2  /dev/null
DeepSeek  61176  1u  unix 0x6559… ->0xc593…        # 管道（指向主进程）
DeepSeek  61176  2u  unix 0x2b14… ->0x4f12…        # 管道（指向主进程）
$ ls -la ~/Library/Logs/DeepSeek\ Harness/          # 空目录
$ find ~/Library/Logs -iname "*harness*" -o -iname "*dsh*"   # 只有上面这个空目录
```

⇒ 文档里「主进程 fd0/fd1/fd2 → `/dev/null`；host 的 fd1/fd2 是通向主进程的管道；日志目录为空」**逐项属实**（且是我自己量的）。`ctx.logger()` 无落盘出口也复核了：`dsh-app-boot/lib/index.js:4054-4067` 用一个内存 exporter 收集 `startupLogs`，只在 `StartupError` 分支挂到 `cause.startup`；`dsh: disabling profile plugin <row>: <reason>` 的唯一 stderr 写入点在 `dsh-app-boot/lib/index.js:2060`。

**未取证的部分**：GUI 两页**没有活体验证**（没有自动化，也没有人真的点开核对渲染）——与 `docs/install-verification.md:28` 的声明一致（见 §6）。

---

## 4. `/scout status` 纯追加、工具面、0.9.2 冻结表述回归

### 4.1 `git diff src/index.ts` 只有两处

```diff
+export const PLUGIN_VERSION = '0.9.3'          # 新增常量（带注释，说明为什么不从 package.json 读）
…
-          + ` (verified ${verified}, open ${scoutCase.claims.length - verified})`,
+          + ` (verified ${verified}, open ${scoutCase.claims.length - verified})`
+          + ` · dsh-scout ${PLUGIN_VERSION}`,
```

- 12 个工具的 `parameters` / `output.schema` / `execute` 返回值、render 预算常量、usage 字面量**均无 diff**（`git diff` 逐 hunk 核对；`MAX_RENDER_BYTES`、`usage:` 行、`output` 定义都不在 diff 里）。
- `package.json` 相对 HEAD 只有 `"version": "0.9.2"` → `"0.9.3"` 一行 ⇒ peer / engines / files / exports 全部未动，与 README「兼容范围没有变化」自洽。

### 4.2 动态复核（自有 ctx，不导入既有断言）

| 复核项 | 实测 |
|---|---|
| 前缀逐字节稳定 | `status.text.startsWith('[v093check] VERIFY · identity needs_verification · sources 0 / claims 0 (verified 0, open 0)')` 成立，且整行 === 前缀 + ` · dsh-scout 0.9.3`，横幅只出现 1 次 |
| `tests/acceptance.test.mjs` 原有前缀断言 | `:1675` 的 `assert.match(… /^\[cmd\] VERIFY · identity needs_verification/)` **一字未改**（`git diff tests/acceptance.test.mjs` 只有新增：文件头注释、`PLUGIN_VERSION` import、新测试 T-C），且仍在 124 基线里通过 |
| usage 行逐字节不变 | `/scout`（空参）与 `help` 都返回 `usage: /scout status <caseId> | /scout questions <caseId> | /scout report <caseId> | /scout export <caseId> [targetDir]`，与 `src/index.ts:1308` 逐字节相同 |
| 其它子动作不受影响 | `questions` / `report` 的成功返回里**不含**横幅 |
| 工具面未被动到 | 12 个工具挂载；`scout_start` / `scout_add_source` 的 `value` 键**恰好**是文档化的 7 个 `{ok,caseId,decision,identity,counts,changed,nextActions}`；`scout_report` = `{caseId,coverage,decision,report}`；`scout_questions` = `{caseId,questions}`；两个变更类工具的 render 都 ≤ 1024 B 且不含 `dsh-scout 0.9.3` |

### 4.3 0.9.2 冻结表述未被回退（README 本轮大改，重点查）

方法：**证明改动只发生在安装体验区域**，而不是逐句「看起来还在」：

1. **尾部逐字节相同**：`git show HEAD:README.md | tail -n +243` 与 `tail -n +327 README.md` **diff 为空**（README.en.md 同样）⇒ 冻结表述所在区域（`language` 语义、按下标逐条、F5 的 1024 B、G1、路线图）**未被任何一次编辑碰到**。
2. **搬迁块逐字保留**：`git diff -U0` 里被删除的 45 行中，除**安装章节本身重写的 14 行**（三条 CLI 路径 / `scout-demo` 命令 / Node 要求 / 最小发布年龄注解 / 兼容性细节第 2 条的原文）以外，工具清单 / 输出契约 / 命令与 Skill 三段**逐行逐字节地重新出现**在新位置（多重集比对：31/45 行逐字命中，其余 14 行恰为本轮故意重写的安装内容）。
3. **CHANGELOG 纯插入**：`git diff CHANGELOG.md` 没有任何 `-` 行 ⇒ 0.9.2 段（含 G1、D10/O10 关闭记录、发布事实）一字未动。
4. **单一「当前版本」标记**：全库 `grep 当前版本` 在**出厂文档**里只有 `docs/dsh-scout-product-contract.md:27` 的 `v0.9.3（当前版本）`（另两处命中在 `docs/verification-0.9.2.md` 的历史引文里，属于历史报告，不算漂移）。
5. **语义锚点**（自有套件 V6 断言）：中英 README 仍含 `按下标逐条` / `判定依据是「是否等于该下标的出厂默认」，不是编辑历史` / `entry by entry, by index` / `本部署的渲染语言` / `不校验标签与内容是否自洽` / `rendering language of this deployment` / `MAX_RENDER_BYTES = 1024` / `含省略号的整串也不会超过 1024 B` / `never exceeds 1024 B`，产品契约仍含 `已知边界 G1`。
6. **G1 的行为描述**沿用 0.9.2 的 7 个 `decide(` 调用点结论；本轮 `src/index.ts` 的 `decide` 相关代码零 diff。

⇒ **0.9.2 的冻结表述全部保持。**

### 4.4 「断言缺陷存在」用例数 = 0（本项目硬规矩）

核验方式：`grep -rn "characterization|characterise|characterize" tests/*.test.mjs` 的全部命中都是**注释**——`tests/acceptance.test.mjs:32`（历史说明："Round 1 pinned six defects as characterization tests … All seven were fixed"）与 `tests/verification-0.9.3.test.mjs:33,36`（本套件的自我约束说明）。不存在任何标记为 still-open / documented-boundary 的钉缺陷用例；本轮 8 项**全部是正向契约**，其中「守卫必须在过期 pin 上变红」是对**守卫职责**的正向断言，不是把产品缺陷钉住。

---

## 5. 文档↔实现逐条吻合（沿用 [verification-0.9.2.md §5](verification-0.9.2.md) 的方法）

| 位置 | 现文（要点） | 实现 / 实测 | 判定 |
|---|---|---|---|
| `README.md:117` / `README.en.md:117` | 桌面 profile 被 Electron 独占，`dsh plugin --profile desktop list` 与 `add` 都会被拒 | 实测三条子命令（`list` / `add` / `allow-version`）全部 `exit=1`、stderr 恰为 `error: profile "desktop" is managed exclusively by the Electron application`、`~/.dsh/profiles` 无任何 mtime 变化；源码 `dsh/lib/bin.js:35-36,119` | **一致** |
| `README.md:123` | 这是**按 profile 名**的硬拒绝，**所有** `dsh plugin` 子命令都命中，**包括** `allow-version` | `rejectElectronProfile(plugin, options.profile)` 在 `plugin` 子命令的 `action` 里、**任何**子命令分派之前调用（`bin.js:119`）；`allow-version` / `revoke-version` / `version-exemptions` 的原生处理在更下游（`lib/plugin-BGnVfe_D.js:16`），因此到不了 | **一致**（唯一 nuance 见 §8.5：`manageDesktopProfile` 是内部参数，CLI 入口恒为 `false`） |
| `README.md:126,137` / `:223` | 安装串锁 `dsh-scout@0.9.3`；逃生门 `dsh plugin --profile <name> version-exemptions / allow-version … --accept-risk` | 实测 `dsh plugin --profile web version-exemptions` → `{}` `exit=0`；`allow-version` 的用法/警告/写入在 `plugin-BGnVfe_D.js:16-48`；`compatibility.json` 由 `readProfileCompatibility`（`dsh-app-boot/lib/index.js:359-397`）读取：精确 `package@version` → 精确 DSH 版本数组，**不合规记录打印 warning 并忽略**、不改其他设置 | **一致** |
| `README.md:129` | 裸包名会被最小发布年龄静默跳过（0.9.2 发布后曾解析到 0.9.0）；写精确版本会记入 `minimumReleaseAgeExclude` 并打印 `Added 1 entry to …` | 该现象来自评审 §2/§6 的**一次真实安装实测**（pnpm 11.7.0，App 自带运行时）；我**未能**独立重跑 App 内安装（§9 U-B）。桌面运行时确为 pnpm 11.7.0（`runtime.json`） | **二手但已注明出处**（不构成不符） |
| `README.md:143` | `dsh` 没有 `profile list` 子命令（`profile` 会被当成 profile 名解析并报错） | 隔离 `DSH_HOME` 实测：`dsh profile list` → `exit=1`，`Error: dsh: profile "profile" does not exist; create it with 'dsh plugin --profile profile add <package>'`，且**没有**创建任何目录 | **一致** |
| `README.md:167,169` | git 路径 ref 必须是真实 tag；仓库自 `v0.3.0` 起共 **10 个 tag**（`v0.3.0 … v0.9.2`；`v0.9.1` 未打 tag）；本次发布创建 `v0.9.3` | 实测 `git tag -l` **恰好 10 个**：`v0.3.0 v0.4.0 v0.5.0 v0.6.0 v0.7.0 v0.8.0 v0.8.1 v0.8.2 v0.9.0 v0.9.2`，`v0.9.1` 缺失 ⇒ **评审「git tag 为空」的判断在本机为假**，实现者的订正正确 | **一致** |
| `README.md:171` | 桌面 App 自带 node / pnpm（实测 node 24.21.0 + pnpm 11.7.0），无需安装 Node；`Node ≥ 22.19` 只对 CLI / 门禁成立 | `runtime.json`：`desktopVersion 0.2.0-rc.2`、`node 24.21.0`、`pnpm 11.7.0`；`package.json engines.node >=22.19.0` | **一致** |
| `README.md:177-180` | 四条第 1、2 条见 §3.1-3.3；第 4 条 `/scout status` 末尾带 `· dsh-scout 0.9.3` | §4.2 实测：前缀逐字节稳定 + 横幅恰在末尾 | **一致**（第 1 条的**中文标签**不符，见 F-4） |
| `README.md:191,215` | 桌面看不到 stderr / 没有日志；禁用行被投影成「已停用」（`enabled: !entry.disabled`） | §3.3 活体 `lsof` + §3.1 源码行号 | **一致** |
| `README.md:239-245` | `compatibility.json` 平铺 JSON 写法与四条边界；运行时精确版本从 `~/.dsh/runtimes/*/runtime.json` 的 `desktopVersion` 读 | 字段名与取值实测一致；四条边界与 `dsh-plugin-manager/README.md:65`、`types/index.d.ts:62,73` 一致 | **一致** |
| `README.md:249-262` | 「已实测版本矩阵」记录 `dsh-scout@0.9.2` 四版本通过；「0.9.2 已发布到 npm（`dist-tags.latest` = 0.9.2）」；表头「0.9.2（已发布）」 | 历史事实（0.9.2 确已发布且通过）⇒ 非假陈述；但**0.9.3 的四版本结果尚未写进该表**（本轮实测 4/4，见 §1.4）。宪法层面这属于「历史叙述」，守卫也按设计不看它 | **一致但需在发版提交里更新**（观察项 O-5） |
| `CHANGELOG.md:5-9` | 0.9.3「**待发布**：本条目描述冻结为 0.9.3 的工作树；npm 元数据在发布后补记」 | 与状态自洽：0.9.3 尚未 publish / tag；README / CHANGELOG **未**出现「已发布 npm」声明 | **一致** |
| `docs/install-verification.md:118` | `check:release` 顺序 = README 版本引用守卫 → `npm test` → 四版本 `test:profile` → `pnpm pack --dry-run` | `scripts/check-release.mjs`：preflight（`:206-383`）→ `run('npm',['test'])`（`:385`）→ 版本循环（`:390-407`）→ `run('pnpm',['pack','--dry-run'])`（`:409`） | **一致** |
| `docs/install-verification.md:120` | 六步链 0.9.2 扩展、**0.9.3 未改动** `scripts/profile-smoke.mjs` | 指纹 `70ade56bff662abd` 与 0.9.2 报告完全相同 | **一致** |
| `docs/install-verification.md:133` | 默认 `DSH_VERSION=0.2.0-rc.2`；隔离临时 `DSH_HOME`；全量约 16 秒 | `profile-smoke.mjs:133` 默认值；实测 16 s；gate 4 的四个临时目录 | **一致** |
| `docs/dsh-scout-product-contract.md:27` + §5.3 | 0.9.3 不改运行时契约；两个 GUI 面分工；`enabled: !entry.disabled`（`dsh-host-plugin-inventory/lib/index.js:131`）；wire 行字段表 | §3 逐项取证，**行号与字段表都准确** | **一致** |
| `docs/dsh-scout-product-contract.md:16` | `v0.9.2` 段落保留（去掉「当前版本」字样） | 契约里只剩一个「当前版本」= v0.9.3 | **一致** |
| `docs/install-verification.md:114` | `dsh plugin --profile desktop` 的 `list`/`add`/`allow-version` **全部**被拒，是**参数解析层**的按名硬编码 | 实测三条全拒；`bin.js:35-36` 的 `rejectElectronProfile` 在 `plugin` 的 `action` 里 | **一致** |
| 发布事实（README / CHANGELOG） | 未声称 0.9.3 已发布 / 已 tag | 与工作树状态（`git status` 未提交、无 `v0.9.3` tag）自洽 | **一致** |

---

## 6. 独立确认 `docs/install-verification.md` 的诚实度

任务要求：确认它**没有把源码取证夸大成已验证**，也**没漏掉别的未验证项**。

| 检查点 | 复核 |
|---|---|
| 是否声明了「GUI 无活体验证」 | 有，且写法到位：`:28` 明确「界面名称、分组与状态词来自**源码取证**（四个包）+ profile 组合实测；**GUI 本身没有做过活体验证**（没有 GUI 自动化，没有任何人实际点开这两页核对过渲染结果）」，并说明 D3 / D4 / D6 带 **｜待人工点一次确认** | 
| 标记是否覆盖了所有「以这两页界面为判据或入口」的步骤 | D3（安装入口页）、D4（两个 GUI 面的判据）、D6（移除入口页）各带标记；D1 的入口是 `plugin_manager` 工具（非 GUI 渲染判据），D5 是会话内工具/命令行为，D7 的判据复用 D4 那一页（已带标记） | 
| 源码取证的具体断言是否属实 | §3 逐条复核：**全部属实**（含行号 131、wire 字段表、状态词、分组名、导航名） |
| 是否有把「评审单次实测」写成「已验证」 | 没有：`pendingBuilds: []`（`:71`）、bundle/loader 行（`:84-85`）、插件总数 198→199（`:86`）都写明「评审实测」；`runtime.json` 的 node/pnpm/`desktopVersion`（`:38-39`）我**独立复现**；`:110` 的 fd/日志断言我**活体复现** |
| 是否漏掉别的未验证项 | 有一条**同类但未被标记**的：中文界面里「侧边栏 → **Plugins** 页」的**标签本身**（zh 渲染为「插件」）——这正是它在 `:28` 末尾邀请的订正（"发现界面文案与本文档不符时，以实际界面为准并回来订正本文档"）。除此之外，Lane D 的动作本身就是人工步骤（D5/D6 的"真实调用/移除后重开对话"只能人工做），文档没有把它们写成已验证 | 
| 是否遗漏「0.9.3 的 App 内安装从未发生」 | 未遗漏：`:26` 说明参考实现是评审对 **0.9.2** 的实测；D3 的判定是新版 checklist 的**待执行项**，没有把 0.9.2 的安装结果冒充成 0.9.3 已验证 |

⇒ **诚实度：合格。** 唯一需要补的是 F-4 的标签订正（P3），不是夸大。

---

## 7. 缺陷台账

### 7.1 本轮结论

**运行时产品代码：0 条新缺陷。** 四道门禁全绿；`/scout status` 是纯追加；12 个工具的返回值 / schema / render 预算未被触碰；0.9.2 的冻结表述逐字节未变；文档措辞与实现对得上（§5）。

**新交付的 README 版本守卫：3 条真缺陷（F-1 / F-2 / F-3）**——它能抓住「忘改安装串」这个真实失败模式（9/9 对照组 + 2/2 防假绿 + 当前树 0 条过期引用），但**不能覆盖「换一种等价写法」**，这正是本轮主题（把静默漂移变成可发现）里最该被指出来的残差。

**文档标签：1 条（F-4）**——中文文档用了英文 GUI 标签。

### 7.2 F-1（中）安装位置认得出、范围写法看不见

| 阶段 | 内容 |
|---|---|
| **观察（本轮攻击）** | 守卫自己的注释把 live 定义为「pin 而不是 mention：**安装动词（`add`/`install`/`dlx`/`i`）的操作数**、独占一行的 spec、带引号的 `"pkg@ver"` 键」。但版本正则 `dsh-scout@(\d+\.\d+\.\d+…)` 要求 `@` 后**紧跟数字**，于是 `add dsh-scout@~0.9.2`、`dsh-scout@^0.9.2`、`dsh-scout@>=0.9.2`、`dsh-scout@=0.9.2` 全部匹配不到 ⇒ **GREEN**（两个实现都是） |
| **证据** | §2.3 R1–R4；`semver@7.8.5`：`=0.9.2` 的 `validRange` 就是 `0.9.2`，四者都 `satisfies("0.9.2")=true` |
| **为什么是真缺陷** | 守卫的**自述契约**是「活的版本引用必须等于 `package.json` 的 version」；这四种写法正文里就是活的安装引用，且 `=0.9.2` / `~0.9.2` 装的**可能正是 0.9.2**（后者在最小发布年龄挡住新版时回落——README 自己警告过这个场景） |
| **建议修法（不在本轮实现）** | 命中 `dsh-scout@<非版本 token>` 时不再按「非 live」放过，而是把整个 spec 与 release 字面量比较；或在 live 位置接受 `^ ~ >= <= > < =` 前缀并解析出被引用的版本 |
| **判定** | **真缺陷（P2）**，不阻塞发布（当前文档无此写法），但必须在下一轮文档改动前修掉 |

### 7.3 F-2（中）成功判据小节内的 `@` 形态双盲

| 阶段 | 内容 |
|---|---|
| **观察** | 成功判据小节被承诺「里面**每个**版本 token 都必须是本版本」。但小节扫描的 token 正则带 `(?<![\w.@/-])` —— **`@` 前缀被排除**；而形态守卫只认 live 位置。于是小节内写 `` 安装 `dsh-scout@0.9.2` 后… ``（表格单元格、正文冒号后、列表项里）**两个守卫都看不见** ⇒ GREEN |
| **证据** | §2.3 R6（毫秒级与 preflight 均 GREEN）；反证：同一行放一个裸 token `v0.9.2` 就会红（对照组 C2） |
| **判定** | **真缺陷（P2）**，是对小节扫描**自述契约**的直接违反。修法：小节扫描同时匹配 `dsh-scout@<semver>`（或去掉 lookbehind 里的 `@`，再与形态守卫去重） |

### 7.4 F-3（低-中）两个实现在「同行 live 引用」上不一致：`npm test` 绿、release gate 红

| 阶段 | 内容 |
|---|---|
| **观察** | 毫秒级守卫的 `reportedLines` 收的是**全部 live 引用**所在行（含与当前版本**相同**的引用），小节扫描会整行跳过；preflight 的 `reportedLines` **只收过期行**。于是「同一行里既有匹配的 live 引用、又有过期裸 token」时：`npm test` **GREEN（17/17 pass）**，同一棵树上 `check:release` **RED** |
| **证据（逐字）** | 把成功判据第 1 条改成 `1. i dsh-scout@0.9.3 后打开详情页，标题旁带 \`v0.9.2\`` → `node --test tests/package.test.mjs`：`ℹ pass 17 / ℹ fail 0`；`node scripts/check-release.mjs`（stub 后半段）→ `README.md:177 pins v0.9.2 in the success-criteria section but package.json is 0.9.3` + `dsh-scout release gate: FAIL` |
| **为什么是真缺陷** | 毫秒级那道是「每次 `npm test`/CI」的守卫；它比 release gate 更容易被人当唯一门禁。两实现同规则却不同结果，正是「6 道防假绿」想避免的情形 |
| **建议修法** | 让毫秒级守卫的 `reportedLines` 也只收**过期**行（与 preflight 对齐），或对同行 token 逐 token 判定 |
| **判定** | **真缺陷（P3）**，不阻塞发布 |

### 7.5 F-4（低）中文文档用了英文 GUI 标签

| 阶段 | 内容 |
|---|---|
| **观察** | 中文 README（`:123/:177/:191/:200/:215`）与 `docs/install-verification.md`（`:10/:34/:65/:77/:81/:105/:111`）写「**侧边栏 → Plugins 页**」，但中文界面里这个侧边栏入口渲染的是「**插件**」（`dsh-client-ui-plugin-manager` zh 词典 `panel:"插件"`、`title:"插件"`；en 才是 `panel:"Plugins"`）。英文 README 的 "sidebar → Plugins page" 与英文界面一致 |
| **影响** | 这是**路径 0（桌面 App）的第一步**：中文用户按文档找不到叫 "Plugins" 的入口。步骤本身已带「待人工点一次确认（安装入口所在页面）」，说明实现者也知道这一处未被活体验证 |
| **建议修法** | 中文文档统一写「侧边栏 → **插件**页（Plugins）」，或两份文档都写「侧边栏 → 插件 / Plugins 页」 |
| **判定** | **真缺陷（P3，文档）**，不阻塞发布（同一步骤已有「待人工确认」标记，且以实际界面为准的纪律已写明） |

### 7.6 我复核掉的「疑似缺陷」（记录，供 Lead 归档）

| # | 疑似 | 复核结论 |
|---|---|---|
| D-1 | 评审 §2 称「仓库 git tag 为空」，而 README/CHANGELOG 说 10 个 tag、并据此把 ref 写成真实 tag | **评审判断为假**：本机 `git tag -l` 恰好 10 个（`v0.3.0…v0.9.2`，无 `v0.9.1`），与实现者的订正一致。实现者「评审的 git tag 判断与事实不符」的措辞**成立** |
| D-2 | 「版本号只在详情页」是不是把「列表卡片也不显示版本」说反了 | 源码 + 桌面 App bundle 双份取证：列表卡片只有「实验性 / 异常」，版本 Tag 只在详情页 —— **成立** |
| D-3 | 「设置 → 内置插件 → 插件列表无版本字段」是不是漏看了 `meta` 里可能带的版本 | 客户端整文件 `"version"` 出现 **0 次**（两份 bundle 皆 0）；wire 行只有 `entryId/moduleName/enabled/fiberPhase/meta?` —— **成立** |
| D-4 | 「peer 不匹配 → GUI 已停用」是否只是推断 | `enabled: !entry.disabled` 在 `dsh-host-plugin-inventory/lib/index.js:131`（两份 bundle 同行号），客户端把 `enabled===false` 映射为 `disabledTag:"已停用"` —— **成立** |
| D-5 | 「中文导航名是『内置插件』」 | `dsh-client-ui-settings-plugins/lib/client.js:143` `nav:"内置插件"` —— **成立** |
| D-6 | 「桌面 App 没有 stderr、没有日志」是不是照抄评审 | 我在**运行中的 App** 上 `lsof` 复核：主进程 fd0/1/2 → `/dev/null`，host fd1/2 → 主进程管道；日志目录空 —— **成立** |
| D-7 | 「安装失败回滚 profile 清单与 lockfile」是否夸大 | `dsh-plugin-manager/README.md:58` 明说失败会恢复 `package.json` + `pnpm-lock.yaml`，**但刻意不恢复 `pnpm-workspace.yaml`**；文档只说「profile 清单与 lockfile」，**没有夸大** —— 成立（`pnpm-workspace.yaml` 不在文档承诺内） |

---

## 8. 已知边界（不是缺陷，但限定对外表述）

1. **README 版本守卫是「忘改安装串」的守卫，不是「等价写法」的守卫**（F-1/F-2/F-3）。对外表述不能写成「README 里任何版本引用都受门禁保护」——准确表述是「**精确版本形态**的安装 / 制品引用 + 成功判据小节内的裸 token 受保护」。
2. **裸 `v<semver>` 只在小节内被守**（设计如此）。「已实测版本矩阵」里的 `dsh-scout@0.9.2`、路线图里的历史版本、发布叙述按设计放过 ⇒ 它们若真的过期（例如发版时忘了把矩阵更新成本版本），守卫**不会**报。发版流程必须自己记得更新矩阵（本轮实测 0.9.3 四版本 4/4，见 §1.4，但 README 表里仍只有 0.9.2 的历史记录）。
3. **GUI 两页没有活体验证**（同 `docs/install-verification.md:28`）：本文的 GUI 结论全部是**源码/资源取证**（含桌面 App 自己的 bundle）+ profile 组合与进程 fd 的活体测量，**没有任何人点开过这两页核对渲染**。F-4 正是这类残差的一个实例。
4. **「装完无需重启、12 个工具即时注入」「pnpm 写 `minimumReleaseAgeExclude`」「`pendingBuilds: []`」**：只有评审 2026-10-13 对 **0.9.2** 的一次真实 App 安装记录（评审 §2/§6）作为证据；我**无法**在本轮复现 App 内安装（会改动用户的桌面 profile）。
5. **`manageDesktopProfile` 不是布尔常量**：`parseDshArgs(argv, version, manageDesktopProfile = false)`（`dsh/lib/bin.js:101,119`）——CLI 入口恒为 `false`，但 Electron 载体可以传 `true`（`app.asar` 里确实有 6 处引用）。对**CLI 用户**，「所有 `dsh plugin` 子命令都被拒」是准确的；对外表述不宜写成「源码里无条件拒绝」。
6. **`check:release` 的四版本矩阵与 CI 的实际运行**是两件事：本地 4/4 已复现，但 0.9.3 尚未 push / tag，GitHub Actions 的真实结果未验证（§9 U-D）。
7. **门禁的 SKIP 开关**（`DSH_SCOUT_SMOKE_SKIP_*`）本轮未使用；0.9.2 报告的边界（「跳过会降级覆盖但保持 exit 0」）**依然有效**，本轮没有重新验证。
8. **`tests/verification-0.9.3.test.mjs` 需要 `dist/`**（与 `tests/acceptance.test.mjs` 相同），`npm test` 会先 build；单独跑该文件前需 `npm run build`。

---

## 9. 未能验证的项

沿用 [verification-0.9.1.md §7](verification-0.9.1.md) / [verification-0.9.2.md §7](verification-0.9.2.md) 的台账，标注本轮状态；**新增项以 U-A…标记**。

| # | 项 | 本轮状态 |
|---|---|---|
| U11 | 导出 / 导入 / 回填 / 跨语言四条路径的真实宿主端到端 | **保持关闭**：`test:profile` 六步 + 两负向对照 + output-schema 对照，4/4 版本通过（§1.2/§1.4）；本轮未重新做 0.9.2 的故障注入（门禁脚本零 diff，注入结论仍有效） |
| U1 | 真实 LLM / agent loop、approval、流式 | **仍未验证**（无 agent 会话） |
| U2 | `/scout` 在真实宿主的 `command/run`/`command/done` 落盘 | **仍未验证** |
| U3 | 相对 `targetDir` + 真实 agent cwd | **仍未验证**（门禁按设计只走绝对路径） |
| U4 | 真实磁盘故障（ENOSPC / EACCES / kill -9） | **仍未验证** |
| U5 | DSH 源码里 `engines.dsh` 是否有读者 | **部分关闭**：本轮为 GUI/兼容性取证逐段读过 `dsh-app-boot`（`evaluatePluginCompatibility` 的 `includePrerelease:true` 在 `:300` 得到确认；`engines.dsh` 仍无读者），但**未**做全库审计 |
| U6 | GitHub Actions 实际运行 | **仍未验证**：0.9.3 未 push / tag |
| U7 | `docs/upstream/**` 内容正确性 | **仍未验证**（非交付物） |
| U8 | `scout_search` 对接真实 web provider | **仍未验证** |
| U9 | npm 发布链路（0.9.3） | **仍未验证**：未 publish / tag；文档**未**声称已发布（自洽） |
| U10 | URL 规范化全边界 | **仅抽样** |
| U12 | 多语言在真实模型会话中的可读性 | **仍未验证** |
| U13 | `autoPersist=true` 真实宿主落盘 | **仍未验证** |
| U14 | 真实进程中断下的撕裂导出 | **仍未验证** |
| U15 | 其余 6 个工具的真实宿主执行 | **仍未验证**（仅断言注册） |
| U16 | 门禁在 CI（非 macOS）上的耗时 / 稳定性 | **仍未验证** |
| **U-A**（新） | **GUI 两页的活体渲染**（侧边栏 Plugins 页 / 设置 → 内置插件 → 插件列表） | **仍未验证**：无 GUI 自动化、无人点开；F-4 即由此类残差暴露 |
| **U-B**（新） | **桌面 App 内的安装**（`plugin_manager.install_bundle`）与 `minimumReleaseAgeExclude` / `pendingBuilds` | **仍未验证**（只有评审对 0.9.2 的实测记录；我不改用户 profile） |
| **U-C**（新） | 0.9.3 在**桌面运行时**（而非 CLI 的 0.2.0-rc.2）上的组合与加载 | **未验证**：Lane C 的自建 profile ≠ `desktop` profile；`desktop` 只能由 App 管理 |
| **U-D**（新） | 范围写法（`=0.9.2` / `~0.9.2` 等）在 pnpm 里**真实安装**到哪个版本 | **未验证**：只验证了 semver 语义（7.8.5），没有真装 |
| **U-E**（新） | App 内 UI 语言为 zh 时的标签渲染 | **未验证**（F-4 的取证是词典源码；实际 App 可能按语言设置渲染 zh 或 en） |

---

## 10. 最终交付判断：**GO**

### 10.1 结论

**GO。** 0.9.3 的核心 KPI（把桌面 App 补成安装主路径、并给安装一条可执行判据）**达成且可复核**：四道门禁全绿；新写的桌面路径在 DSH 0.2.0-rc.2 的源码、桌面 App 自己的 bundle、以及**运行中 App 的进程 fd** 三层证据上都成立；`/scout status` 是纯追加且 usage 逐字节不变；0.9.2 的冻结表述逐字节未动；**运行时产品代码 0 条新缺陷**。

但本轮的**新守卫**（README 版本引用）有 3 条真缺陷（F-1/F-2/F-3）：它能抓住「忘改安装串」，**抓不住「换一种等价写法的过期引用」**。当前文档集合本身是干净的（独立抽取器 + 两个出厂实现互相印证 = 20 条引用全部指向 0.9.3），所以这 3 条**不阻塞本次发布**；它们限制的是**下一次文档改动**的安全网，必须随下一轮改动修掉。另有 1 条文档标签缺陷（F-4，中文文档写「Plugins 页」而 zh 界面是「插件」），同样是 P3。

### 10.2 理由

1. **四道门禁独立复现通过**：`npm test` 冻结基线 **124/124**（加入本轮 8 项后 **132/132**，耗时 1.89 s）；`test:profile` **PASS**（dsh 0.2.0-rc.2，六步 + 两个负向对照，16 s，pid 变化）；`pnpm pack --dry-run` **23 个文件**、`dsh-scout-0.9.3.tgz`；`check:release` **4/4 PASS**、exit=0、**`DSH_BIN` 未设置**（四个 binary 从 npm 真取，四个全新临时目录 + 四个随机 gate 目录）、91 s。
2. **对抗验证给出了守卫的真实边界**：9/9 经典过期形态变红、2/2 防假绿在规则失效时变红 ⇒ 守卫**不是戏法**；同时 **11 种写法带着过期版本过绿**（含小节内 `@` 形态与范围写法）⇒ 守卫的宽表述不成立，已如实记入缺陷台账。
3. **桌面论断三层取证**：CLI 安装与**桌面 App 自身 bundle** 双份源码取证（`enabled: !entry.disabled` 在两份里都是 `:131`；设置页客户端全文 0 个 "version"；zh 导航 = 「内置插件」；列表卡片无版本、详情页有版本）+ 运行中 App 的 fd 活体测量（主进程 → `/dev/null`，host → 管道，日志目录空）。
4. **纯追加有动态证据**：状态行 == 旧前缀 + ` · dsh-scout 0.9.3`（前缀逐字节、横幅恰一次）；`acceptance.test.mjs:1675` 的原前缀断言一字未改仍通过；12 个工具的 value 键与 render ≤1024 B 未变；`git diff src/index.ts` 只有常量与尾部追加两处。
5. **零回归**：`README*.md` 尾部（旧 243 行起）与 HEAD **逐字节相同**；搬迁的工具清单 / 输出契约 / 命令段落逐行逐字保留；`CHANGELOG.md` 是纯插入；产品契约只剩一个「当前版本」= v0.9.3。
6. **纪律达标**：「断言缺陷存在」的用例数 **0**；本轮 8 项全为正向契约；发现的守卫缺陷写入报告与 Lead，**未改任何实现**；验证期间**未修改任何既有文件**（209 文件逐字节差分证明）。
7. **诚实度**：`docs/install-verification.md` 如实声明了「GUI 无活体验证」并给 D3/D4/D6 标了『待人工点一次确认』；其源码取证断言逐条属实；评审的「git tag 为空」被实测证伪，实现者的订正正确。

### 10.3 交付前建议（不阻塞 GO）

| 优先级 | 项 | 改动 |
|---|---|---|
| **P2** | F-1：范围写法（`^` `~` `>=` `=`）在安装位置不再被当成 mention | `tests/package.test.mjs` + `scripts/check-release.mjs` 各一处规则 |
| **P2** | F-2：成功判据小节扫描补上 `dsh-scout@<semver>` 形态（或去掉 lookbehind 的 `@` 并去重） | 同上 |
| **P3** | F-3：毫秒级守卫的 `reportedLines` 改为只收过期行（与 preflight 对齐） | `tests/package.test.mjs` 一处 |
| **P3** | F-4：中文文档统一写「侧边栏 → **插件**页（Plugins）」 | README.md + `docs/install-verification.md` 共 12 处措辞 |
| **P3** | O-5：发版提交里把「已实测版本矩阵」从 0.9.2 更新为 0.9.3（本轮 4/4 已实测，§1.4） | README 两份 + 表格 |
| — | 以上都动到守卫/文档 ⇒ 改完必须重跑本文 §1 的四道门禁与 §2 的对抗矩阵（我的 `/tmp` 脚本可原样重跑） | — |

### 10.4 把 GO 变成 NO-GO 的条件

1. **冻结树变化而未重跑门禁**：`src/**`、`scripts/**`、`tests/**`、`package.json`、`pnpm-lock.yaml`、`locale/**` 任一偏离 §0 的实现集聚合 **`e863c712b2562c0a`** 后，未重跑四道门禁 ⇒ NO-GO。
2. **`npm test` 出现任何 fail**（尤其：重新出现「断言缺陷存在」的用例，或把 F-1/F-2/F-3 写成红断言钉住缺陷）⇒ NO-GO（违反项目硬规矩）。
3. **发布前任何出厂文档（两份 README / 产品契约 / install-verification / CHANGELOG）出现指向非 0.9.3 的「活」引用**——**注意守卫抓不全**（F-1/F-2/F-3 的写法会过绿）：必须在发布提交里用独立抽取器（本文 §2.4 的方法或 `node /tmp` 脚本）复核一遍；发现即 NO-GO 直到改正。
4. **把 P2-4 的守卫「完整性」当成本轮验收的一部分**：若 Lead 要求守卫对**等价写法**也成立，则 F-1/F-2/F-3 未修完 ⇒ NO-GO（修完并重跑 §2 矩阵即可转 GO，成本约 5 分钟）。
5. **`test:profile` 六步任一不再出 PASS 行**，或两个完成标记负向对照不再拒绝回填，或默认行为被改成带 `DSH_SCOUT_SMOKE_SKIP_*` 运行 ⇒ NO-GO。
6. **`check:release` 不再 4/4**；或重跑时 `DSH_BIN` 被导出、或用了 `DSH_ALLOW_OUT_OF_RANGE=1` ⇒ 该结论无效，等同 NO-GO。
7. **打包内容变化**：`pnpm pack --dry-run` 不再是这 23 个文件（集合不变，见 §11.1 的订正）、`exports` 六个目标缺失，或本轮验证文件 / `docs/verification-*.md` / `scripts/repro-*.md` 进入发布包 ⇒ NO-GO。
8. **发布声明与事实不符**：CHANGELOG 的「**待发布**」在 0.9.3 真正 publish / tag 之前被删除，或出现「已发布 npm / 已打 tag v0.9.3」而实际没有（或反之）⇒ NO-GO。
9. **对外表述超范围**：① 若把守卫写成「README 里任何版本引用都受门禁保护」（与 F-1/F-2/F-3 冲突）；② 若把「桌面路径已完整走查」写成已验证（与 `install-verification.md:28` 的残差声明、§3 的未活体验证冲突）；③ 若把「可选绑定 / 静默跳过」写成「所有宿主都能用 `/scout` 与 Skill」⇒ NO-GO。
10. **本文档或本轮套件被修改后未重跑**：`docs/verification-0.9.3.md` 或 `tests/verification-0.9.3.test.mjs`（`6d9bc45f844387ef`）一旦变更，本报告的 GO 即失效，须重跑 §1 与 §2 后再签发。

---

## 附录 A：复现本报告的完整命令清单

```sh
cd "<repo>"

# 四道门禁
npm test                                        # 冻结基线 124/124；加入本轮套件后 132/132
DSH_BIN=$(which dsh) npm run test:profile        # PASS (dsh 0.2.0-rc.2)，16 s
pnpm pack --dry-run                              # 23 个文件，exit=0
env -u DSH_BIN npm run check:release             # 必须不带 DSH_BIN；4/4 PASS，约 91 s

# 本轮独立套件（需要 dist/；npm test 会先 build）
node --test tests/verification-0.9.3.test.mjs    # 8/8

# 冻结树指纹（实现集聚合；排除验证者自己的套件）
find . -type f \( -path ./node_modules -o -path ./.git -o -path ./.pnpm-store -o -path ./dist \) -prune -o -type f -print \
  | grep -vE '^\./(node_modules|\.git|\.pnpm-store|dist)/' | grep -v '\.DS_Store' | LC_ALL=C sort \
  | while IFS= read -r f; do printf '%s  %s\n' "$(shasum -a 256 "$f" | cut -c1-16)" "$f"; done \
  | grep -E '  \./(src/|scripts/|tests/|package\.json|pnpm-lock\.yaml|locale/|cordis\.patch\.yml|tsconfig\.json)' \
  | grep -v 'verification-0.9.3.test.mjs' | LC_ALL=C sort | shasum -a 256 | cut -c1-16
# → e863c712b2562c0a（18 个文件）

# 守卫对抗（全部在 /tmp 副本；仓库零改动）
#   基座：rsync 仓库到 /tmp/guard0973/base（排除 node_modules/.git/dist/.pnpm-store）+ 补一个空 dist/
#   逐条改动 README.md 后，分别跑：
node --test tests/package.test.mjs               # 毫秒级守卫（RED/GREEN）
PATH=/tmp/guard0973/stub:$PATH DSH_VERSIONS=0.2.0-rc.2 node scripts/check-release.mjs
#   stub/ 里 npm、pnpm 是 `exit 0` 的桩 ⇒ 退出码只由 preflight 决定

# 桌面 CLI 拒绝
dsh plugin --profile desktop list; dsh plugin --profile desktop add dsh-scout@0.9.3
dsh plugin --profile desktop allow-version dsh-scout@0.9.3 --dsh-version 0.2.0-rc.2 --accept-risk
# 三条均 exit=1 + `error: profile "desktop" is managed exclusively by the Electron application`
DSH_HOME=/tmp/probe-home dsh profile list        # exit=1：profile 被当 profile 名解析（隔离 DSH_HOME，零副作用）
dsh plugin --profile web version-exemptions      # {} exit=0（逃生门子命令存在，且 desktop 之外可用）

# 桌面 GUI 取证（桌面 App 自身 bundle）
#   解析 /Applications/DeepSeek Harness.app/Contents/Resources/app.asar 的 header（JSON 起点 16，长度 = UInt32LE(12)，
#   数据起点 = 16 + len + 4），抽出：
#   /dsh/node_modules/@deepseek-ai/dsh-client-ui-plugin-manager/lib/client.js
#   /dsh/node_modules/@deepseek-ai/dsh-host-plugin-inventory/lib/index.js
#   /dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-plugin-inventory/lib/client.js
#   /dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-plugins/lib/client.js
grep -n 'enabled: !entry.disabled' <host-plugin-inventory>/lib/index.js      # → 131
grep -c 'version' <settings-plugin-inventory>/lib/client.js                   # → 0

# 桌面可见性活体测量
lsof -p $(pgrep -f "DeepSeek Harness$" | head -1) -a -d 0,1,2   # 主进程 fd0/1/2 → /dev/null
lsof -p <dsh host pid> -a -d 0,1,2                              # fd1/fd2 → unix 管道
ls -la ~/Library/Logs/DeepSeek\ Harness/                        # 空
```

## 附录 B：本次验证的边界声明

- 本报告只对 §0 指纹所列的**这一个**工作树状态负责；验证开始与结束两次采样完全一致，且**没有修改任何既有文件**（唯一新增是本报告的套件与本文档）。
- 全部守卫攻击在 `/tmp/guard0973/**` 副本上完成；`check:release` 的 preflight 用例把 npm/pnpm 换成 `exit 0` 的桩，**被验证的 preflight 本身是出厂代码**（这不影响「preflight 是否 fail-fast」的结论：桩只在 preflight 通过之后才会被调用，我用日志文件证明失败用例根本没走到 npm）。
- GUI 结论是**源码 + 桌面 App bundle + 活体进程 fd** 的取证，**不是** GUI 活体验证（§3、§9 U-A）。
- 本轮未执行 `git commit` / `git push` / `git tag` / `npm publish`；未触碰 `docs/upstream/**`、`scripts/archive-official-docs.mjs`、`scripts/enrich-official-docs-index.mjs`。
- 报告中的「实测输出」为终端原文摘录（省略号 `…` 表示省略的无关行），未改写数字或诊断文本。
---

# 复验（第二轮）：F-1~F-4 修复后的最终 GO/NO-GO

> 触发：第一轮 GO 签发后工作树又变了（Lead 批准，含一处越界批准），按 §10.4 第 10 条重跑。**本节是最终结论**；§0–§10 是第一轮冻结态（实现集聚合 `e863c712b2562c0a`）的记录，其中 F-1~F-4 已在本轮修掉、`24 个文件` 的计数错误已在 §11.1 订正，其余文字保留作为历史。

## 11.0 本轮变动与新冻结指纹

**实现 + 门禁 + 测试集（18 个文件，排除本轮两个验证文件）聚合指纹：`7ea717d9c4179323`**（第一轮为 `e863c712b2562c0a`）。

| 文件 | 第一轮 sha256[0:16] | 第二轮 sha256[0:16] | 本轮 delta（逐行核对） |
|---|---|---|---|
| `src/index.ts` | `3142abab04518acb` | `3142abab04518acb` | **未变**（`/scout status` 与 12 个工具零改动） |
| `README.md` | `883cb4b8cf9c01f1` | `aa4c4ca32fa046d2` | 仅 5 处 `Plugins 页` → `插件页` |
| `README.en.md` | `213932f9c8f346bc` | `9b36477d80f816bc` | 仅词表修正（卡片标签 `Experimental/Problem`；tag `Enabled/Disabled/Failed/Conditional`；status `Running/Failed to start/Waiting for dependencies/Not running`）；侧边栏仍 "Plugins page" |
| `CHANGELOG.md` | `362850103ce30fbb` | `bb04d7986c049438` | 仅 6 处同一标签替换 |
| `docs/dsh-scout-product-contract.md` | `4eaf9ab5358c8ef4` | `6f01f7399d925211` | 仅 2 处同一标签替换 |
| `docs/install-verification.md` | `59dc9db2eb5f356e` | `a4abf9ed4182d326` | 仅 8 处同一标签替换（word-diff 排除标签行后为空） |
| `tests/package.test.mjs` | `4b325ee2bd85031f` | `f4ef102ececc7137` | 守卫规则改造（fail-closed + 小节扫描 + 去重统一）+ 1 个新用例 |
| `scripts/check-release.mjs` | `b57164b1e271828d` | `e59fa213760b7619` | preflight 同步同一套语义（第二实现） |
| `tests/verification-0.9.3.test.mjs`（验证者） | `6d9bc45f844387ef` | `294c3ccdce5400f4` | V4 矩阵扩到 17 组；V5 加「8 条精确引用 + 1 个占位符」计数断言 |

技术要点（我读源码确认，不是采信实现者结论）：

- **F-1 修法**：`dsh-scout@<token>` 的 token 字符集改为 `[0-9A-Za-z.*^~<>=|+-]+`（不再要求 `@` 后紧跟数字），再用 `classifySpecifier()` 分三类：精确版本 → 比较；`VERSION_OR_RANGE_SPECIFIER = /^[\^~<>=|\s]*(?:v?\d|\*|x)/i` 命中 → **problem（fail-closed）**；其余（`latest`、`<version>`）→ mention。⇒ 范围/比较写法不再"看不见"。
- **F-2 修法**：小节扫描 `SECTION_VERSION_TOKEN` 的 lookbehind 从 `(?<![\w.@/-])` 放宽为 `(?<![\w./-])`（`@` 不再被排除）⇒ 小节内的正文/表格 `dsh-scout@0.9.2` 会被看见。
- **F-3 修法**：两个实现的 `reportedLines` 统一为「**只**收已被形态守卫判为违规的行」；测试侧把 `guardFailures()` 抽成单一裁决函数，preflight 侧同步同一分支 ⇒ 同一棵树上不再出现「`npm test` 绿 / release gate 红」。

## 11.1 自纠：上一节的「24 个文件」是错的（实际 23）

第一轮报告 §1.3 / §5 / §10.4 与附录 A 写「`pnpm pack --dry-run` 24 个文件」。复验时逐行点数，实际是 **23**：

- `pnpm pack --dry-run` 的 `Tarball Contents` 逐行列出 **23 条**（编号 1–23，本轮已贴出）；
- `files` 白名单算术：`dist` 6 + `cordis.patch.yml` 1 + `locale` 2 + `assets` 1 + `scripts` 2 + `README.md` 1 + `LICENSE` 1 + 契约 1 + fixture 1 + `tests` 4 + `README.en.md` 1 + `CHANGELOG.md` 1 + `package.json`（始终包含）= **23**；
- 产品自身的记录也是 23：`CHANGELOG.md` 的 0.9.2 发布条写明已发布 tarball「**23 个文件**」。

⇒ 两轮的**文件集完全相同**（列表逐条一致），错的只是第一轮（以及它沿用的 [verification-0.9.2.md](verification-0.9.2.md) §1.3）的计数。本节已把前面 4 处改为 23；§10.4 第 7 条的不变式是**文件集**，判定不受影响。

## 11.2 四道门禁（第二轮原始输出）

### 11.2.1 `npm test` — **133/133**

```console
$ npm test
ℹ tests 133
ℹ pass 133
ℹ fail 0
ℹ duration_ms 2358.238541
exit=0
```

133 = 第一轮冻结基线 124 + 验证者套件 8 + 守卫本轮新增 1 个用例（`fails closed on ranges and reports a section token once per line`；`tests/package.test.mjs` 由 17 个用例增至 18 个）。与 Lead 给的基线一致。

### 11.2.2 `DSH_BIN=$(which dsh) npm run test:profile` — PASS（16 s）

```console
$ DSH_BIN=$(which dsh) npm run test:profile
dsh-scout profile smoke: PASS (dsh-scout 0.9.3, dsh 0.2.0-rc.2)
  step 1 registry+create: PASS (12 tools mounted, …, scout_start content=166B < 1024, zh report 382 Han chars)
  step 3 cold restart: PASS (second boot on the same DSH_HOME/profile, pid 81559 → 81561)
  not covered: no agent/LLM/approval path (agent unset ⇒ absolute dirs only), 6/12 tools executed, report asserted structurally, autoPersist stays false, token budget covers rendered content only
exit=0
```

### 11.2.3 `pnpm pack --dry-run` — **23 个文件**，exit=0

```console
$ pnpm pack --dry-run
package: dsh-scout@0.9.3
Tarball Details
dsh-scout-0.9.3.tgz
exit=0
# Tarball Contents 逐行 23 条：assets/icon.svg, CHANGELOG.md, cordis.patch.yml, dist/{i18n,index,model}.{d.ts,js}(6),
# docs/dsh-scout-product-contract.md, docs/fixtures/dsh-scout/snapmaker-hr-head.json, LICENSE, locale/{en,zh}.json,
# package.json, README.en.md, README.md, scripts/{check-release,profile-smoke}.mjs, tests/{acceptance,model,package,tools}.test.mjs
$ … | grep -cE "verification|install-verification|dsh-scout-install-ux"   # → 0
```

### 11.2.4 `env -u DSH_BIN npm run check:release` — 4/4 PASS（91 s）

```console
$ env -u DSH_BIN npm run check:release      # 开始时 DSH_BIN before: [<unset>]；23:36:42 → 23:38:13
dsh-scout release gate
  declared engines.dsh: >=0.1.0-rc.6 <0.3.0-0
  profile matrix: 0.1.0-rc.6, 0.1.2-rc.1, 0.2.0-rc.2, 0.2.1-alpha.2 (default matrix)
  readme release references: 20 checked (4 inside the success-criteria section), all pinned to 0.9.3
ℹ tests 133 / ℹ pass 133 / ℹ fail 0
[ok] dsh 0.1.0-rc.6     — profile smoke passed (satisfies engines.dsh ">=0.1.0-rc.6 <0.3.0-0")
[ok] dsh 0.1.2-rc.1     — profile smoke passed (satisfies engines.dsh ">=0.1.0-rc.6 <0.3.0-0")
[ok] dsh 0.2.0-rc.2     — profile smoke passed (satisfies engines.dsh ">=0.1.0-rc.6 <0.3.0-0")
[ok] dsh 0.2.1-alpha.2  — profile smoke passed (satisfies engines.dsh ">=0.1.0-rc.6 <0.3.0-0")
dsh-scout release gate: PASS (4 DSH versions, >=0.1.0-rc.6 <0.3.0-0)
exit=0
```

计数交叉验证：preflight 的 `20 checked` = 我独立抽取器的 16 条精确 live 引用（每份 README 8 条）+ 小节内 4 个裸 token（每份 2 个：`v0.9.3` 与横幅里的 `0.9.3`）。数字与第一轮一致，说明守卫改造没有漏数或多算。

## 11.3 对抗矩阵重跑（同一批 `/tmp` 副本注入，仓库零改动）

矩阵扩到 34 组（形态矩阵 21 + 两实现交叉 12 + F-3 分歧 1）；下表列关键行，颜色为 `毫秒级守卫 / preflight`。

| # | 变更 | 第一轮 | **第二轮** | 第二轮诊断（逐字，节选） |
|---|---|---|---|---|
| **R1** | 独占一行 `dsh-scout@^0.9.2` | GREEN/GREEN | **RED/RED** | `README.md:126 dsh-scout@^0.9.2 uses the unsupported specifier "^0.9.2"; … (npm install pin)` |
| **R4** | `add dsh-scout@~0.9.2` | GREEN/GREEN | **RED/RED** | `README.md:137 dsh-scout@~0.9.2 uses the unsupported specifier "~0.9.2"; …` |
| **R6** | 小节内正文 `安装 \`dsh-scout@0.9.2\` 后…` | GREEN/GREEN | **RED/RED** | `README.md:177 pins 0.9.2 in the success-criteria section but package.json is 0.9.3` |
| **R12** | 同一行：正确 pin `i dsh-scout@0.9.3` + 过期裸 token `` `v0.9.2` `` | GREEN/**RED** | **RED/RED** | `README.md:177 pins v0.9.2 in the success-criteria section but package.json is 0.9.3` |
| R2 | 独占一行 `dsh-scout@>=0.9.2` | GREEN/— | **RED** | 同 R1 形态（comparator） |
| R3 | 独占一行 `dsh-scout@=0.9.2`（就是精确 0.9.2） | GREEN/— | **RED** | 同 R1 形态 |
| R13 | 独占一行 `dsh-scout@0.9`（部分版本） | — | **RED** | 同 R1 形态 |
| R14 | 独占一行 `dsh-scout@*` | — | **RED** | 同 R1 形态 |
| R15 | 独占一行 `dsh-scout@x` | — | **RED** | 同 R1 形态 |
| R6b | 小节内正文 `dsh-scout@^0.9.2` | — | **RED** | 小节扫描看见 `0.9.2` |
| R12b | 同行两个都过期（应只报一次） | — | **RED** | 形态守卫报 1 条，小节扫描不重复 |
| C1/C2/C3/C6/C7/C9 | 经典过期形态（操作数 / 小节裸 token / 锚点改写 / tarball / tag claim / git ref） | RED | **RED**（无回退） | 各自诊断带 `file:line` |
| FP2–FP5 | `@latest`、`@<version>`、小节内**正确**的 `dsh-scout@0.9.3`、`dsh-scout-0.9.3.tgz。` | — | **GREEN**（无误报） | — |

**F-1 / F-2 / F-3 三项均按任务书要求由 GREEN 转为 RED/RED，且控制组无回退、合法写法无误报。**

## 11.4 独立抽取器复核当前 README 集合（不用实现者的词表/正则）

我自写的抽取器（`/tmp` 脚本，与两个出厂实现都不共享代码）在第二轮 README 上得到：

| 文件 | live 引用 | 精确=当前版本 | 精确=过期 | 占位符 | dist-tag | 范围/比较 |
|---|---|---|---|---|---|---|
| `README.md` | 9 | **8** | **0** | 1（`dsh-scout@<new-version>`，第 196 行「卸载与升级」） | 0 | 0 |
| `README.en.md` | 9 | **8** | **0** | 1（同上） | 0 | 0 |

形态分布（每份相同）：install pin 4（其中 1 个是占位符）+ tarball 2 + git ref 1 + tag claim 1 + status banner 1。
⇒ **当前 README 集合干净**：没有任何过期引用、没有范围/比较写法、没有 dist-tag 冒充安装串；唯一的非版本 live spec 是文档化的升级占位符。该结论与出厂 preflight 的 `20 checked`、以及守卫自身的绿灯三方一致。

## 11.5 F-4 标签独立复核（我自己读 bundle 词典，不采信实现者词表）

取证对象与第一轮相同：`A` = npm 安装的 `@deepseek-ai/dsh` 0.2.0-rc.2；`B` = 桌面 App 自己的 `app.asar` 内 bundle。**两份词典逐键一致**，下表为 B 的 zh/en 实际渲染值（A 相同）：

| 面 | 键 | zh（中文界面实际渲染） | en |
|---|---|---|---|
| 侧边栏面板（`dsh-client-ui-plugin-manager`） | `panel` / `title` | **插件** | Plugins |
| 面板内列表标题 | `bundlesTitle` | 已安装 | Installed |
| 列表卡片标签 | `statusBeta` / `statusProblem` | 实验性 / 异常 | **Experimental / Problem** |
| 详情页版本标签 | `versionTag` | `v{version}` | `v{version}` |
| 设置导航（`dsh-client-ui-settings-plugins`） | `nav` / `title` | **内置插件** | Built-in plugins |
| 设置 tab（`dsh-client-ui-settings-plugin-inventory`） | `tab` | 插件列表 | Plugin list |
| 分组 | `presetTitle` / `globalTitle` | 会话插件 / 全局插件 | Session plugins / Global plugins |
| **标签（tag）** | `enabledTag` / `disabledTag` / `conditionalTag` / `failedTag` | 已启用 / 已停用 / 条件启用 / 启动失败 | Enabled / Disabled / Conditional / **Failed** |
| **运行状态（status）** | `active` / `failed` / `pending` / `unobserved` | 运行中 / 启动失败 / 等待依赖 / 未运行 | Running / **Failed to start** / Waiting for dependencies / Not running |

**判决（谁对）**：**实现者是对的，Lead 转述的英文词表把 tag 与 status 混了**——英文**标签**是 `Failed`（`failedTag`），英文**运行状态**才是 `Failed to start`（phase `failed`）；卡片标签 `Experimental` / `Problem` 与 Lead 转述一致、也正确。文档的最终写法与此完全吻合：`README.en.md:178` 用 "Enabled tag / Running status，not Disabled / Failed / Conditional"，`:191` 用 "Enabled / Disabled / Failed / Conditional tags and Running / Failed to start / Waiting for dependencies / Not running statuses"。

**与最终文档逐处对照**（全部通过）：

| 文档 | 检查 | 判定 |
|---|---|---|
| `README.md:123/177/191/200/215` | 5 处「侧边栏 → **插件页**」＝ zh `panel:"插件"` | **一致** |
| `README.md:177/178/191` | 「已安装」「实验性 / 异常」「设置 → 内置插件 → 插件列表」「会话插件 / 全局插件」「已启用 / 已停用 / 启动失败 / 条件启用」「运行中 / 启动失败 / 等待依赖 / 未运行」 | **一致** |
| `README.en.md:123/177/200/215` | "sidebar → Plugins page" ＝ en `panel:"Plugins"`（保持英文标签，正确） | **一致** |
| `README.en.md:177/178/191` | Installed / Experimental / Problem / Built-in plugins / Plugin list / Session plugins / Global plugins / tag 与 status 两套词表 | **一致** |
| `docs/install-verification.md`（8 处） | 「侧边栏 → 插件页」+ 全部 zh 标签/状态词 | **一致** |
| `CHANGELOG.md`（6 处）、`docs/dsh-scout-product-contract.md`（2 处，**随 npm 包分发**） | 同上；越界修复已由 Lead 批准 | **一致** |
| 出厂文档残留 | `grep "Plugins 页"` 在 README×2 / CHANGELOG / 契约 / checklist 中 **0 命中**（仅本文档 §3/§7 作为历史引文保留） | **一致** |

⇒ **F-4 关闭**，且修复面覆盖了会随包分发的契约文件。

## 11.6 0.9.2 冻结表述回归（README 又改过一轮）

| 检查 | 结果 |
|---|---|
| `README.md` / `README.en.md` 尾部（HEAD 第 243 行起 = 现第 327 行起）逐字节 | **与 HEAD 完全相同**（`diff` 无输出） |
| `CHANGELOG.md` 相对 HEAD | **纯插入**（`git diff` 只有 1 行 `---` 头，无内容删除） |
| 出厂文档「当前版本」标记 | 仅 `docs/dsh-scout-product-contract.md:27` 的 `v0.9.3（当前版本）` |
| 产品契约本轮 delta | 仅 2 处标签替换（word 级核对） |
| 验证者套件 V6（语义锚点：按下标逐条 / 渲染语言 / 1024 B / G1） | **通过**（133/133 内含） |

⇒ **零回退。**

## 11.7 残余类别（按 Lead 的范围上限：只记录，不再要求修复）

第二轮修复后我复测的残余集合（全部为「能带着过期版本过绿」或「合法写法误报」，都不是当前文档的实际形态）：

| # | 类别 | 复现 | 结果 | 我的严重度判断 |
|---|---|---|---|---|
| RE1 | 表格单元格里的过期精确 pin | 入口表加一行：\| 桌面 App（旧版） \| `desktop` \| `dsh-scout@0.9.2` \| | GREEN | 低：非「live 位置」，守卫自述范围外 |
| RE2 | 冒号后正文里的过期 pin | `安装命令：\`dsh-scout@0.9.2\`` | GREEN | 低：同上 |
| RE3 | 小节**之外**的裸 `v0.9.2` | 正文插一句「本次安装的是 v0.9.2」 | GREEN | 低：裸 token 只在小节内受守（设计） |
| RE4 | `@latest` 当安装串 | 独占一行 `dsh-scout@latest` | GREEN | 低：`npa` 归类为 tag（移动目标，不是过期 pin）；文档本就警告不要写裸名 |
| RE5 | **非 live 位置**的范围写法 | `安装串：dsh-scout@^0.9.2` | GREEN | 低：fail-closed 只覆盖 live 位置 |
| RE6 | HTML 注释里的过期 pin | `<!-- 安装 dsh-scout@0.9.2 -->` | GREEN | 极低：不渲染 |
| **RE7（新）** | **npm alias 协议** | `add npm:dsh-scout@0.9.2` 或 `add dsh-scout@npm:dsh-scout@0.9.2` | **GREEN/GREEN** | 低-中：`npm-package-arg` 确认两者都是合法 `alias` spec（装的正是 0.9.2）；token 在 `npm:`/第二个 `@` 处断开，live 位置判定失效。现实中没人这样写，但它是**真 bypass 类别**，建议下一轮顺手覆盖 |
| **RE8（新）** | `@` 后带空白 | `add dsh-scout@ 0.9.2` | **GREEN** | 极低：`npa` 归一为 version `0.9.2`；字符集不容空白 ⇒ 漏判。写法极不自然 |
| **RE9（新，误报）** | 精确 pin + 句号/`+build` 元数据 | `add dsh-scout@0.9.3.`、`add dsh-scout@0.9.3+build.1`、`add dsh-scout@0.9.3-` | **RED/RED**（fail-closed） | 极低：`npa` 把 `0.9.3.` 归为 tag、`0.9.3+build.1` 归为 version；守卫一律拒绝并提示"写精确版本"——方向安全（不会放过过期串），只是提示词对后两种略绕。冻结文档全用代码跨度，**当前零误报** |
| **RE10（新，措辞）** | 两实现补救文案里的常量名不同 | 测试侧提示 `RELEASE_REFERENCE_PATTERNS`，preflight 提示 `README_REFERENCE_PATTERNS` | 两条 RED 文案不一致 | 纯 cosmetic |
| **RE11** | `dsh-scout@<version>` 占位符 | 文档第 196 行 `add dsh-scout@<new-version>` | GREEN（**有意放行**） | 无：`npa` 本就判为非法 tag，它是占位符不是版本声明 |

**是否阻塞发布？不阻塞。** 理由：① 冻结文档集合已被我的独立抽取器验证干净（8 条精确 + 1 个占位符，0 过期 / 0 范围）；② 所有 bypass 都需要现实文档不会采用的拼写，且都落在守卫**自述的规则集之外**（四种 live 位置的精确写法）；③ RE9 是**误报**而非漏判——它只会让维护者多看一眼，永远不会放过过期串，且当前零触发；④ 守卫是维护者辅助工具、不是安全边界（Lead 已封顶范围）。唯一我认为**值得**在下一轮顺手修的是 **RE7（alias）**：它是合法安装 spec、装的确实是具体版本，属于"等价写法"这一类；但优先级 P3，不改变本轮结论。

## 11.8 最终判断：**GO**

### 11.8.1 结论

**GO（复验通过）。** 第一轮的 4 条缺陷全部关闭：**F-1 / F-2 / F-3** 由 `GREEN` 修成 **RED/RED**（含我要求点名的 R1 / R4 / R6 / R12，并额外覆盖 `>=` `=` `0.9` `*` `x` 与「同行双过期」），控制组无回退、合法写法无误报；**F-4** 的标签修复经我**独立读取两份 bundle 词典**逐处核对，中文侧「插件页」与全部 zh 标签/状态词、英文侧 "Plugins page" 与修正后的 tag/status 两套词表**完全吻合**，且会随包分发的契约文件也已修。四道门禁全绿（`npm test` **133/133**、`test:profile` PASS、`pack` exit=0 **23 个文件**、`check:release` **4/4 PASS**）；0.9.2 冻结表述零回退；残余类别 11 条已记录，**无一条严重到应阻塞发布**。

### 11.8.2 理由

1. **四项修复可复核**：R1/R4/R6/R12 两实现均 RED/RED，诊断带 `file:line`；修法本身读源码确认（token 分类 fail-closed、lookbehind 放宽、去重语义统一）。
2. **无假绿回退**：9 组经典控制形态仍全红，防假绿（tag claim 短语、小节锚点）仍会响；合法写法（`@latest`、占位符、小节内正确 pin、CJK 句号）不会误报。
3. **当前文档集合干净**：我的独立抽取器 8 精确 + 1 占位符 / 无过期 / 无范围；与出厂 preflight 的 20 checked 互证。
4. **标签修复正确**：zh/en 两侧逐键对照 bundle 词典；顺带判定"英文 tag = `Failed`、status = `Failed to start`"——**实现者正确，Lead 转述有误**。
5. **门禁与冻结树**：133/133、PASS、23 文件、4/4 PASS（`DSH_BIN` 未设置、91 s、四个全新临时目录）；README 尾部与 HEAD 逐字节相同、CHANGELOG 纯插入、契约只剩一个「当前版本」。
6. **自纠**：第一轮的「24 个文件」已订正为 **23**（文件集不变，见 §11.1）。
7. **纪律**：本轮只改 `tests/verification-0.9.3.test.mjs` 与本文档；`src/`、`scripts/`、README、CHANGELOG、`package.json`、`docs/` 其它文件一律未动。

### 11.8.3 把 GO 变成 NO-GO 的条件（覆盖 §10.4 的旧条件）

1. **冻结树变化而未重跑门禁**：任一实现/文档文件偏离 §11.0 的轮二指纹（实现集聚合 **`7ea717d9c4179323`**）后，未重跑 §11.2 的四道门禁 ⇒ NO-GO。
2. **四项修复回退**：R1/R4/R6/R12 任一行不再 RED/RED（我的 `tests/verification-0.9.3.test.mjs` V4 矩阵即可复核），或防假绿不再响 ⇒ NO-GO。
3. **发布前任何出厂文档出现过期/非精确的「活」引用**——**注意 RE1–RE8 这些写法守卫抓不到**（RE7 alias、RE8 空白、RE1/R2/R5 非 live 位置、RE3 小节外裸 token）：发布提交必须用**独立抽取器**（§11.4 方法）复核；发现即 NO-GO 直到改正。
4. **`npm test` 出现任何 fail**，或重新出现「断言缺陷存在」的用例 ⇒ NO-GO。
5. **`check:release` 不再 4/4**；或重跑时 `DSH_BIN` 被导出、或使用 `DSH_ALLOW_OUT_OF_RANGE=1` ⇒ 结论无效，等同 NO-GO。
6. **打包文件集变化**（不再是 §11.2.3 的 23 个）、`exports` 六目标缺失，或验证文件 / `docs/verification-*.md` / `scripts/repro-*.md` 进入发布包 ⇒ NO-GO。
7. **发布声明与事实不符**：0.9.3 真正 publish / tag 之前删掉 CHANGELOG「**待发布**」，或出现「已发布 / 已打 tag v0.9.3」而实际没有（或反之）⇒ NO-GO。
8. **对外表述超范围**：把守卫写成「README 里任何版本引用都受保护」（与 RE1–RE8 冲突）；把 GUI 两页写成"已活体验证"（`docs/install-verification.md:28` 的残差声明仍在，D3/D4/D6 仍标「待人工点一次确认」）；把可选绑定写成"所有宿主都能用 `/scout` 与 Skill" ⇒ NO-GO。
9. **本文档或本轮套件被改动后未重跑**：`tests/verification-0.9.3.test.mjs`（复验后 `294c3ccdce5400f4`）或本文档变更后，未重跑 §11.2 与 §11.3 ⇒ NO-GO。

### 11.8.4 复验后仍成立的第一轮边界

§8 的已知边界与 §9 的未验证项**全部继续成立**：GUI 两页无活体验证（U-A）、App 内安装（U-B）、0.9.3 在桌面运行时上的组合（U-C）、范围写法的真实安装行为（U-D，本轮只验了 `npm-package-arg` 的分类语义，没有真装），以及 U1/U2/U4/U6/U8/U9/U13/U15/U16 等。守卫的对外表述上限见 §11.7。
---

# 发布提交签核（第三轮，T-O）

> 触发：Lead 在 commit 之前用**独立抽取器**复核，抓到 `README.md` / `README.en.md` 的 `#### 已实测版本矩阵` 小节里是一条**活声明**却写着过期的 `dsh-scout@0.9.2`；install-docs（T-M）与 readme-guard（T-N）修完后，本卡对**待发布提交**做最后签核。

## 12.0 流程说明：task-25 卡不存在

`team_task_get("task-25")` 两次返回 `team task "task-25" not found`，`team_task_list` 里最新卡是 task-24（全部 completed）。我按 Lead 消息的实质内容执行了本卡，但**无法 claim / complete task-25**（卡不在板上）。这不影响签核结论；请 Lead 事后补建或标记该卡。

## 12.1 新冻结指纹（§0 / §11.0 的 README 哈希已失效）

| 文件 | 第二轮 | **发布提交（第三轮）** | 本轮 delta |
|---|---|---|---|
| `README.md` | `aa4c4ca32fa046d2` | **`449698ba62805998`** | T-M：矩阵小节 3 处活声明（发布句 / 表头列 / 收口段） |
| `README.en.md` | `9b36477d80f816bc` | **`e51283083b1a6596`** | T-M 同步（措辞与中文对应） |
| `tests/package.test.mjs` | `f4ef102ececc7137` | **`c256de118efc8253`** | T-N：**仅注释**（37/37 注释行，见 §12.6） |
| `CHANGELOG.md` | `bb04d7986c049438` | `bb04d7986c049438` | 未变（跨轮字节相同） |
| `docs/dsh-scout-product-contract.md` | `6f01f7399d925211` | 同上 | 未变 |
| `docs/install-verification.md` | `a4abf9ed4182d326` | 同上 | 未变 |
| `scripts/check-release.mjs` | `e59fa213760b7619` | 同上 | 未变 |
| `src/index.ts` | `3142abab04518acb` | 同上 | 未变 |
| `package.json` | `684424dc1fd54c45` | 同上 | 未变（仅 version 相对 HEAD 变更） |
| `tests/verification-0.9.3.test.mjs`（验证者） | `294c3ccdce5400f4` | `14552bfeec5abb7b` | 新增 V9（矩阵活声明）+ 夹具自证 |

**实现 + 门禁 + 测试集聚合指纹：`7ea717d9c4179323`（轮二）→ `6480ff437eab50c5`（发布提交）**（同样 18 个文件，排除两个验证文件）。

## 12.2 Lead 的独立抽取器真阳性：我独立复现，并确认守卫确实漏了它

在 **T-M 之前**的轮二快照（`/tmp/guard0973/base`，即 `README.md` = `aa4c4ca32fa046d2`）上重跑：

| 检查者 | 结果 |
|---|---|
| **我的签核抽取器**（§12.3 定义，覆盖矩阵语义） | **exit=1，8 条 FLAG**：两份 README 的发布句 `dsh-scout@0.9.2`、表头 `0.9.2（已发布）结果`、表头「已发布」措辞、收口句 subject ≠ 0.9.3 |
| **出厂守卫**（`tests/package.test.mjs`） | **GREEN（18/18 pass）** |

⇒ **该真阳性成立**：只信守卫，0.9.3 会带着过期的版本矩阵发出去。这正是我在 §11.8.3 第 3 条要求的"发布提交必须用独立抽取器复核"的价值所在。

**自我批评（重要）**：我**轮二**的抽取器把那一句归为「非 live 位置 → mention」，**同样漏掉了这一类**——它只按语法位置判定，没有覆盖「矩阵小节的语义活声明」。本轮我把该类别写成显式检查（§12.3）后才有覆盖。教训：独立抽取器必须跟着**语义**（这句话在说哪个版本）走，不能只跟着语法位置。

## 12.3 签核抽取器：定义与当前树结果

检查项（我自写脚本，不共享实现者代码）：

- **A. 语法 live 引用**：install pin（安装动词操作数 / 独占一行 / 带引号 JSON 键）、tarball 名、git ref、`· dsh-scout <v>` 横幅、`本次发布创建 v<v>`；非精确 spec 分三类（精确 / 占位符 / 其它）并逐一判定。
- **B. 矩阵小节的语义活声明**（本轮新增，覆盖 T-M 修的类别）：① 发布句里的 `dsh-scout@<v>`；② 表头版本列；③ 收口句「故更新为本版本 / so the table is updated to this version」的**主语版本**（取短语之前最后一个版本 token）；并断言这三处都等于 `package.json` 版本、且不得把当前版本写成「已发布」。
- **C. 不可变历史**：矩阵小节必须仍含 `0.9.2` 与 `38406696598`。
- **D. 无提前发布声明**：全库扫描 `0.9.3` 附近 60 字符内出现 `已发布` / `published` / `dist-tags.latest = 0.9.3` / `tag v0.9.3`。

**当前发布提交树结果（exit=0）**：

```console
$ node signoff-extractor.mjs
=== README.md ===
  syntactic live refs: 9 (exact 8, placeholder 1, other 0)
  ok(non-version) README.md:196 install pin = <new-version>
  matrix section heading: line 247
  release sentence (line 249): 0.9.3
  table header (line 255): | DSH 版本 | npm 渠道（2026-10-12 核对） | 0.9.3（候选 tarball）结果 |
  closing paragraph (line 262): subject version = 0.9.3
=== README.en.md ===
  syntactic live refs: 9 (exact 8, placeholder 1, other 0)
  matrix section heading: line 247
  release sentence (line 249): 0.9.3
  table header (line 255): | DSH version | npm channel (checked 2026-10-12) | 0.9.3 (candidate tarball) |
  closing paragraph (line 262): subject version = 0.9.3
VERDICT: 0 stale / non-exact live references, matrix live claims track the release, no premature publication claim
exit=0
```

⇒ **18 条语法 live 引用（16 精确 = 0.9.3 + 2 个文档化占位符）、0 条过期 / 非精确**；与 Lead 自写抽取器的「18 条活引用、0 过期」一致（口径相同：占位符计入引用数）。矩阵三处活声明全部指向 0.9.3。

## 12.4 非空洞性：6 组变异（中英各 3 处）

在**当前树**副本上把 T-M 修好的三处分别改回 0.9.2：

| 变异 | 我的抽取器 | 出厂守卫 |
|---|---|---|
| M1 发布句 → `dsh-scout@0.9.2`（zh / en） | **RED（1 条 FLAG）** | **GREEN** |
| M2 表头 → `0.9.2（已发布）结果` / `0.9.2 (released)` | **RED（2 条）** | **GREEN** |
| M3 收口句主语 → `0.9.2` | **RED（1 条）** | **GREEN** |

⇒ 我的签核检查**不是空转**；同时**再次证明 KNOWN GAP 真实**（守卫对这三处一律 GREEN，与 T-N 的注释声明一致）。该检查已固化为验证者套件的 **V9**（含夹具自证：过期夹具必须报 ≥3 条、候选形态夹具必须 0 条），因此它会随 `npm test` 每次都跑。

## 12.5 T-M 复核：0.9.2 的不可变发布事实未改坏，也没有提前的 0.9.3 发布声明

- **0.9.2 事实逐字保留**（`CHANGELOG.md` 的 `## [0.9.2]` 段；该文件本轮零改动、跨三轮字节相同）：发布日期 2026-10-13、`npm dsh-scout@0.9.2`（`dist-tags.latest` = `0.9.2`）、tarball URL、**23 个文件**、shasum `bedb4a656709d5d0e77d5f4b410e2173c0b8eb31`、integrity `sha512-UIJOP8…`、Sigstore provenance（logIndex `3244828180`）、git tag `v0.9.2`（annotated，指向 `64138a0`）、GitHub Release 附件 130,691 B、发布 workflow run `38406696598`（16m59s）、发布前 `118/118` + `4/4`、独立验证 GO。
- **README 矩阵段**保留「上一版 **0.9.2 已发布到 npm**（`dist-tags.latest` = `0.9.2`）」与 `run 38406696598`，且措辞明确是「上一版 / the previous release」——我的抽取器把这两个字符串列为**必须存在**（§12.3 C）。
- **0.9.3 口径准确**：README:262 写本版改的是「安装文档与诊断面（桌面 App 主路径 / 版本引用守卫 / `/scout status` 版本），依赖与运行时契约未动」⇒ 与 `package.json` diff（仅 version 一行）、CHANGELOG `## [0.9.3]` 的实际内容一致；不再有「0.9.2 沿用同一范围并只对齐 schemastery，故更新为本版本」那种错位叙述。
- **无 0.9.3 发布声明**：`0.9.3` 附近出现发布词的扫描 **0 命中**；README 用「**候选 tarball**」形态（:249 / :255），CHANGELOG:9 仍写「**待发布**」。

## 12.6 T-N 复核：确实是 comment-only（独立 diff）

- 相对轮二快照：**37 个变更行，37/37 是注释或空行，非注释 0**（`diff -u` 后逐行分类）。
- 结构不变量全部不变：`source:` 5/5、`classify:` 5/5、`assert.` 69/69、`SECTION_VERSION_TOKEN` 2/2、`const RELEASE_VERSION` 1/1、`test(` 27/27 ⇒ **规则 / 断言 / 守卫范围未动**（范围仍按 T-K / T-N 冻结）。
- **KNOWN GAP 段逐字复核**（`tests/package.test.mjs:111-129`）：点名三处活声明（发布句 / 表头版本列 / 收口句）、写明后果（「a forgotten bump there passes green, and the next release ships a stale version matrix while every gate reports success」）、声明为**已记录的残余类别**、并要求发布前用独立抽取器复核（引用本报告）。它没有把矩阵说成"已处理"，方向正确。
- 夹具里仍保留 `` '**`dsh-scout@0.9.2` passed on four exact DSH versions**' `` 等行，但注释已改为「本守卫无法认领这个形状 —— 那是 KNOWN GAP，不代表矩阵是历史」；危险的历史/活声明混淆已消除。

## 12.7 四道门禁（第三轮原始输出，独立复现 Lead 的结果）

```console
$ npm test                                        # 签核基线（V9 之前）
ℹ tests 133 / pass 133 / fail 0 / duration_ms 3130.947792   exit=0
$ npm test                                        # 加入本轮 V9 之后
ℹ tests 134 / pass 134 / fail 0 / duration_ms 2094.083666   exit=0
$ DSH_BIN=$(which dsh) npm run test:profile
dsh-scout profile smoke: PASS (dsh-scout 0.9.3, dsh 0.2.0-rc.2)   # 16 s，exit=0
$ pnpm pack --dry-run
package: dsh-scout@0.9.3 ; 23 个文件 ; dsh-scout-0.9.3.tgz        # exit=0
$ env -u DSH_BIN npm run check:release            # DSH_BIN before: [<unset>]；23:55:09 → 23:56:42（93 s）
  readme release references: 20 checked (4 inside the success-criteria section), all pinned to 0.9.3
ℹ tests 133 / pass 133 / fail 0
[ok] dsh 0.1.0-rc.6 / 0.1.2-rc.1 / 0.2.0-rc.2 / 0.2.1-alpha.2
dsh-scout release gate: PASS (4 DSH versions, >=0.1.0-rc.6 <0.3.0-0)
exit=0
```

> 基线口径：签核前 `npm test` = **133/133**（与 Lead 给的一致）；我新增 V9 后为 **134/134**（+1 只来自验证者套件，与实现无关）。`check:release` 内部那次 `npm test` 跑在 V9 加入**之前**，所以日志里是 133；这不影响门禁结论（同一棵树、守卫与实现零改动）。

## 12.8 残余类别更新：把「矩阵活声明」补进清单（RE12）

| # | 类别 | 状态 |
|---|---|---|
| **RE12（新，本轮真阳性来源）** | `#### 已实测版本矩阵` 的**活声明**——① 发布句 `` `dsh-scout@<v>` 已在四个精确 DSH 版本上实测通过 ``、② 表头版本列 `X（候选/已发布）结果`、③ 收口句「…故更新为本版本」——**不被出厂守卫覆盖**（它按设计只认四种 live 位置的精确写法）。 | **已记录**：守卫注释 `tests/package.test.mjs:111-129` 的 KNOWN GAP + 本节；**固定处置**：发布提交必须用独立抽取器复核（§11.8.3 第 3 条、§12.3），并已固化为验证者套件 V9（随 `npm test` 常跑） |

RE1–RE11 不变。**我的阻塞判断：不阻塞发布。** 理由：① 该类别已被独立抽取器在待发布提交上复核为 **0 问题**；② 处置已制度化（守卫 KNOWN GAP 注释 + 报告发布条件 + V9 常跑）；③ 它属于"忘记更新矩阵"这一维护动作，不是产物正确性问题，且发布后 Lead 的发布事实同步提交会再碰这一段。

## 12.9 发布提交签核结论：**GO**

**GO —— 可以对当前工作树执行 commit / push / tag v0.9.3。**

理由：

1. **独立抽取器复核通过**：18 条语法 live 引用（16 精确 = 0.9.3 + 2 占位符）、0 条过期/非精确；矩阵三处活声明（发布句 / 表头 / 收口句）全部指向 0.9.3；无提前发布声明。T-M 之前那棵树我的抽取器报 8 条 FLAG ⇒ Lead 抓到的真阳性已闭合。
2. **不可变事实未损坏**：0.9.2 的发布事实（`latest`=0.9.2、run `38406696598`、2026-10-13、23 文件、shasum/integrity/provenance/tag `64138a0`）在 CHANGELOG 逐字保留、在 README 矩阵段保留；0.9.3 只写"候选 tarball"、CHANGELOG 仍写"待发布"。
3. **T-N 是纯注释**：37/37 注释行，非注释 0；pattern / 断言 / 守卫范围零改动；KNOWN GAP 如实记录且指向本报告的发布条件。
4. **四道门禁独立复现全绿**：`npm test` **133/133**（新增 V9 后 **134/134**）、`test:profile` PASS（16 s）、`pack` **23 文件**、`env -u DSH_BIN check:release` **4/4 PASS**（93 s，`DSH_BIN` 未设置）。
5. **纪律**：本轮只改了 `tests/verification-0.9.3.test.mjs` 与本文档；实现/文档/README/CHANGELOG/package.json 一律未动（轮三次采样逐字节差分证明）。

**仍然有效的 NO-GO 条件**（承接 §11.8.3，签核后更新两条）：

1. **commit 前树再变**：任一文件偏离 §12.1 的签发哈希（实现集聚合 **`6480ff437eab50c5`**）后未重跑本节的抽取器与四道门禁 ⇒ NO-GO。
2. **矩阵活声明再次漂移**：`dsh-scout@<v>` 发布句 / 表头版本列 / 收口句任一不再等于 `package.json` 版本（V9 会当场变红）⇒ NO-GO。
3. **发布前文档出现过期或非精确的活引用**——尤其 **RE1–RE8 + RE12** 这些守卫抓不到的写法：必须用独立抽取器复核（§12.3）⇒ 发现即 NO-GO。
4. **`npm test` 出现任何 fail**，或重现「断言缺陷存在」的用例 ⇒ NO-GO。
5. **`check:release` 不再 4/4**，或重跑时导出 `DSH_BIN` / 使用 `DSH_ALLOW_OUT_OF_RANGE=1` ⇒ 结论无效，等同 NO-GO。
6. **打包文件集变化**（不再 §12.7 的 23 个）、`exports` 六目标缺失，或验证文件 / `docs/verification-*.md` / `scripts/repro-*.md` 进入发布包 ⇒ NO-GO。
7. **发布声明与事实不符**：tag 之前删掉 CHANGELOG「待发布」，或 tag 之后未同步 CHANGELOG 的 npm 元数据（tarball / shasum / integrity / provenance / tag / workflow run）与 README 矩阵的「已发布」形态 ⇒ NO-GO（发布后必须补这笔小提交，且**不移动 tag**）。
8. **对外表述超范围**：守卫写成"覆盖所有版本引用"（与 RE1–RE12 冲突）；GUI 两页写成"已活体验证"；可选绑定写成"所有宿主可用" ⇒ NO-GO。
9. **本文档或本轮套件被改动后未重跑**：`tests/verification-0.9.3.test.mjs`（`14552bfeec5abb7b`）或本文档变更后，未重跑 §12.3 / §12.7 ⇒ NO-GO。

**发布后请补的两件事**：① CHANGELOG `## [0.9.3]` 的「待发布」换成实际 npm 元数据（tarball / shasum / integrity / provenance / tag / run id）；② README 矩阵的 0.9.3 行由「候选 tarball」改为「已发布」——两处都必须用同一份独立抽取器再复核一次（活引用的版本号不变，但"已发布"措辞要出现，且 §12.3 D 项的"无提前声明"检查届时按发布后口径重新解释）。
---

# 缺陷记录 F-5：验证套件依赖 Node test reporter（CI 发布阻塞，已修）

## 13.0 观察（CI，v0.9.3 release workflow）

`Run the release gate` **20 秒失败**，`npm test` **133/134**，唯一失败是**我的** V4：

```console
not ok 129 - V4 · the shipped README guard fails on every stale exact reference, and passes on the frozen tree
  error: 'the pristine guard run must report zero failures'
  location: tests/verification-0.9.3.test.mjs:367
```

而同一份 CI 日志里，V4 抓到的**子进程**输出是 `1..18 / # tests 18 / # pass 18 / # fail 0` —— 子进程 **18/18 全过**。

## 13.1 根因

- `runShippedGuard` 用 `execFileSync('node', ['--test', 'tests/package.test.mjs'], { stdio: ['ignore','pipe','pipe'] })` 抓输出，V4 断言 `assert.match(clean.output, /ℹ fail 0/)`。
- node 的**默认 test reporter 不是常量**：Node 22（CI，piped 子进程）→ `tap`，汇总写 `# fail 0`；本机 Node 26（以及 24）→ `spec`，汇总写 `ℹ fail 0`。
- ⇒ 断言匹配的是 spec 的字符 `ℹ`；在 tap 环境下子进程全过、断言仍报 "must report zero failures"。**这是"本地绿、CI 红"**——正是本轮主题要消灭的那类缺陷，而它出自我自己的验证套件。Lead 的判定正确。

## 13.2 本机复现（没有 Node 22，也能精确复现失败机制）

- 本机确实没有 Node 22：`npx -y node@22.19.0 --version` → **v26.8.1**（与 Lead 观察一致）；本机只有 system Node **26.8.1** 与桌面 App 自带 Node **24.21.0**；`ci.yml` / `release.yml` / `compatibility-nightly.yml` 三个 workflow 都锁 `node-version: 22`。
- 但差异的全部内容就是 reporter，可以用环境变量精确模拟：`NODE_OPTIONS='--test-reporter=tap'`（Node 允许它经 `NODE_OPTIONS` 生效，并会传给子进程）。
- **用未修的套件**（轮三开头快照 `294c3ccdce5400f4`；其 V4 断言与发布提交版 `14552bfeec5abb7b` 逐字相同，只少了后加的 V9）复现：

```console
$ NODE_OPTIONS='--test-reporter=tap' node --test tests/verification-0.9.3.test.mjs
not ok 4 - V4 · the shipped README guard fails on every stale exact reference, and passes on the frozen tree
  error: 'the pristine guard run must report zero failures'
    # pass 18
    # fail 0
# pass 7
# fail 1
```

⇒ 与 CI 的失败**同一个断言、同一条消息、同样的"子进程全过"**。同一份套件在默认环境（spec）下 V4 通过 ⇒ 复现的正是 reporter/Node 版本差异。

## 13.3 修复（4 处，全部在 `tests/verification-0.9.3.test.mjs`）

1. **给子进程显式固定 reporter**：`['--test', '--test-reporter=tap', 'tests/package.test.mjs']`。TAP 汇总格式跨 Node 大版本稳定，不再依赖默认值。
2. **断言改成 TAP 计数 + 退出码**：`tapFailures(output)` 解析 `^# fail (\d+)$`；解析不到（reporter 再漂移）时**显式失败并打印子进程输出**，绝不静默通过。没有把 `ℹ` 换成 `#` 了事。
3. **子进程改用 `process.execPath`**：跑的就是父套件自己的那个 Node，不受 PATH 上恰好哪个 `node` 影响。
4. **`childEnv()` 额外剥离 `NODE_OPTIONS` 里的 test-runner flags**（`--test` / `--test-reporter[=…]` / `--test-reporter-destination[=…]`）：否则外部传入的 reporter 会与显式指定的那个冲突（Node 报 `The argument '--test-reporter' must match ... Received [ 'tap', 'tap' ]`）——这是我复现过程中真撞到的坑，也顺带让套件对 NODE_OPTIONS 免疫。

## 13.4 本轮实测（跨 Node 大版本 × 两种 reporter）

| 环境 | 我的套件 | 全套件 |
|---|---|---|
| Node 26.8.1（本机），默认 spec | **9/9** | **134/134**（`npm test`） |
| Node 26.8.1，**TAP-forced**（CI reporter 模拟） | **9/9** | **134/134**（`NODE_OPTIONS=… node --test tests/*.test.mjs`） |
| Node 24.21.0（桌面 App 自带），默认 | **9/9** | **134/134** |
| Node 24.21.0，**TAP-forced** | **9/9** | — |
| Node 26 + TAP-forced，**未修套件** | **V4 RED**（复现 CI） | — |
| Node 22.19.x | **本机不可得** | — |

原始尾部：

```console
$ npm test                       # Node 26.8.1，默认 reporter
ℹ tests 134
ℹ pass 134
ℹ fail 0
ℹ duration_ms 2408.891292
exit=0

$ NODE_OPTIONS='--test-reporter=tap' node --test tests/*.test.mjs
# tests 134
# pass 134
# fail 0
```

**非空洞性保持**：V4 在 TAP 模式下仍然把 17 组变异（含 6 组 fail-closed 形态、逐条 stale 精确引用、锚点改写）全部判红，pristine 判绿；V9 的夹具自证（过期夹具 ≥3 条、候选形态 0 条）在两种 reporter 下都跑。

## 13.5 审计：套件里还有没有别的 Node 22 vs 26 差异

结论：**未发现第二处**。逐项证据：

| 检查项 | 结果 |
|---|---|
| 默认 reporter 依赖 | 修后子进程 reporter 被显式固定；断言里 `ℹ` 出现 **0** 次（唯一命中是解释本条缺陷的注释） |
| `isTTY` 分支 | **0** 处；子进程 stdio 显式 `pipe`；结果判定不再依赖 TTY 形态 |
| `process.version` 依赖 | **0** 处 |
| Node 23+ API | `structuredClone` / `Object.groupBy` / `toSorted` / `toReversed` / `findLast` / `Array.fromAsync` / `Promise.withResolvers` 均 **0** 处 |
| `import.meta.resolve` | **0** 处（我不使用；`tests/package.test.mjs` 使用，但那是既有套件、Node 22 上本就通过） |
| 子进程输出解析 | 只有两处：① V4 的 TAP 计数（已固定）；② 变更用例里的 `README.md:<line>` 诊断——那是**仓库自带文案**，TAP 的 YAML `error:` 字段同样保留；V4 在 TAP 下 17 组变异全部被抓 ⇒ 已实测 |
| V8 的子进程 | 跑 `node scripts/check-release.mjs`（**普通脚本，不涉及 test reporter**），npm/pnpm 用桩；退出码 + 仓库自有 stdout 文案 |
| 使用的 `node:` 模块 | `node:test`、`assert/strict`、`child_process`、`fs`、`os`、`path`、`url` —— 全部 Node 22 可用（`fs.cpSync` ≥16.7、`Array.prototype.at` ≥16.6、`String.replaceAll` ≥15、lookbehind ≥8.3） |
| 错误消息措辞 | 只匹配仓库自有字符串与 TAP 字段，不匹配 Node 自身报错文案 |

## 13.6 诚实边界：凭什么认为修好了、哪些只能等 CI

- **本机无法验证 Node 22**：没有 Node 22 二进制，`npx node@22` 落回 v26.8.1；三个 workflow 都锁 22。**真正的 Node 22 结论只能由 CI 给出。**
- **我认为修好了，依据是**：① 失败机制被**精确复现**（TAP-forced 下未修套件报出与 CI 同一条断言消息）；② 修复把子进程 reporter **显式钉死为 TAP**，断言只读 TAP 计数与退出码 ⇒ 子进程输出形态不再随 Node 大版本变化；③ 修后在同一失败场景（Node 26 + TAP-forced）与 Node 24、Node 26 默认场景下，套件与全套件全绿（134/134）；④ 审计未发现其它版本敏感假设（§13.5）。
- **只能等 CI 确认的**：Node 22 自身可能存在的、与 reporter 无关的差异。最快信号是 `npm test`（V4 在 ~1–2 s 内即出结果），不必等 `check:release` 的四版本矩阵（约 90 s）。

## 13.7 订正与影响

- 这是**验证套件**的缺陷（编号 **F-5**），**不是产品缺陷**：`README*`、版本守卫、`src/`、`package.json`、`CHANGELOG`、契约、checklist 等产品文件在本轮**一字未动**（哈希与 §12.1 完全一致）。
- **§12 的签核 GO 仍然成立**（针对产品文件与文档内容）；被卡住的是"套件在 CI 上跑绿"这一步，现已修复，待一次 CI 运行确认。
- F-1~F-4 关闭状态不变；残余类别 RE1–RE12 不变。
- 哈希更新（只涉及验证者两个文件）：`tests/verification-0.9.3.test.mjs` `14552bfeec5abb7b` → **`35c036be8bb30b24`**；产品文件哈希全部不变：`README.md` `449698ba62805998`、`README.en.md` `e51283083b1a6596`、`tests/package.test.mjs` `c256de118efc8253`、实现集聚合 **`6480ff437eab50c5`**。
- **NO-GO 条件追加一条**：套件再次引入依赖 Node 大版本 / reporter / TTY 的断言（或 `npm test` 在 Node 22 与 Node 26 任一上不绿）⇒ 未重跑两版本前不得发布。
---

# 口径切换：V9 从"发布前签核"到"发布后事实同步"（T-R）

## 14.0 触发与事实

- **0.9.3 已成功发布**：npm `dsh-scout@0.9.3`（`dist-tags.latest` = `0.9.3`）、tag `v0.9.3` → `3634c2c`、GitHub Release 附 tarball（158,725 B）、Sigstore provenance logIndex `3245268322`、发布 workflow run `38428072425`（约 20 分 28 秒）。
- install-docs 完成发布后同步后，`npm test` = **133/134**，唯一红项是**我的 V9**。
- **这不是文档写错，是 V9 的时间点过期了。** 本报告 §12 自己就写明了这一步：§12.9 的收尾要求「发布后请补的两件事……且 §12.3 D 项的『无提前声明』检查届时按发布后口径重新解释」；§12 也把 V9 描述为"对**待发布提交**做最后签核"。所以正确动作是改 V9，而不是回滚文档。

## 14.1 关键设计判断：为什么不能做"硬反转"

把 V9 直接写成"当前版本**必须**已发布"会修好今天、锁死明天：

```yaml
# .github/workflows/release.yml（节选，行号即文件行号）
33:      - name: Run the release gate
34:        run: npm run check:release
36:      - name: Pack the tarball
37:        run: pnpm pack
46:      - name: Publish to npm
49:          npm publish --provenance --access public
53:      - name: Create GitHub Release with tarball
```

发布门禁跑在**打 tag 的那个提交**上，而那个提交的文档**必然是**「待发布 / 候选 tarball」——0.9.3 的 run `38428072425` 正是这样通过的（当时 CHANGELOG 写「待发布」、README 表头写「候选 tarball」，`npm test` 134/134）。若 V9 硬要求"已发布"，**0.9.4 以及之后每一次发布都会在 gate 阶段被自己的套件挡住**，比这次的问题更重（这次挡的只是一笔发布后的文档同步提交）。

因此 V9 改成**释放状态一致性检查**：

1. 以 `CHANGELOG.md` 的 `## [RELEASE_VERSION]` 段判定状态：**已发布**（有 `已发布`/`is published`）或**待发布**（有 `待发布`），两者**必须恰有其一**——混合或都没有 ⇒ 直接失败。
2. 每个状态施加**完整**契约（见 §14.2）：已发布态强制全部五条反向要求；候选态强制对称的"还未发布"契约（不得声称已发布、必须标候选、不得携带只有发布后才存在的元数据）。
3. 当前树处于**已发布态** ⇒ **五条反向要求全部生效**；而 0.9.4 的候选态提交仍然能通过 gate。

## 14.2 五条反向要求逐条落地

| # | 原断言（发布前口径） | 现断言（按状态） |
|---|---|---|
| 1 | 表头**不得**含 `已发布`/`released` | **命名当前版本的那一列必须含** `已发布`/`released`（锚定"含 `<version>` 的单元格"，不碰同表里的历史列）；候选态则**必须**标 `候选`/`candidate` 且不得声称已发布，且该列版本必须等于 `RELEASE_VERSION` |
| 2 | CHANGELOG `## [0.9.3]` **必须**仍有「待发布」 | **不得**再有「待发布」，且**必须**含：tarball 名（`dsh-scout-<v>.tgz`）、`shasum` + 40 位十六进制、`integrity` + `sha512-…`、workflow run id、`dist-tags.latest` = `<v>`、`git tag v<v>` —— 全部用 `RELEASE_VERSION` 拼，无硬编码 |
| 3 | `0.9.3` ±60 字符内**不得**出现发布声明 | **必须**出现：从每个发布短语回溯到最近的 `<version>` 提及，且两者之间不得有句末标点（同句判定，避免把 `上一版 0.9.2 已发布到 npm` 的历史句误认成当前版本的声明）；候选态则相反。**「0.9.2 不可变事实必须仍在」保留**（`0.9.2` 与 run `38406696598` 必须出现在该小节） |
| 4 | 夹具写死「`0.9.3（候选 tarball）结果` 必须 0 条问题」 | 夹具双向：**已发布形态** 0 条、**候选形态** 0 条；**8 组过期矩阵夹具**（表头退回候选 / 表头版本 ≠ 当前 / 收口句不记发布 / 0.9.2 事实被删 / 发布句版本错 / 发布句声称已发布 / 候选态表头声称已发布 / 候选态收口句声称已发布）与 **7 组过期 CHANGELOG 夹具**（仍写待发布 / 缺 tarball / 缺 shasum / 缺 integrity / 缺 run id / 缺 tag / 候选条目携带发布元数据）**必须各报 ≥1 条** |
| 5 | — | 本节记录这次口径切换（谁：verifier-093；何时：0.9.3 发布后、install-docs 完成事实同步后；证据：§14.0 的发布事实 + release.yml 的步骤顺序 + §14.3 的双向变异） |

## 14.3 双向证据（原始断言消息）

**A. 文件级变异**（`/tmp` 副本，仓库零改动；跑真套件，`--test-reporter=tap`）：

| 变异 | 期望 | 实测 | V9 的原始诊断 |
|---|---|---|---|
| M1 表头退回候选形态（`0.9.3（已发布）结果` → `0.9.3（候选 tarball）结果`） | RED | **exit=1，V9 RED** | `README.md: the published 0.9.3 column must say 已发布/released, got "0.9.3（候选 tarball）结果"` |
| M2 删掉 CHANGELOG 的 shasum | RED | **exit=1，V9 RED** | `CHANGELOG.md: the published entry is missing its shasum` |
| M3 CHANGELOG 退回「待发布」而 README 仍是已发布（**混合状态**） | RED | **exit=1，V9 RED** | `README.md: the unpublished 0.9.3 column must not claim publication, got "0.9.3（已发布）结果"` / `…the candidate 0.9.3 column must be marked as not yet published…` / `…the closing paragraph presents unpublished 0.9.3 as published` |
| M4 矩阵版本列写成别的版本（`0.9.2（已发布）结果`） | RED | **exit=1，V9 RED** | `README.md: the matrix version column is 0.9.2` |
| **M5 一致的候选态**（中英表头→候选、去掉当前版本的发布句、CHANGELOG→待发布） | **GREEN** | **exit=0，V9 GREEN** | —（这正是发布门禁在打 tag 时必须接受的状态） |

**B. 套件内夹具**（随 `npm test` 常跑）：已发布形态 0 条、候选形态 0 条；15 组过期夹具（8 矩阵 + 7 CHANGELOG）逐一断言"必须被报出"。夹具在两种 reporter 下都执行。

## 14.4 本轮门禁与回归

```console
$ npm test                                  # Node 26.8.1，默认 spec
ℹ tests 134 / pass 134 / fail 0 / duration_ms 2376.543291        exit=0

$ NODE_OPTIONS='--test-reporter=tap' node --test tests/*.test.mjs   # CI reporter 模拟
# tests 134 / # pass 134 / # fail 0

$ "$NODE24" --test tests/*.test.mjs          # 桌面 App 自带 Node 24.21.0
ℹ tests 134 / pass 134 / fail 0
$ NODE_OPTIONS='--test-reporter=tap' "$NODE24" --test tests/*.test.mjs
# tests 134 / # pass 134 / # fail 0
```

⇒ F-5 的 reporter 修复在新 V9 上同样成立（四种组合全绿），且 V9 的绿色不是靠削弱换来的（§14.3 A 的四个方向都会红）。

## 14.5 诚实边界

- **Node 22 依然只能靠 CI**：本机无 Node 22（`npx node@22` 落回 v26.8.1）；上面的 TAP-forced 只是复刻 CI 的 reporter 行为。CI 绿了才算 Node 22 确认。
- **状态一致性有一个有意不覆盖的极端情形**：发布后把 CHANGELOG 与两份 README **整体**回滚成一致的候选态，V9 不会报错（两个状态各自自洽）。要封死它需要引入"曾经发布过"的外部事实（例如 `git tag`），而 CI 是浅克隆、且套件不应依赖 git 状态——**取舍已记录**，本轮不引入。真实风险低：发布事实还存在于 npm、GitHub Release 与 tag 三处。
- **V9 不是"永不翻面"的**：它现在接受两种自洽状态，因此下一个版本（候选态）与本次发布后（已发布态）都无需再改；但 `RELEASE_VERSION` 常量本身仍按项目惯例随发布手改（V1 的硬编码就是为此）。

## 14.6 哈希（发布后同步的当前树）

| 文件 | 值 | 说明 |
|---|---|---|
| `README.md` | `a28ce1cef52a55d4` | install-docs 发布后同步（矩阵 → 已发布）；§12.1 的 `449698ba62805998` 是签核时（候选态）的记录 |
| `README.en.md` | `a583ba569d45a9a6` | 同上（§12.1 为 `e51283083b1a6596`） |
| `CHANGELOG.md` | `b8902b3491b2848e` | 同上（§12.1 为 `bb04d7986c049438`） |
| `tests/package.test.mjs` | `c256de118efc8253` | 未变（T-N 的注释版本） |
| `scripts/check-release.mjs` / `src/index.ts` / `package.json` | `e59fa213760b7619` / `3142abab04518acb` / `684424dc1fd54c45` | 均未变 |
| `tests/verification-0.9.3.test.mjs`（验证者） | `a288a9ffdfcc20cd` | 本轮 V9 口径切换；上轮为 `35c036be8bb30b24` |

发布物 `v0.9.3` 定格在 `3634c2c`（**发布后同步之前的树**：CHANGELOG 待发布、README 候选形态），当前树是其后的同步提交——这正是本报告 §12 要求的"发布事实另笔同步、不移动 tag"。

## 14.7 结论与 NO-GO 条件更新

**V9 口径切换完成：`npm test` 134/134；V9 在已发布态强制全部反向要求，在候选态保持发布门禁可用；四个方向的过期变异都会红。**

NO-GO 条件修订（覆盖 §13.7）：

1. 套件再次把**某一个时间点**写死（发布前口径挡发布后同步、或发布后口径挡下一次发布的 gate）⇒ 未修前不得发布。
2. README 矩阵与 CHANGELOG 的释放状态**不一致**（V9 会当场变红），或已发布态缺 tarball/shasum/integrity/run id/tag/dist-tag 任一 ⇒ NO-GO。
3. 0.9.2 的不可变发布事实（`0.9.2` 与 run `38406696598`）从矩阵小节消失 ⇒ NO-GO。
4. 套件引入依赖 Node 大版本/reporter/TTY 的断言（`npm test` 必须在 Node 22 与 26 上都绿）⇒ NO-GO。
5. §12.9 的其余条件（树偏离签发哈希未重跑、`check:release` 非 4/4、打包集变化、发布声明与事实不符、超范围表述）继续有效。
