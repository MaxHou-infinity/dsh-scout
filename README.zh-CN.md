# dsh-scout · 司察（Scout）

[![license MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![node >=22.19](https://img.shields.io/badge/node-%3E%3D22.19-brightgreen)](package.json)
[![dsh-tools 0.1.0-rc.6](https://img.shields.io/badge/dsh-tools-0.1.0--rc.6-4b32c3)](package.json)
[![tests 16 passing](https://img.shields.io/badge/tests-16%20passing-green)](tests/model.test.mjs)
[![English README](https://img.shields.io/badge/README-English-blue)](README.md)

**司察（Scout）** —— 面向 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) 的证据驱动型公司尽调与岗位背调插件（HR tech）。

`dsh-scout` 帮助 Agent 回答一个具体问题：

> 这家公司和这个岗位是否值得进入下一轮？面试中还有哪些事项必须核验？

插件将事实、转述信息、推断、未知项、来源和下一步动作分开管理。在公司主体和高影响结论获得充分证据之前，默认保持谨慎的 `VERIFY` 状态。

## 命名

- **Scout（侦察兵）** —— 在你做出承诺之前，先派出侦察兵去摸清一家公司与一个岗位：背调、尽调、证据收集、面试准备。英文包名与仓库名保持 `dsh-scout` 不变，确保安装引用稳定。
- **司察（sī-chá）** —— 中文名："司"谐音 scout，"察"取考察、审查、侦察之意，二字点明"证据驱动的公司与岗位尽调"这一核心功能。

## 当前范围

本仓库包含首个可运行、按会话隔离的功能切片：

- `scout_start`：创建一个保存在内存中的尽调案例。
- `scout_add_source`：登记一个信息来源。
- `scout_add_claim`：添加一条受证据边界约束的主张。
- `scout_verify_identity`：通过 `E3` 来源确认法定主体。
- `scout_verify_claim`：提升主张的验证状态，同时保留其此前的证据状态。
- `scout_report`：生成当前 Markdown 报告（证据概况统计、按影响排序的关键证据/风险/角色假设、**待核验清单**、带 URL 的来源清单与面试问题）。
- `scout_export`：将案例持久化为**五文件导出**（`case.json`、`sources.json`、`claims.json`、`events.jsonl`、`report.md`）写入目标目录。
- `scout_import`：从五文件导出目录恢复案例，并重新计算其决策。

首个案例夹具是 [Snapmaker HR Head](docs/fixtures/dsh-scout/snapmaker-hr-head.json)。其中的历史材料被刻意标记为 `E1`，不会被视为当前有效的核验依据。

案例状态默认保存在内存中，并按 DSH Agent/会话身份隔离；通过 `scout_export` / `scout_import` 可借助五文件格式（含可回放的 `events.jsonl`）跨会话持久化。可配置存储目录和由 Provider 支持的信息采集是下一阶段的实现内容；本仓库目前并不声称已完成完整产品契约。

## 开发

```sh
pnpm install
pnpm test
pnpm run check:release
```

测试覆盖谨慎决策默认值、证据等级约束、主体核验、会话隔离、报告渲染，以及插件卸载时的工具清理。`check:release` 还会打包插件，将其安装到隔离的临时 DSH Profile 中，验证 `--dump-config`，检查挂载后的全部六个工具，并确认 Cordis 卸载 disposer 被触发。该门禁优先使用 `DSH_BIN` 或本地 `dsh`；如果两者都不可用，则通过 `npx` 下载官方 CLI 的精确版本 `0.1.0-rc.6`。

## 安装到 DSH Profile

该包是一个可安装的 DSH Bundle：

```sh
dsh plugin --profile scout-demo add github:MaxHou-infinity/dsh-scout#<commit>
dsh --profile scout-demo --dump-config
```

通过 Git 安装时会拉取源代码并运行 `prepare`。pnpm 可能要求为 `dsh-scout` 显式添加 `allowBuilds` 配置；请只允许你已审查且已固定版本的来源。当前包面向 `@deepseek-ai/dsh-tools` `0.1.0-rc.6` 和 `@deepseek-ai/cordis` `4.0.x`。

## 设计边界

- 不替代通用网页搜索、浏览器或 MCP Provider。
- 不向第三方发送求职申请、邮件或个人身份信息。
- 不会把融资信息、公司自述或招聘启事直接当作已经核实的成功证明。
- 不构成法律、投资或医疗建议。

完整 MVP 边界和验收标准见[产品契约](docs/dsh-scout-product-contract.md)。

## 社区

这是一个面向 DeepSeek Harness 的独立社区插件。仓库使用 `dsh-plugin`、`deepseek-harness`、`due-diligence`、`company-research`、`job-research`、`hr-tech`、`evidence-based` 等 Topic 供用户发现与检索。
