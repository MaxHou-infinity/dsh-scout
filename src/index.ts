import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import {
  addClaim,
  addSource,
  appendEvent,
  CLAIM_DIMENSIONS,
  CLAIM_IMPACTS,
  CLAIM_STATUSES,
  computeCoverage,
  createCase,
  decideCase,
  DEFAULT_AUTHORITY_HOST_SUFFIXES,
  EVIDENCE_LEVELS,
  EXPORT_FILE_NAMES,
  exportCaseFiles,
  findSourceByUrl,
  generateInterviewQuestions,
  importCaseFromFiles,
  inferEvidenceLevel,
  inferSourceType,
  renderComparison,
  renderReport,
  SOURCE_TYPES,
  verifyClaim,
  verifyIdentity,
  type ClaimDimension,
  type ClaimImpact,
  type ClaimStatus,
  type Decision,
  type EvidenceLevel,
  type ScoutCase,
  type ScoutEvent,
  type ScoutSource,
  type SourceType,
} from './model.js'
import { formatScoutString, normalizeScoutLanguage, scoutStrings, type ScoutLanguage } from './i18n.js'

export const name = 'dsh-scout'
export const inject = ['tools']

export interface Config {
  /** Default directory for case exports; case files land under `<scoutDir>/<caseId>/`. */
  scoutDir?: string
  /** Persist the five-file export after every mutation when `scoutDir` is set. */
  autoPersist?: boolean
  /** Trusted authority host suffixes used by the E3 evidence policy. */
  authorityHostSuffixes?: readonly string[]
  /** Language used by the rendered report, comparison and interview questions. */
  language?: ScoutLanguage
}

export const Config = z.object({
  scoutDir: z.string().default('dsh-scout'),
  autoPersist: z.boolean().default(false),
  authorityHostSuffixes: z.array(z.string()).default([...DEFAULT_AUTHORITY_HOST_SUFFIXES]),
  language: z.union([z.const('zh-CN'), z.const('en')]).default('zh-CN'),
})

/* ------------------------------------------------------------------ *
 * Optional host services.
 *
 * Every service is resolved at its use site (or bound with `ctx.inject`
 * for one-time registrations), never snapshotted during `apply()`: a
 * service mounted later must still be usable, and a replaced provider
 * must not leave a stale reference behind.
 * ------------------------------------------------------------------ */

interface ScoutFsResolveOptions {
  cwd?: string
  signal?: unknown
}
interface ScoutFsTarget {
  targetKey: string
  displayPath: string
}
interface ScoutFs {
  resolve(path: string, opts?: ScoutFsResolveOptions): Promise<ScoutFsTarget>
  readText(target: ScoutFsTarget, signal?: unknown): Promise<string>
  writeText(
    target: ScoutFsTarget,
    content: string,
    intent?: unknown,
    signal?: unknown,
  ): Promise<unknown>
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
}

interface ScoutCommandInvocation {
  rawInput?: unknown
  agent?: { id?: unknown; session?: ScoutSessionLike }
  signal?: unknown
}
interface ScoutCommandResult {
  kind: 'success' | 'error'
  text?: string
}
interface ScoutCommands {
  register(definition: {
    name: string
    description: string
    handler(invocation: ScoutCommandInvocation): ScoutCommandResult | Promise<ScoutCommandResult>
  }): () => void
}
interface ScoutSkills {
  register(definition: {
    name: string
    description: string
    content: string
    whenToUse?: string
    invocation?: { modelInvocable?: boolean; userInvocable?: boolean }
  }): () => void
}

/** Session/workspace facts reached through the (nullable) executing agent. */
interface ScoutSessionLike {
  header?: { cwd?: string }
}
interface ScoutAgentLike {
  id?: unknown
  session?: ScoutSessionLike
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/* ------------------------------------------------------------------ *
 * Tool output contract (0.9.1)
 *
 * Mutation tools return the same structured envelope and render a compact
 * summary (<1 KB) instead of re-printing the whole case as JSON. The full
 * artifact stays behind `scout_report` / `scout_export`.
 * ------------------------------------------------------------------ */

type EnvelopeChangeKind =
  | 'case_started'
  | 'source_added'
  | 'sources_added'
  | 'claim_added'
  | 'claims_added'
  | 'identity_verified'
  | 'claim_verified'
  | 'case_imported'
  | 'case_rehydrated'

interface PersistView {
  persisted: boolean
  targetDir: string
  error?: string
}

interface EnvelopeView {
  ok: boolean
  caseId: string
  decision: Decision
  identity: ScoutCase['subject']['identityStatus']
  counts: { sources: number; claims: number; verified: number; open: number }
  changed: { kind: EnvelopeChangeKind; ids: string[] }
  nextActions: string[]
  persist?: PersistView
  errors?: Array<{ url: string; error: string }>
  /** Present on `scout_import`: the directory the case was restored from. */
  sourceDir?: string
  /** Present on `scout_import`: whether the export carried a completion marker. */
  complete?: boolean
}

const IMPACT_RANK: Record<ClaimImpact, number> = { blocking: 0, material: 1, informational: 2 }

/** Up to three smallest next actions for open blocking/material claims. */
const deriveNextActions = (scoutCase: ScoutCase): string[] =>
  [...scoutCase.claims]
    .filter(claim => claim.impact !== 'informational' && claim.status !== 'verified')
    .sort((left, right) => IMPACT_RANK[left.impact] - IMPACT_RANK[right.impact])
    .map(claim => claim.nextAction.trim())
    .filter((action, index, all) => Boolean(action) && all.indexOf(action) === index)
    .slice(0, 3)

const capIds = (ids: string[], limit = 20): string[] =>
  ids.length > limit ? [...ids.slice(0, limit), `+${ids.length - limit} more`] : ids

const buildEnvelope = (
  scoutCase: ScoutCase,
  changed: { kind: EnvelopeChangeKind; ids: string[] },
  extras: { persist?: PersistView; errors?: Array<{ url: string; error: string }> } = {},
): EnvelopeView => {
  const verified = scoutCase.claims.filter(claim => claim.status === 'verified').length
  return {
    ok: true,
    caseId: scoutCase.caseId,
    decision: scoutCase.decision,
    identity: scoutCase.subject.identityStatus,
    counts: {
      sources: scoutCase.sources.length,
      claims: scoutCase.claims.length,
      verified,
      open: scoutCase.claims.length - verified,
    },
    changed: { kind: changed.kind, ids: capIds(changed.ids) },
    nextActions: deriveNextActions(scoutCase),
    ...(extras.persist ? { persist: extras.persist } : {}),
    ...(extras.errors?.length ? { errors: extras.errors } : {}),
  }
}

/** Model-facing render budget for one mutation summary, in UTF-8 bytes. */
const MAX_RENDER_BYTES = 1024

/** Byte length of a JS string in UTF-8, without relying on Node globals. */
const utf8Length = (text: string): number => {
  let bytes = 0
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
  }
  return bytes
}

/** Hard cap so an oversized free-text field can never blow the render budget. */
const clampUtf8 = (text: string, limit: number): string => {
  if (utf8Length(text) <= limit) return text
  let clipped = text
  while (clipped.length > 0 && utf8Length(clipped) > limit - 1) clipped = clipped.slice(0, -1)
  return `${clipped}…`
}

/** Per-field cap applied before the whole-render cap. */
const clipField = (text: string, limit: number): string =>
  text.length > limit ? `${text.slice(0, limit - 1)}…` : text

const formatEnvelope = (value: EnvelopeView): string => {
  const { counts, changed } = value
  const lines = [
    `[${clipField(value.caseId, 80)}] ${value.decision} · identity ${value.identity} · sources ${counts.sources} / claims ${counts.claims} (verified ${counts.verified}, open ${counts.open})`,
    `changed: ${changed.kind}${changed.ids.length ? ` (${clipField(changed.ids.join(', '), 200)})` : ''}`,
  ]
  if (value.nextActions.length) {
    lines.push(`next: ${value.nextActions.map(action => clipField(action, 140)).join(' | ')}`)
  }
  if (value.persist) {
    lines.push(value.persist.persisted
      ? `persisted: ${clipField(value.persist.targetDir, 160)}`
      : `PERSIST FAILED (${clipField(value.persist.targetDir, 160)}): ${clipField(value.persist.error ?? 'unknown error', 160)}`)
  }
  if (value.errors?.length) {
    lines.push(`rejected: ${value.errors.length} item(s) — first: ${clipField(value.errors[0].error, 160)}`)
  }
  if (value.sourceDir) {
    lines.push(`imported from ${clipField(value.sourceDir, 160)} (complete: ${value.complete === true})`)
  }
  // The per-field caps keep this from triggering in practice; the whole-render
  // cap is the guarantee the gate asserts.
  return clampUtf8(lines.join('\n'), MAX_RENDER_BYTES - 8)
}

/** Envelope schema shared by every mutating tool. */
const mutationSchema = () => ({
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' as const, required: true as const },
    caseId: { type: 'string' as const, required: true as const },
    decision: {
      type: 'string' as const,
      enum: ['PROCEED', 'VERIFY', 'STOP'],
      required: true as const,
    },
    identity: {
      type: 'string' as const,
      enum: ['verified', 'needs_verification'],
      required: true as const,
    },
    counts: {
      type: 'object' as const,
      additionalProperties: false,
      required: true as const,
      properties: {
        sources: { type: 'integer' as const, required: true as const },
        claims: { type: 'integer' as const, required: true as const },
        verified: { type: 'integer' as const, required: true as const },
        open: { type: 'integer' as const, required: true as const },
      },
    },
    changed: {
      type: 'object' as const,
      additionalProperties: false,
      required: true as const,
      properties: {
        kind: {
          type: 'string' as const,
          enum: [
            'case_started',
            'source_added',
            'sources_added',
            'claim_added',
            'claims_added',
            'identity_verified',
            'claim_verified',
            'case_imported',
            'case_rehydrated',
          ],
          required: true as const,
        },
        ids: { type: 'array' as const, items: { type: 'string' as const }, required: true as const },
      },
    },
    nextActions: { type: 'array' as const, items: { type: 'string' as const }, required: true as const },
    persist: {
      type: 'object' as const,
      additionalProperties: false,
      properties: {
        persisted: { type: 'boolean' as const, required: true as const },
        targetDir: { type: 'string' as const, required: true as const },
        error: { type: 'string' as const },
      },
    },
    errors: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        additionalProperties: false,
        properties: {
          url: { type: 'string' as const, required: true as const },
          error: { type: 'string' as const, required: true as const },
        },
      },
    },
    sourceDir: { type: 'string' as const },
    complete: { type: 'boolean' as const },
  },
})

const mutationOutput = () => ({
  schema: mutationSchema(),
  render: (_args: unknown, value: EnvelopeView) => [
    { type: 'text' as const, text: formatEnvelope(value) },
  ],
})

export function apply(ctx: Context, config: Config = {}) {
  const cases = new Map<string, ScoutCase>()
  const caseKey = (caseId: string, agentId: unknown) => `${String(agentId ?? 'unscoped')}::${caseId}`
  const keyCaseId = (key: string) => key.slice(key.indexOf('::') + 2 || 0)

  const authoritySuffixes = config.authorityHostSuffixes ?? DEFAULT_AUTHORITY_HOST_SUFFIXES
  const defaultScoutDir = config.scoutDir?.replace(/\/+$/, '') || 'dsh-scout'
  const caseExportDir = (caseId: string) => `${defaultScoutDir}/${caseId}`

  /** Resolved once from validated config; every renderer and decision follows it. */
  const language: ScoutLanguage = normalizeScoutLanguage(config.language)
  const decide = (scoutCase: ScoutCase): ScoutCase => ({
    ...decideCase(scoutCase, { language }),
    // Keep the case's own label in sync with the language this deployment renders in,
    // so case.json never claims one language while carrying another's prose.
    language,
  })
  const renderReportOf = (scoutCase: ScoutCase) => renderReport(scoutCase, { language })
  const strings = scoutStrings(language)

  // Resolved per call so a later-mounted (or replaced) provider is honored.
  const fsService = () => ctx.get('fs') as ScoutFs | undefined
  const webService = () => ctx.get('web') as ScoutWeb | undefined
  const execCwd = (exec: unknown): string | undefined =>
    (exec as { agent?: ScoutAgentLike } | undefined)?.agent?.session?.header?.cwd

  const recordEvent = (
    scoutCase: ScoutCase,
    type: ScoutEvent['type'],
    detail: Record<string, unknown>,
  ) => {
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
    recordEvent(addSource(scoutCase, source, authoritySuffixes), 'source_added', {
      sourceId: source.sourceId,
      type: source.type,
      title: source.title,
      url: source.url,
      evidenceLevel: source.evidenceLevel,
      ingested: true,
    })

  /* -------------------------------------------------------------- *
   * Durable export
   *
   * Order is "record the event, then write": the persisted
   * `events.jsonl` must contain the export event it belongs to.
   * A completion marker is written last so a torn export is
   * distinguishable from a corrupt one.
   * -------------------------------------------------------------- */

  const EXPORT_MARKER_FILE = 'export.complete.json'
  const EXPORT_MARKER_SCHEMA = 'dsh-scout.export.v1'

  const directoryOf = (displayPath: string): string => {
    const cut = displayPath.lastIndexOf('/')
    return cut > 0 ? displayPath.slice(0, cut) : displayPath
  }

  /**
   * Write the five export files plus the completion marker.
   *
   * The marker is invalidated *before* the payload is touched and only
   * re-asserted after every payload file landed, so an interrupted export can
   * never leave a stale `complete: true` beside mixed-generation files.
   */
  const persistFiles = async (
    scoutCase: ScoutCase,
    targetDir: string,
    fs: ScoutFs,
    cwd: string | undefined,
    signal: unknown,
  ): Promise<PersistView> => {
    try {
      const files = exportCaseFiles(scoutCase, { language })
      const marker = (complete: boolean) => `${JSON.stringify({
        schemaVersion: EXPORT_MARKER_SCHEMA,
        caseId: scoutCase.caseId,
        complete,
        files: [...EXPORT_FILE_NAMES],
        eventCount: (scoutCase.events ?? []).length,
      }, null, 2)}\n`
      let absoluteDir: string | undefined
      const write = async (fileName: string, content: string) => {
        const target = await fs.resolve(`${targetDir}/${fileName}`, { cwd, signal })
        if (typeof target?.displayPath === 'string') absoluteDir = directoryOf(target.displayPath)
        await fs.writeText(target, content, undefined, signal)
      }
      await write(EXPORT_MARKER_FILE, marker(false))
      for (const fileName of EXPORT_FILE_NAMES) {
        await write(fileName, files[fileName])
      }
      await write(EXPORT_MARKER_FILE, marker(true))
      return { persisted: true, targetDir: absoluteDir ?? targetDir }
    } catch (error) {
      return { persisted: false, targetDir, error: messageOf(error) }
    }
  }

  /**
   * Persist a case for one tool call. On success the returned case carries
   * the `case_exported` event that the written `events.jsonl` also has; on
   * failure the event is dropped and the error is surfaced to the caller.
   */
  const exportCase = async (
    scoutCase: ScoutCase,
    targetDir: string,
    fs: ScoutFs,
    cwd: string | undefined,
    signal: unknown,
    auto: boolean,
  ): Promise<{ scoutCase: ScoutCase; persist: PersistView }> => {
    const withEvent = recordEvent(scoutCase, 'case_exported', { targetDir, auto })
    const persist = await persistFiles(withEvent, targetDir, fs, cwd, signal)
    return { scoutCase: persist.persisted ? withEvent : scoutCase, persist }
  }

  const maybePersist = async (
    scoutCase: ScoutCase,
    exec: unknown,
  ): Promise<{ scoutCase: ScoutCase; persist?: PersistView }> => {
    if (!config.autoPersist) return { scoutCase }
    const fs = fsService()
    if (!fs) {
      return {
        scoutCase,
        persist: {
          persisted: false,
          targetDir: caseExportDir(scoutCase.caseId),
          error: 'Filesystem service is unavailable in this host',
        },
      }
    }
    return exportCase(
      scoutCase,
      caseExportDir(scoutCase.caseId),
      fs,
      execCwd(exec),
      (exec as { signal?: unknown } | undefined)?.signal,
      true,
    )
  }

  /* -------------------------------------------------------------- *
   * Case lookup with lazy rehydration
   * -------------------------------------------------------------- */

  const readExportFiles = async (
    sourceDir: string,
    fs: ScoutFs,
    cwd: string | undefined,
    signal: unknown,
  ): Promise<Record<string, string>> => {
    const files: Record<string, string> = {}
    for (const fileName of ['case.json', 'sources.json', 'claims.json', 'events.jsonl']) {
      const target = await fs.resolve(`${sourceDir}/${fileName}`, { cwd, signal })
      files[fileName] = await fs.readText(target, signal)
    }
    return files
  }

  /**
   * Read the completion marker. Existence is not enough: the marker is
   * written with `complete: false` before an export starts, so a stale marker
   * left by an interrupted export must not be read as a finished one.
   */
  const readCompletionMarker = async (
    sourceDir: string,
    fs: ScoutFs,
    cwd: string | undefined,
    signal: unknown,
  ): Promise<boolean> => {
    try {
      const raw = await fs.readText(await fs.resolve(`${sourceDir}/${EXPORT_MARKER_FILE}`, { cwd, signal }), signal)
      const parsed = JSON.parse(raw) as { complete?: unknown } | null
      return parsed?.complete === true
    } catch {
      return false
    }
  }

  /**
   * Restore a case from `<scoutDir>/<caseId>/` when the cache misses.
   *
   * Only a completed export is rehydrated: an interrupted one is reported by
   * `scout_import` (which returns `complete: false`) rather than silently
   * becoming this session's case state. Exports written before 0.9.1 have no
   * marker at all and must be restored explicitly with `scout_import`.
   */
  const rehydrate = async (
    caseId: string,
    key: string,
    fs: ScoutFs,
    cwd: string | undefined,
    signal: unknown,
  ): Promise<ScoutCase | undefined> => {
    const sourceDir = caseExportDir(caseId)
    try {
      if (!(await readCompletionMarker(sourceDir, fs, cwd, signal))) return undefined
      const restored = importCaseFromFiles(await readExportFiles(sourceDir, fs, cwd, signal))
      if (restored.caseId !== caseId) return undefined
      const nextCase = decide(recordEvent(restored, 'case_rehydrated', { sourceDir }))
      cases.set(key, nextCase)
      return nextCase
    } catch {
      return undefined
    }
  }

  const requireCase = async (key: string, exec: unknown): Promise<ScoutCase> => {
    const existing = cases.get(key)
    if (existing) return existing
    const caseId = keyCaseId(key)
    const fs = fsService()
    if (fs) {
      const restored = await rehydrate(caseId, key, fs, execCwd(exec), (exec as { signal?: unknown } | undefined)?.signal)
      if (restored) return restored
    }
    const known = [...cases.keys()]
      .filter(entry => entry.startsWith(`${String((exec as { agent?: ScoutAgentLike } | undefined)?.agent?.id ?? 'unscoped')}::`))
      .map(entry => keyCaseId(entry))
    throw new Error(
      `Unknown case: ${caseId}. No in-memory case and no restorable export at ${caseExportDir(caseId)}.`
      + (known.length ? ` Known cases in this session: ${known.join(', ')}.` : '')
      + ' Use scout_start to create it or scout_import to restore it from a directory.',
    )
  }

  /* -------------------------------------------------------------- *
   * Tools
   * -------------------------------------------------------------- */

  ctx.effect(function* registerScoutTools() {
    yield () => cases.clear()

    yield ctx.tools.register(defineTool({
      name: 'scout_start',
      description: 'Start a company and job due-diligence case. The initial decision is VERIFY until identity evidence is confirmed. Returns a compact status summary; use scout_report for the full report.',
      parameters: {
        caseId: { type: 'string', required: true, description: 'Stable case identifier.' },
        companyName: { type: 'string', required: true, description: 'Company or brand name to investigate.' },
        roleTitle: { type: 'string', required: true, description: 'Role title to evaluate.' },
        location: { type: 'string', required: true, description: 'Job location, or an empty string if unknown.' },
      },
      output: mutationOutput(),
      async execute(args, exec) {
        const key = caseKey(args.caseId, exec.agent?.id)
        if (cases.has(key)) throw new Error(`Case already exists: ${args.caseId}`)
        let nextCase = recordEvent(createCase({
          caseId: args.caseId,
          companyName: args.companyName,
          roleTitle: args.roleTitle,
          location: args.location || undefined,
          language,
        }), 'case_started', {
          companyName: args.companyName,
          roleTitle: args.roleTitle,
          location: args.location || null,
        })
        const persisted = await maybePersist(nextCase, exec)
        nextCase = persisted.scoutCase
        cases.set(key, nextCase)
        return buildEnvelope(nextCase, { kind: 'case_started', ids: [nextCase.caseId] }, { persist: persisted.persist })
      },
    }))

    yield ctx.tools.register(defineTool({
      name: 'scout_add_claim',
      description: 'Add a sourced or explicitly unverified claim to an active dsh-scout case. Returns a compact status summary; use scout_report for the full ledger.',
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
      output: mutationOutput(),
      async execute(args, exec) {
        const key = caseKey(args.caseId, exec.agent?.id)
        const scoutCase = await requireCase(key, exec)
        let nextCase = recordEvent(decide(addClaim(scoutCase, {
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
        const persisted = await maybePersist(nextCase, exec)
        nextCase = persisted.scoutCase
        cases.set(key, nextCase)
        return buildEnvelope(nextCase, { kind: 'claim_added', ids: [args.claimId] }, { persist: persisted.persist })
      },
    }))

    yield ctx.tools.register(defineTool({
      name: 'scout_ingest',
      description: 'Batch-register collected research results as sources, optionally drafting claims from each item. itemsJson is a JSON array of { url, title?, sourceType?, evidenceLevel?, claim? }; claim is { text, dimension, impact?, status?, evidenceLevel? } with status defaulting to reported, impact to material, and evidence level to the source level. Source type and evidence level are inferred from the URL when omitted (official registry/regulator origins map to E3, job platforms to job_posting/E2, user-provided to E1, unknown to other/E2). A URL already registered for the case is reused instead of duplicated. Individual invalid items or rejected claims are reported in errors without aborting the batch; a failed claim does not undo its already-registered source.',
      parameters: {
        caseId: { type: 'string', required: true, description: 'Existing case identifier.' },
        itemsJson: { type: 'string', required: true, description: 'JSON array of collected source items.' },
      },
      output: mutationOutput(),
      async execute(args, exec) {
        const key = caseKey(args.caseId, exec.agent?.id)
        let scoutCase = await requireCase(key, exec)
        let items: Array<{ url?: unknown; title?: unknown; sourceType?: unknown; evidenceLevel?: unknown; claim?: unknown }>
        try {
          const parsed = JSON.parse(args.itemsJson)
          if (!Array.isArray(parsed)) throw new Error('itemsJson must be a JSON array')
          items = parsed
        } catch (error) {
          throw new Error(`Invalid itemsJson: ${messageOf(error)}`)
        }
        const added: string[] = []
        const failures: Array<{ url: string; error: string }> = []
        let nextId = (scoutCase.sources.length ?? 0) + 1
        let nextClaimId = (scoutCase.claims.length ?? 0) + 1
        for (const rawItem of items) {
          const itemUrl = () =>
            rawItem && typeof rawItem === 'object' && typeof (rawItem as Record<string, unknown>).url === 'string'
              ? ((rawItem as Record<string, unknown>).url as string)
              : String((rawItem as Record<string, unknown> | null)?.url ?? rawItem ?? '')
          try {
            if (!rawItem || typeof rawItem !== 'object') {
              failures.push({ url: String(rawItem ?? ''), error: 'item must be an object' })
              continue
            }
            const item = rawItem as Record<string, unknown>
            const url = typeof item.url === 'string' ? item.url.trim() : ''
            if (!url) {
              failures.push({ url: String(item.url ?? ''), error: 'url is required' })
              continue
            }
            const explicitType = typeof item.sourceType === 'string' && SOURCE_TYPES.includes(item.sourceType as SourceType)
              ? item.sourceType as SourceType
              : undefined
            const explicitLevel = typeof item.evidenceLevel === 'string' && EVIDENCE_LEVELS.includes(item.evidenceLevel as EvidenceLevel)
              ? item.evidenceLevel as EvidenceLevel
              : undefined
            if (item.sourceType !== undefined && item.sourceType !== null && !explicitType) {
              failures.push({ url, error: `invalid sourceType: ${String(item.sourceType)}` })
              continue
            }
            if (item.evidenceLevel !== undefined && item.evidenceLevel !== null && !explicitLevel) {
              failures.push({ url, error: `invalid evidenceLevel: ${String(item.evidenceLevel)}` })
              continue
            }
            const typeGuess = inferSourceType(url, explicitType, authoritySuffixes)
            const levelGuess = inferEvidenceLevel(url, typeGuess.type, explicitLevel, authoritySuffixes)
            const existing = findSourceByUrl(scoutCase, url)
            let source: ScoutSource
            if (existing) {
              source = existing
            } else {
              let sourceId = `src-${nextId}`
              while (scoutCase.sources.some(candidate => candidate.sourceId === sourceId)) {
                nextId += 1
                sourceId = `src-${nextId}`
              }
              nextId += 1
              source = {
                sourceId,
                type: typeGuess.type,
                title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : url,
                url,
                capturedAt: new Date().toISOString(),
                evidenceLevel: levelGuess.evidenceLevel,
                status: 'captured',
              }
              scoutCase = registerSource(scoutCase, source)
            }
            added.push(source.sourceId)
            const rawClaim = item.claim
            if (rawClaim !== undefined && rawClaim !== null) {
              if (typeof rawClaim !== 'object') {
                failures.push({ url, error: 'claim must be an object' })
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
                  failures.push({ url, error: `claim rejected: ${claimIssues.join('; ')}` })
                } else {
                  let claimId = `claim-${nextClaimId}`
                  while (scoutCase.claims.some(candidate => candidate.claimId === claimId)) {
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
                      confidenceNote: formatScoutString(strings.ingest.autoConfidenceNote, { sourceId: source.sourceId }),
                      nextAction: strings.ingest.autoNextAction,
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
                    added.push(claimId)
                  } catch (error) {
                    failures.push({ url, error: `claim rejected: ${messageOf(error)}` })
                  }
                }
              }
            }
          } catch (error) {
            failures.push({ url: itemUrl(), error: messageOf(error) })
          }
        }
        scoutCase = decide(scoutCase)
        const persisted = await maybePersist(scoutCase, exec)
        scoutCase = persisted.scoutCase
        cases.set(key, scoutCase)
        return buildEnvelope(
          scoutCase,
          { kind: 'sources_added', ids: added },
          { persist: persisted.persist, errors: failures },
        )
      },
    }))

    yield ctx.tools.register(defineTool({
      name: 'scout_search',
      description: 'Run a web search through the DSH web provider and auto-register the result URLs as sources for the case (type and evidence level inferred per URL; a URL already registered for the case is reused). Optionally limits how many results are registered.',
      parameters: {
        caseId: { type: 'string', required: true, description: 'Existing case identifier.' },
        query: { type: 'string', required: true, description: 'Search query to run through the web provider.' },
        limit: { type: 'number', description: 'Maximum number of search results to register (default 5, capped at 10).' },
      },
      output: mutationOutput(),
      async execute(args, exec) {
        const web = webService()
        if (!web) throw new Error('Web search service is unavailable in this host')
        const key = caseKey(args.caseId, exec.agent?.id)
        let scoutCase = await requireCase(key, exec)
        const parsedLimit = Math.trunc(args.limit ?? 5)
        const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 10) : 5
        const result = await web.search({ query: args.query, maxResults: limit }, exec.signal)
        const added: string[] = []
        const failures: Array<{ url: string; error: string }> = []
        const items = Array.isArray(result.sources) ? result.sources : []
        if (!Array.isArray(result.sources)) {
          failures.push({ url: '', error: 'search provider returned a non-array sources field' })
        }
        let nextId = (scoutCase.sources.length ?? 0) + 1
        items.forEach((item, index) => {
          if (!item || typeof item !== 'object') {
            failures.push({ url: '', error: `search result ${index} must be an object` })
            return
          }
          const url = typeof item.url === 'string' ? item.url.trim() : ''
          if (!url) {
            failures.push({ url: '', error: `search result ${index} missing url` })
            return
          }
          try {
            const existing = findSourceByUrl(scoutCase, url)
            if (existing) {
              added.push(existing.sourceId)
              return
            }
            const typeGuess = inferSourceType(url, undefined, authoritySuffixes)
            const levelGuess = inferEvidenceLevel(url, typeGuess.type, undefined, authoritySuffixes)
            let sourceId = `src-${nextId}`
            while (scoutCase.sources.some(candidate => candidate.sourceId === sourceId)) {
              nextId += 1
              sourceId = `src-${nextId}`
            }
            nextId += 1
            scoutCase = registerSource(scoutCase, {
              sourceId,
              type: typeGuess.type,
              title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : url,
              url,
              capturedAt: new Date().toISOString(),
              evidenceLevel: levelGuess.evidenceLevel,
              status: 'captured',
            })
            added.push(sourceId)
          } catch (error) {
            failures.push({ url, error: messageOf(error) })
          }
        })
        scoutCase = decide(scoutCase)
        const persisted = await maybePersist(scoutCase, exec)
        scoutCase = persisted.scoutCase
        cases.set(key, scoutCase)
        return buildEnvelope(
          scoutCase,
          { kind: 'sources_added', ids: added },
          { persist: persisted.persist, errors: failures },
        )
      },
    }))

    yield ctx.tools.register(defineTool({
      name: 'scout_compare',
      description: 'Render a side-by-side comparison report for two to five existing cases (decision, identity status, verified conclusions, open risks, and merged interview questions).',
      parameters: {
        caseIds: { type: 'string', required: true, description: 'Comma-separated case identifiers; at least two, at most five.' },
      },
      output: {
        schema: {
          type: 'object' as const,
          additionalProperties: false,
          properties: {
            caseIds: {
              type: 'array' as const,
              items: { type: 'string' as const },
              required: true as const,
            },
            report: { type: 'string' as const, required: true as const },
          },
        },
        render: (_args: unknown, value: { report: string }) => [
          { type: 'text' as const, text: value.report },
        ],
      },
      async execute(args, exec) {
        const agentId = exec.agent?.id
        const rawIds = args.caseIds.split(',').map(value => value.trim()).filter(Boolean)
        if (rawIds.length === 0) throw new Error('No case ids provided')
        const caseIds = [...new Set(rawIds)]
        if (caseIds.length < 2) throw new Error('Comparison requires at least two distinct case ids')
        const compared = []
        for (const caseId of caseIds) {
          compared.push(await requireCase(caseKey(caseId, agentId), exec))
        }
        return { caseIds, report: renderComparison(compared, { language }) }
      },
    }))

    yield ctx.tools.register(defineTool({
      name: 'scout_report',
      description: 'Render the full evidence-bounded report for a dsh-scout case. This is the only tool that returns the complete artifact; mutation tools return compact summaries.',
      parameters: {
        caseId: { type: 'string', required: true, description: 'Existing case identifier.' },
      },
      output: {
        schema: {
          type: 'object' as const,
          additionalProperties: false,
          properties: {
            caseId: { type: 'string' as const, required: true as const },
            decision: {
              type: 'string' as const,
              enum: ['PROCEED', 'VERIFY', 'STOP'],
              required: true as const,
            },
            report: { type: 'string' as const, required: true as const },
            coverage: {
              type: 'array' as const,
              required: true as const,
              items: {
                type: 'object' as const,
                additionalProperties: false,
                properties: {
                  dimension: {
                    type: 'string' as const,
                    enum: [...CLAIM_DIMENSIONS],
                    required: true as const,
                  },
                  verified: { type: 'integer' as const, required: true as const },
                  open: { type: 'integer' as const, required: true as const },
                  untouched: { type: 'boolean' as const, required: true as const },
                },
              },
            },
          },
        },
        render: (_args: unknown, value: { report: string }) => [
          { type: 'text' as const, text: value.report },
        ],
      },
      async execute(args, exec) {
        const key = caseKey(args.caseId, exec.agent?.id)
        const scoutCase = await requireCase(key, exec)
        return {
          caseId: scoutCase.caseId,
          decision: scoutCase.decision,
          report: renderReportOf(scoutCase),
          coverage: computeCoverage(scoutCase),
        }
      },
    }))

    yield ctx.tools.register(defineTool({
      name: 'scout_export',
      description: 'Persist a dsh-scout case as the durable five-file export (case.json, sources.json, claims.json, events.jsonl, report.md) plus a completion marker. targetDir is optional and defaults to the configured scoutDir (or ./dsh-scout) plus the case id. The returned targetDir is the resolved absolute directory.',
      parameters: {
        caseId: { type: 'string', required: true, description: 'Existing case identifier.' },
        targetDir: { type: 'string', description: 'Directory path to write the five export files into; defaults to <scoutDir>/<caseId>.' },
      },
      output: {
        schema: {
          type: 'object' as const,
          additionalProperties: false,
          properties: {
            caseId: { type: 'string' as const, required: true as const },
            targetDir: { type: 'string' as const, required: true as const },
            files: { type: 'array' as const, items: { type: 'string' as const }, required: true as const },
            persisted: { type: 'boolean' as const, required: true as const },
            complete: { type: 'boolean' as const, required: true as const },
            error: { type: 'string' as const },
          },
        },
        render: (_args: unknown, value: { targetDir: string; persisted: boolean; complete: boolean; error?: string }) => [
          {
            type: 'text' as const,
            text: value.persisted
              ? `exported to ${value.targetDir} (complete: ${value.complete})`
              : `EXPORT FAILED (${value.targetDir}): ${value.error ?? 'unknown error'}`,
          },
        ],
      },
      async execute(args, exec) {
        const fs = fsService()
        if (!fs) throw new Error('Filesystem service is unavailable in this host')
        const key = caseKey(args.caseId, exec.agent?.id)
        const scoutCase = await requireCase(key, exec)
        const targetDir = args.targetDir || caseExportDir(scoutCase.caseId)
        const exported = await exportCase(scoutCase, targetDir, fs, execCwd(exec), exec.signal, false)
        cases.set(key, exported.scoutCase)
        return {
          caseId: scoutCase.caseId,
          targetDir: exported.persist.targetDir,
          files: [...EXPORT_FILE_NAMES, EXPORT_MARKER_FILE],
          persisted: exported.persist.persisted,
          complete: exported.persist.persisted,
          ...(exported.persist.error ? { error: exported.persist.error } : {}),
        }
      },
    }))

    yield ctx.tools.register(defineTool({
      name: 'scout_questions',
      description: 'Derive a deduplicated, prioritized interview question list from the case: unverified blocking/material next actions first, then questions for missing required role dimensions, then the default interview questions.',
      parameters: {
        caseId: { type: 'string', required: true, description: 'Existing case identifier.' },
      },
      output: {
        schema: {
          type: 'object' as const,
          additionalProperties: false,
          properties: {
            caseId: { type: 'string' as const, required: true as const },
            questions: { type: 'array' as const, items: { type: 'string' as const }, required: true as const },
          },
        },
        render: (_args: unknown, value: { questions: string[] }) => [
          {
            type: 'text' as const,
            text: value.questions.length
              ? value.questions.map((question, index) => `${index + 1}. ${question}`).join('\n')
              : 'No interview questions derived yet.',
          },
        ],
      },
      async execute(args, exec) {
        const key = caseKey(args.caseId, exec.agent?.id)
        const scoutCase = await requireCase(key, exec)
        return { caseId: scoutCase.caseId, questions: generateInterviewQuestions(scoutCase, { language }) }
      },
    }))

    yield ctx.tools.register(defineTool({
      name: 'scout_import',
      description: 'Restore a dsh-scout case from a five-file export directory, then recompute its decision. Exports written before 0.9.1 have no completion marker: they still import, but `complete` reports false.',
      parameters: {
        caseId: { type: 'string', required: true, description: 'Case identifier to restore; must match the exported case.json.' },
        sourceDir: { type: 'string', required: true, description: 'Directory path containing the five export files.' },
      },
      output: mutationOutput(),
      async execute(args, exec) {
        const fs = fsService()
        if (!fs) throw new Error('Filesystem service is unavailable in this host')
        const key = caseKey(args.caseId, exec.agent?.id)
        const cwd = execCwd(exec)
        const restored = importCaseFromFiles(await readExportFiles(args.sourceDir, fs, cwd, exec.signal))
        if (restored.caseId !== args.caseId) {
          throw new Error(`Case id mismatch: export has ${restored.caseId}, requested ${args.caseId}`)
        }
        const nextCase = decide(recordEvent(restored, 'case_imported', { sourceDir: args.sourceDir }))
        cases.set(key, nextCase)
        return {
          ...buildEnvelope(nextCase, { kind: 'case_imported', ids: [nextCase.caseId] }),
          sourceDir: args.sourceDir,
          complete: await readCompletionMarker(args.sourceDir, fs, cwd, exec.signal),
        }
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
      output: mutationOutput(),
      async execute(args, exec) {
        const key = caseKey(args.caseId, exec.agent?.id)
        const scoutCase = await requireCase(key, exec)
        const source: ScoutSource = {
          sourceId: args.sourceId,
          type: args.sourceType,
          title: args.title,
          url: args.url || null,
          capturedAt: new Date().toISOString(),
          evidenceLevel: args.evidenceLevel,
          status: 'captured',
        }
        let nextCase = recordEvent(addSource(scoutCase, source, authoritySuffixes), 'source_added', {
          sourceId: source.sourceId,
          evidenceLevel: source.evidenceLevel,
        })
        const persisted = await maybePersist(nextCase, exec)
        nextCase = persisted.scoutCase
        cases.set(key, nextCase)
        return buildEnvelope(nextCase, { kind: 'source_added', ids: [args.sourceId] }, { persist: persisted.persist })
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
      output: mutationOutput(),
      async execute(args, exec) {
        const key = caseKey(args.caseId, exec.agent?.id)
        const scoutCase = await requireCase(key, exec)
        let nextCase = recordEvent(decide(verifyIdentity(scoutCase, {
          legalEntity: args.legalEntity,
          registrationNumber: args.registrationNumber,
          registeredRegion: args.registeredRegion,
          legalRepresentative: args.legalRepresentative,
          brandRelationship: args.brandRelationship,
          sourceIds: args.sourceIds.split(',').map(value => value.trim()).filter(Boolean),
        }, authoritySuffixes)), 'identity_verified', {
          legalEntity: args.legalEntity,
          registrationNumber: args.registrationNumber,
        })
        const persisted = await maybePersist(nextCase, exec)
        nextCase = persisted.scoutCase
        cases.set(key, nextCase)
        return buildEnvelope(nextCase, { kind: 'identity_verified', ids: [args.legalEntity] }, { persist: persisted.persist })
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
      output: mutationOutput(),
      async execute(args, exec) {
        const key = caseKey(args.caseId, exec.agent?.id)
        const scoutCase = await requireCase(key, exec)
        let nextCase = recordEvent(decide(verifyClaim(scoutCase, {
          claimId: args.claimId,
          evidenceLevel: args.evidenceLevel,
          sourceIds: args.sourceIds.split(',').map(value => value.trim()).filter(Boolean),
          confidenceNote: args.confidenceNote,
          nextAction: args.nextAction,
        })), 'claim_verified', {
          claimId: args.claimId,
          evidenceLevel: args.evidenceLevel,
        })
        const persisted = await maybePersist(nextCase, exec)
        nextCase = persisted.scoutCase
        cases.set(key, nextCase)
        return buildEnvelope(nextCase, { kind: 'claim_verified', ids: [args.claimId] }, { persist: persisted.persist })
      },
    }))
  }, 'dsh-scout tools')

  /* -------------------------------------------------------------- *
   * Host entry points: a `/scout` command and a registered Skill.
   * Both are optional services bound through `ctx.inject`, so a host
   * without them simply skips the registration.
   * -------------------------------------------------------------- */

  const runScoutCommand = async (invocation: ScoutCommandInvocation): Promise<ScoutCommandResult> => {
    const raw = typeof invocation?.rawInput === 'string' ? invocation.rawInput.trim() : ''
    const [action = 'help', caseId = ''] = raw.split(/\s+/).filter(Boolean)
    if (action === 'help' || !caseId) {
      return {
        kind: 'success',
        text: 'usage: /scout status <caseId> | /scout questions <caseId> | /scout report <caseId> | /scout export <caseId> [targetDir]',
      }
    }
    const key = caseKey(caseId, invocation?.agent?.id)
    const scoutCase = cases.get(key)
    if (!scoutCase) {
      return { kind: 'error', text: `Unknown case: ${caseId}. Use scout_start or scout_import first.` }
    }
    if (action === 'status') {
      const verified = scoutCase.claims.filter(claim => claim.status === 'verified').length
      return {
        kind: 'success',
        text: `[${scoutCase.caseId}] ${scoutCase.decision} · identity ${scoutCase.subject.identityStatus}`
          + ` · sources ${scoutCase.sources.length} / claims ${scoutCase.claims.length}`
          + ` (verified ${verified}, open ${scoutCase.claims.length - verified})`,
      }
    }
    if (action === 'questions') {
      return { kind: 'success', text: generateInterviewQuestions(scoutCase, { language }).map((q, i) => `${i + 1}. ${q}`).join('\n') }
    }
    if (action === 'report') {
      return { kind: 'success', text: renderReportOf(scoutCase) }
    }
    if (action === 'export') {
      const fs = fsService()
      if (!fs) return { kind: 'error', text: 'Filesystem service is unavailable in this host' }
      const targetDir = caseExportDir(scoutCase.caseId)
      const exported = await exportCase(scoutCase, targetDir, fs, invocation?.agent?.session?.header?.cwd, invocation?.signal, false)
      cases.set(key, exported.scoutCase)
      return exported.persist.persisted
        ? { kind: 'success', text: `exported to ${exported.persist.targetDir}` }
        : { kind: 'error', text: `export failed (${exported.persist.targetDir}): ${exported.persist.error ?? 'unknown error'}` }
    }
    return { kind: 'error', text: `Unknown /scout action: ${action}` }
  }

  const SCOUT_SKILL_CONTENT = [
    '# dsh-scout (司察) due-diligence workflow',
    '',
    'Use the scout tools when the user wants to judge whether a company and a role are worth',
    'pursuing, and what must be verified before deciding.',
    '',
    '## Order',
    '1. `scout_start` — create the case. The decision starts at VERIFY.',
    '2. `scout_search` / `scout_ingest` / `scout_add_source` — collect and register sources.',
    '3. `scout_add_claim` — attach evidence-bounded claims (batch drafts come from `scout_ingest`).',
    '4. `scout_verify_identity` — confirm the legal entity from an E3 registry/regulator source.',
    '5. `scout_verify_claim` — promote a claim once stronger sources exist.',
    '6. `scout_report` / `scout_questions` — the full report and the interview question list.',
    '7. `scout_export` — persist the five-file export; `scout_import` restores it later.',
    '',
    '## Evidence discipline (enforced by the tools, do not try to bypass)',
    '1. A claim may never cite a higher evidence level than its strongest source.',
    '2. A high-impact claim with no source must stay `unknown` or `needs_verification`.',
    '3. `scout_verify_identity` requires a linked E3 registry/regulator/official-filing source over HTTPS.',
    '4. The decision stays VERIFY while the identity is unverified or a blocking/material claim is open.',
    '',
    '## Reading tool output',
    'Mutation tools return a compact status summary (decision, counts, what changed, next actions).',
    'Call `scout_report` when the full ledger is actually needed instead of re-reading every mutation.',
  ].join('\n')

  const bindOptional = (serviceName: string, install: (service: unknown) => () => void) => {
    ctx.inject([serviceName], (child: Context) => {
      const service = (child as unknown as Record<string, unknown>)[serviceName]
      if (!service) return
      child.effect(() => install(service), `dsh-scout ${serviceName}`)
    })
  }

  bindOptional('commands', service => (service as ScoutCommands).register({
    name: 'scout',
    description: 'Inspect a dsh-scout case: /scout status|questions|report|export <caseId>',
    handler: runScoutCommand,
  }))

  bindOptional('skills', service => (service as ScoutSkills).register({
    name: 'scout',
    description: 'Evidence-driven company and job due diligence with the dsh-scout tools.',
    whenToUse: 'When the user asks whether a company/role is worth pursuing, or wants a background check with sources and interview questions.',
    content: SCOUT_SKILL_CONTENT,
    invocation: { modelInvocable: true, userInvocable: true },
  }))
}

export * from './model.js'
