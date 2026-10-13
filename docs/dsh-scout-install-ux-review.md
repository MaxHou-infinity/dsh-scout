# dsh-scout 安装文档与安装体验评审

评审对象：`github.com/MaxHou-infinity/dsh-scout` @ `f3c890e`（README.md 306 行 / README.en.md 对应）
评审方法：在真实桌面版 DSH（desktop profile，运行时 0.2.0-rc.2）上**完整走一遍安装**，记录每一步的实际摩擦
结论一句话：**三条"已验证路径"对桌面 App 用户全部不可用，而桌面 App 恰恰是这类插件最主流的入口——缺的不是细节，是一整条主路径。**

---

## 一、根因：文档假设读者是 CLI 用户，而主要读者不是

README.md / README.en.md 全文检索 `桌面 | desktop | Electron | GUI` —— **零命中**。
但桌面版 DSH 的 `desktop` profile 被应用独占，CLI 无法管理：

```console
$ dsh plugin --profile desktop list
error: profile "desktop" is managed exclusively by the Electron application
```

这不是权限或配置问题，而是 CLI 里的**硬编码按名字拒绝**（`@deepseek-ai/dsh/lib/bin.js`）：

```js
function rejectElectronProfile(program, profile) {
  if (profile.toLowerCase() === "desktop")
    program.error('error: profile "desktop" is managed exclusively by the Electron application');
}
```

该判断在**参数解析层**，因此 `dsh plugin --profile desktop` 的**所有子命令**都被拒绝——包括 `add`、`list`，也包括文档里那条兼容性逃生门 `allow-version`。

### 连带后果（比"装不上"更值得警惕）

| # | 后果 | 说明 |
|---|---|---|
| 1 | **三条路径全废** | A/B/C 都是 `dsh plugin --profile <name> add …`，桌面用户一条都跑不通 |
| 2 | **逃生门同样失效** | 文档把 peer 范围过期列为头号失败模式，但唯一解药 `allow-version` 在 desktop profile 上被同一条判断拒绝 |
| 3 | **验证步骤不可达** | 文档给的 `dsh --profile scout-demo --dump-config` 在桌面场景没有对应物 |
| 4 | **失败形态还是静默的** | 文档自己写了"失败的形态是静默不加载，不是报错"，而桌面用户既没有 CLI 也没有判据 |

---

## 二、实测证据清单

安装全过程的关键实测记录（均在本机复现）：

| 观察 | 实测结果 |
|---|---|
| `dsh plugin --profile desktop list` | 被拒绝（Electron 独占） |
| `dsh plugin --profile web list` / `--profile scout-demo list` | 正常 —— 所以**被独占的是 profile 名 `desktop`，不是"App 装过就锁"** |
| `~/.dsh/profiles/` 实际内容 | `desktop`、`web`（+ 用户自建的 `scout-demo`） |
| `dsh profile --help` | 不存在该子命令；`profile` 被当作 profile 名解析并报错 → **用户无从列举 profile** |
| 已发布 tarball 内容 | 含 `dist/*.js`（**自带构建产物**） |
| 仓库 git 内容 | 无 `dist/`（`.gitignore` 第 2 行）；`git tag` 为空 |
| 装完后 profile 的 `pendingBuilds` | `[]` —— npm 路径**零构建脚本** |
| 0.9.2 发布时间与安装时刻 | 2026-10-13T13:56:58Z 发布，22:29 安装（相隔约 33 分钟） |
| pnpm 行为 | 未锁版本会撞 minimum release age；锁 `@0.9.2` 后 pnpm 自动写入 `minimumReleaseAgeExclude` |
| 桌面 App 自带运行时 | node 24.21.0 + pnpm 11.7.0（`runtime/primary-runtime/runtime.json`），**与系统 node 无关** |
| 门禁是否校验文档 | `check-release.mjs`、`ci.yml` 均不读 README → 文档中的版本号无人守护 |

---

## 三、README 修改建议（按优先级）

### P0-1　补一条"路径 0：桌面 App"，并说明它为什么是唯一路径

现状：`## 安装到 DSH Profile` 直接给三条 CLI 命令，桌面用户第一步就撞墙，且报错信息（`managed exclusively by the Electron application`）不会告诉他"那该怎么办"。

建议在三条路径**之前**加一节，并把 CLI 三路径降级为"CLI / 自建 profile 用户"适用。

### P0-2　不要再使用 `scout-demo` 这种虚构 profile 名

现状：三条命令都写死 `--profile scout-demo`。这个 profile 在用户机器上并不存在，而 CLI **会照常创建并使用它、不报任何错** —— 用户以为装好了，实际装进了另一个 profile，桌面 App 里什么都不会出现。这是典型的**静默装错位置**。

建议：把 profile 名改成显式占位符 `--profile <your-profile>`，并在同段写清"如何确定我的 profile 名"。

### P0-3　给"装上了吗"一条可执行的判据

现状：文档强调了静默失败，却只给了 `--dump-config` 这一条 CLI 判据。
建议加"成功判据"小节（桌面 / CLI 两套），这是投入产出比最高的一处补充。

### P1-1　A/B/C 不应平权并列，应标注推荐度与代价

现状："三条已验证路径，任选其一"。实测代价差异极大：

| 路径 | 是否自带产物 | 是否执行构建脚本 | 实测代价 |
|---|---|---|---|
| A npm | ✅ 自带 `dist/` | ❌ 无（`pendingBuilds: []`） | 最低，**推荐** |
| B git | ❌ 无 `dist/` | ✅ `prepare` → `tsc` + 装 devDependencies | 高，且可能被 pnpm 构建脚本门禁拦 |
| C tarball | ✅（`pnpm pack` 产物） | ❌ | 中，仅离线/自测需要 |

建议把 B 标注为"不推荐（需本地构建）"，或直接删掉——它对用户几乎没有额外价值。

### P1-2　主命令里显式锁版本，而不是把 minimum release age 写成"注意事项"

现状：那段说明写得**很准确**（现象、原因、命令、pnpm 输出特征都有），但位置在正文之后，且主命令仍是裸包名 `dsh-scout`。实际后果是**静默装到旧版**（文档自己也记录了"曾解析到 0.9.0"）。

建议：主命令写成 `dsh-scout@<version>`；"不写版本会怎样"降为一句注解。

### P1-3　路径 B 的 `#<commit>` 占位符无法执行

`git tag` 为空，用户不知道该填什么 commit。若要保留该路径，请给一个具体 commit，或允许省略 ref。

### P1-4　补卸载 / 升级 / 回滚

现状：安装章节完全没有；`dsh plugin remove dsh-scout` 只在门禁描述里出现过一次。
建议：给桌面与 CLI 两套卸载/升级写法，并提示"安装失败会回滚 profile 清单与 lockfile"（这条现有的兼容性章节其实写了，挪近一点即可）。

### P2-1　修正 Node 要求的适用范围

"要求：Node ≥ 22.19" 对桌面用户是误导：桌面 App 自带 node 24.21.0 + pnpm 11.7.0。建议改为"CLI / 门禁路径要求宿主 Node ≥ 22.19；桌面 App 自带运行时，无需安装 Node"。

### P2-2　安装章节位置与深度

README 306 行，`## 安装到 DSH Profile` 在第 149 行——前面是产品介绍、12 工具表、输出契约细节。且安装章节内部嵌套了"兼容性三层 + 逃生门"这类作者向深度内容。
建议：安装章节上移到「快速上手」之后；深度内容下沉到 `docs/`，README 留一条链接。

### P2-3　逃生门对桌面用户不可用，需给手动兜底

既然 `dsh plugin --profile desktop allow-version` 也会被拒绝，请补一句手动路径：豁免记录在 profile 目录下的 `compatibility.json`（与 `package.json`、`cordis.patch.yml` 并列；首次豁免时生成）。

### P2-4　让门禁守护文档

`check-release.mjs` 与 `ci.yml` 都不读 README，而 README 里有 4 处硬编码 `0.9.2`。建议在 `check:release` 里加一条断言：README / README.en.md 中的版本号必须等于 `package.json` 的 version。

---

## 四、可直接粘贴的替换文本

### 4.1 中文（替换 README.md `## 安装到 DSH Profile` 整节开头）

```markdown
## 安装

先确认你在哪运行——两条入口的安装方式完全不同，**不要混用**。

| 你在哪用 | 目标 profile | 怎么装 |
|---|---|---|
| **桌面 App（DeepSeek Harness）** | `desktop` | **App 内安装**（唯一路径，见下） |
| CLI / headless / 自建 profile | 你自己的 profile 名 | `dsh plugin --profile <your-profile> add …` |

### 路径 0：桌面 App（推荐）

桌面版的 `desktop` profile 由 Electron 应用独占，CLI 无法管理它——执行
`dsh plugin --profile desktop add dsh-scout` 会被直接拒绝：

    error: profile "desktop" is managed exclusively by the Electron application

请在 App 的插件设置里安装，填入：

    dsh-scout@0.9.2

> 版本务必显式写死。pnpm ≥ 11 默认启用最小发布年龄（minimum release age）供应链保护，
> 裸包名会让刚发布的版本被静默跳过、回退到旧版；写上精确版本后 pnpm 会把它记入
> profile 的 `minimumReleaseAgeExclude`（输出里打印 `Added 1 entry to …`）。

装完不用重启，当前会话即可用。

### 路径 1：CLI（npm，推荐）

```sh
# 把 <your-profile> 换成你自己的 profile 名；不要照抄示例
dsh plugin --profile <your-profile> add dsh-scout@0.9.2
```

<details>
<summary>怎么知道我的 profile 名？</summary>

`dsh` 没有 `profile list` 子命令，直接看目录：

```sh
ls ~/.dsh/profiles          # 或用 $DSH_HOME/profiles
```

出现的名字就是可用 profile 名（如 `web`、`tui`、你自建的 profile）。
注意 `desktop` 是 App 独占的，CLI 对它执行任何 `dsh plugin` 子命令都会被拒绝。
</details>

**不要用 `scout-demo` 之类的示例名直接照抄**：CLI 会照常创建并使用它、不报错，
结果是插件装进了另一个 profile，你以为装好了却完全没生效。

### 路径 2：本地 tarball（离线 / 可复现）

```sh
pnpm pack                                  # 生成 dsh-scout-0.9.2.tgz
dsh plugin --profile <your-profile> add "file:$PWD/dsh-scout-0.9.2.tgz"
```

### 其他安装方式与取舍

| 方式 | 自带构建产物 | 执行安装脚本 | 建议 |
|---|---|---|---|
| npm（路径 1） | ✅ | ❌ | **推荐** |
| tarball（路径 2） | ✅ | ❌ | 离线/自测 |
| `github:MaxHou-infinity/dsh-scout` | ❌（仓库不含 `dist/`） | ✅ `prepare` 会跑 `tsc`，并需安装 devDependencies | 不推荐；仅在需要未发布提交时使用 |

> 桌面 App 自带 node 24 / pnpm 11 运行时，**无需**安装 Node。
> 「Node ≥ 22.19」只对 CLI / 门禁路径成立。

### 装上了吗？（成功判据）

**桌面 App**

1. 插件设置里出现 `dsh-scout` 且为启用状态；
2. 新开一轮对话，工具列表里出现 12 个 `scout_*` 工具；
3. 输入 `/scout status <caseId>` 能命中命令。

**CLI**

```sh
# 组合树里应出现 dsh-scout 那一层
dsh --profile <your-profile> --dump-config | grep -A2 'dsh-scout'
```

但**组合进去 ≠ 运行时挂上了**：最可靠的判据始终是「12 个 `scout_*` 工具是否出现」「`/scout` 是否命中」。
运行时不兼容时插件行会被置为 disabled，进程只在 stderr 打一行
`dsh: disabling profile plugin <row>: <reason>` —— 现象是"插件没生效"，不是显眼的红色报错。

### 卸载与升级

```sh
dsh plugin --profile <your-profile> add dsh-scout@<new-version>   # 升级
dsh plugin --profile <your-profile> remove dsh-scout              # 卸载
```

桌面 App 请在插件设置里升级/移除。安装失败会回滚 profile 清单与 lockfile。
```

### 4.2 English（README.en.md 对应段落，结构同上）

```markdown
## Install

First decide where you run it — the two entry points install differently. Do not mix them.

| Where you run | Target profile | How |
|---|---|---|
| **Desktop app (DeepSeek Harness)** | `desktop` | **In-app install** (the only path — see below) |
| CLI / headless / your own profile | your profile name | `dsh plugin --profile <your-profile> add …` |

### Path 0: desktop app (recommended)

The desktop `desktop` profile is owned exclusively by the Electron application, so the CLI
refuses to manage it — `dsh plugin --profile desktop add dsh-scout` fails with:

    error: profile "desktop" is managed exclusively by the Electron application

Install through the app's plugin settings instead, using:

    dsh-scout@0.9.2

> Always pin the exact version. pnpm ≥ 11 enables minimum-release-age supply-chain
> protection by default, so a bare package name silently skips a just-released version and
> falls back to an older one. With an exact version pnpm records it under the profile's
> `minimumReleaseAgeExclude` (it prints `Added 1 entry to …`).

No restart is needed; the current session picks it up.

### Path 1: CLI (npm, recommended)

```sh
# Replace <your-profile> with your own profile name — do not copy the example verbatim
dsh plugin --profile <your-profile> add dsh-scout@0.9.2
```

<details>
<summary>How do I find my profile name?</summary>

There is no `dsh profile list` subcommand; read the directory:

```sh
ls ~/.dsh/profiles          # or $DSH_HOME/profiles
```

Every name listed is a usable profile (e.g. `web`, `tui`, one you created).
`desktop` is app-owned: any `dsh plugin` subcommand against it is refused.
</details>

**Do not copy example names like `scout-demo` verbatim**: the CLI will happily create and use
it without any error, so the plugin lands in a different profile and appears not to work.

### Path 2: local tarball (offline / reproducible)

```sh
pnpm pack                                  # produces dsh-scout-0.9.2.tgz
dsh plugin --profile <your-profile> add "file:$PWD/dsh-scout-0.9.2.tgz"
```

### Other install sources, and the trade-off

| Source | Ships build output | Runs install scripts | Recommendation |
|---|---|---|---|
| npm (path 1) | yes | no | **recommended** |
| tarball (path 2) | yes | no | offline / self-test |
| `github:MaxHou-infinity/dsh-scout` | no (`dist/` is not committed) | yes — `prepare` runs `tsc` and needs devDependencies | not recommended; only for unreleased commits |

> The desktop app bundles its own node 24 / pnpm 11 runtime — you do **not** need Node installed.
> The "Node ≥ 22.19" requirement applies to the CLI / gate paths only.

### Did it install? (success criteria)

**Desktop app**

1. `dsh-scout` appears in plugin settings and is enabled;
2. start a new turn — 12 `scout_*` tools appear in the tool list;
3. `/scout status <caseId>` resolves.

**CLI**

```sh
# the composed tree should contain the dsh-scout layer
dsh --profile <your-profile> --dump-config | grep -A2 'dsh-scout'
```

Being composed is **not** the same as being mounted at runtime: the reliable signal is always
whether the 12 `scout_*` tools show up and whether `/scout` resolves. On a runtime mismatch the
plugin row is disabled and the process writes exactly one stderr line,
`dsh: disabling profile plugin <row>: <reason>` — what you see is "the plugin isn't working",
not a loud red error.

### Upgrade and uninstall

```sh
dsh plugin --profile <your-profile> add dsh-scout@<new-version>   # upgrade
dsh plugin --profile <your-profile> remove dsh-scout              # uninstall
```

Use the app's plugin settings on desktop. A failed install rolls back the profile manifest
and lockfile.
```

---

## 五、安装体验层面的优化（超出文档）

1. **发布后立刻安装是默认场景，不是边缘场景。** 作者自己发完版就会想让用户体验，而 minimum release age 恰好在这个窗口内生效。建议：GitHub Release 说明里直接给 pinned 命令，README 主命令也 pinned。
2. **考虑放弃 git 安装路径。** 仓库不含 `dist/`，git 安装必须本地构建，是三条路径里唯一会执行代码、唯一可能被构建门禁拦的。保留它的收益（未发布提交）远小于它的失败面。
3. **把"静默失败"变成"可诊断"。** 插件可以在加载时打一行明确的版本横幅（如 `dsh-scout 0.9.2 loaded`），用户和文档都能据此判断；文档里的排障清单也就能写成"看不到这行 → 走兼容性三层表"。
4. **相对路径在桌面场景要写死。** `scoutDir` 默认 `./dsh-scout`，其解析依赖 `cwd`；门禁脚本注释里也记录了"`agent` 未设置时 `cwd` 为 `undefined`，所以门禁只用绝对路径"。桌面用户的 cwd 语义与 CLI 不同，建议文档明确推荐配置绝对路径，例如
   `~/.dsh/profiles/desktop/cordis.patch.yml` 中 `id: dsh-scout` 的 `config.scoutDir`。
   注意该文件由 App 维护，手改前建议先退出 App。
5. **双语同步成本。** zh/en 两套手工维护、且都不覆盖桌面场景。建议把「安装」这类高频变更收敛成一份 canonical 片段（比如 `docs/install.md`），两个 README 只做引用或最小差异化。
6. **本次实测的桌面路径链路值得补进你的验证矩阵。** 现有门禁跑的是"CLI + 隔离 profile + tarball"，**从未覆盖 Electron 独占 profile**——这正是文档缺口的来源。哪怕只加一条手工 checklist，也能防止同类问题再次漏出。

---

## 六、附：本次桌面安装的完整实测记录

用于佐证上述结论，也可作为"路径 0"的参考实现。

```text
1. 确认运行时          plugin_manager list_version_exemptions → 0.2.0-rc.2
2. 确认兼容性          peer @deepseek-ai/dsh-tools ">=0.1.0-rc.6 <0.3.0-0" 在 includePrerelease 下满足
3. CLI 路径不可用      dsh plugin --profile desktop list → 被拒绝
4. 产物校验            下载 0.9.2 tarball，确认含 dist/；跑包内测试 103/103 通过
                       （用运行时真实的 @deepseek-ai/dsh-tools，非本机替代品）
5. 安装                plugin_manager install_bundle → dsh-scout@0.9.2
                       退出码 0；pnpm 自动写入 minimumReleaseAgeExclude；pendingBuilds 为空
6. 生效验证            bundle 清单 installed+enabled，rowId dsh-scout
                       loader 行 include:dsh-scout fiberPhase = active
                       插件总数 198 → 199
7. 功能验证            12 个 scout_* 工具即时注入当前会话，无需重启
                       scout_start + scout_report 实际调用成功，输出中文报告
                       scout Skill 可加载；/scout 命令已注册
8. 收尾                profile 的 package.json / cordis patch / 锁文件均已更新
```

关键旁证：整个过程中**没有任何一步用到 README 的安装章节**——每一步都要靠读 CLI 源码、插件清单与 profile 目录自行推断。
