# dsh-scout 0.9.1 合规审计报告（对照 DSH 0.2.0-rc.2 官方契约）

- 审计对象：`dsh-scout@0.9.1`（HEAD `64ec814`）的实际代码与产物
- 契约来源：本机 DSH `0.2.0-rc.2` 运行时（`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh`）的类型与实现 + 官方文档归档（`docs/upstream/deepseek-harness-site/`）
- 审计日期：2026-10-12
- 方法：**读实际代码 + 真实宿主实测**（不是读文档推断）

## 结论

**结构合规，实现方式基本符合官方要求；发现 1 个真实的类型契约违反 + 5 项非违规偏差。**

| 维度 | 结论 |
|---|---|
| Bundle / Profile / Patch 契约 | ✅ 合规 |
| 官方 manifest 字段与展示元数据 | ✅ 合规（真实 reader 验证） |
| 兼容范围声明与门禁 | ✅ 合规 |
| 最小运行面（host-only） | ✅ 合规 |
| Config（schemastery） | ✅ 合规 |
| 依赖注入与可选服务绑定 | ✅ 合规（调用点解析 + `ctx.inject`） |
| 工具定义与输出契约 | ✅ 合规（真实调用 + 负向对照验证） |
| 生命周期 / Effect 所有权 / 清理 | ✅ 合规 |
| 命令入口（`/scout`） | ✅ 合规（真实宿主验证） |
| **Skill 注册** | ❌ **不符合**：缺必填的 `source` |
| 分发（`files`/`exports`/`prepare`） | ✅ 合规（有 2 项冗余） |

---

## 1. 发现的问题

### F1（唯一违规）Skill 注册缺少必填的 `source`

**契约**（`@deepseek-ai/dsh-skill/lib/types/index.d.ts:78-84`）：

```ts
export type SkillRegistration = Omit<SkillDefinition, 'invocation' | 'provider'> & {
  readonly invocation?: SkillInvocationPolicy;
  readonly provider?: string;
};
```

`Omit` 只去掉了 `invocation` 与 `provider`；`SkillDefinition extends SkillSummary`，而 `SkillSummary.source: SkillSource` 是**非可选**（同文件 `:56`），且注释放明"**prompt-visible metadata**"。

**当前代码**（`src/index.ts:1340-1346`）没有提供 `source`：

```ts
bindOptional('skills', service => (service as ScoutSkills).register({
  name: 'scout',
  description: '…',
  whenToUse: '…',
  content: SCOUT_SKILL_CONTENT,
  invocation: { modelInvocable: true, userInvocable: true },
  // ← 缺 source
}))
```

**真实宿主实测**（把 0.9.1 装进隔离 profile，用探针插件读回契约面）：

```
SKILL_ROW={"name":"scout","provider":"runtime","hasSource":true}
```

- `provider` 由注册表补默认值（`dsh-skill/lib/index.js:207` `provider: skill.provider ?? RUNTIME_PROVIDER`），所以是 `"runtime"`；
- **`source` 没有被补默认值**，投影处 `:443` 无条件写出 `source: skill.source` → 属性键存在但值为 `undefined`（`JSON.stringify` 会丢掉它，故 `'source' in row === true` 而 `row.source === undefined`）。

**为什么没在开发期暴露**：`validateRuntimeSkill`（`:465-469`）只校验 `name` / `description` / `invocation`，**不校验 `source`**，所以不会抛错；我们的单测用的是假 `skills` double，不看这个字段。

**影响面（已量化，不算大但要修）**：
1. **类型契约违反**：任何用真实 `SkillRegistration` 类型书写注册的消费者会编译不过；
2. `ctx.skills.list()` / `snapshot()` 返回的 `SkillSummary` 违反自己声明的非可选字段，读 `source` 的消费者拿到 `undefined`（例如按来源分组展示）；
3. `dsh-skill/lib/index.js:320` 的 shadow 告警会打印 `undefined`。

**一行修复**：

```ts
  content: SCOUT_SKILL_CONTENT,
  source: 'runtime',              // ← 补这一行（SkillSource 联合里有 'runtime'）
  invocation: { modelInvocable: true, userInvocable: true },
```

同时把 `src/index.ts` 里 `ScoutSkills.register` 的**结构化类型补上 `source: string`**，让类型层也能挡住这类遗漏。

---

## 2. 非违规但值得处理的偏差

| # | 偏差 | 事实与影响 | 建议 |
|---|---|---|---|
| D1 | `@deepseek-ai/schemastery` 是普通 `dependency` 且范围 `^3.18.2`，宿主系列锁 `~3.18.4` | 可能解析到 3.19.x 造成行为漂移；**不会误判 Config**——身份识别走全局符号 `Symbol.for("schemastery")`（`schemastery/lib/index.mjs:3`，由 `dsh-app-boot` 的 `isNativeConfigSchema` 读取），无 `instanceof` 检查 | 对齐成 `~3.18.4`（0.9.1 已明确缓办） |
| D2 | 两个 peer 都标了 `optional: true` | `@deepseek-ai/dsh-tools` 实际是**硬依赖**（`src/index.ts` 顶层 value import `defineTool`）。标 optional 只影响 npm/pnpm 的告警，**不影响 DSH 兼容门禁**（`evaluatePluginCompatibility` 只读 `peerDependencies`，无视 `peerDependenciesMeta`） | 至少把 `dsh-tools` 改为非 optional，让安装期就能给出明确信号 |
| D3 | `apply(ctx, config: Config = {})` 的默认参数是死代码 | cordis 始终传入校验后的 config；官方示例签名为 `apply(ctx, config)` | 可去掉默认值（纯风格） |
| D4 | `export * from './model.js'` 让插件入口额外导出全部内部模型函数 | 非违规，但把包的公共 API 面（semver 面）扩大到实现细节 | 如无外部消费需求，改为 `export type` 或收窄 |
| D5 | `files` 把 `tests/**` 与 `scripts/**` 一起发布（约 150 KB） | 对使用者无用；不影响正确性 | 发 npm 前考虑是否保留（当前保留有"自带验证套件"的正当理由） |
| D6 | 两个做 I/O 的工具未声明 `timeoutMs` | 可选字段；声明它等于承诺"把 `exec.signal` 转发给可协作的实现"——`scout_export`/`scout_search` 现在**都已转发**，因此声明是合法的 | 可选加固，非必须 |

---

## 3. 逐项合规证据（含真实宿主实测）

| 官方要求 | 实现 | 证据 |
|---|---|---|
| Bundle 声明 `dsh.bundle.patch`；patch 为顶层数组、row id 稳定 | `dsh.bundle.patch: "./cordis.patch.yml"`；`- insert: - id: dsh-scout, name: dsh-scout` | `--dump-config` 出现 `# == dsh-scout` 层（profile smoke） |
| manifest 格式版本与作者声明字段 | `dsh.manifestVersion: 1`、`engines.dsh: ">=0.1.0-rc.6 <0.3.0-0"` | `dsh-package-manifest/lib/types/types.d.ts:22,30,54-64` |
| 插件管理器展示元数据 | `locale/en.json` + `locale/zh.json`（`meta.title`/`meta.description`）+ 包内 `icon`，且 locale **写进 `exports`** | `dsh-app-boot/lib/index.js:1969-1994`（`readPluginMeta`）+ `:1884-1891`（ESM resolver，未导出=静默忽略） |
| 兼容门禁 | `peerDependencies["@deepseek-ai/dsh-tools"]` 带 `-0` 上界 | `dsh-app-boot/lib/index.js:294`（只认 `@deepseek-ai/dsh*`）、`:300`（`includePrerelease: true`） |
| 最小运行面 | 无 `dsh.client`、无 client bundle、无 slot | project 无 client 需求，符合"最小运行面" |
| Config 必须是 schema | `export const Config = z.object({...}).default(...)` | `__en__develop__basic__config.html`：不得导出普通对象 |
| 必需服务用 `inject` | `export const inject = ['tools']` | 与官方模板一致 |
| 可选服务调用点解析 / 惰性绑定 | `fs`/`web` 在 `execute` 内 `ctx.get()`；`commands`/`skills` 走 `ctx.inject([name], cb)` + `child.effect` | `__en__develop__framework__service.html`："query with `ctx.get()` at the use site" |
| 工具定义 | `defineTool` + value-schema DSL；object 节点显式 `additionalProperties`；`render` 必填 | `dsh-tools/lib/types/schema.d.ts:58-62,178-193` |
| 输出契约 | 12/12 工具的 `output.schema` 全部为结构化；注册表实际强制 | 真实调用 + 负向对照命中 `INVALID_TOOL_OUTPUT` |
| Effect 所有权 | 12 个工具注册全在**同一个 `ctx.effect`** 内；可选服务注册在子作用域 effect | `src/index.ts:643`（`ctx.effect`）、`:1327-1331`（`ctx.inject` + `child.effect`） |
| 无残留资源 | grep 全库：无 `process.` / `console.` / `setTimeout` / `setInterval` / `.watch(` | `src/*.ts` 零命中；实测卸载输出 `DSH_SCOUT_UNLOAD` |
| 命令入口 | `ctx.commands.register({name:'scout', description, handler})` | 真实宿主：`COMMAND_ROW={"name":"scout","description":"…"}`；校验器 `dsh-commands/lib/index.js:149-153` 只要求小写名/非空描述/函数 handler |
| **Skill 入口** | 注册成功但缺 `source` | 真实宿主：`SKILL_ROW={name, provider:"runtime", hasSource:true}`，`source` 为 `undefined` → **见 F1** |
| 不自造 session event（0.2.0-rc.2 红线） | 未声明任何 `SessionEventMap` 扩展 | `dsh-session/lib/index.js:1441-1459`（append 无法写 `ignorable`）+ `dsh-session-persistence/lib/index.js:184`（读路径拒绝未知非 ignorable 类型） |
| model-visible 可重建 | 模型可见面 = 工具结果（已进会话日志）；case 事件写在插件自己的 `events.jsonl` | `__en__reference__.html`："Model-visible means logged" |
| 分发一致性 | `main`/`types`/`exports`/`files` 与产物一致；`prepare` 自包含 | `pnpm pack --dry-run` 23 项；6 个 exports 目标全部存在 |
| Git 安装 | README 给出 `github:…#<commit>` + `allowBuilds` | `__en__develop__basic__publish.html` |

---

## 4. 明确"不需要做"的（避免过度设计）

| 项 | 为什么不做是对的 |
|---|---|
| `dsh.client` / client bundle / slot 注册 | 无 Web 可视化需求；官方要求"没有 Web 需求就不要声明 `dsh.client`" |
| `presentationMeta` / `presentCall` / `presentResult` | 宿主侧视图是封闭联合（`Generic\|Terminal\|Diff\|Search\|Read\|Web`），自定义卡片必须走 client 插件；无 client 消费者时零收益 |
| `isConcurrencySafe` | 省略即 exclusive，对共享内存 case 表是**正确**默认 |
| 自造 session event | 0.2.0-rc.2 上是红线，会导致插件自己写的会话无法重建 |
| `ctx.storageDomain` | 0.10.0 的事；当前"文件惰性回填"已覆盖主要痛感 |

---

## 5. 建议动作

**立即（一行 + 一行类型）**：补 `source: 'runtime'`，并把 `ScoutSkills.register` 的结构类型补上 `source`；加一条断言 `ctx.skills.list()` 返回行的 `source` 为 `'runtime'` 的测试（现有假 double 测不到，需要在真实宿主门禁里断言，或让假 double 校验必填字段）。

**发 npm 前**：D1（schemastery 范围对齐）、D2（`dsh-tools` 去掉 optional）、D5（是否继续随包发布 tests/scripts）。

**可延后**：D3 / D4 / D6。

---

## 附：本次审计的实测命令（可复现）

```sh
# 1) 真实宿主读取命令与技能契约面
#    隔离 profile 装入 0.9.1 tarball + 探针插件（--patch）
#    → SKILL_ROW={"name":"scout","provider":"runtime","hasSource":true}
#    → COMMAND_ROW={"name":"scout","description":"…"}

# 2) 结构卫生
grep -nE "\bprocess\.|\bconsole\.|setTimeout|setInterval|\.watch\(" src/*.ts   # 零命中
grep -nE "ctx\.(tools\.register|effect|inject|on)\(" src/index.ts              # 12 个 register 全在 1 个 effect 内

# 3) 打包一致性
pnpm pack --dry-run
```
