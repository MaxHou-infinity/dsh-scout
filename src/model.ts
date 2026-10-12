import {
  formatScoutString,
  normalizeScoutLanguage,
  scoutStrings,
} from './i18n.js'
import type { ScoutLanguage } from './i18n.js'

export {
  formatScoutString,
  isScoutLanguage,
  normalizeScoutLanguage,
  SCOUT_LANGUAGES,
  scoutStrings,
} from './i18n.js'
export type { ScoutLanguage, ScoutStrings } from './i18n.js'

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

export const DECISION_REASON_CODES = [
  'identity',
  'unresolved',
  'missing_dimension',
  'proceed',
] as const
export type DecisionReasonCode = typeof DECISION_REASON_CODES[number]

export function isDecisionReasonCode(value: unknown): value is DecisionReasonCode {
  return typeof value === 'string' && (DECISION_REASON_CODES as readonly string[]).includes(value)
}

export const EVENT_TYPES = [
  'case_started',
  'source_added',
  'claim_added',
  'identity_verified',
  'claim_verified',
  'case_exported',
  'case_imported',
  'case_rehydrated',
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

/** Default trusted authority host suffixes used by the E3 evidence policy. */
export const DEFAULT_AUTHORITY_HOST_SUFFIXES = [
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

/** Registrar/registry hostnames that map to company_registry rather than regulator. */
const REGISTRY_HOST_SUFFIXES = [
  'gsxt.gov.cn',
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
  /** Optional reason code for the decision; older exports omit it. */
  decisionReasonCode?: DecisionReasonCode
  sources: ScoutSource[]
  claims: ScoutClaim[]
  interviewQuestions: string[]
  events?: ScoutEvent[]
}

/**
 * Resolve the render language: an explicit option wins, then the case language,
 * then the `zh-CN` default. Unknown values always fall back to `zh-CN`.
 */
function reportLanguage(explicit: ScoutLanguage | undefined, fallback: unknown): ScoutLanguage {
  return normalizeScoutLanguage(explicit ?? fallback)
}

export function createCase(input: {
  caseId: string
  companyName: string
  roleTitle: string
  location?: string
  decisionObjective?: string
  language?: ScoutLanguage
}): ScoutCase {
  const language = normalizeScoutLanguage(input.language)
  const t = scoutStrings(language)
  return {
    schemaVersion: 'dsh-scout.case.v0',
    caseId: input.caseId,
    title: `${input.companyName} — ${input.roleTitle}`,
    language,
    decisionObjective: input.decisionObjective ?? t.defaults.decisionObjective,
    subject: {
      name: input.companyName,
      identitySourceIds: [],
      identityStatus: 'needs_verification',
    },
    role: {
      title: input.roleTitle,
      location: input.location,
      fitQuestion: t.defaults.fitQuestion,
    },
    decision: 'VERIFY',
    decisionReason: t.defaults.initialDecisionReason,
    sources: [],
    claims: [],
    events: [],
    interviewQuestions: [...t.defaults.interviewQuestions],
  }
}

export function addSource(
  scoutCase: ScoutCase,
  source: ScoutSource,
  authoritySuffixes: readonly string[] = DEFAULT_AUTHORITY_HOST_SUFFIXES,
): ScoutCase {
  if (scoutCase.sources.some(item => item.sourceId === source.sourceId)) {
    throw new Error(`Duplicate source: ${source.sourceId}`)
  }
  if (
    source.evidenceLevel === 'E3'
    && (!IDENTITY_SOURCE_TYPES.has(source.type) || !isTrustedAuthorityUrl(source.url, authoritySuffixes))
  ) {
    throw new Error('E3 sources require a supported registry, regulator, or official filing HTTPS origin')
  }
  return { ...scoutCase, sources: [...scoutCase.sources, source] }
}

export function isTrustedAuthorityUrl(
  value: string | null,
  authoritySuffixes: readonly string[] = DEFAULT_AUTHORITY_HOST_SUFFIXES,
): boolean {
  if (!value) return false
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return false
    if (url.port && url.port !== '443') return false
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
    return authoritySuffixes.some(suffix =>
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
  authoritySuffixes: readonly string[] = DEFAULT_AUTHORITY_HOST_SUFFIXES,
): { type: SourceType; inferred: boolean } {
  if (explicit && SOURCE_TYPES.includes(explicit)) return { type: explicit, inferred: false }
  if (url) {
    try {
      const hostname = new URL(url).hostname.toLowerCase().replace(/\.$/, '')
      // Trusted authority origins (official registry/regulator) take priority.
      if (isTrustedAuthorityUrl(url, authoritySuffixes)) {
        const isRegistry = REGISTRY_HOST_SUFFIXES.some(suffix => hostname === suffix || hostname.endsWith(`.${suffix}`))
        return { type: isRegistry ? 'company_registry' : 'regulator', inferred: true }
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
  authoritySuffixes: readonly string[] = DEFAULT_AUTHORITY_HOST_SUFFIXES,
): { evidenceLevel: EvidenceLevel; inferred: boolean } {
  if (explicit && EVIDENCE_LEVELS.includes(explicit)) return { evidenceLevel: explicit, inferred: false }
  if (IDENTITY_SOURCE_TYPES.has(type) && isTrustedAuthorityUrl(url, authoritySuffixes)) {
    return { evidenceLevel: 'E3', inferred: true }
  }
  if (type === 'user_provided') {
    return { evidenceLevel: 'E1', inferred: true }
  }
  return { evidenceLevel: 'E2', inferred: true }
}

/**
 * Normalize a source URL for deduplication: trim, lowercase the host, drop a
 * trailing slash and any fragment. Empty or unparsable URLs return `undefined`.
 */
export function normalizeSourceUrl(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return undefined
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '')
  if (!hostname) return undefined
  const path = parsed.pathname.replace(/\/+$/, '')
  const port = parsed.port ? `:${parsed.port}` : ''
  return `${parsed.protocol.toLowerCase()}//${hostname}${port}${path}${parsed.search}`
}

/** Find a source by normalized URL (trim + trailing-slash + host case insensitive). */
export function findSourceByUrl(scoutCase: ScoutCase, url: string): ScoutSource | undefined {
  const target = normalizeSourceUrl(url)
  if (!target) return undefined
  return scoutCase.sources.find(source => normalizeSourceUrl(source.url) === target)
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
  authoritySuffixes: readonly string[] = DEFAULT_AUTHORITY_HOST_SUFFIXES,
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
    && isTrustedAuthorityUrl(source.url, authoritySuffixes),
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

const REQUIRED_DIMENSIONS: readonly ClaimDimension[] = ['role_existence', 'reporting_line', 'mandate']

interface DecisionAssessment {
  decision: Decision
  reasonCode: DecisionReasonCode
  blockingContradiction: boolean
  missingRequiredDimension?: ClaimDimension
}

/** Recompute the whole decision basis from the subject and claims (pure). */
function assessDecision(scoutCase: ScoutCase): DecisionAssessment {
  const blockingContradiction = scoutCase.claims.some(claim =>
    claim.impact === 'blocking' && claim.status === 'contradicted',
  )
  const identityUnverified = scoutCase.subject.identityStatus !== 'verified'
  const unresolvedMaterialClaim = scoutCase.claims.some(claim =>
    claim.impact !== 'informational' && claim.status !== 'verified',
  )
  const missingRequiredDimension = REQUIRED_DIMENSIONS.find(dimension =>
    !scoutCase.claims.some(claim => claim.dimension === dimension && claim.status === 'verified'),
  )
  let reasonCode: DecisionReasonCode
  if (blockingContradiction) reasonCode = 'unresolved'
  else if (identityUnverified) reasonCode = 'identity'
  else if (unresolvedMaterialClaim) reasonCode = 'unresolved'
  else if (missingRequiredDimension) reasonCode = 'missing_dimension'
  else reasonCode = 'proceed'
  const decision: Decision = blockingContradiction
    ? 'STOP'
    : reasonCode === 'proceed'
      ? 'PROCEED'
      : 'VERIFY'
  return { decision, reasonCode, blockingContradiction, missingRequiredDimension }
}

/** Pure decision reason code recomputed from the subject and claims, without stored state. */
export function explainDecision(scoutCase: ScoutCase): DecisionReasonCode {
  return assessDecision(scoutCase).reasonCode
}

export function decideCase(scoutCase: ScoutCase, opts?: { language?: ScoutLanguage }): ScoutCase {
  const t = scoutStrings(reportLanguage(opts?.language, scoutCase.language))
  const { decision, reasonCode, blockingContradiction, missingRequiredDimension } = assessDecision(scoutCase)
  const decisionReason = reasonCode === 'proceed'
    ? t.decisionReasons.proceed
    : reasonCode === 'identity'
      ? t.decisionReasons.identity
      : reasonCode === 'unresolved'
        ? (blockingContradiction ? t.decisionReasons.blockingContradiction : t.decisionReasons.unresolved)
        : formatScoutString(t.decisionReasons.missingDimension, { dimension: missingRequiredDimension ?? '' })
  return { ...scoutCase, decision, decisionReason, decisionReasonCode: reasonCode }
}

export interface DimensionCoverage {
  dimension: ClaimDimension
  verified: number
  open: number
  untouched: boolean
}

/** Investigation coverage per dimension, in `CLAIM_DIMENSIONS` order. */
export function computeCoverage(scoutCase: ScoutCase): DimensionCoverage[] {
  return CLAIM_DIMENSIONS.map(dimension => {
    const claims = scoutCase.claims.filter(claim => claim.dimension === dimension)
    const verified = claims.filter(claim => claim.status === 'verified').length
    return {
      dimension,
      verified,
      open: claims.length - verified,
      untouched: claims.length === 0,
    }
  })
}

const IMPACT_RANK: Record<ClaimImpact, number> = { blocking: 0, material: 1, informational: 2 }

function byImpact(claims: ScoutClaim[]): ScoutClaim[] {
  return [...claims].sort((a, b) => IMPACT_RANK[a.impact] - IMPACT_RANK[b.impact])
}

const INTERVIEW_QUESTION_LIMIT = 12

/** Trim-key dedupe that keeps the first occurrence and drops blank questions. */
function dedupeQuestions(questions: readonly string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const question of questions) {
    const key = question.trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    unique.push(question)
  }
  return unique
}

/**
 * Derive a deduplicated, prioritized interview question list from the case.
 * Order: pending next actions, missing required dimensions, untouched
 * dimensions, then the case's own curated questions. The curated questions
 * reserve their full quota, so an uninvestigated case cannot crowd them out of
 * the 12-item cap.
 */
export function generateInterviewQuestions(
  scoutCase: ScoutCase,
  opts?: { language?: ScoutLanguage },
): string[] {
  const t = scoutStrings(reportLanguage(opts?.language, scoutCase.language))
  const nextActions = byImpact(scoutCase.claims.filter(claim =>
    claim.impact !== 'informational' && claim.status !== 'verified',
  ))
    .map(claim => claim.nextAction.trim())
    .filter((action, index, all) => action && all.indexOf(action) === index)
  const missingDimensions = REQUIRED_DIMENSIONS.filter(dimension =>
    !scoutCase.claims.some(claim => claim.dimension === dimension && claim.status === 'verified'),
  )
  const untouchedDimensions = computeCoverage(scoutCase)
    .filter(item => item.untouched)
    .map(item => item.dimension)
  const head = dedupeQuestions([
    ...nextActions,
    ...missingDimensions.map(dimension => t.questions[dimension]),
    ...untouchedDimensions.map(dimension => t.questions[dimension]),
  ])
  const curated = scoutCase.interviewQuestions
  const headBudget = Math.max(0, INTERVIEW_QUESTION_LIMIT - curated.length)
  return dedupeQuestions([...head.slice(0, headBudget), ...curated]).slice(0, INTERVIEW_QUESTION_LIMIT)
}

export function renderReport(scoutCase: ScoutCase, opts?: { language?: ScoutLanguage }): string {
  const t = scoutStrings(reportLanguage(opts?.language, scoutCase.language))
  const sourceLine = (source: ScoutSource) => {
    const url = source.url ? ` — ${source.url}` : ''
    return `- ${source.sourceId}: ${source.title} [${source.type} / ${source.evidenceLevel}]${url}`
  }
  const sources = scoutCase.sources.length
    ? scoutCase.sources.map(sourceLine).join('\n')
    : t.empty.noSources
  const claimLine = (claim: ScoutClaim) => {
    const sourceIds = claim.sourceIds.length ? claim.sourceIds.join(', ') : t.claim.noSourceIds
    const history = claim.history?.length
      ? formatScoutString(t.claim.history, { count: claim.history.length })
      : ''
    return formatScoutString(t.claim.line, {
      status: claim.status,
      evidenceLevel: claim.evidenceLevel,
      impact: claim.impact,
      text: claim.text,
      dimension: claim.dimension,
      sourceIds,
      confidenceNote: claim.confidenceNote,
      nextAction: claim.nextAction,
      history,
    })
  }
  const claims = scoutCase.claims.length
    ? scoutCase.claims.map(claimLine).join('\n')
    : t.empty.noClaims
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
  const checklistLine = (claim: ScoutClaim) => formatScoutString(t.claim.checklistLine, {
    impact: claim.impact,
    claimId: claim.claimId,
    text: claim.text,
    nextAction: claim.nextAction,
  })
  const checklistBlock = checklist.length
    ? checklist.map(checklistLine).join('\n')
    : t.empty.noChecklistItems
  const statusCounts = scoutCase.claims.reduce<Record<string, number>>((counts, claim) => {
    counts[claim.status] = (counts[claim.status] ?? 0) + 1
    return counts
  }, {})
  const summary = Object.entries(statusCounts)
    .map(([status, count]) => `${count} ${status}`)
    .join(' / ')
  const coverage = computeCoverage(scoutCase)
  const coverageLines = coverage.map(item => formatScoutString(t.coverage.entry, {
    dimension: item.dimension,
    label: t.dimensions[item.dimension],
    verified: item.verified,
    open: item.open,
    untouched: item.untouched ? t.coverage.yes : t.coverage.no,
  }))
  const untouchedDimensions = coverage.filter(item => item.untouched).map(item => item.dimension)
  const untouchedLine = formatScoutString(t.coverage.untouchedLine, {
    count: untouchedDimensions.length,
    dimensions: untouchedDimensions.length
      ? untouchedDimensions.join(t.coverage.separator)
      : t.coverage.none,
  })

  return [
    `# ${scoutCase.title}`,
    '',
    formatScoutString(t.header.decision, { decision: scoutCase.decision }),
    formatScoutString(t.header.reason, { reason: scoutCase.decisionReason }),
    formatScoutString(t.header.objective, { objective: scoutCase.decisionObjective }),
    ...(summary ? [formatScoutString(t.header.evidenceSummary, { summary })] : []),
    '',
    t.headings.coverage,
    '',
    ...coverageLines,
    '',
    untouchedLine,
    '',
    t.headings.supportingEvidence,
    '',
    supports.length ? supports.map(claimLine).join('\n') : t.empty.noSupportingEvidence,
    '',
    t.headings.unresolvedRisks,
    '',
    risks.length ? risks.map(claimLine).join('\n') : t.empty.noUnresolvedRisks,
    '',
    t.headings.roleHypotheses,
    '',
    roleHypotheses.length ? roleHypotheses.map(claimLine).join('\n') : t.empty.noRoleHypotheses,
    '',
    t.headings.verificationChecklist,
    '',
    checklistBlock,
    '',
    t.headings.claimLedger,
    '',
    claims,
    '',
    t.headings.sources,
    '',
    sources,
    '',
    t.headings.interviewQuestions,
    '',
    scoutCase.interviewQuestions.map(question => `- ${question}`).join('\n'),
    '',
    t.reportDisclaimer,
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

/**
 * Serialize a case into the durable five-file export payloads (no I/O).
 *
 * `case.json` keeps the case's own `language` field, which records the language
 * the case was created in; the language used to render `report.md` is decided by
 * the caller through `opts.language` (falling back to the case language), so a
 * case imported across a language boundary can still be exported in the
 * configured language.
 */
export function exportCaseFiles(
  scoutCase: ScoutCase,
  opts?: { language?: ScoutLanguage },
): Record<string, string> {
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
    ...(scoutCase.decisionReasonCode ? { decisionReasonCode: scoutCase.decisionReasonCode } : {}),
    interviewQuestions: scoutCase.interviewQuestions,
  }
  const events = scoutCase.events ?? []
  return {
    'case.json': `${JSON.stringify(base, null, 2)}\n`,
    'sources.json': `${JSON.stringify(scoutCase.sources, null, 2)}\n`,
    'claims.json': `${JSON.stringify(scoutCase.claims, null, 2)}\n`,
    'events.jsonl': events.length ? `${events.map(event => JSON.stringify(event)).join('\n')}\n` : '',
    'report.md': renderReport(scoutCase, opts),
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
  const decisionReasonCode = isDecisionReasonCode(base.decisionReasonCode)
    ? base.decisionReasonCode
    : undefined
  return {
    schemaVersion: base.schemaVersion as 'dsh-scout.case.v0',
    caseId: base.caseId as string,
    title: base.title as string,
    language: typeof base.language === 'string' && base.language ? base.language : 'zh-CN',
    decisionObjective: base.decisionObjective as string,
    subject: base.subject as ScoutCase['subject'],
    role: base.role as ScoutCase['role'],
    decision: base.decision as Decision,
    decisionReason: base.decisionReason as string,
    ...(decisionReasonCode ? { decisionReasonCode } : {}),
    sources: sources as ScoutSource[],
    claims: claims as ScoutClaim[],
    interviewQuestions: base.interviewQuestions as string[],
    events,
  }
}

/** Render a side-by-side comparison report for two or more cases. */
export function renderComparison(cases: ScoutCase[], opts?: { language?: ScoutLanguage }): string {
  if (cases.length < 2) throw new Error('Comparison requires at least two cases')
  if (cases.length > 5) throw new Error('Comparison supports at most five cases')
  const language = reportLanguage(opts?.language, cases[0].language)
  const t = scoutStrings(language)
  const countByStatus = (scoutCase: ScoutCase) => scoutCase.claims.reduce<Record<string, number>>((counts, claim) => {
    counts[claim.status] = (counts[claim.status] ?? 0) + 1
    return counts
  }, {})
  const summaryLine = (scoutCase: ScoutCase) => {
    const counts = countByStatus(scoutCase)
    const identity = scoutCase.subject.identityStatus === 'verified'
      ? t.comparison.identityVerified
      : t.comparison.identityUnverified
    const countsText = Object.entries(counts)
      .map(([status, count]) => `${count} ${(t.statuses as Record<string, string>)[status] ?? status}`)
      .join(' / ')
    const countsSuffix = countsText
      ? formatScoutString(t.comparison.countsSuffix, { counts: countsText })
      : ''
    return formatScoutString(t.comparison.summary, {
      title: scoutCase.title,
      decision: scoutCase.decision,
      identity,
      claimCount: scoutCase.claims.length,
      countsSuffix,
    })
  }
  const compareTable = [
    t.comparison.tableHeader,
    t.comparison.tableSeparator,
    ...cases.map(scoutCase => formatScoutString(t.comparison.tableRow, {
      title: scoutCase.title,
      decision: scoutCase.decision,
      identity: scoutCase.subject.identityStatus === 'verified'
        ? t.comparison.verifiedMark
        : t.comparison.unverifiedMark,
      claimCount: scoutCase.claims.length,
    })),
  ]
  const sections: string[] = []
  for (const scoutCase of cases) {
    const verified = byImpact(scoutCase.claims.filter(claim => claim.status === 'verified')).slice(0, 3)
    const open = byImpact(scoutCase.claims.filter(claim =>
      claim.impact !== 'informational' && claim.status !== 'verified',
    )).slice(0, 3)
    sections.push(
      formatScoutString(t.comparison.detailTitle, { title: scoutCase.title, caseId: scoutCase.caseId }),
      '',
      t.comparison.verifiedHeading,
      verified.length ? verified.map(claim => `- ${claim.text}`).join('\n') : t.comparison.noVerified,
      '',
      t.comparison.openHeading,
      open.length
        ? open.map(claim => formatScoutString(t.comparison.openItem, {
          impact: claim.impact,
          text: claim.text,
          nextAction: claim.nextAction,
        })).join('\n')
        : t.comparison.noOpen,
      '',
    )
  }
  const mergedQuestions: string[] = []
  const seen = new Set<string>()
  for (const scoutCase of cases) {
    for (const question of generateInterviewQuestions(scoutCase, { language })) {
      const key = question.trim()
      if (!key || seen.has(key)) continue
      seen.add(key)
      mergedQuestions.push(key)
      if (mergedQuestions.length >= 12) break
    }
    if (mergedQuestions.length >= 12) break
  }
  return [
    formatScoutString(t.comparison.title, { count: cases.length }),
    '',
    t.comparison.overviewHeading,
    '',
    ...cases.map(summaryLine),
    '',
    t.comparison.decisionTableHeading,
    '',
    ...compareTable,
    '',
    t.comparison.detailHeading,
    '',
    ...sections,
    t.comparison.questionsHeading,
    '',
    ...mergedQuestions.map(question => `- ${question}`),
    '',
    t.comparison.disclaimer,
    '',
  ].join('\n')
}
