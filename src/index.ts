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
  importCaseFromFiles,
  renderReport,
  SOURCE_TYPES,
  type ScoutCase,
  type ScoutEvent,
  type ScoutSource,
  verifyClaim,
  verifyIdentity,
} from './model.js'

export const name = 'dsh-scout'
export const inject = ['tools', 'fs']

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

export function apply(ctx: Context) {
  const cases = new Map<string, ScoutCase>()
  const caseKey = (caseId: string, agentId: unknown) => `${String(agentId ?? 'unscoped')}::${caseId}`
  const requireCase = (key: string) => {
    const scoutCase = cases.get(key)
    if (!scoutCase) throw new Error(`Unknown case: ${key.split('::').at(-1)}`)
    return scoutCase
  }
  const fs = (ctx as unknown as { fs?: ScoutFs }).fs
  const recordEvent = (scoutCase: ScoutCase, type: ScoutEvent['type'], detail: Record<string, unknown>) =>
    appendEvent(scoutCase, {
      eventId: `evt-${(scoutCase.events?.length ?? 0) + 1}`,
      type,
      at: new Date().toISOString(),
      detail,
    })

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
        cases.set(key, recordEvent(scoutCase, 'case_started', {
          companyName: args.companyName,
          roleTitle: args.roleTitle,
          location: args.location || null,
        }))
        return JSON.stringify(scoutCase, null, 2)
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
        const nextCase = decideCase(addClaim(scoutCase, {
          claimId: args.claimId,
          text: args.text,
          status: args.status,
          evidenceLevel: args.evidenceLevel,
          dimension: args.dimension,
          impact: args.impact,
          sourceIds: args.sourceIds ? args.sourceIds.split(',').map(value => value.trim()).filter(Boolean) : [],
          confidenceNote: args.confidenceNote,
          nextAction: args.nextAction,
        }))
        cases.set(key, recordEvent(nextCase, 'claim_added', {
          claimId: args.claimId,
          status: args.status,
          evidenceLevel: args.evidenceLevel,
          dimension: args.dimension,
          impact: args.impact,
        }))
        return JSON.stringify(nextCase, null, 2)
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
      description: 'Persist a dsh-scout case as the durable five-file export (case.json, sources.json, claims.json, events.jsonl, report.md) into a target directory.',
      parameters: {
        caseId: { type: 'string', required: true, description: 'Existing case identifier.' },
        targetDir: { type: 'string', required: true, description: 'Directory path to write the five export files into.' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args, exec) {
        if (!fs) throw new Error('Filesystem service is unavailable in this host')
        const key = caseKey(args.caseId, exec.agent?.id)
        const scoutCase = requireCase(key)
        const files = exportCaseFiles(scoutCase)
        const target = await fs.resolve(args.targetDir)
        const written: string[] = []
        for (const name of EXPORT_FILE_NAMES) {
          const fileTarget = await fs.resolve(`${target.displayPath}/${name}`)
          await fs.writeText(fileTarget, files[name])
          written.push(name)
        }
        const nextCase = recordEvent(scoutCase, 'case_exported', { targetDir: target.displayPath })
        cases.set(key, nextCase)
        return JSON.stringify({
          caseId: args.caseId,
          targetDir: target.displayPath,
          files: written,
        }, null, 2)
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
        cases.set(key, recordEvent(addSource(scoutCase, source), 'source_added', {
          sourceId: source.sourceId,
          evidenceLevel: source.evidenceLevel,
        }))
        return JSON.stringify(source, null, 2)
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
        const nextCase = decideCase(verifyIdentity(scoutCase, {
          legalEntity: args.legalEntity,
          registrationNumber: args.registrationNumber,
          registeredRegion: args.registeredRegion,
          legalRepresentative: args.legalRepresentative,
          brandRelationship: args.brandRelationship,
          sourceIds: args.sourceIds.split(',').map(value => value.trim()).filter(Boolean),
        }))
        cases.set(key, recordEvent(nextCase, 'identity_verified', {
          legalEntity: args.legalEntity,
          registrationNumber: args.registrationNumber,
        }))
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
        const nextCase = decideCase(verifyClaim(scoutCase, {
          claimId: args.claimId,
          evidenceLevel: args.evidenceLevel,
          sourceIds: args.sourceIds.split(',').map(value => value.trim()).filter(Boolean),
          confidenceNote: args.confidenceNote,
          nextAction: args.nextAction,
        }))
        cases.set(key, recordEvent(nextCase, 'claim_verified', {
          claimId: args.claimId,
          evidenceLevel: args.evidenceLevel,
        }))
        return JSON.stringify(nextCase, null, 2)
      },
    }))
  }, 'dsh-scout tools')
}

export * from './model.js'
