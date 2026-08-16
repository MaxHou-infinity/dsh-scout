import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  addClaim,
  addSource,
  appendEvent,
  createCase,
  decideCase,
  exportCaseFiles,
  generateInterviewQuestions,
  importCaseFromFiles,
  inferEvidenceLevel,
  inferSourceType,
  isTrustedAuthorityUrl,
  renderReport,
  verifyClaim,
  verifyIdentity,
} from '../dist/model.js'
import { apply, inject, name } from '../dist/index.js'

test('starts conservatively until company identity is verified', () => {
  const scoutCase = createCase({
    caseId: 'demo',
    companyName: 'Example Co',
    roleTitle: 'HR Head',
  })

  assert.equal(scoutCase.decision, 'VERIFY')
  assert.equal(scoutCase.subject.identityStatus, 'needs_verification')
})

test('rejects claims that reference an unknown source', () => {
  const scoutCase = createCase({
    caseId: 'demo',
    companyName: 'Example Co',
    roleTitle: 'HR Head',
  })

  assert.throws(() => addClaim(scoutCase, {
    claimId: 'claim-1',
    text: 'The role has budget authority.',
    status: 'reported',
    evidenceLevel: 'E1',
    dimension: 'mandate',
    impact: 'blocking',
    sourceIds: ['missing'],
    confidenceNote: 'Only a reported statement is available.',
    nextAction: 'Ask the hiring manager.',
  }), /Unknown source/)
})

test('renders a sourced claim and preserves a VERIFY decision', () => {
  let scoutCase = createCase({
    caseId: 'demo',
    companyName: 'Example Co',
    roleTitle: 'HR Head',
  })
  scoutCase = addSource(scoutCase, {
    sourceId: 'job-posting',
    type: 'job_posting',
    title: 'Example job posting',
    url: 'https://example.com/job',
    capturedAt: '2026-08-14T00:00:00.000Z',
    evidenceLevel: 'E1',
    status: 'captured',
  })
  scoutCase = addClaim(scoutCase, {
    claimId: 'claim-1',
    text: 'The role may build the HR function from zero.',
    status: 'reported',
    evidenceLevel: 'E1',
    dimension: 'mandate',
    impact: 'blocking',
    sourceIds: ['job-posting'],
    confidenceNote: 'The job posting is a company-controlled source.',
    nextAction: 'Confirm the mandate and budget in the interview.',
  })
  scoutCase = decideCase(scoutCase)
  const report = renderReport(scoutCase)

  assert.equal(scoutCase.decision, 'VERIFY')
  assert.match(report, /Example Co — HR Head/)
  assert.match(report, /job-posting/)
  assert.match(report, /Confirm the mandate/)
  assert.match(report, /Blocking or unresolved risks/)
  assert.match(report, /Role task and authority hypotheses/)
  assert.match(report, /Interview questions/)
})

test('requires an E3 source to verify company identity', () => {
  let scoutCase = createCase({
    caseId: 'demo',
    companyName: 'Example Co',
    roleTitle: 'HR Head',
  })
  scoutCase = addSource(scoutCase, {
    sourceId: 'registry',
    type: 'company_registry',
    title: 'Official registry record',
    url: 'https://www.gsxt.gov.cn/registry/REG-123',
    capturedAt: '2026-08-14T00:00:00.000Z',
    evidenceLevel: 'E3',
    status: 'captured',
  })
  scoutCase = verifyIdentity(scoutCase, {
    legalEntity: 'Example Company Limited',
    registrationNumber: 'REG-123',
    registeredRegion: 'Shenzhen',
    legalRepresentative: 'Example Person',
    brandRelationship: 'Example Co is the registered brand of the legal entity.',
    sourceIds: ['registry'],
  })
  scoutCase = addClaim(scoutCase, {
    claimId: 'claim-1',
    text: 'The registry confirms the company identity.',
    status: 'verified',
    evidenceLevel: 'E3',
    dimension: 'identity',
    impact: 'material',
    sourceIds: ['registry'],
    confidenceNote: 'The linked registry record contains the legal entity identifiers.',
    nextAction: 'Use the verified entity for subsequent research.',
  })
  scoutCase = decideCase(scoutCase)

  assert.equal(scoutCase.subject.identityStatus, 'verified')
  assert.equal(scoutCase.subject.possibleLegalEntity, 'Example Company Limited')
  assert.deepEqual(scoutCase.subject.identitySourceIds, ['registry'])
  assert.equal(scoutCase.decision, 'VERIFY')
})

test('rejects a self-labelled E3 source that is not from a trusted authority origin', () => {
  const scoutCase = createCase({
    caseId: 'demo',
    companyName: 'Example Co',
    roleTitle: 'HR Head',
  })
  assert.throws(() => addSource(scoutCase, {
    sourceId: 'blog',
    type: 'other',
    title: 'Unverified blog post',
    url: 'https://example.com/blog',
    capturedAt: '2026-08-14T00:00:00.000Z',
    evidenceLevel: 'E3',
    status: 'captured',
  }), /supported registry, regulator, or official filing/)
})

test('rejects verified claims backed only by E0 evidence', () => {
  let scoutCase = createCase({
    caseId: 'demo',
    companyName: 'Example Co',
    roleTitle: 'HR Head',
  })
  scoutCase = addSource(scoutCase, {
    sourceId: 'guess',
    type: 'other',
    title: 'Model guess',
    url: null,
    capturedAt: null,
    evidenceLevel: 'E0',
    status: 'captured',
  })

  assert.throws(() => addClaim(scoutCase, {
    claimId: 'role',
    text: 'The role exists.',
    status: 'verified',
    evidenceLevel: 'E0',
    dimension: 'role_existence',
    impact: 'blocking',
    sourceIds: ['guess'],
    confidenceNote: 'No evidence exists.',
    nextAction: 'Confirm the role with a real source.',
  }), /at least E1 evidence/)
})

test('rejects a claim whose evidence level exceeds its sources', () => {
  let scoutCase = createCase({
    caseId: 'demo',
    companyName: 'Example Co',
    roleTitle: 'HR Head',
  })
  scoutCase = addSource(scoutCase, {
    sourceId: 'job-posting',
    type: 'job_posting',
    title: 'Example job posting',
    url: 'https://example.com/job',
    capturedAt: '2026-08-14T00:00:00.000Z',
    evidenceLevel: 'E1',
    status: 'captured',
  })

  assert.throws(() => addClaim(scoutCase, {
    claimId: 'claim-1',
    text: 'This claim overstates its source strength.',
    status: 'verified',
    evidenceLevel: 'E3',
    dimension: 'risk',
    impact: 'material',
    sourceIds: ['job-posting'],
    confidenceNote: 'The source does not justify an E3 label.',
    nextAction: 'Find an authoritative source.',
  }), /exceeds its strongest source/)
})

test('replays the Snapmaker fixture offline with a stable VERIFY result', () => {
  const fixture = JSON.parse(readFileSync(
    new URL('../docs/fixtures/dsh-scout/snapmaker-hr-head.json', import.meta.url),
    'utf8',
  ))
  let scoutCase = createCase({
    caseId: fixture.caseId,
    companyName: fixture.subject.name,
    roleTitle: fixture.role.title,
    location: fixture.role.location,
    decisionObjective: fixture.decisionObjective,
  })
  for (const source of fixture.sources) scoutCase = addSource(scoutCase, source)
  for (const claim of fixture.claims) scoutCase = addClaim(scoutCase, claim)
  scoutCase = decideCase(scoutCase)

  const report = renderReport(scoutCase)
  assert.equal(scoutCase.decision, fixture.expectedDecision)
  assert.match(report, /历史材料不能替代运行时实时核验|公司主体仍未核验/)
  assert.match(report, /Interview questions/)
  assert.equal(scoutCase.interviewQuestions.length, 5)
})

test('verifies a claim and preserves its previous evidence state', () => {
  let scoutCase = createCase({
    caseId: 'demo',
    companyName: 'Example Co',
    roleTitle: 'HR Head',
  })
  scoutCase = addClaim(scoutCase, {
    claimId: 'claim-identity',
    text: 'The legal entity matches the brand.',
    status: 'needs_verification',
    evidenceLevel: 'E0',
    dimension: 'identity',
    impact: 'blocking',
    sourceIds: [],
    confidenceNote: 'No current registry evidence has been attached.',
    nextAction: 'Check the official registry.',
  })
  scoutCase = addSource(scoutCase, {
    sourceId: 'registry',
    type: 'company_registry',
    title: 'Official registry record',
    url: 'https://www.gsxt.gov.cn/registry/REG-123',
    capturedAt: '2026-08-14T00:00:00.000Z',
    evidenceLevel: 'E3',
    status: 'captured',
  })
  scoutCase = verifyClaim(scoutCase, {
    claimId: 'claim-identity',
    evidenceLevel: 'E3',
    sourceIds: ['registry'],
    confidenceNote: 'The registry source resolves the prior identity uncertainty.',
    nextAction: 'Use the legal entity in all subsequent searches.',
  })

  const claim = scoutCase.claims[0]
  assert.equal(claim.status, 'verified')
  assert.deepEqual(claim.sourceIds, ['registry'])
  assert.deepEqual(claim.history?.[0].sourceIds, [])
  assert.equal(claim.history?.[0].status, 'needs_verification')
  assert.match(claim.history?.[0].confidenceNote, /No current registry/)
})

test('only proceeds after identity and all required role dimensions are verified', () => {
  let scoutCase = createCase({
    caseId: 'demo',
    companyName: 'Example Co',
    roleTitle: 'HR Head',
  })
  scoutCase = addSource(scoutCase, {
    sourceId: 'registry',
    type: 'company_registry',
    title: 'Official registry record',
    url: 'https://www.gsxt.gov.cn/registry/REG-123',
    capturedAt: '2026-08-14T00:00:00.000Z',
    evidenceLevel: 'E3',
    status: 'captured',
  })
  scoutCase = addSource(scoutCase, {
    sourceId: 'interview',
    type: 'user_provided',
    title: 'Hiring manager interview notes',
    url: null,
    capturedAt: '2026-08-14T00:00:00.000Z',
    evidenceLevel: 'E1',
    status: 'captured',
  })
  scoutCase = verifyIdentity(scoutCase, {
    legalEntity: 'Example Company Limited',
    registrationNumber: 'REG-123',
    registeredRegion: 'Shenzhen',
    legalRepresentative: 'Example Person',
    brandRelationship: 'Example Co is the registered brand of the legal entity.',
    sourceIds: ['registry'],
  })
  for (const [claimId, dimension, text] of [
    ['role', 'role_existence', 'The open role is confirmed.'],
    ['reporting', 'reporting_line', 'The role reports to the CEO.'],
    ['mandate', 'mandate', 'The role owns the approved people roadmap.'],
  ]) {
    scoutCase = addClaim(scoutCase, {
      claimId,
      text,
      status: 'verified',
      evidenceLevel: 'E1',
      dimension,
      impact: 'blocking',
      sourceIds: ['interview'],
      confidenceNote: 'The hiring manager confirmed this point directly.',
      nextAction: 'Reconfirm it in the written offer or next interview.',
    })
  }

  assert.equal(decideCase(scoutCase).decision, 'PROCEED')
})

test('isolates identical case ids by DSH agent session identity', async () => {
  const registered = []
  apply({
    tools: {
      register(tool) {
        registered.push(tool)
        return () => undefined
      },
    },
    effect(execute) {
      Array.from(execute())
    },
  })
  const tools = new Map(registered.map(tool => [tool.name, tool]))
  const start = tools.get('scout_start')
  const report = tools.get('scout_report')

  await start.execute({
    caseId: 'same-id',
    companyName: 'Company A',
    roleTitle: 'Role A',
    location: '',
  }, { agent: { id: 'session-a' } })
  await start.execute({
    caseId: 'same-id',
    companyName: 'Company B',
    roleTitle: 'Role B',
    location: '',
  }, { agent: { id: 'session-b' } })

  const reportA = await report.execute({ caseId: 'same-id' }, { agent: { id: 'session-a' } })
  const reportB = await report.execute({ caseId: 'same-id' }, { agent: { id: 'session-b' } })
  assert.match(reportA, /Company A — Role A/)
  assert.doesNotMatch(reportA, /Company B/)
  assert.match(reportB, /Company B — Role B/)
})

test('renders an evidence summary, source URLs, and a prioritized verification checklist', () => {
  let scoutCase = createCase({
    caseId: 'demo',
    companyName: 'Example Co',
    roleTitle: 'HR Head',
  })
  scoutCase = addSource(scoutCase, {
    sourceId: 'job-posting',
    type: 'job_posting',
    title: 'Example job posting',
    url: 'https://example.com/job',
    capturedAt: '2026-08-14T00:00:00.000Z',
    evidenceLevel: 'E1',
    status: 'captured',
  })
  scoutCase = addClaim(scoutCase, {
    claimId: 'claim-role',
    text: 'The role exists.',
    status: 'reported',
    evidenceLevel: 'E1',
    dimension: 'role_existence',
    impact: 'blocking',
    sourceIds: ['job-posting'],
    confidenceNote: 'The job posting is a company-controlled source.',
    nextAction: 'Confirm the mandate and budget in the interview.',
  })
  scoutCase = addClaim(scoutCase, {
    claimId: 'claim-risk',
    text: 'A litigation risk is reported.',
    status: 'reported',
    evidenceLevel: 'E1',
    dimension: 'risk',
    impact: 'material',
    sourceIds: ['job-posting'],
    confidenceNote: 'A media report mentions the risk.',
    nextAction: 'Check the court docket.',
  })
  const report = renderReport(scoutCase)

  assert.match(report, /证据概况：2 reported/)
  assert.match(report, /https:\/\/example\.com\/job/)
  assert.match(report, /## Verification checklist/)
  const checklistStart = report.indexOf('## Verification checklist')
  const checklist = report.slice(checklistStart, report.indexOf('## Claim ledger'))
  assert.ok(checklist.indexOf('[blocking]') < checklist.indexOf('[material]'), 'blocking items rank before material')
  assert.match(checklist, /→ 下一步：Confirm the mandate/)
})

test('exports a disposable DSH plugin tool surface', async () => {  const registered = []
  const disposed = []
  const effects = []
  apply({
    tools: {
      register(tool) {
        registered.push(tool)
        return () => disposed.push(tool.name)
      },
    },
    effect(execute) {
      effects.push(...execute())
    },
  })

  assert.equal(name, 'dsh-scout')
  assert.deepEqual(inject, ['tools', 'fs'])
  assert.deepEqual(
    registered.map(tool => tool.name).sort(),
    [
      'scout_add_claim',
      'scout_add_source',
      'scout_export',
      'scout_import',
      'scout_ingest',
      'scout_questions',
      'scout_report',
      'scout_start',
      'scout_verify_claim',
      'scout_verify_identity',
    ],
  )

  for (const dispose of effects.reverse()) dispose()
  assert.deepEqual(disposed.sort(), registered.map(tool => tool.name).sort())
})

test('round-trips a case through the five-file export', () => {
  let scoutCase = createCase({
    caseId: 'demo',
    companyName: 'Example Co',
    roleTitle: 'HR Head',
  })
  scoutCase = appendEvent(scoutCase, {
    eventId: 'evt-1',
    type: 'case_started',
    at: '2026-08-16T00:00:00.000Z',
    detail: { companyName: 'Example Co' },
  })
  scoutCase = addSource(scoutCase, {
    sourceId: 'job-posting',
    type: 'job_posting',
    title: 'Example job posting',
    url: 'https://example.com/job',
    capturedAt: '2026-08-14T00:00:00.000Z',
    evidenceLevel: 'E1',
    status: 'captured',
  })
  scoutCase = addClaim(scoutCase, {
    claimId: 'claim-1',
    text: 'The role exists.',
    status: 'reported',
    evidenceLevel: 'E1',
    dimension: 'role_existence',
    impact: 'blocking',
    sourceIds: ['job-posting'],
    confidenceNote: 'The job posting is a company-controlled source.',
    nextAction: 'Confirm the mandate in the interview.',
  })
  scoutCase = decideCase(scoutCase)

  const files = exportCaseFiles(scoutCase)
  assert.deepEqual(Object.keys(files).sort(), ['case.json', 'claims.json', 'events.jsonl', 'report.md', 'sources.json'])
  assert.match(files['report.md'], /## Verification checklist/)
  assert.match(files['events.jsonl'], /"type":"case_started"/)

  const restored = importCaseFromFiles(files)
  assert.equal(restored.caseId, 'demo')
  assert.equal(restored.subject.name, 'Example Co')
  assert.equal(restored.sources[0].sourceId, 'job-posting')
  assert.equal(restored.claims[0].claimId, 'claim-1')
  assert.equal(restored.events?.[0].type, 'case_started')
  assert.equal(restored.decision, 'VERIFY')
})

test('rejects an incomplete or mismatched export payload', () => {
  const files = exportCaseFiles(createCase({ caseId: 'demo', companyName: 'Example Co', roleTitle: 'HR Head' }))
  delete files['sources.json']
  assert.throws(() => importCaseFromFiles(files), /Missing export files/)
  const intact = exportCaseFiles(createCase({ caseId: 'demo', companyName: 'Example Co', roleTitle: 'HR Head' }))
  assert.throws(() => importCaseFromFiles({ ...intact, 'case.json': JSON.stringify({ schemaVersion: 'dsh-scout.case.v1' }) }), /Unsupported schema/)
})

test('exports and imports a case through the fs-backed tools', async () => {
  const registered = []
  const store = new Map()
  const mockFs = {
    async resolve(path) {
      return { targetKey: path, displayPath: path }
    },
    async readText(target) {
      if (!store.has(target.displayPath)) throw new Error(`not found: ${target.displayPath}`)
      return store.get(target.displayPath)
    },
    async writeText(target, content) {
      store.set(target.displayPath, content)
      return { operation: 'create' }
    },
  }
  apply({
    tools: {
      register(tool) {
        registered.push(tool)
        return () => undefined
      },
    },
    fs: mockFs,
    effect(execute) {
      Array.from(execute())
    },
  })
  const tools = new Map(registered.map(tool => [tool.name, tool]))
  const start = tools.get('scout_start')
  const addSourceTool = tools.get('scout_add_source')
  const addClaimTool = tools.get('scout_add_claim')
  const exportTool = tools.get('scout_export')
  const importTool = tools.get('scout_import')

  await start.execute({
    caseId: 'persisted',
    companyName: 'Example Co',
    roleTitle: 'HR Head',
    location: 'Shenzhen',
  }, { agent: { id: 'session-a' } })
  await addSourceTool.execute({
    caseId: 'persisted',
    sourceId: 'job-posting',
    sourceType: 'job_posting',
    title: 'Example job posting',
    url: 'https://example.com/job',
    evidenceLevel: 'E1',
  }, { agent: { id: 'session-a' } })
  await addClaimTool.execute({
    caseId: 'persisted',
    claimId: 'claim-1',
    text: 'The role exists.',
    status: 'reported',
    evidenceLevel: 'E1',
    dimension: 'role_existence',
    impact: 'blocking',
    sourceIds: 'job-posting',
    confidenceNote: 'The job posting is a company-controlled source.',
    nextAction: 'Confirm the mandate in the interview.',
  }, { agent: { id: 'session-a' } })

  const exportResult = JSON.parse(await exportTool.execute({
    caseId: 'persisted',
    targetDir: '/tmp/scout-cases/persisted',
  }, { agent: { id: 'session-a' } }))
  assert.equal(exportResult.files.length, 5)
  assert.equal(store.size, 5)
  assert.ok(store.has('/tmp/scout-cases/persisted/case.json'))

  const importResult = JSON.parse(await importTool.execute({
    caseId: 'persisted',
    sourceDir: '/tmp/scout-cases/persisted',
  }, { agent: { id: 'session-a' } }))
  assert.equal(importResult.caseId, 'persisted')
  assert.equal(importResult.sources.length, 1)
  assert.equal(importResult.claims.length, 1)
  assert.ok(importResult.events?.some(event => event.type === 'case_imported'))
  assert.equal(importResult.decision, 'VERIFY')
})

test('generates a deduplicated, prioritized interview question list', () => {
  let scoutCase = createCase({
    caseId: 'demo',
    companyName: 'Example Co',
    roleTitle: 'HR Head',
  })
  scoutCase = addSource(scoutCase, {
    sourceId: 'job-posting',
    type: 'job_posting',
    title: 'Example job posting',
    url: 'https://example.com/job',
    capturedAt: '2026-08-14T00:00:00.000Z',
    evidenceLevel: 'E1',
    status: 'captured',
  })
  scoutCase = addClaim(scoutCase, {
    claimId: 'claim-role',
    text: 'The role exists.',
    status: 'reported',
    evidenceLevel: 'E1',
    dimension: 'role_existence',
    impact: 'blocking',
    sourceIds: ['job-posting'],
    confidenceNote: 'A source describes the role.',
    nextAction: 'Confirm the mandate in the interview.',
  })
  scoutCase = addClaim(scoutCase, {
    claimId: 'claim-reporting',
    text: 'Reporting line is unknown.',
    status: 'unknown',
    evidenceLevel: 'E0',
    dimension: 'reporting_line',
    impact: 'blocking',
    sourceIds: [],
    confidenceNote: 'No source discloses the reporting line.',
    nextAction: 'Ask who this role reports to.',
  })

  const questions = generateInterviewQuestions(scoutCase)
  assert.ok(questions.includes('Confirm the mandate in the interview.'))
  assert.ok(questions.includes('Ask who this role reports to.'))
  // missing verified mandate dimension gets its default question
  assert.ok(questions.some(q => q.includes('最终决定权')))
  // defaults are appended and deduplicated
  assert.ok(questions.includes(scoutCase.interviewQuestions[0]))
  assert.equal(new Set(questions).size, questions.length)
  assert.ok(questions.length <= 12)
})

test('auto-persists each mutation when configured, and exports to the default dir', async () => {
  const registered = []
  const store = new Map()
  const mockFs = {
    async resolve(path) {
      return { targetKey: path, displayPath: path }
    },
    async readText(target) {
      if (!store.has(target.displayPath)) throw new Error(`not found: ${target.displayPath}`)
      return store.get(target.displayPath)
    },
    async writeText(target, content) {
      store.set(target.displayPath, content)
      return { operation: 'create' }
    },
  }
  apply({
    tools: {
      register(tool) {
        registered.push(tool)
        return () => undefined
      },
    },
    fs: mockFs,
    effect(execute) {
      Array.from(execute())
    },
  }, { scoutDir: '/tmp/scout-cases', autoPersist: true })
  const tools = new Map(registered.map(tool => [tool.name, tool]))
  const start = tools.get('scout_start')
  const exportTool = tools.get('scout_export')

  await start.execute({
    caseId: 'auto',
    companyName: 'Example Co',
    roleTitle: 'HR Head',
    location: '',
  }, { agent: { id: 'session-a' } })

  // autoPersist wrote the five files under scoutDir/<caseId>
  assert.ok(store.has('/tmp/scout-cases/auto/case.json'))
  assert.ok(store.has('/tmp/scout-cases/auto/report.md'))
  assert.equal(store.size, 5)

  // export without targetDir uses the configured scoutDir/<caseId>
  const exportResult = JSON.parse(await exportTool.execute({
    caseId: 'auto',
  }, { agent: { id: 'session-a' } }))
  assert.equal(exportResult.targetDir, '/tmp/scout-cases/auto')
  assert.equal(exportResult.persisted, true)
  assert.equal(exportResult.files.length, 5)
})

test('scout_questions tool returns the derived question list', async () => {
  const registered = []
  apply({
    tools: {
      register(tool) {
        registered.push(tool)
        return () => undefined
      },
    },
    effect(execute) {
      Array.from(execute())
    },
  })
  const tools = new Map(registered.map(tool => [tool.name, tool]))
  const start = tools.get('scout_start')
  const questions = tools.get('scout_questions')
  await start.execute({
    caseId: 'demo',
    companyName: 'Example Co',
    roleTitle: 'HR Head',
    location: '',
  }, { agent: { id: 'session-a' } })
  const result = JSON.parse(await questions.execute({ caseId: 'demo' }, { agent: { id: 'session-a' } }))
  assert.ok(Array.isArray(result))
  assert.ok(result.length >= 5)
})

test('auto-persist and default export dir degrade gracefully without fs or scoutDir', async () => {
  // autoPersist enabled but no fs service: mutations still succeed
  const noFs = []
  apply({
    tools: { register(tool) { noFs.push(tool); return () => undefined } },
    effect(execute) { Array.from(execute()) },
  }, { scoutDir: '/nowhere', autoPersist: true })
  const startNoFs = new Map(noFs.map(t => [t.name, t])).get('scout_start')
  const started = JSON.parse(await startNoFs.execute({
    caseId: 'no-fs',
    companyName: 'Example Co',
    roleTitle: 'HR Head',
    location: '',
  }, { agent: { id: 'session-a' } }))
  assert.equal(started.caseId, 'no-fs')
  assert.ok(started.events?.some(e => e.type === 'case_started'))

  // no scoutDir configured: export without targetDir falls back to ./dsh-scout/<caseId>
  const registered = []
  const store = new Map()
  const mockFs = {
    async resolve(path) { return { targetKey: path, displayPath: path } },
    async readText(target) {
      if (!store.has(target.displayPath)) throw new Error(`not found: ${target.displayPath}`)
      return store.get(target.displayPath)
    },
    async writeText(target, content) { store.set(target.displayPath, content); return { operation: 'create' } },
  }
  apply({
    tools: { register(tool) { registered.push(tool); return () => undefined } },
    fs: mockFs,
    effect(execute) { Array.from(execute()) },
  })
  const tools = new Map(registered.map(t => [t.name, t]))
  await tools.get('scout_start').execute({
    caseId: 'default-dir',
    companyName: 'Example Co',
    roleTitle: 'HR Head',
    location: '',
  }, { agent: { id: 'session-a' } })
  const exported = JSON.parse(await tools.get('scout_export').execute(
    { caseId: 'default-dir' },
    { agent: { id: 'session-a' } },
  ))
  assert.equal(exported.targetDir, 'dsh-scout/default-dir')
  assert.ok(store.has('dsh-scout/default-dir/case.json'))
})

test('covers question-generation, duplicate-id, authority-url, and import edge cases', () => {
  // empty case: 3 missing-dimension questions + 5 defaults = 8
  const empty = createCase({ caseId: 'e', companyName: 'C', roleTitle: 'R' })
  assert.equal(generateInterviewQuestions(empty).length, 8)

  // fully verified role dimensions: only the 5 defaults remain
  let verifiedCase = createCase({ caseId: 'v', companyName: 'C', roleTitle: 'R' })
  verifiedCase = addSource(verifiedCase, {
    sourceId: 's1', type: 'user_provided', title: 'notes', url: null,
    capturedAt: '2026-08-16T00:00:00.000Z', evidenceLevel: 'E1', status: 'captured',
  })
  for (const [claimId, dimension] of [
    ['role', 'role_existence'], ['reporting', 'reporting_line'], ['mandate', 'mandate'],
  ]) {
    verifiedCase = addClaim(verifiedCase, {
      claimId, text: 'confirmed', status: 'verified', evidenceLevel: 'E1', dimension,
      impact: 'blocking', sourceIds: ['s1'], confidenceNote: 'direct', nextAction: 'done',
    })
  }
  const verifiedQuestions = generateInterviewQuestions(verifiedCase)
  assert.equal(verifiedQuestions.length, 5)

  // blank nextAction is filtered and the 12-item cap truncates
  let capped = createCase({ caseId: 'c', companyName: 'C', roleTitle: 'R' })
  capped = addSource(capped, {
    sourceId: 's1', type: 'user_provided', title: 'notes', url: null,
    capturedAt: '2026-08-16T00:00:00.000Z', evidenceLevel: 'E1', status: 'captured',
  })
  for (let i = 0; i < 20; i += 1) {
    capped = addClaim(capped, {
      claimId: `c${i}`, text: `pending ${i}`, status: 'reported', evidenceLevel: 'E1',
      dimension: 'risk', impact: 'material', sourceIds: ['s1'],
      confidenceNote: 'media', nextAction: i === 0 ? '   ' : `action ${i}`,
    })
  }
  const cappedQuestions = generateInterviewQuestions(capped)
  assert.equal(cappedQuestions.length, 12)
  assert.ok(!cappedQuestions.some(q => q.trim() === '   '))

  // duplicate ids are rejected at the model layer (pure functions return new cases)
  let dup = createCase({ caseId: 'd', companyName: 'C', roleTitle: 'R' })
  const source = {
    sourceId: 's1', type: 'job_posting', title: 'posting', url: null,
    capturedAt: '2026-08-16T00:00:00.000Z', evidenceLevel: 'E1', status: 'captured',
  }
  dup = addSource(dup, source)
  assert.throws(() => addSource(dup, source), /Duplicate source/)
  const claim = {
    claimId: 'c1', text: 'x', status: 'unknown', evidenceLevel: 'E0', dimension: 'risk',
    impact: 'material', sourceIds: [], confidenceNote: '', nextAction: '',
  }
  dup = addClaim(dup, claim)
  assert.throws(() => addClaim(dup, claim), /Duplicate claim/)
  const event = { eventId: 'evt-1', type: 'case_started', at: '2026-08-16T00:00:00.000Z', detail: {} }
  dup = appendEvent(dup, event)
  assert.throws(() => appendEvent(dup, event), /Duplicate event/)

  // trusted-authority URL rejections
  assert.equal(isTrustedAuthorityUrl('http://www.gsxt.gov.cn/'), false)
  assert.equal(isTrustedAuthorityUrl('https://www.gsxt.gov.cn:8080/'), false)
  assert.equal(isTrustedAuthorityUrl('https://user:pass@www.gsxt.gov.cn/'), false)
  assert.equal(isTrustedAuthorityUrl('https://example.com/'), false)
  assert.equal(isTrustedAuthorityUrl(null), false)
  assert.equal(isTrustedAuthorityUrl('https://www.gsxt.gov.cn/'), true)

  // import rejects malformed claim entries and wraps JSON syntax errors
  const files = exportCaseFiles(createCase({ caseId: 'x', companyName: 'C', roleTitle: 'R' }))
  assert.throws(() => importCaseFromFiles({ ...files, 'claims.json': JSON.stringify([{ claimId: 'c1' }]) }), /Invalid claim entry/)
  assert.throws(() => importCaseFromFiles({ ...files, 'case.json': '{not json' }), /Invalid case\.json/)
})

test('infers source type and evidence level from URLs', () => {
  // official registry/regulator origins
  assert.deepEqual(inferSourceType('https://www.gsxt.gov.cn/foo'), { type: 'company_registry', inferred: true })
  assert.deepEqual(inferSourceType('https://example.gov.cn/'), { type: 'regulator', inferred: true })
  assert.deepEqual(inferEvidenceLevel('https://www.gsxt.gov.cn/foo', 'company_registry'), { evidenceLevel: 'E3', inferred: true })
  // job platforms
  assert.deepEqual(inferSourceType('https://m.liepin.com/job/1.shtml'), { type: 'job_posting', inferred: true })
  assert.deepEqual(inferEvidenceLevel('https://m.liepin.com/job/1.shtml', 'job_posting'), { evidenceLevel: 'E2', inferred: true })
  // unknown origins
  assert.deepEqual(inferSourceType('https://example.com/article'), { type: 'other', inferred: true })
  assert.deepEqual(inferEvidenceLevel('https://example.com/article', 'other'), { evidenceLevel: 'E2', inferred: true })
  // user-provided
  assert.deepEqual(inferEvidenceLevel(null, 'user_provided'), { evidenceLevel: 'E1', inferred: true })
  // explicit values win and are not marked inferred
  assert.deepEqual(inferSourceType('https://example.com/', 'independent_media'), { type: 'independent_media', inferred: false })
  assert.deepEqual(inferEvidenceLevel('https://example.com/', 'job_posting', 'E1'), { evidenceLevel: 'E1', inferred: false })
})

test('scout_ingest batch-registers sources with inference and isolates errors', async () => {
  const registered = []
  apply({
    tools: { register(tool) { registered.push(tool); return () => undefined } },
    effect(execute) { Array.from(execute()) },
  })
  const tools = new Map(registered.map(t => [t.name, t]))
  await tools.get('scout_start').execute({
    caseId: 'ingest',
    companyName: 'Example Co',
    roleTitle: 'HR Head',
    location: '',
  }, { agent: { id: 'session-a' } })

  const result = JSON.parse(await tools.get('scout_ingest').execute({
    caseId: 'ingest',
    itemsJson: JSON.stringify([
      { url: 'https://www.gsxt.gov.cn/registry/1', title: 'Registry record' },
      { url: 'https://m.liepin.com/job/2.shtml' },
      { url: 'https://example.com/blog' },
      { url: 'https://not-e3.example.com/', sourceType: 'company_registry', evidenceLevel: 'E3' },
      { url: '' },
    ]),
  }, { agent: { id: 'session-a' } }))

  assert.equal(result.added.length, 3)
  assert.equal(result.errors.length, 2)
  assert.deepEqual(result.added[0], {
    sourceId: 'src-1', title: 'Registry record', url: 'https://www.gsxt.gov.cn/registry/1',
    type: 'company_registry', evidenceLevel: 'E3',
    inferred: { type: true, evidenceLevel: true },
  })
  assert.equal(result.added[1].type, 'job_posting')
  assert.equal(result.added[1].evidenceLevel, 'E2')
  assert.equal(result.added[2].type, 'other')
  // the invalid E3 item is isolated in errors and does not abort the batch
  assert.match(result.errors[0].error, /E3 sources require/)
  assert.equal(result.errors[1].error, 'url is required')

  // sources are registered in the case and carry events
  const report = await tools.get('scout_report').execute({ caseId: 'ingest' }, { agent: { id: 'session-a' } })
  assert.match(report, /src-1/)
  assert.match(report, /src-3/)
  assert.doesNotMatch(report, /src-4/)
})
