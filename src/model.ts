export const EVIDENCE_LEVELS = ['E0', 'E1', 'E2', 'E3'] as const
export type EvidenceLevel = typeof EVIDENCE_LEVELS[number]

export const CLAIM_STATUSES = [
  'verified',
  'reported',
  'inferred',
  'contradicted',
  'unknown',
  'needs_verification',
] as const
export type ClaimStatus = typeof CLAIM_STATUSES[number]

export const SOURCE_TYPES = [
  'company_registry',
  'regulator',
  'official_filing',
  'company_official',
  'job_posting',
  'independent_media',
  'public_database',
  'user_provided',
  'user_provided_historical_report',
  'other',
] as const
export type SourceType = typeof SOURCE_TYPES[number]

export const CLAIM_IMPACTS = ['blocking', 'material', 'informational'] as const
export type ClaimImpact = typeof CLAIM_IMPACTS[number]

export const CLAIM_DIMENSIONS = [
  'identity',
  'role_existence',
  'reporting_line',
  'mandate',
  'company_and_founder',
  'product_and_technology',
  'market_and_competition',
  'financing_and_commercialization',
  'organization_and_hr',
  'risk',
  'role_fit',
] as const
export type ClaimDimension = typeof CLAIM_DIMENSIONS[number]

export type Decision = 'PROCEED' | 'VERIFY' | 'STOP'

export const EVENT_TYPES = [
  'case_started',
  'source_added',
  'claim_added',
  'identity_verified',
  'claim_verified',
  'case_exported',
  'case_imported',
] as const
export type ScoutEventType = typeof EVENT_TYPES[number]

export interface ScoutEvent {
  eventId: string
  type: ScoutEventType
  at: string
  detail: Record<string, unknown>
}

const IDENTITY_SOURCE_TYPES = new Set<SourceType>([
  'company_registry',
  'regulator',
  'official_filing',
])

const JOB_PLATFORM_HOST_HINTS = [
  'liepin.com',
  'zhipin.com',
  '51job.com',
  'zhaopin.com',
  'quanzhi.com',
  'nowcoder.com',
  'jobs.feishu.cn',
]

const AUTHORITY_HOST_SUFFIXES = [
  'gov',
  'gov.cn',
  'gov.uk',
  'gov.hk',
  'gov.au',
  'gc.ca',
  'brreg.no',
  'handelsregister.de',
  'hkexnews.hk',
  'sse.com.cn',
  'szse.cn',
  'neeq.com.cn',
] as const

export interface ScoutSource {
  sourceId: string
  type: SourceType
  title: string
  url: string | null
  capturedAt: string | null
  evidenceLevel: EvidenceLevel
  status: string
  note?: string
}

export interface ScoutClaim {
  claimId: string
  text: string
  status: ClaimStatus
  evidenceLevel: EvidenceLevel
  dimension: ClaimDimension
  impact: ClaimImpact
  sourceIds: string[]
  nextAction: string
  confidenceNote: string
  history?: Array<{
    status: ClaimStatus
    evidenceLevel: EvidenceLevel
    sourceIds: string[]
    nextAction: string
    confidenceNote: string
  }>
}

export interface ScoutCase {
  schemaVersion: 'dsh-scout.case.v0'
  caseId: string
  title: string
  language: string
  decisionObjective: string
  subject: {
    name: string
    possibleLegalEntity?: string
    registrationNumber?: string
    registeredRegion?: string
    legalRepresentative?: string
    brandRelationship?: string
    identitySourceIds: string[]
    identityStatus: 'verified' | 'needs_verification'
  }
  role: {
    title: string
    location?: string
    fitQuestion: string
  }
  decision: Decision
  decisionReason: string
  sources: ScoutSource[]
  claims: ScoutClaim[]
  interviewQuestions: string[]
  events?: ScoutEvent[]
}

export function createCase(input: {
  caseId: string
  companyName: string
  roleTitle: string
  location?: string
  decisionObjective?: string
}): ScoutCase {
  return {
    schemaVersion: 'dsh-scout.case.v0',
    caseId: input.caseId,
    title: `${input.companyName} — ${input.roleTitle}`,
    language: 'zh-CN',
    decisionObjective: input.decisionObjective ?? '判断是否值得进入下一轮，并准备面试反问',
    subject: {
      name: input.companyName,
      identitySourceIds: [],
      identityStatus: 'needs_verification',
    },
    role: {
      title: input.roleTitle,
      location: input.location,
      fitQuestion: '该岗位是否拥有足够的业务授权，值得继续推进？',
    },
    decision: 'VERIFY',
    decisionReason: '尚未完成公司主体和岗位授权核验。',
    sources: [],
    claims: [],
    events: [],
    interviewQuestions: [
      '这个岗位在前三个月最重要的业务结果是什么？',
      '该岗位直接向谁汇报，在哪些事项上拥有最终决定权？',
      '现有团队、预算和外部供应商资源分别是什么？',
      '当前最影响业务增长的组织问题是什么？',
      '六个月后，哪些可观察结果代表这个岗位取得成功？',
    ],
  }
}

export function addSource(scoutCase: ScoutCase, source: ScoutSource): ScoutCase {
  if (scoutCase.sources.some(item => item.sourceId === source.sourceId)) {
    throw new Error(`Duplicate source: ${source.sourceId}`)
  }
  if (
    source.evidenceLevel === 'E3'
    && (!IDENTITY_SOURCE_TYPES.has(source.type) || !isTrustedAuthorityUrl(source.url))
  ) {
    throw new Error('E3 sources require a supported registry, regulator, or official filing HTTPS origin')
  }
  return { ...scoutCase, sources: [...scoutCase.sources, source] }
}

export function isTrustedAuthorityUrl(value: string | null): boolean {
  if (!value) return false
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return false
    if (url.port && url.port !== '443') return false
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
    return AUTHORITY_HOST_SUFFIXES.some(suffix =>
      hostname === suffix || hostname.endsWith(`.${suffix}`),
    )
  } catch {
    return false
  }
}

/** Guess a source category from its URL when the caller did not provide one. */
export function inferSourceType(
  url: string | null,
  explicit?: SourceType,
): { type: SourceType; inferred: boolean } {
  if (explicit) return { type: explicit, inferred: false }
  if (url) {
    try {
      const hostname = new URL(url).hostname.toLowerCase().replace(/\.$/, '')
      // Trusted authority origins (official registry/regulator) take priority.
      if (isTrustedAuthorityUrl(url)) {
        return { type: hostname.includes('gsxt') ? 'company_registry' : 'regulator', inferred: true }
      }
      // Exact host or subdomain match for known job platforms (no substring false positives).
      if (JOB_PLATFORM_HOST_HINTS.some(hint => hostname === hint || hostname.endsWith(`.${hint}`))) {
        return { type: 'job_posting', inferred: true }
      }
    } catch {
      // fall through to 'other'
    }
  }
  return { type: 'other', inferred: true }
}

/** Guess an evidence level from the URL and category when not provided explicitly. */
export function inferEvidenceLevel(
  url: string | null,
  type: SourceType,
  explicit?: EvidenceLevel,
): { evidenceLevel: EvidenceLevel; inferred: boolean } {
  if (explicit) return { evidenceLevel: explicit, inferred: false }
  if (IDENTITY_SOURCE_TYPES.has(type) && isTrustedAuthorityUrl(url)) {
    return { evidenceLevel: 'E3', inferred: true }
  }
  if (type === 'user_provided') {
    return { evidenceLevel: 'E1', inferred: true }
  }
  return { evidenceLevel: 'E2', inferred: true }
}

export function addClaim(scoutCase: ScoutCase, claim: ScoutClaim): ScoutCase {
  if (scoutCase.claims.some(item => item.claimId === claim.claimId)) {
    throw new Error(`Duplicate claim: ${claim.claimId}`)
  }
  validateClaimEvidence(scoutCase, claim)
  return { ...scoutCase, claims: [...scoutCase.claims, claim] }
}

function validateClaimEvidence(
  scoutCase: ScoutCase,
  claim: Pick<ScoutClaim, 'status' | 'evidenceLevel' | 'sourceIds'>,
): void {
  const knownSources = new Set(scoutCase.sources.map(source => source.sourceId))
  const missingSource = claim.sourceIds.find(sourceId => !knownSources.has(sourceId))
  if (missingSource) throw new Error(`Unknown source: ${missingSource}`)
  if (
    claim.sourceIds.length === 0
    && claim.status !== 'unknown'
    && claim.status !== 'needs_verification'
  ) {
    throw new Error('Claims without sources must remain unknown or needs_verification')
  }
  if (claim.status === 'verified' && claim.evidenceLevel === 'E0') {
    throw new Error('Verified claims require at least E1 evidence')
  }
  const evidenceRank: Record<EvidenceLevel, number> = { E0: 0, E1: 1, E2: 2, E3: 3 }
  const strongestSourceRank = scoutCase.sources
    .filter(source => claim.sourceIds.includes(source.sourceId))
    .reduce((rank, source) => Math.max(rank, evidenceRank[source.evidenceLevel]), 0)
  if (evidenceRank[claim.evidenceLevel] > strongestSourceRank) {
    throw new Error(`Claim evidence ${claim.evidenceLevel} exceeds its strongest source`)
  }
}

export function verifyClaim(
  scoutCase: ScoutCase,
  input: {
    claimId: string
    evidenceLevel: EvidenceLevel
    sourceIds: string[]
    nextAction: string
    confidenceNote: string
  },
): ScoutCase {
  const claimIndex = scoutCase.claims.findIndex(claim => claim.claimId === input.claimId)
  if (claimIndex < 0) throw new Error(`Unknown claim: ${input.claimId}`)
  const current = scoutCase.claims[claimIndex]
  const verified: ScoutClaim = {
    ...current,
    status: 'verified',
    evidenceLevel: input.evidenceLevel,
    sourceIds: [...input.sourceIds],
    nextAction: input.nextAction,
    confidenceNote: input.confidenceNote,
    history: [
      ...(current.history ?? []),
      {
        status: current.status,
        evidenceLevel: current.evidenceLevel,
        sourceIds: [...current.sourceIds],
        nextAction: current.nextAction,
        confidenceNote: current.confidenceNote,
      },
    ],
  }
  validateClaimEvidence(scoutCase, verified)
  const claims = [...scoutCase.claims]
  claims[claimIndex] = verified
  return { ...scoutCase, claims }
}

export function verifyIdentity(
  scoutCase: ScoutCase,
  input: {
    legalEntity: string
    registrationNumber: string
    registeredRegion: string
    legalRepresentative: string
    brandRelationship: string
    sourceIds: string[]
  },
): ScoutCase {
  const requiredValues = [
    input.legalEntity,
    input.registrationNumber,
    input.registeredRegion,
    input.legalRepresentative,
    input.brandRelationship,
  ]
  if (requiredValues.some(value => value.trim().length === 0)) {
    throw new Error('Company identity fields must not be blank')
  }
  if (input.sourceIds.length === 0) {
    throw new Error('Company identity verification requires at least one source')
  }
  const sources = input.sourceIds.map(sourceId => {
    const source = scoutCase.sources.find(item => item.sourceId === sourceId)
    if (!source) throw new Error(`Unknown source: ${sourceId}`)
    return source
  })
  const hasAuthoritativeSource = sources.some(source =>
    source.evidenceLevel === 'E3'
    && IDENTITY_SOURCE_TYPES.has(source.type)
    && isTrustedAuthorityUrl(source.url),
  )
  if (!hasAuthoritativeSource) {
    throw new Error('Company identity verification requires a linked E3 registry, regulator, or official filing source')
  }
  return {
    ...scoutCase,
    subject: {
      ...scoutCase.subject,
      possibleLegalEntity: input.legalEntity,
      registrationNumber: input.registrationNumber,
      registeredRegion: input.registeredRegion,
      legalRepresentative: input.legalRepresentative,
      brandRelationship: input.brandRelationship,
      identitySourceIds: [...input.sourceIds],
      identityStatus: 'verified',
    },
  }
}

export function decideCase(scoutCase: ScoutCase): ScoutCase {
  const identityUnverified = scoutCase.subject.identityStatus !== 'verified'
  const blockingContradiction = scoutCase.claims.some(claim =>
    claim.impact === 'blocking' && claim.status === 'contradicted',
  )
  const unresolvedMaterialClaim = scoutCase.claims.some(claim =>
    claim.impact !== 'informational' && claim.status !== 'verified',
  )
  const requiredDimensions: ClaimDimension[] = ['role_existence', 'reporting_line', 'mandate']
  const missingRequiredDimension = requiredDimensions.find(dimension =>
    !scoutCase.claims.some(claim => claim.dimension === dimension && claim.status === 'verified'),
  )

  if (blockingContradiction) {
    return {
      ...scoutCase,
      decision: 'STOP',
      decisionReason: '存在相互矛盾的关键事实，需先解决冲突。',
    }
  }
  if (identityUnverified || unresolvedMaterialClaim || missingRequiredDimension) {
    return {
      ...scoutCase,
      decision: 'VERIFY',
      decisionReason: identityUnverified
        ? '公司主体仍未核验，不能直接推进。'
        : unresolvedMaterialClaim
          ? '仍有阻断级或重要结论未完成核验，不能直接推进。'
          : `缺少已核验的必需维度：${missingRequiredDimension}。`,
    }
  }
  return {
    ...scoutCase,
    decision: 'PROCEED',
    decisionReason: '当前关键结论均有来源支撑，建议进入下一轮并继续现场核验。',
  }
}

const IMPACT_RANK: Record<ClaimImpact, number> = { blocking: 0, material: 1, informational: 2 }

function byImpact(claims: ScoutClaim[]): ScoutClaim[] {
  return [...claims].sort((a, b) => IMPACT_RANK[a.impact] - IMPACT_RANK[b.impact])
}

const MISSING_DIMENSION_QUESTIONS: Record<string, string> = {
  role_existence: '该岗位当前是否真实在招？招聘状态与到岗时间如何？',
  reporting_line: '该岗位直接向谁汇报？虚线/实线如何划分？',
  mandate: '该岗位在哪些事项上拥有最终决定权？团队与预算规模如何？',
}

/** Derive a deduplicated, prioritized interview question list from the case. */
export function generateInterviewQuestions(scoutCase: ScoutCase): string[] {
  const nextActions = byImpact(scoutCase.claims.filter(claim =>
    claim.impact !== 'informational' && claim.status !== 'verified',
  ))
    .map(claim => claim.nextAction.trim())
    .filter((action, index, all) => action && all.indexOf(action) === index)
  const missingDimensions = Object.keys(MISSING_DIMENSION_QUESTIONS).filter(dimension =>
    !scoutCase.claims.some(claim => claim.dimension === dimension && claim.status === 'verified'),
  )
  const questions = [
    ...nextActions,
    ...missingDimensions.map(dimension => MISSING_DIMENSION_QUESTIONS[dimension]),
    ...scoutCase.interviewQuestions,
  ]
  const seen = new Set<string>()
  return questions.filter(question => {
    const key = question.trim()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 12)
}

export function renderReport(scoutCase: ScoutCase): string {
  const sourceLine = (source: ScoutSource) => {
    const url = source.url ? ` — ${source.url}` : ''
    return `- ${source.sourceId}: ${source.title} [${source.type} / ${source.evidenceLevel}]${url}`
  }
  const sources = scoutCase.sources.length
    ? scoutCase.sources.map(sourceLine).join('\n')
    : '- 暂无来源'
  const claimLine = (claim: ScoutClaim) => {
    const sourceIds = claim.sourceIds.length ? claim.sourceIds.join(', ') : '无来源'
    const history = claim.history?.length ? `；历史修订：${claim.history.length}` : ''
    return `- **${claim.status} / ${claim.evidenceLevel} / ${claim.impact}** ${claim.text}（维度：${claim.dimension}；来源：${sourceIds}；置信说明：${claim.confidenceNote}；下一步：${claim.nextAction}${history}）`
  }
  const claims = scoutCase.claims.length
    ? scoutCase.claims.map(claimLine).join('\n')
    : '- 暂无结论'
  const supports = byImpact(scoutCase.claims.filter(claim => claim.status === 'verified')).slice(0, 3)
  const risks = byImpact(scoutCase.claims.filter(claim =>
    claim.impact !== 'informational' && claim.status !== 'verified',
  )).slice(0, 3)
  const roleHypotheses = byImpact(scoutCase.claims.filter(claim =>
    ['role_existence', 'reporting_line', 'mandate'].includes(claim.dimension),
  )).slice(0, 3)
  const checklist = byImpact(scoutCase.claims.filter(claim =>
    claim.impact !== 'informational' && claim.status !== 'verified',
  ))
  const checklistLine = (claim: ScoutClaim) =>
    `- [${claim.impact}] ${claim.claimId}: ${claim.text} → 下一步：${claim.nextAction}`
  const checklistBlock = checklist.length
    ? checklist.map(checklistLine).join('\n')
    : '- 无待核验的阻断级或重要事项'
  const statusCounts = scoutCase.claims.reduce<Record<string, number>>((counts, claim) => {
    counts[claim.status] = (counts[claim.status] ?? 0) + 1
    return counts
  }, {})
  const summary = Object.entries(statusCounts)
    .map(([status, count]) => `${count} ${status}`)
    .join(' / ')

  return [
    `# ${scoutCase.title}`,
    '',
    `- 判断：**${scoutCase.decision}**`,
    `- 理由：${scoutCase.decisionReason}`,
    `- 目标：${scoutCase.decisionObjective}`,
    ...(summary ? [`- 证据概况：${summary}`] : []),
    '',
    '## Key supporting evidence (up to 3)',
    '',
    supports.length ? supports.map(claimLine).join('\n') : '- 暂无已核验的支持证据',
    '',
    '## Blocking or unresolved risks (up to 3)',
    '',
    risks.length ? risks.map(claimLine).join('\n') : '- 暂无阻断级或重要待核验风险',
    '',
    '## Role task and authority hypotheses',
    '',
    roleHypotheses.length ? roleHypotheses.map(claimLine).join('\n') : '- 岗位真实性、汇报关系和授权边界尚未建模',
    '',
    '## Verification checklist',
    '',
    checklistBlock,
    '',
    '## Claim ledger',
    '',
    claims,
    '',
    '## Sources',
    '',
    sources,
    '',
    '## Interview questions',
    '',
    scoutCase.interviewQuestions.map(question => `- ${question}`).join('\n'),
    '',
    '> 本报告只表达当前证据边界内的判断，不替代法律、投资或医疗意见。',
    '',
  ].join('\n')
}

export function appendEvent(scoutCase: ScoutCase, event: ScoutEvent): ScoutCase {
  const events = scoutCase.events ?? []
  if (events.some(item => item.eventId === event.eventId)) {
    throw new Error(`Duplicate event: ${event.eventId}`)
  }
  return { ...scoutCase, events: [...events, event] }
}

export const EXPORT_FILE_NAMES = [
  'case.json',
  'sources.json',
  'claims.json',
  'events.jsonl',
  'report.md',
] as const

/** Serialize a case into the durable five-file export payloads (no I/O). */
export function exportCaseFiles(scoutCase: ScoutCase): Record<string, string> {
  const base = {
    schemaVersion: scoutCase.schemaVersion,
    caseId: scoutCase.caseId,
    title: scoutCase.title,
    language: scoutCase.language,
    decisionObjective: scoutCase.decisionObjective,
    subject: scoutCase.subject,
    role: scoutCase.role,
    decision: scoutCase.decision,
    decisionReason: scoutCase.decisionReason,
    interviewQuestions: scoutCase.interviewQuestions,
  }
  const events = scoutCase.events ?? []
  return {
    'case.json': `${JSON.stringify(base, null, 2)}\n`,
    'sources.json': `${JSON.stringify(scoutCase.sources, null, 2)}\n`,
    'claims.json': `${JSON.stringify(scoutCase.claims, null, 2)}\n`,
    'events.jsonl': events.length ? `${events.map(event => JSON.stringify(event)).join('\n')}\n` : '',
    'report.md': renderReport(scoutCase),
  }
}

/** Rebuild a case from the five-file export payloads, validating structure. */
export function importCaseFromFiles(files: Record<string, string>): ScoutCase {
  const missing = EXPORT_FILE_NAMES.filter(name => !(name in files) && name !== 'report.md')
  if (missing.length) throw new Error(`Missing export files: ${missing.join(', ')}`)
  const parseJson = (name: string): unknown => {
    try {
      return JSON.parse(files[name])
    } catch (error) {
      throw new Error(`Invalid ${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const base = parseJson('case.json') as Record<string, unknown>
  if (base.schemaVersion !== 'dsh-scout.case.v0') {
    throw new Error(`Unsupported schema version: ${String(base.schemaVersion)}`)
  }
  if (!base.caseId || !base.subject || !base.role || !Array.isArray(base.interviewQuestions)) {
    throw new Error('Invalid case.json export')
  }
  const sources = parseJson('sources.json')
  const claims = parseJson('claims.json')
  if (!Array.isArray(sources) || !Array.isArray(claims)) {
    throw new Error('Invalid sources.json or claims.json export')
  }
  if (!sources.every(item => item && typeof item.sourceId === 'string' && typeof item.title === 'string')) {
    throw new Error('Invalid source entry in sources.json')
  }
  if (!claims.every(item => item && typeof item.claimId === 'string' && typeof item.text === 'string' && typeof item.nextAction === 'string')) {
    throw new Error('Invalid claim entry in claims.json')
  }
  const events: ScoutEvent[] = files['events.jsonl']?.trim()
    ? files['events.jsonl'].trim().split('\n').map(line => JSON.parse(line))
    : []
  if (!Array.isArray(events)) throw new Error('Invalid events.jsonl export')
  return {
    schemaVersion: base.schemaVersion as 'dsh-scout.case.v0',
    caseId: base.caseId as string,
    title: base.title as string,
    language: base.language as string,
    decisionObjective: base.decisionObjective as string,
    subject: base.subject as ScoutCase['subject'],
    role: base.role as ScoutCase['role'],
    decision: base.decision as Decision,
    decisionReason: base.decisionReason as string,
    sources: sources as ScoutSource[],
    claims: claims as ScoutClaim[],
    interviewQuestions: base.interviewQuestions as string[],
    events,
  }
}
