# dsh-scout · 司察（Scout）

[![license MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![node >=22.19](https://img.shields.io/badge/node-%3E%3D22.19-brightgreen)](package.json)
[![dsh-tools 0.1.0-rc.6](https://img.shields.io/badge/dsh-tools-0.1.0--rc.6-4b32c3)](package.json)
[![tests 26 passing](https://img.shields.io/badge/tests-26%20passing-green)](tests/model.test.mjs)
[![English README](https://img.shields.io/badge/README-English-blue)](README.en.md)

**司察（Scout）** —— 面向 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) 的**证据驱动型公司与岗位尽调 / 背调插件**。

一句话说清楚：**它让 AI 帮你回答——"这家公司和这个岗位，值得进入下一轮吗？面试中还有哪些事项必须核验？"** 并且，每一个结论都挂靠真实的来源，绝不把"公司自述"或"融资新闻"当成已经核实的事实。

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
scout_add_source     登记来源（sourceType + evidenceLevel）
   │
scout_add_claim      添加结论（受证据边界约束）
   │
scout_verify_identity 用 E3 官方源核验公司主体（可选但强烈建议）
   │
scout_verify_claim   用更强证据把结论提升为 verified（保留历史）
   │
scout_report         生成 Markdown 尽调报告
   │
scout_export / scout_import  落盘持久化（五文件），换会话可恢复
```

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
- **Claim ledger**：全部结论台账（状态/证据等级/影响/来源/置信说明）
- **Sources**：带 URL 的来源清单（可点击回溯）
- **Interview questions**：建议的面试反问

## 工具清单

| 工具 | 作用 |
|---|---|
| `scout_start` | 创建尽调案例 |
| `scout_add_source` | 登记信息来源（含证据等级） |
| `scout_ingest` | 批量登记采集结果（自动推断来源类型与证据等级，单条失败不影响整体） |
| `scout_add_claim` | 添加证据受限的主张 |
| `scout_verify_identity` | 用 E3 官方源核验法定主体 |
| `scout_verify_claim` | 用更强证据提升主张为 verified |
| `scout_report` | 渲染当前 Markdown 报告 |
| `scout_questions` | 从案例派生去重、按优先级排序的面试问题清单（上限 12 条） |
| `scout_compare` | 2–5 个案例的并排对比报告（决策/主体/关键结论/风险/面试问题） |
| `scout_export` | 持久化五文件导出（case/sources/claims/events/report） |
| `scout_import` | 从导出目录恢复案例并重算决策 |

## 安装到 DSH Profile

```sh
dsh plugin --profile scout-demo add github:MaxHou-infinity/dsh-scout#<commit>
dsh --profile scout-demo --dump-config   # 验证工具挂载
```

要求：Node ≥ 22.19；面向 `@deepseek-ai/dsh-tools` `0.1.0-rc.6` 与 `@deepseek-ai/cordis` `4.0.x`。Git 安装会运行 `prepare`，pnpm 可能需要为 `dsh-scout` 显式添加 `allowBuilds`（只放行你审查过的固定版本）。

## 配置（可选）

在 DSH profile 的 `cordis.patch.yml` 中为 `dsh-scout` 配置：

```yaml
- id: dsh-scout
  config:
    scoutDir: /path/to/scout-cases   # 默认导出目录；case 落在 <scoutDir>/<caseId>/
    autoPersist: true                # 每次变更后自动写五文件（默认 false）
```

- `scoutDir` 未配置时，`scout_export` 省略 `targetDir` 会写到 `./dsh-scout/<caseId>/`；
- `autoPersist: true` 时，每次 `scout_start` / `scout_add_source` / `scout_ingest` / `scout_add_claim` / `scout_verify_*` 后自动落盘；写失败不影响主流程。

## 数据持久化（v0.2 / v0.3）

案例默认在内存中、按会话隔离；`scout_export` 把案例写为五个文件：

```
case.json      案例主体（含决策状态）
sources.json   来源清单
claims.json    结论台账
events.jsonl   可回放事件流（case_started / claim_added / …）
report.md      当前报告快照
```

`scout_import` 可从导出目录恢复案例并重新计算决策——换会话、换机器都能接着尽调。

## 何时不要用（设计边界）

- 它**不替代**通用网页搜索、浏览器或 MCP Provider（信息来源仍需你自己/Agent 采集）；
- 它**不会**替你把融资信息、公司自述或招聘启事当成已核实的事实；
- 它**不构成**法律、投资或医疗建议；
- 主体核验依赖 E3 官方源，若 gsxt 等无法访问，报告会如实标记"待核验"。

完整 MVP 边界与验收标准见[产品契约](docs/dsh-scout-product-contract.md)；首个示例案例见 [Snapmaker HR Head](docs/fixtures/dsh-scout/snapmaker-hr-head.json)。

## 开发与测试

```sh
pnpm install
pnpm test        # 26 个测试：决策默认值/证据约束/主体核验/会话隔离/报告渲染/导出导入往返/自动持久化/面试问题
pnpm run check:release
```

## 路线图

- ✅ v0.1：证据纪律、三态决策、结构化报告、会话隔离
- ✅ v0.2：五文件持久化导出 + 事件流 + 导入恢复
- ✅ v0.3：可配置存储（`scoutDir` / `autoPersist`）+ 面试问题生成（`scout_questions`）
- ✅ v0.4：信息采集登记（`scout_ingest`：批量登记搜索结果/抓取页面，自动推断来源类型与证据等级）
- ✅ v0.5：公司/岗位对比（`scout_compare`：多案例并排对比报告，合并面试问题）
- ⏳ 下一阶段：Provider 深度集成（搜索/浏览器结果自动流转为来源与主张）

## 社区

面向 DeepSeek Harness 的独立社区插件（Topic：`dsh-plugin`、`deepseek-harness`、`due-diligence`、`company-research`、`job-research`、`hr-tech`、`evidence-based`）。欢迎 Issues / PR。
