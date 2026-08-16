import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  addClaim,
  addSource,
  appendEvent,
  CLAIM_DIMENSIONS,
  CLAIM_IMPACTS,
  CLAIM_STATUSES,
  createCase,
  decideCase,
  EVIDENCE_LEVELS,
  EXPORT_FILE_NAMES,
  exportCaseFiles,
  generateInterviewQuestions,
  importCaseFromFiles,
  inferEvidenceLevel,
  inferSourceType,
  renderComparison,
  renderReport,
  SOURCE_TYPES,
  type ScoutCase,
  type ScoutEvent,
  type ScoutSource,
  type ClaimDimension,
  type ClaimImpact,
  type ClaimStatus,
  type EvidenceLevel,
  type SourceType,
  verifyClaim,
  verifyIdentity,
} from './model.js'

export const name = 'dsh-scout'
export const inject = ['tools', 'fs', 'web']

export interface ScoutConfig {
  /** Default directory for case exports; case files land under `<scoutDir>/<caseId>/`. */
  scoutDir?: string
  /** Persist the five-file export after every mutation when `scoutDir` is set. */
  autoPersist?: boolean
}

interface ScoutFsTarget {
  targetKey: string
  displayPath: string
}
interface ScoutFs {
  resolve(path: string): Promise<ScoutFsTarget>
  readText(target: ScoutFsTarget, signal?: unknown): Promise<string>
  writeText(
    target: ScoutFsTarget,
    content: string,
    intent?: unknown,
    signal?: unknown,
  ): Promise<{ operation: string }>
}

interface ScoutWebSource {
  url: string
  title?: string
  snippet?: string
  publishedAt?: string
}
interface ScoutWebResult {
  content?: string
  sources: ScoutWebSource[]
  truncated: boolean
}
interface ScoutWeb {
  search(request: { query: string; maxResults?: number }, signal?: unknown): Promise<ScoutWebResult>
  fetch(request: { url: string }, signal?: unknown): Promise<unknown>
}

export function apply(ctx: Context, config: ScoutConfig = {}) {
  const cases = new Map<string, ScoutCase>()
  const caseKey = (caseId: string, agentId: unknown) => `${String(agentId ?? 'unscoped')}::${caseId}`
  const requireCase = (key: string) => {
    const scoutCase = cases.get(key)
    if (!scoutCase) throw new Error(`Unknown case: ${key.split('::').at(-1)}`)
    return scoutCase
  }
  const fs = (ctx as unknown as { fs?: ScoutFs }).fs
  const web = (ctx as unknown as { web?: ScoutWeb }).web
  const defaultScoutDir = config.scoutDir?.replace(/\/+$/, '') || 'dsh-scout'
  const caseExportDir = (caseId: string) => `${defaultScoutDir}/${caseId}`
  const persistFiles = async (scoutCase: ScoutCase, targetDir: string): Promise<{ persisted: boolean; targetDir: string; error?: string }> => {
    if (!fs) return { persisted: false, targetDir, error: 'Filesystem service is unavailable in this host' }
    try {
      const files = exportCaseFiles(scoutCase)
      for (const name of EXPORT_FILE_NAMES) {
        const target = await fs.resolve(`${targetDir}/${name}`)
        await fs.writeText(target, files[name])
      }
      return { persisted: true, targetDir }
    } catch (error) {
      return { persisted: false, targetDir, error: error instanceof Error ? error.message : String(error) }
    }
  }
  const recordEvent = (scoutCase: ScoutCase, type: ScoutEvent['type'], detail: Record<string, unknown>) => {
    const events = scoutCase.events ?? []
    let n = events.length + 1
    let eventId = `evt-${n}`
    while (events.some(event => event.eventId === eventId)) {
      n += 1
      eventId = `evt-${n}`
    }
    return appendEvent(scoutCase, {
      eventId,
      type,
      at: new Date().toISOString(),
      detail,
    })
  }
  const registerSource = (scoutCase: ScoutCase, source: ScoutSource): ScoutCase =>
    recordEvent(addSource(scoutCase, source), 'source_added', {
      sourceId: source.sourceId,
      type: source.type,
      title: source.title,
      url: source.url,
      evidenceLevel: source.evidenceLevel,
      ingested: true,
    })
  const maybePersist = async (scoutCase: ScoutCase) => {
    if (!config.autoPersist) return scoutCase
    const targetDir = caseExportDir(scoutCase.caseId)
    const withEvent = recordEvent(scoutCase, 'case_exported', { targetDir, auto: true })
    const result = await persistFiles(withEvent, targetDir)
    if (!result.persisted) return scoutCase
    return withEvent
  }

  ctx.effect(function* registerScoutTools() {
    yield () => cases.clear()

    yield ctx.tools.register(defineTool({
      name: 'scout_start',
      description: 'Start a company and job due-diligence case. The initial decision is VERIFY until identity evidence is confirmed.',
      parameters: {
        caseId: { type: 'string', required: true, description: 'Stable case identifier.' },
        companyName: { type: 'string', required: true, description: 'Company or brand name to investigate.' },
        roleTitle: { type: 'string', required: true, description: 'Role title to evaluate.' },
        location: { type: 'string', required: true, description: 'Job location, or an empty string if unknown.' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args, exec) {
        const key = caseKey(args.caseId, exec.agent?.id)
        if (cases.has(key)) throw new Error(`Case already exists: ${args.caseId}`)
        const scoutCase = createCase({
          caseId: args.caseId,
          companyName: args.companyName,
          roleTitle: args.roleTitle,
          location: args.location || undefined,
        })
        let nextCase = recordEvent(scoutCase, 'case_started', {
          companyName: args.companyName,
          roleTitle: args.roleTitle,
          location: args.location || null,
        })
        nextCase = await maybePersist(nextCase)
        cases.set(key, nextCase)
        return JSON.stringify(nextCase, null, 2)
      },
    }))

    yield ctx.tools.register(defineTool({
      name: 'scout_add_claim',
      description: 'Add a sourced or explicitly unverified claim to an active dsh-scout case.',
      parameters: {
        caseId: { type: 'string', required: true, description: 'Existing case identifier.' },
        claimId: { type: 'string', required: true, description: 'Stable claim identifier.' },
        text: { type: 'string', required: true, description: 'Claim text.' },
        status: { type: 'string', enum: CLAIM_STATUSES, required: true, description: 'Claim verification status.' },
        evidenceLevel: { type: 'string', enum: EVIDENCE_LEVELS, required: true, description: 'Source quality from E0 to E3.' },
        dimension: { type: 'string', enum: CLAIM_DIMENSIONS, required: true, description: 'Due-diligence dimension this claim belongs to.' },
        impact: { type: 'string', enum: CLAIM_IMPACTS, required: true, description: 'Decision impact: blocking, material, or informational.' },
        sourceIds: { type: 'string', required: true, description: 'Comma-separated source identifiers; empty when there is no source.' },
        confidenceNote: { type: 'string', required: true, description: 'Why the current evidence supports this status and level.' },
        nextAction: { type: 'string', required: true, description: 'Smallest next action to verify or use the claim.' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args, exec) {
        const key = caseKey(args.caseId, exec.agent?.id)
        const scoutCase = requireCase(key)
        let nextCase = recordEvent(decideCase(addClaim(scoutCase, {
          claimId: args.claimId,
          text: args.text,
          status: args.status,
          evidenceLevel: args.evidenceLevel,
          dimension: args.dimension,
          impact: args.impact,
          sourceIds: args.sourceIds ? args.sourceIds.split(',').map(value => value.trim()).filter(Boolean) : [],
          confidenceNote: args.confidenceNote,
          nextAction: args.nextAction,
        })), 'claim_added', {
          claimId: args.claimId,
          status: args.status,
          evidenceLevel: args.evidenceLevel,
          dimension: args.dimension,
          impact: args.impact,
        })
        nextCase = await maybePersist(nextCase)
        cases.set(key, nextCase)
        return JSON.stringify(nextCase, null, 2)
      },
    }))

    yield ctx.tools.register(defineTool({
      name: 'scout_ingest',
      description: 'Batch-register collected research results as sources, optionally drafting claims from each item. itemsJson is a JSON array of { url, title?, sourceType?, evidenceLevel?, claim? }; claim is { text, dimension, impact?, status?, evidenceLevel? } with status defaulting to reported, impact to material, and evidence level to the source level. Source type and evidence level are inferred from the URL when omitted (official registry/regulator origins map to E3, job platforms to job_posting/E2, user-provided to E1, unknown to other/E2). Individual invalid items or rejected claims are reported in errors without aborting the batch; a failed claim does not undo its already-registered source.',
      parameters: {
        caseId: { type: 'string', required: true, description: 'Existing case identifier.' },
        itemsJson: { type: 'string', required: true, description: 'JSON array of collected source items.' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args, exec) {
        const key = caseKey(args.caseId, exec.agent?.id)
        let scoutCase = requireCase(key)
        let items: Array<{ url?: unknown; title?: unknown; sourceType?: unknown; evidenceLevel?: unknown; claim?: unknown }>
        try {
          const parsed = JSON.parse(args.itemsJson)
          if (!Array.isArray(parsed)) throw new Error('itemsJson must be a JSON array')
          items = parsed
        } catch (error) {
          throw new Error(`Invalid itemsJson: ${error instanceof Error ? error.message : String(error)}`)
        }
        const added: Array<Record<string, unknown>> = []
        const errors: Array<{ url: string; error: string }> = []
        let nextId = (scoutCase.sources.length ?? 0) + 1
        let nextClaimId = (scoutCase.claims.length ?? 0) + 1
        for (const rawItem of items) {
          const itemUrl = () =>
            rawItem && typeof rawItem === 'object' && typeof (rawItem as Record<string, unknown>).url === 'string'
              ? ((rawItem as Record<string, unknown>).url as string)
              : String((rawItem as Record<string, unknown> | null)?.url ?? rawItem ?? '')
          try {
            if (!rawItem || typeof rawItem !== 'object') {
              errors.push({ url: String(rawItem ?? ''), error: 'item must be an object' })
              continue
            }
            const item = rawItem as Record<string, unknown>
            const url = typeof item.url === 'string' ? item.url.trim() : ''
            if (!url) {
              errors.push({ url: String(item.url ?? ''), error: 'url is required' })
              continue
            }
            const explicitType = typeof item.sourceType === 'string' && SOURCE_TYPES.includes(item.sourceType as SourceType)
              ? item.sourceType as SourceType
              : undefined
            const explicitLevel = typeof item.evidenceLevel === 'string' && EVIDENCE_LEVELS.includes(item.evidenceLevel as EvidenceLevel)
              ? item.evidenceLevel as EvidenceLevel
              : undefined
            if (item.sourceType !== undefined && item.sourceType !== null && !explicitType) {
              errors.push({ url, error: `invalid sourceType: ${String(item.sourceType)}` })
              continue
            }
            if (item.evidenceLevel !== undefined && item.evidenceLevel !== null && !explicitLevel) {
              errors.push({ url, error: `invalid evidenceLevel: ${String(item.evidenceLevel)}` })
              continue
            }
            const typeGuess = inferSourceType(url, explicitType)
            const levelGuess = inferEvidenceLevel(url, typeGuess.type, explicitLevel)
            let sourceId = `src-${nextId}`
            while (scoutCase.sources.some(source => source.sourceId === sourceId)) {
              nextId += 1
              sourceId = `src-${nextId}`
            }
            nextId += 1
            const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : url
            const source: ScoutSource = {
              sourceId,
              type: typeGuess.type,
              title,
              url,
              capturedAt: new Date().toISOString(),
              evidenceLevel: levelGuess.evidenceLevel,
              status: 'captured',
            }
            scoutCase = registerSource(scoutCase, source)
            const addedEntry: Record<string, unknown> = {
              sourceId,
              title,
              url,
              type: typeGuess.type,
              evidenceLevel: levelGuess.evidenceLevel,
              inferred: { type: typeGuess.inferred, evidenceLevel: levelGuess.inferred },
            }
            const rawClaim = (item as Record<string, unknown>).claim
            if (rawClaim !== undefined && rawClaim !== null) {
              if (typeof rawClaim !== 'object') {
                errors.push({ url, error: 'claim must be an object' })
              } else {
                const claimDraft = rawClaim as Record<string, unknown>
                const text = typeof claimDraft.text === 'string' && claimDraft.text.trim() ? claimDraft.text.trim() : ''
                const dimension = typeof claimDraft.dimension === 'string' && CLAIM_DIMENSIONS.includes(claimDraft.dimension as ClaimDimension)
                  ? claimDraft.dimension as ClaimDimension
                  : undefined
                const claimIssues: string[] = []
                const hasStatus = claimDraft.status !== undefined && claimDraft.status !== null
                const status = hasStatus && typeof claimDraft.status === 'string' && CLAIM_STATUSES.includes(claimDraft.status as ClaimStatus)
                  ? claimDraft.status as ClaimStatus
                  : undefined
                if (hasStatus && !status) claimIssues.push(`invalid claim.status: ${String(claimDraft.status)}`)
                const hasImpact = claimDraft.impact !== undefined && claimDraft.impact !== null
                const impact = hasImpact && typeof claimDraft.impact === 'string' && CLAIM_IMPACTS.includes(claimDraft.impact as ClaimImpact)
                  ? claimDraft.impact as ClaimImpact
                  : undefined
                if (hasImpact && !impact) claimIssues.push(`invalid claim.impact: ${String(claimDraft.impact)}`)
                const hasClaimLevel = claimDraft.evidenceLevel !== undefined && claimDraft.evidenceLevel !== null
                const claimLevel = hasClaimLevel && typeof claimDraft.evidenceLevel === 'string' && EVIDENCE_LEVELS.includes(claimDraft.evidenceLevel as EvidenceLevel)
                  ? claimDraft.evidenceLevel as EvidenceLevel
                  : undefined
                if (hasClaimLevel && !claimLevel) claimIssues.push(`invalid claim.evidenceLevel: ${String(claimDraft.evidenceLevel)}`)
                if (!text) claimIssues.push('claim.text is required')
                if (!dimension) claimIssues.push(`invalid claim.dimension: ${String(claimDraft.dimension)}`)
                if (claimIssues.length) {
                  errors.push({ url, error: `claim rejected: ${claimIssues.join('; ')}` })
                } else {
                  let claimId = `claim-${nextClaimId}`
                  while (scoutCase.claims.some(claim => claim.claimId === claimId)) {
                    nextClaimId += 1
                    claimId = `claim-${nextClaimId}`
                  }
                  nextClaimId += 1
                  try {
                    scoutCase = recordEvent(addClaim(scoutCase, {
                      claimId,
                      text,
                      status: status ?? 'reported',
                      evidenceLevel: claimLevel ?? source.evidenceLevel,
                      dimension: dimension as ClaimDimension,
                      impact: impact ?? 'material',
                      sourceIds: [source.sourceId],
                      confidenceNote: `由采集项自动登记，来源 ${source.sourceId}`,
                      nextAction: '核验该主张并补充独立来源',
                    }), 'claim_added', {
                      claimId,
                      status: status ?? 'reported',
                      evidenceLevel: claimLevel ?? source.evidenceLevel,
                      dimension: dimension as ClaimDimension,
                      impact: impact ?? 'material',
                      text,
                      sourceIds: [source.sourceId],
                      ingested: true,
                    })
                    addedEntry.claims = [claimId]
                  } catch (error) {
                    errors.push({ url, error: `claim rejected: ${error instanceof Error ? error.message : String(error)}` })
                  }
                }
              }
            }
            added.push(addedEntry)
          } catch (error) {
            errors.push({ url: itemUrl(), error: error instanceof Error ? error.message : String(error) })
          }
        }
        scoutCase = decideCase(scoutCase)
        scoutCase = await maybePersist(scoutCase)
        cases.set(key, scoutCase)
        return JSON.stringify({ added, errors }, null, 2)
      },
    }))

    yield ctx.tools.register(defineTool({
      name: 'scout_search',
      description: 'Run a web search through the DSH web provider and auto-register the result URLs as sources for the case (type and evidence level inferred per URL). Optionally limits how many results are registered.',
      parameters: {
        caseId: { type: 'string', required: true, description: 'Existing case identifier.' },
        query: { type: 'string', required: true, description: 'Search query to run through the web provider.' },
        limit: { type: 'number', description: 'Maximum number of search results to register (default 5, capped at 10).' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args, exec) {
        if (!web) throw new Error('Web search service is unavailable in this host')
        const key = caseKey(args.caseId, exec.agent?.id)
        let scoutCase = requireCase(key)
        const parsedLimit = Math.trunc(args.limit ?? 5)
        const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 10) : 5
        const result = await web.search({ query: args.query, maxResults: limit }, exec.signal)
        const added: Array<Record<string, unknown>> = []
        const errors: Array<{ url: string; error: string }> = []
        const items = Array.isArray(result.sources) ? result.sources : []
        if (!Array.isArray(result.sources)) {
          errors.push({ url: '', error: 'search provider returned a non-array sources field' })
        }
        let nextId = (scoutCase.sources.length ?? 0) + 1
        items.forEach((item, index) => {
          if (!item || typeof item !== 'object') {
            errors.push({ url: '', error: `search result ${index} must be an object` })
            return
          }
          const url = typeof item.url === 'string' ? item.url.trim() : ''
          if (!url) {
            errors.push({ url: '', error: `search result ${index} missing url` })
            return
          }
          try {
            const typeGuess = inferSourceType(url)
            const levelGuess = inferEvidenceLevel(url, typeGuess.type)
            let sourceId = `src-${nextId}`
            while (scoutCase.sources.some(source => source.sourceId === sourceId)) {
              nextId += 1
              sourceId = `src-${nextId}`
            }
            nextId += 1
            const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : url
            scoutCase = registerSource(scoutCase, {
              sourceId,
              type: typeGuess.type,
              title,
              url,
              capturedAt: new Date().toISOString(),
              evidenceLevel: levelGuess.evidenceLevel,
              status: 'captured',
            })
            added.push({
              sourceId,
              title,
              url,
              type: typeGuess.type,
              evidenceLevel: levelGuess.evidenceLevel,
              snippet: typeof item.snippet === 'string' ? item.snippet.slice(0, 300) : null,
              publishedAt: typeof item.publishedAt === 'string' ? item.publishedAt : null,
              inferred: { type: typeGuess.inferred, evidenceLevel: levelGuess.inferred },
            })
          } catch (error) {
            errors.push({ url, error: error instanceof Error ? error.message : String(error) })
          }
        })
        scoutCase = decideCase(scoutCase)
        scoutCase = await maybePersist(scoutCase)
        cases.set(key, scoutCase)
        return JSON.stringify({
          query: args.query,
          truncated: Boolean(result.truncated),
          added,
          errors,
          content: typeof result.content === 'string' && result.content ? result.content.slice(0, 500) : null,
        }, null, 2)
      },
    }))

    yield ctx.tools.register(defineTool({
      name: 'scout_compare',
      description: 'Render a side-by-side comparison report for two to five existing cases (decision, identity status, verified conclusions, open risks, and merged interview questions).',
      parameters: {
        caseIds: { type: 'string', required: true, description: 'Comma-separated case identifiers; at least two, at most five.' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args, exec) {
        const agentId = exec.agent?.id
        const rawIds = args.caseIds.split(',').map(value => value.trim()).filter(Boolean)
        if (rawIds.length === 0) throw new Error('No case ids provided')
        const caseIds = [...new Set(rawIds)]
        if (caseIds.length < 2) throw new Error('Comparison requires at least two distinct case ids')
        const compared = caseIds.map(caseId => {
          try {
            return requireCase(caseKey(caseId, agentId))
          } catch (error) {
            throw new Error(`Unknown case: ${caseId} (not found in this agent session)`)
          }
        })
        return renderComparison(compared)
      },
    }))

    yield ctx.tools.register(defineTool({
      name: 'scout_report',
      description: 'Render the current evidence-bounded report for a dsh-scout case.',
      parameters: {
        caseId: { type: 'string', required: true, description: 'Existing case identifier.' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args, exec) {
        const key = caseKey(args.caseId, exec.agent?.id)
        return renderReport(requireCase(key))
      },
    }))

    yield ctx.tools.register(defineTool({
      name: 'scout_export',
      description: 'Persist a dsh-scout case as the durable five-file export (case.json, sources.json, claims.json, events.jsonl, report.md). targetDir is optional and defaults to the configured scoutDir (or ./dsh-scout) plus the case id.',
      parameters: {
        caseId: { type: 'string', required: true, description: 'Existing case identifier.' },
        targetDir: { type: 'string', description: 'Directory path to write the five export files into; defaults to <scoutDir>/<caseId>.' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args, exec) {
        const key = caseKey(args.caseId, exec.agent?.id)
        const scoutCase = requireCase(key)
        const targetDir = args.targetDir || caseExportDir(scoutCase.caseId)
        const result = await persistFiles(scoutCase, targetDir)
        let nextCase = scoutCase
        if (result.persisted) {
          nextCase = recordEvent(scoutCase, 'case_exported', { targetDir: result.targetDir })
          cases.set(key, nextCase)
        }
        return JSON.stringify({
          caseId: args.caseId,
          targetDir: result.targetDir,
          files: EXPORT_FILE_NAMES,
          persisted: result.persisted,
          ...(result.error ? { error: result.error } : {}),
        }, null, 2)
      },
    }))

    yield ctx.tools.register(defineTool({
      name: 'scout_questions',
      description: 'Derive a deduplicated, prioritized interview question list from the case: unverified blocking/material next actions first, then questions for missing required role dimensions, then the default interview questions.',
      parameters: {
        caseId: { type: 'string', required: true, description: 'Existing case identifier.' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args, exec) {
        const key = caseKey(args.caseId, exec.agent?.id)
        return JSON.stringify(generateInterviewQuestions(requireCase(key)), null, 2)
      },
    }))

    yield ctx.tools.register(defineTool({
      name: 'scout_import',
      description: 'Restore a dsh-scout case from a five-file export directory, then recompute its decision.',
      parameters: {
        caseId: { type: 'string', required: true, description: 'Case identifier to restore; must match the exported case.json.' },
        sourceDir: { type: 'string', required: true, description: 'Directory path containing the five export files.' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args, exec) {
        if (!fs) throw new Error('Filesystem service is unavailable in this host')
        const key = caseKey(args.caseId, exec.agent?.id)
        const read = async (name: string) => {
          const target = await fs.resolve(`${args.sourceDir}/${name}`)
          return fs.readText(target)
        }
        const files: Record<string, string> = {}
        for (const name of ['case.json', 'sources.json', 'claims.json', 'events.jsonl']) {
          files[name] = await read(name)
        }
        const restored = importCaseFromFiles(files)
        if (restored.caseId !== args.caseId) {
          throw new Error(`Case id mismatch: export has ${restored.caseId}, requested ${args.caseId}`)
        }
        const nextCase = decideCase(recordEvent(restored, 'case_imported', { sourceDir: args.sourceDir }))
        cases.set(key, nextCase)
        return JSON.stringify(nextCase, null, 2)
      },
    }))

    yield ctx.tools.register(defineTool({
      name: 'scout_add_source',
      description: 'Register a source before attaching it to claims.',
      parameters: {
        caseId: { type: 'string', required: true, description: 'Existing case identifier.' },
        sourceId: { type: 'string', required: true, description: 'Stable source identifier.' },
        sourceType: { type: 'string', enum: SOURCE_TYPES, required: true, description: 'Closed source category used by evidence policy.' },
        title: { type: 'string', required: true, description: 'Human-readable source title.' },
        url: { type: 'string', required: true, description: 'Source URL, or an empty string for local/user-provided material.' },
        evidenceLevel: { type: 'string', enum: EVIDENCE_LEVELS, required: true, description: 'Source quality from E0 to E3.' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args, exec) {
        const key = caseKey(args.caseId, exec.agent?.id)
        const scoutCase = requireCase(key)
        const source: ScoutSource = {
          sourceId: args.sourceId,
          type: args.sourceType,
          title: args.title,
          url: args.url || null,
          capturedAt: new Date().toISOString(),
          evidenceLevel: args.evidenceLevel,
          status: 'captured',
        }
        let nextCase = recordEvent(addSource(scoutCase, source), 'source_added', {
          sourceId: source.sourceId,
          evidenceLevel: source.evidenceLevel,
        })
        nextCase = await maybePersist(nextCase)
        cases.set(key, nextCase)
        return JSON.stringify(nextCase, null, 2)
      },
    }))

    yield ctx.tools.register(defineTool({
      name: 'scout_verify_identity',
      description: 'Confirm the legal company identity using a previously registered E3 source.',
      parameters: {
        caseId: { type: 'string', required: true, description: 'Existing case identifier.' },
        legalEntity: { type: 'string', required: true, description: 'Verified legal entity name.' },
        registrationNumber: { type: 'string', required: true, description: 'Registry or unified social credit identifier.' },
        registeredRegion: { type: 'string', required: true, description: 'Verified registration region.' },
        legalRepresentative: { type: 'string', required: true, description: 'Verified legal representative.' },
        brandRelationship: { type: 'string', required: true, description: 'How the investigated brand relates to the legal entity.' },
        sourceIds: { type: 'string', required: true, description: 'Comma-separated identity sources including a linked authoritative E3 source.' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args, exec) {
        const key = caseKey(args.caseId, exec.agent?.id)
        const scoutCase = requireCase(key)
        let nextCase = recordEvent(decideCase(verifyIdentity(scoutCase, {
          legalEntity: args.legalEntity,
          registrationNumber: args.registrationNumber,
          registeredRegion: args.registeredRegion,
          legalRepresentative: args.legalRepresentative,
          brandRelationship: args.brandRelationship,
          sourceIds: args.sourceIds.split(',').map(value => value.trim()).filter(Boolean),
        })), 'identity_verified', {
          legalEntity: args.legalEntity,
          registrationNumber: args.registrationNumber,
        })
        nextCase = await maybePersist(nextCase)
        cases.set(key, nextCase)
        return JSON.stringify(nextCase, null, 2)
      },
    }))

    yield ctx.tools.register(defineTool({
      name: 'scout_verify_claim',
      description: 'Promote an existing claim to verified while preserving its prior evidence state.',
      parameters: {
        caseId: { type: 'string', required: true, description: 'Existing case identifier.' },
        claimId: { type: 'string', required: true, description: 'Existing claim identifier.' },
        evidenceLevel: { type: 'string', enum: EVIDENCE_LEVELS, required: true, description: 'Updated source quality from E0 to E3.' },
        sourceIds: { type: 'string', required: true, description: 'Comma-separated registered source identifiers.' },
        confidenceNote: { type: 'string', required: true, description: 'Why the new sources justify verified status.' },
        nextAction: { type: 'string', required: true, description: 'Smallest next action after verification.' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args, exec) {
        const key = caseKey(args.caseId, exec.agent?.id)
        const scoutCase = requireCase(key)
        let nextCase = recordEvent(decideCase(verifyClaim(scoutCase, {
          claimId: args.claimId,
          evidenceLevel: args.evidenceLevel,
          sourceIds: args.sourceIds.split(',').map(value => value.trim()).filter(Boolean),
          confidenceNote: args.confidenceNote,
          nextAction: args.nextAction,
        })), 'claim_verified', {
          claimId: args.claimId,
          evidenceLevel: args.evidenceLevel,
        })
        nextCase = await maybePersist(nextCase)
        cases.set(key, nextCase)
        return JSON.stringify(nextCase, null, 2)
      },
    }))
  }, 'dsh-scout tools')
}

export * from './model.js'
