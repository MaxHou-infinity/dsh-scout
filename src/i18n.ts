/**
 * Localized strings for every human-facing dsh-scout surface.
 *
 * `zh-CN` is the default language and its strings must stay byte-identical to the
 * pre-0.9.1 output; `en` is additive. This module only imports types so that
 * `model.ts` can import it at runtime without creating an import cycle.
 */
import type {
  ClaimDimension,
  ClaimImpact,
  ClaimStatus,
  Decision,
  EvidenceLevel,
} from './model.js'

export const SCOUT_LANGUAGES = ['zh-CN', 'en'] as const
export type ScoutLanguage = typeof SCOUT_LANGUAGES[number]

export function isScoutLanguage(value: unknown): value is ScoutLanguage {
  return typeof value === 'string' && (SCOUT_LANGUAGES as readonly string[]).includes(value)
}

/** Resolve any value to a supported language, falling back to the `zh-CN` default. */
export function normalizeScoutLanguage(value: unknown): ScoutLanguage {
  return isScoutLanguage(value) ? value : 'zh-CN'
}

/** Fill `{placeholder}` slots in a localized template; unknown slots stay verbatim. */
export function formatScoutString(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = values[key]
    return value === undefined ? match : String(value)
  })
}

export interface ScoutStrings {
  language: ScoutLanguage
  /** Header labels of the evidence report. */
  header: {
    decision: string
    reason: string
    objective: string
    evidenceSummary: string
  }
  /** Section headings shared by the report. */
  headings: {
    supportingEvidence: string
    unresolvedRisks: string
    roleHypotheses: string
    verificationChecklist: string
    claimLedger: string
    sources: string
    coverage: string
    interviewQuestions: string
  }
  /** Claim rendering templates. */
  claim: {
    line: string
    noSourceIds: string
    history: string
    checklistLine: string
  }
  /** Placeholders for empty sections. */
  empty: {
    noSources: string
    noClaims: string
    noSupportingEvidence: string
    noUnresolvedRisks: string
    noRoleHypotheses: string
    noChecklistItems: string
  }
  /** Investigation coverage block. */
  coverage: {
    entry: string
    untouchedLine: string
    yes: string
    no: string
    none: string
    separator: string
  }
  /** Decision labels for the three decision states. */
  decisions: Record<Decision, string>
  /** One line per decision reason code; the missing-dimension one is a template. */
  decisionReasons: {
    identity: string
    unresolved: string
    missingDimension: string
    proceed: string
    blockingContradiction: string
  }
  statuses: Record<ClaimStatus, string>
  evidenceLevels: Record<EvidenceLevel, string>
  impacts: Record<ClaimImpact, string>
  dimensions: Record<ClaimDimension, string>
  /** One interview question per dimension when the dimension has no verified evidence. */
  questions: Record<ClaimDimension, string>
  defaults: {
    decisionObjective: string
    fitQuestion: string
    initialDecisionReason: string
    interviewQuestions: string[]
  }
  /** Defaults for claims drafted by the `scout_ingest` batch path. */
  ingest: {
    /** Template with a `{sourceId}` placeholder. */
    autoConfidenceNote: string
    autoNextAction: string
  }
  comparison: {
    title: string
    overviewHeading: string
    summary: string
    countsSuffix: string
    identityVerified: string
    identityUnverified: string
    decisionTableHeading: string
    tableHeader: string
    tableSeparator: string
    tableRow: string
    verifiedMark: string
    unverifiedMark: string
    detailHeading: string
    detailTitle: string
    verifiedHeading: string
    openHeading: string
    noVerified: string
    noOpen: string
    openItem: string
    questionsHeading: string
    disclaimer: string
  }
  reportDisclaimer: string
}

const ZH_CN: ScoutStrings = {
  language: 'zh-CN',
  header: {
    decision: '- 判断：**{decision}**',
    reason: '- 理由：{reason}',
    objective: '- 目标：{objective}',
    evidenceSummary: '- 证据概况：{summary}',
  },
  headings: {
    supportingEvidence: '## Key supporting evidence (up to 3)',
    unresolvedRisks: '## Blocking or unresolved risks (up to 3)',
    roleHypotheses: '## Role task and authority hypotheses',
    verificationChecklist: '## Verification checklist',
    claimLedger: '## Claim ledger',
    sources: '## Sources',
    coverage: '## Coverage',
    interviewQuestions: '## Interview questions',
  },
  claim: {
    line: '- **{status} / {evidenceLevel} / {impact}** {text}（维度：{dimension}；来源：{sourceIds}；置信说明：{confidenceNote}；下一步：{nextAction}{history}）',
    noSourceIds: '无来源',
    history: '；历史修订：{count}',
    checklistLine: '- [{impact}] {claimId}: {text} → 下一步：{nextAction}',
  },
  empty: {
    noSources: '- 暂无来源',
    noClaims: '- 暂无结论',
    noSupportingEvidence: '- 暂无已核验的支持证据',
    noUnresolvedRisks: '- 暂无阻断级或重要待核验风险',
    noRoleHypotheses: '- 岗位真实性、汇报关系和授权边界尚未建模',
    noChecklistItems: '- 无待核验的阻断级或重要事项',
  },
  coverage: {
    entry: '- {dimension}（{label}）：已核验 {verified} / 待核验 {open} / 未调查：{untouched}',
    untouchedLine: '未调查维度（{count}）：{dimensions}',
    yes: '是',
    no: '否',
    none: '无',
    separator: '、',
  },
  decisions: {
    PROCEED: '继续推进',
    VERIFY: '继续核验',
    STOP: '停止',
  },
  decisionReasons: {
    identity: '公司主体仍未核验，不能直接推进。',
    unresolved: '仍有阻断级或重要结论未完成核验，不能直接推进。',
    missingDimension: '缺少已核验的必需维度：{dimension}。',
    proceed: '当前关键结论均有来源支撑，建议进入下一轮并继续现场核验。',
    blockingContradiction: '存在相互矛盾的关键事实，需先解决冲突。',
  },
  statuses: {
    verified: '已核验',
    reported: '转述',
    inferred: '推断',
    contradicted: '矛盾',
    unknown: '未知',
    needs_verification: '待核验',
  },
  evidenceLevels: {
    E0: 'E0（无证据）',
    E1: 'E1（单方陈述）',
    E2: 'E2（独立来源）',
    E3: 'E3（权威来源）',
  },
  impacts: {
    blocking: '阻断级',
    material: '重要',
    informational: '参考',
  },
  dimensions: {
    identity: '主体身份',
    role_existence: '岗位真实性',
    reporting_line: '汇报关系',
    mandate: '授权与职责',
    company_and_founder: '公司与创始人',
    product_and_technology: '产品与技术',
    market_and_competition: '市场与竞争',
    financing_and_commercialization: '融资与商业化',
    organization_and_hr: '组织与人力',
    risk: '风险',
    role_fit: '岗位匹配度',
  },
  questions: {
    identity: '公司主体的法定名称、注册号与注册地是什么？如何与品牌对应？',
    role_existence: '该岗位当前是否真实在招？招聘状态与到岗时间如何？',
    reporting_line: '该岗位直接向谁汇报？虚线/实线如何划分？',
    mandate: '该岗位在哪些事项上拥有最终决定权？团队与预算规模如何？',
    company_and_founder: '创始团队背景与股权结构如何？关键决策人是谁？',
    product_and_technology: '核心产品当前处于什么阶段？技术壁垒与依赖是什么？',
    market_and_competition: '目标市场与主要竞争对手是谁？差异化优势如何维持？',
    financing_and_commercialization: '当前融资轮次、现金储备与商业化进展如何？',
    organization_and_hr: '当前组织规模、关键岗位空缺与离职率如何？',
    risk: '已知的合规、诉讼或经营风险有哪些？处置进展如何？',
    role_fit: '该岗位的成功标准是什么？与我的经验差距在哪里？',
  },
  defaults: {
    decisionObjective: '判断是否值得进入下一轮，并准备面试反问',
    fitQuestion: '该岗位是否拥有足够的业务授权，值得继续推进？',
    initialDecisionReason: '尚未完成公司主体和岗位授权核验。',
    interviewQuestions: [
      '这个岗位在前三个月最重要的业务结果是什么？',
      '该岗位直接向谁汇报，在哪些事项上拥有最终决定权？',
      '现有团队、预算和外部供应商资源分别是什么？',
      '当前最影响业务增长的组织问题是什么？',
      '六个月后，哪些可观察结果代表这个岗位取得成功？',
    ],
  },
  ingest: {
    autoConfidenceNote: '由采集项自动登记，来源 {sourceId}',
    autoNextAction: '核验该主张并补充独立来源',
  },
  comparison: {
    title: '# 公司/岗位对比（{count} 个案例）',
    overviewHeading: '## 总览',
    summary: '- **{title}**：决策 **{decision}**；主体{identity}；主张 {claimCount} 条{countsSuffix}',
    countsSuffix: '（{counts}）',
    identityVerified: '已核验',
    identityUnverified: '待核验',
    decisionTableHeading: '## 决策与主体核验对比',
    tableHeader: '| 案例 | 决策 | 主体核验 | 主张数 |',
    tableSeparator: '|---|---|---|---|',
    tableRow: '| {title} | {decision} | {identity} | {claimCount} |',
    verifiedMark: '✅ 已核验',
    unverifiedMark: '⚠️ 待核验',
    detailHeading: '## 各案例详情',
    detailTitle: '### {title}（{caseId}）',
    verifiedHeading: '**关键已核验结论**：',
    openHeading: '**待核验风险/未知项**：',
    noVerified: '- 暂无已核验结论',
    noOpen: '- 无',
    openItem: '- [{impact}] {text} → {nextAction}',
    questionsHeading: '## 面试问题（合并去重，前 12 条）',
    disclaimer: '> 对比只呈现各案例证据边界内的状态，不替代法律、投资或医疗意见；关键差异请以原始来源人工复核。',
  },
  reportDisclaimer: '> 本报告只表达当前证据边界内的判断，不替代法律、投资或医疗意见。',
}

const EN: ScoutStrings = {
  language: 'en',
  header: {
    decision: '- Decision: **{decision}**',
    reason: '- Reason: {reason}',
    objective: '- Objective: {objective}',
    evidenceSummary: '- Evidence summary: {summary}',
  },
  headings: {
    supportingEvidence: '## Key supporting evidence (up to 3)',
    unresolvedRisks: '## Blocking or unresolved risks (up to 3)',
    roleHypotheses: '## Role task and authority hypotheses',
    verificationChecklist: '## Verification checklist',
    claimLedger: '## Claim ledger',
    sources: '## Sources',
    coverage: '## Coverage',
    interviewQuestions: '## Interview questions',
  },
  claim: {
    line: '- **{status} / {evidenceLevel} / {impact}** {text} (dimension: {dimension}; sources: {sourceIds}; confidence: {confidenceNote}; next action: {nextAction}{history})',
    noSourceIds: 'no source',
    history: '; revisions: {count}',
    checklistLine: '- [{impact}] {claimId}: {text} → next action: {nextAction}',
  },
  empty: {
    noSources: '- No sources yet',
    noClaims: '- No claims yet',
    noSupportingEvidence: '- No verified supporting evidence yet',
    noUnresolvedRisks: '- No blocking or material claims awaiting verification',
    noRoleHypotheses: '- Role existence, reporting line, and authority boundary are not modelled yet',
    noChecklistItems: '- No blocking or material items awaiting verification',
  },
  coverage: {
    entry: '- {dimension} ({label}): verified {verified} / open {open} / untouched: {untouched}',
    untouchedLine: 'Untouched dimensions ({count}): {dimensions}',
    yes: 'yes',
    no: 'no',
    none: 'none',
    separator: ', ',
  },
  decisions: {
    PROCEED: 'proceed',
    VERIFY: 'verify',
    STOP: 'stop',
  },
  decisionReasons: {
    identity: 'The company identity is not verified yet, so we cannot proceed.',
    unresolved: 'Blocking or material claims are still unverified, so we cannot proceed.',
    missingDimension: 'Missing verified required dimension: {dimension}.',
    proceed: 'All key claims are backed by sources; proceed to the next round and keep verifying on site.',
    blockingContradiction: 'Blocking facts contradict each other; resolve the conflict before deciding.',
  },
  statuses: {
    verified: 'verified',
    reported: 'reported',
    inferred: 'inferred',
    contradicted: 'contradicted',
    unknown: 'unknown',
    needs_verification: 'needs verification',
  },
  evidenceLevels: {
    E0: 'E0 (no evidence)',
    E1: 'E1 (single-party account)',
    E2: 'E2 (independent source)',
    E3: 'E3 (authoritative source)',
  },
  impacts: {
    blocking: 'blocking',
    material: 'material',
    informational: 'informational',
  },
  dimensions: {
    identity: 'Company identity',
    role_existence: 'Role existence',
    reporting_line: 'Reporting line',
    mandate: 'Mandate and authority',
    company_and_founder: 'Company and founder',
    product_and_technology: 'Product and technology',
    market_and_competition: 'Market and competition',
    financing_and_commercialization: 'Financing and commercialization',
    organization_and_hr: 'Organization and HR',
    risk: 'Risk',
    role_fit: 'Role fit',
  },
  questions: {
    identity: 'What are the legal name, registration number, and registered region of the entity behind the brand?',
    role_existence: 'Is this role actually open right now, and what are the hiring status and start date?',
    reporting_line: 'Who does this role report to, and how are the solid and dotted lines split?',
    mandate: 'Which decisions does this role own, and what are the team and budget sizes?',
    company_and_founder: 'What is the founding team background and cap table, and who makes the key decisions?',
    product_and_technology: 'What stage is the core product at, and what are its technical moat and dependencies?',
    market_and_competition: 'Who are the main competitors in the target market, and how is the differentiation maintained?',
    financing_and_commercialization: 'What are the current funding round, cash runway, and commercialization progress?',
    organization_and_hr: 'What are the current headcount, key open roles, and attrition rate?',
    risk: 'What known compliance, litigation, or operational risks exist, and how are they being handled?',
    role_fit: 'What does success look like in this role, and where does my experience fall short?',
  },
  defaults: {
    decisionObjective: 'Decide whether this role is worth pursuing, and prepare questions to ask.',
    fitQuestion: 'Does this role carry enough business authority to be worth pursuing?',
    initialDecisionReason: 'Company identity and role authority have not been verified yet.',
    interviewQuestions: [
      'What business outcomes matter most in this role in the first three months?',
      'Who does this role report to, and which decisions does it own?',
      'What team, budget, and external vendor resources are in place today?',
      'What organizational problem most constrains business growth right now?',
      'What observable results would mean this role succeeded six months from now?',
    ],
  },
  ingest: {
    autoConfidenceNote: 'Auto-registered from an ingested item; source {sourceId}',
    autoNextAction: 'Verify this claim and add an independent source',
  },
  comparison: {
    title: '# Company / role comparison ({count} cases)',
    overviewHeading: '## Overview',
    summary: '- **{title}**: decision **{decision}**; identity {identity}; claims: {claimCount}{countsSuffix}',
    countsSuffix: ' ({counts})',
    identityVerified: 'verified',
    identityUnverified: 'unverified',
    decisionTableHeading: '## Decision and identity comparison',
    tableHeader: '| Case | Decision | Identity | Claims |',
    tableSeparator: '|---|---|---|---|',
    tableRow: '| {title} | {decision} | {identity} | {claimCount} |',
    verifiedMark: '✅ verified',
    unverifiedMark: '⚠️ unverified',
    detailHeading: '## Case details',
    detailTitle: '### {title} ({caseId})',
    verifiedHeading: '**Key verified claims**:',
    openHeading: '**Unresolved risks / unknowns**:',
    noVerified: '- No verified claims yet',
    noOpen: '- None',
    openItem: '- [{impact}] {text} → {nextAction}',
    questionsHeading: '## Interview questions (merged and deduplicated, first 12)',
    disclaimer: '> This comparison only reports the status inside each case evidence boundary; it does not replace legal, investment, or medical advice. Verify key differences against the original sources.',
  },
  reportDisclaimer: '> This report only states judgements within the current evidence boundary; it does not replace legal, investment, or medical advice.',
}

const TABLES: Record<ScoutLanguage, ScoutStrings> = {
  'zh-CN': ZH_CN,
  en: EN,
}

/** Look up the string table for a language; an unknown or missing language falls back to `zh-CN`. */
export function scoutStrings(lang: ScoutLanguage | undefined): ScoutStrings {
  return TABLES[normalizeScoutLanguage(lang)]
}
