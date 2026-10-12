# dsh-scout 0.9.1 开发结果报告

- 交付版本：`dsh-scout@0.9.1`（**仅本地**：未推 GitHub、未发 npm、未打 tag）
- 基线：`0.9.0`（commit `3406a4e`）
- 运行面基准：DSH `0.2.0-rc.2`（本机）+ `0.1.0-rc.6` / `0.1.2-rc.1` / `0.2.1-alpha.2`（矩阵实测）
- 团队模式：Agent Team（Lead + 5 名成员），Lead 自留 `src/index.ts` 关键路径
- 完成日期：2026-10-12

---

## 1. 一句话结论

0.9.1 按 [方向报告](dsh-scout-0.9.1-direction.md) 的冻结范围全部落地：**工具输出契约重做、落盘可信度修复、服务调用时绑定与惰性回填、多语言与调查覆盖度、官方 manifest 与本地化展示元数据、`/scout` 命令与 Skill 入口、文档与真实调用门禁**。四道门禁全绿，独立验证给出 **GO**。开发过程中由独立验证者抓出并关闭了 **6 个真实缺陷 + 5 条文档不符**，全部在本次迭代内修复。

| 门禁 | 结果 |
|---|---|
| `npm test`（构建 + 4 个套件） | **95/95 通过** |
| `DSH_BIN=$(which dsh) npm run test:profile` | **PASS**（真实 `ctx.tools.execute` 调用 + 输出 schema 负向对照） |
| `npm run check:release` | **PASS（4 个精确 DSH 版本 4/4）**，exit 0 |
| `pnpm pack --dry-run` | 23 项，含 `dist/`、`locale/`、`assets/`、`CHANGELOG.md`、全部测试套件；6 个 `exports` 目标均真实存在 |

---

## 2. 交付内容（对照冻结范围逐项）

### 2.1 P0 契约与正确性

| 项 | 状态 | 落地方式 |
|---|---|---|
| P0-1 落盘失败静默 | 已修 | `persist.persisted=false` + `persist.error` 进返回值；失败时**不产生** `case_exported` 事件 |
| P0-2 导出不是忠实快照 | 已修 | 两条落盘路径统一为「先记事件、后写文件」，磁盘 `events.jsonl` 含本次导出事件 |
| P0-3 恢复后 case 丢失 | 已修 | 缓存未命中时从 `<scoutDir>/<caseId>/` 惰性回填并记 `case_rehydrated`；未知 case 报错会列出本会话已知 caseId |
| P0-4 可选服务 apply 时快照 | 已修 | `fs`/`web` 改为**调用点解析**；`commands`/`skills` 用 `ctx.inject` 绑定 |
| P0-5 工具回吐整份 case JSON | 已修 | 12 个工具全部改为结构化 `output.schema`；变更类工具渲染 **< 1 KB** 摘要（实测 120–238 B） |

### 2.2 P1 分发、可解释与双语

| 项 | 状态 | 落地方式 |
|---|---|---|
| P1-1 官方 manifest 字段 | 已加 | `engines.dsh` + `dsh.manifestVersion: 1`；README 讲清「声明 / 生效 / 不被校验」三层口径 |
| P1-2 插件管理器展示 | 已加 | `locale/{en,zh}.json`（**写进 `exports`**，否则 ESM resolver 静默忽略）+ 包内 `icon` |
| P1-3 输出语言可配置 | 已加 | `language: 'zh-CN' \| 'en'`（默认 `zh-CN`），覆盖报告/问题/对比/采集草稿/案例自带出厂文案 |
| P1-4 调查覆盖度 | 已加 | 报告 `## Coverage`（11 维 已核验/待核验/未调查）+ `scout_report.value.coverage` |
| P1-5 `/scout` 命令 | 已加 | `status` / `questions` / `report` / `export` 四个子动作；宿主自动落 `command/run` + `command/done` |
| P1-6 Skill 入口 | 已加 | `ctx.skills.register` 注册标准工作流 + 四条证据纪律，无需落文件 |

### 2.3 其余交付项

| 项 | 状态 |
|---|---|
| 来源 URL 去重（规范化：host 小写、去尾斜杠） | 已做 |
| 导出返回**解析后的绝对路径**；相对 `scoutDir` 以会话 cwd 为基准 | 已做 |
| 导出完成标记 `export.complete.json` + 写盘转发 `exec.signal` | 已做 |
| 产品契约 §5 撤回「自造 session event」计划并给出替代路线 | 已做 |
| README 双语 + `CHANGELOG.md`（含 `Not in this release` / `Known boundaries`） | 已做 |
| 真实工具调用门禁 + 版本范围分类（`OUT OF DECLARED RANGE` vs `REGRESSION`） | 已做 |

---

## 3. 独立验证抓出并关闭的缺陷

这是本次迭代质量提升最大的一段：**独立验证者（非实现者）在三轮里报出的每一条都成立**，全部在 0.9.1 内修复或按边界记录。

| 编号 | 缺陷 | 处置 |
|---|---|---|
| G1 | 惰性回填不校验完成标记，半份导出被静默接受 | 已修：回填要求 `complete === true` |
| G2 | 1 KB 预算不强制（3000 字符 `nextAction` → 3121 B） | 已修：逐字段裁剪 + UTF-8 整串上限（同例实测 **261 B**），`value` 仍保留完整文本 |
| G3 | 覆盖写失败后陈旧标记仍宣称 `complete:true` | 已修：**写前先降级为 `complete:false`**，五文件落盘后再置 `true` |
| D1 | 配置 `en` 导入 zh-CN case：工具报告英文、落盘 `report.md` 中文 | 已修：`exportCaseFiles(case, { language })` 跟随渲染语言 |
| D7 | `scout_ingest` 草稿分支硬编码中文说明文字 | 已修：文案入 `i18n` 字典（`ingest.autoConfidenceNote` / `autoNextAction`） |
| D8 | D1 的残留：案例自带文案仍是创建语言，`case.json` 自相矛盾 | 已修：`alignCaseDefaults` 对**未编辑的出厂默认**对齐部署语言；用户编辑过的原样保留 |
| D2–D6 / D9 | 5+1 条文档与实测不符（工具清单、`persist` 语义、完成标记语义、问题上限、回填前置条件） | 已修：文档逐条对齐实现 |
| D10 | 精选面试问题**整组**对齐（部分编辑则整组保留创建语言） | **已知边界**，写入 CHANGELOG `Known boundaries`，按条对齐排 0.9.2 |

三个附加价值：

1. **`zh-CN` 零回归被证明**：验证者用 **真实 0.9.0 构建产物**（`3406a4e`）做逐字节差分，剥掉新增的 16 行 `## Coverage` 后报告完全相同，`case.json` 三字段逐字段相同。
2. **门禁有牙被证明**：输出 schema 负向对照命中 `ToolOutputError`/`INVALID_TOOL_OUTPUT`；包装配层 16 个变异体全部被 `tests/package.test.mjs` 捕获。
3. **两条方法论修正**：验证者自己纠正了「用 `git archive HEAD` 取基线」（HEAD 已前进，会取到被测代码本身）与「管道导致退出码失真」两个陷阱。

---

## 4. 团队分工（Agent Team）

| 成员 | 负责范围（唯一写者） | 主要产出 |
|---|---|---|
| lead | `src/index.ts`、`tests/tools.test.mjs` | 输出契约、落盘可信度、服务绑定与回填、命令与 Skill、语言接线 |
| model-i18n | `src/model.ts`、`src/i18n.ts`、`tests/model.test.mjs` | 多语言字典、`computeCoverage`、`findSourceByUrl`、问题预算修复 |
| packaging | `package.json`、`locale/`、`assets/`、`tests/package.test.mjs` | manifest 字段、locale exports、图标、12 项契约测试 |
| verify-harness | `scripts/profile-smoke.mjs`、`scripts/check-release.mjs` | 真实工具调用门禁、版本范围分类 |
| docs | `README*.md`、产品契约、`CHANGELOG.md` | 兼容性口径、契约改写、变更日志 |
| verifier | `tests/acceptance.test.mjs`、`docs/verification-0.9.1.md` | 22 项对抗式验收 + 三轮验证报告 |

协作纪律：每个文件只有一个写者；测试文件在开工前按所有权拆分（`model` / `tools` / `package` / `acceptance` 四个套件互不重叠）；Lead 统一提交，成员不执行任何 git 写操作。

---

## 5. 未做与未验证（诚实边界）

**本轮明确不做**（写入 `CHANGELOG.md` 的 `Not in this release`）：client 面板、自造 session event（DSH 0.2.0-rc.2 上是红线：`Session.append` 无法写 `ignorable`，而持久化读路径拒绝未知且非 ignorable 的类型，会让插件自己写的会话无法重建）、`ctx.storageDomain` 持久化重写、评分/排名、`@deepseek-ai/schemastery` 版本对齐、`presentationMeta` 载荷、npm 发布与 git tag。

**未验证**（独立验证者列出 U1–U12，最要紧的两条）：
- **U11**：`test:profile` 只真实调用 `scout_start` + `scout_report`，**不经过**标记/导出/回填/跨语言导入代码路径——这四类修复的证据来自假 ctx 探测 + 真实构建产物差分，不是真实宿主端到端。
- **U1**：无 API key ⇒ 真实 LLM/agent/approval/tool-policy 路径没有任何门禁；`/scout` 在真实宿主上的 `command/run` + `command/done` 落盘亦未验证。

其余未验证项：真实 fs provider 下的绝对路径、真实磁盘故障（ENOSPC/EACCES）、DSH 源码是否消费 `engines.dsh`、GitHub Actions 实际运行、真实 web provider、npm 发布链路、URL 边界、多语言在真实模型会话中的可读性。

---

## 6. 本地提交记录

```
7075668 Align case-authored copy with the deployment language
fa20d7e Add v0.9.1 docs: compatibility policy, contract rewrite and changelog
3d71199 Add v0.9.1 release gates: real tool invocation and declared range
ad60338 Add v0.9.1 distribution contract: manifest fields, locales and icon
30c1946 Add v0.9.1: structured output, durable state and i18n
3406a4e fix: support DSH 0.2 in dsh-scout 0.9.0   ← 0.9.0 基线
```

- 与 0.9.0 相比：**16 个文件、+4305 / −1200**（不含验证者的两个新文件）。
- 仅本地：**没有** `git push`、**没有** `npm publish`、**没有** tag。`docs/upstream/**` 与两个归档脚本是本次工作前就存在的未跟踪文件，**未被提交**。

---

## 7. 下一步（建议）

1. **0.9.2（小）**：精选面试问题**按条**对齐（下标逐项替换，去掉整组 all-or-nothing 边界）；把 U11 从「假 ctx 证据」升级为真实宿主端到端（让 profile-smoke 真的走一遍 `scout_export` → `scout_import` → 跨语言导入）。
2. **0.10.0（feature）**：client 面板（`tool.call.toolview` + `shell.overlay`）与 `presentationMeta` 载荷；`ctx.storageDomain` 持久化（注意：无内建分区、无迁移、`KvUnit` 不串行化并发写）。
3. **发版前**：在真实 GitHub Actions 上跑一次 `check:release`，再决定是否推远端 / 发 npm。

---

## 附录：验证产物

- 对抗式验证报告：[verification-0.9.1.md](verification-0.9.1.md)（三轮汇总台账、已知边界、GO/NO-GO 与 U1–U12）
- 方向分析报告：[dsh-scout-0.9.1-direction.md](dsh-scout-0.9.1-direction.md)
