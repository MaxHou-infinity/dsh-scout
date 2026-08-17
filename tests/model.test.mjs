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
  renderComparison,
  renderReport,
  verifyClaim,
  verifyIdentity,
} from '../dist/model.js'
import { apply, Config, inject, name } from '../dist/index.js'

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
    get(name) { return this[name] },
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
    get(name) { return this[name] },
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
  assert.deepEqual(inject, ['tools'])
  assert.deepEqual(
    registered.map(tool => tool.name).sort(),
    [
      'scout_add_claim',
      'scout_add_source',
      'scout_compare',
      'scout_export',
      'scout_import',
      'scout_ingest',
      'scout_questions',
      'scout_report',
      'scout_search',
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
    get(name) { return this[name] },
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
    get(name) { return this[name] },
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
    get(name) { return this[name] },
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
    get(name) { return this[name] },
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
    get(name) { return this[name] },
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
    get(name) { return this[name] },
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

test('scout_ingest isolates null items and invalid explicit enums, and avoids substring false positives', async () => {
  // substring false positives are gone
  assert.deepEqual(inferSourceType('https://notaboss.example.com/'), { type: 'other', inferred: true })
  assert.deepEqual(inferSourceType('https://www.zhipin.com/job/1.html'), { type: 'job_posting', inferred: true })
  assert.deepEqual(inferSourceType('https://bambulab.jobs.feishu.cn/position/1'), { type: 'job_posting', inferred: true })
  assert.deepEqual(inferSourceType('https://www.liepin.com/job/1.shtml'), { type: 'job_posting', inferred: true })

  const registered = []
  apply({
    get(name) { return this[name] },
    tools: { register(tool) { registered.push(tool); return () => undefined } },
    effect(execute) { Array.from(execute()) },
  })
  const tools = new Map(registered.map(t => [t.name, t]))
  await tools.get('scout_start').execute({
    caseId: 'robust', companyName: 'Example Co', roleTitle: 'HR Head', location: '',
  }, { agent: { id: 'session-a' } })

  const result = JSON.parse(await tools.get('scout_ingest').execute({
    caseId: 'robust',
    itemsJson: JSON.stringify([
      null,
      { url: 'https://m.liepin.com/job/1.shtml' },
      { url: 'https://www.gsxt.gov.cn/registry/1' },
      { url: 'https://example.com/x', sourceType: 'regulatory_typo' },
      { url: 'https://example.com/y', evidenceLevel: 'E9' },
    ]),
  }, { agent: { id: 'session-a' } }))

  // null item and invalid explicit enums are isolated; valid items still registered
  assert.equal(result.added.length, 2)
  assert.equal(result.errors.length, 3)
  assert.equal(result.errors[0].error, 'item must be an object')
  assert.match(result.errors[1].error, /invalid sourceType/)
  assert.match(result.errors[2].error, /invalid evidenceLevel/)
  assert.equal(result.added[0].type, 'job_posting')
  assert.equal(result.added[1].type, 'company_registry')
  assert.equal(result.added[1].evidenceLevel, 'E3')

  // the previously added sources survive the batch
  const report = await tools.get('scout_report').execute({ caseId: 'robust' }, { agent: { id: 'session-a' } })
  assert.match(report, /src-1/)
  assert.match(report, /src-2/)
  assert.doesNotMatch(report, /src-3/)
})

test('renders a side-by-side comparison of two cases', () => {
  const makeCase = (caseId, companyName, verifiedIdentity) => {
    let scoutCase = createCase({
      caseId, companyName, roleTitle: 'HR Head', location: 'Shenzhen',
    })
    scoutCase = addSource(scoutCase, {
      sourceId: 's1', type: 'job_posting', title: 'posting', url: 'https://example.com/job',
      capturedAt: '2026-08-16T00:00:00.000Z', evidenceLevel: 'E1', status: 'captured',
    })
    scoutCase = addClaim(scoutCase, {
      claimId: 'c1', text: `${companyName} pays 30k.`, status: 'reported', evidenceLevel: 'E1',
      dimension: 'mandate', impact: 'material', sourceIds: ['s1'],
      confidenceNote: 'reported', nextAction: 'Confirm in interview.',
    })
    scoutCase = addClaim(scoutCase, {
      claimId: 'c2', text: `${companyName} has a legal risk.`, status: 'unknown', evidenceLevel: 'E0',
      dimension: 'risk', impact: 'blocking', sourceIds: [],
      confidenceNote: 'unknown', nextAction: 'Check the docket.',
    })
    if (verifiedIdentity) {
      scoutCase = addSource(scoutCase, {
        sourceId: 'reg', type: 'company_registry', title: 'registry', url: 'https://www.gsxt.gov.cn/r',
        capturedAt: '2026-08-16T00:00:00.000Z', evidenceLevel: 'E3', status: 'captured',
      })
      scoutCase = verifyIdentity(scoutCase, {
        legalEntity: companyName, registrationNumber: 'REG-1', registeredRegion: 'Shenzhen',
        legalRepresentative: 'P', brandRelationship: 'brand', sourceIds: ['reg'],
      })
    }
    return decideCase(scoutCase)
  }
  const caseA = makeCase('a', 'Company A', true)
  const caseB = makeCase('b', 'Company B', false)

  const report = renderComparison([caseA, caseB])
  assert.match(report, /# 公司\/岗位对比（2 个案例）/)
  assert.match(report, /## 决策与主体核验对比/)
  assert.match(report, /Company A — HR Head \| VERIFY \| ✅ 已核验/)
  assert.match(report, /Company B — HR Head \| VERIFY \| ⚠️ 待核验/)
  assert.match(report, /### Company A — HR Head（a）/)
  assert.match(report, /### Company B — HR Head（b）/)
  assert.match(report, /Company A pays 30k\./)
  assert.match(report, /Company B has a legal risk\./)
  assert.match(report, /## 面试问题（合并去重，前 12 条）/)

  assert.throws(() => renderComparison([caseA]), /at least two/)
  const five = [caseA, caseB, caseA, caseB, caseA, caseB]
  assert.throws(() => renderComparison(five), /at most five/)
})

test('scout_compare tool compares cases and inference rejects invalid explicit enums', async () => {
  // model-layer enum defense (review L3)
  assert.deepEqual(inferSourceType('https://example.com/', 'not_a_type'), { type: 'other', inferred: true })
  assert.deepEqual(inferEvidenceLevel('https://example.com/', 'job_posting', 'E9'), { evidenceLevel: 'E2', inferred: true })

  const registered = []
  apply({
    get(name) { return this[name] },
    tools: { register(tool) { registered.push(tool); return () => undefined } },
    effect(execute) { Array.from(execute()) },
  })
  const tools = new Map(registered.map(t => [t.name, t]))
  for (const [caseId, company] of [['a', 'Company A'], ['b', 'Company B']]) {
    await tools.get('scout_start').execute({
      caseId, companyName: company, roleTitle: 'HR Head', location: '',
    }, { agent: { id: 'session-a' } })
  }
  const result = await tools.get('scout_compare').execute(
    { caseIds: 'a, b' },
    { agent: { id: 'session-a' } },
  )
  assert.match(result, /公司\/岗位对比（2 个案例）/)
  assert.match(result, /Company A/)
  assert.match(result, /Company B/)
})

test('scout_compare deduplicates case ids and empty claims render cleanly', async () => {
  const registered = []
  apply({
    get(name) { return this[name] },
    tools: { register(tool) { registered.push(tool); return () => undefined } },
    effect(execute) { Array.from(execute()) },
  })
  const tools = new Map(registered.map(t => [t.name, t]))
  for (const [caseId, company] of [['a', 'Company A'], ['b', 'Company B']]) {
    await tools.get('scout_start').execute({
      caseId, companyName: company, roleTitle: 'HR Head', location: '',
    }, { agent: { id: 'session-a' } })
  }
  const compare = tools.get('scout_compare')

  // duplicate ids are deduplicated: 'a,a,b' -> a, b
  const deduped = await compare.execute({ caseIds: 'a, a, b' }, { agent: { id: 'session-a' } })
  assert.match(deduped, /公司\/岗位对比（2 个案例）/)

  // only one distinct id -> explicit error
  await assert.rejects(
    compare.execute({ caseIds: 'a, a' }, { agent: { id: 'session-a' } }),
    /at least two distinct case ids/,
  )
  // blank ids -> explicit error
  await assert.rejects(
    compare.execute({ caseIds: ' , ' }, { agent: { id: 'session-a' } }),
    /No case ids provided/,
  )
  // missing case -> error hints at the agent session boundary
  await assert.rejects(
    compare.execute({ caseIds: 'a, missing' }, { agent: { id: 'session-a' } }),
    /Unknown case: missing \(not found in this agent session\)/,
  )

  // empty claims render without an empty parentheses suffix
  const empty = renderComparison([
    createCase({ caseId: 'x', companyName: 'X', roleTitle: 'R' }),
    createCase({ caseId: 'y', companyName: 'Y', roleTitle: 'R' }),
  ])
  assert.match(empty, /主张 0 条\n/)
  assert.doesNotMatch(empty, /主张 0 条（）/)
})

test('scout_ingest drafts claims from items alongside sources', async () => {
  // foreign registries classify as company_registry
  assert.deepEqual(inferSourceType('https://w2.brreg.no/company/1'), { type: 'company_registry', inferred: true })
  assert.deepEqual(inferSourceType('https://www.handelsregister.de/rp_web/mask.do'), { type: 'company_registry', inferred: true })
  assert.deepEqual(inferSourceType('https://www1.hkexnews.hk/search/titlesearch.xhtml'), { type: 'company_registry', inferred: true })

  const registered = []
  apply({
    get(name) { return this[name] },
    tools: { register(tool) { registered.push(tool); return () => undefined } },
    effect(execute) { Array.from(execute()) },
  })
  const tools = new Map(registered.map(t => [t.name, t]))
  await tools.get('scout_start').execute({
    caseId: 'draft', companyName: 'Example Co', roleTitle: 'HR Head', location: '',
  }, { agent: { id: 'session-a' } })

  const result = JSON.parse(await tools.get('scout_ingest').execute({
    caseId: 'draft',
    itemsJson: JSON.stringify([
      {
        url: 'https://m.liepin.com/job/1.shtml',
        claim: { text: '该岗位月薪 13k–26k。', dimension: 'financing_and_commercialization', impact: 'material' },
      },
      {
        url: 'https://www.gsxt.gov.cn/registry/1',
        claim: { text: '主体为深圳某科技有限公司。', dimension: 'identity', status: 'verified', evidenceLevel: 'E3' },
      },
      // claim missing dimension -> source kept, claim rejected
      { url: 'https://example.com/a', claim: { text: 'no dimension' } },
      // claim evidence level exceeds the E2 source -> claim rejected, source kept
      { url: 'https://example.com/b', claim: { text: 'overstated', dimension: 'risk', evidenceLevel: 'E3' } },
    ]),
  }, { agent: { id: 'session-a' } }))

  assert.equal(result.added.length, 4)
  assert.equal(result.errors.length, 2)
  // claim defaults: reported / material / source evidence level
  assert.deepEqual(result.added[0].claims, ['claim-1'])
  // verified claim on an E3 registry source is accepted
  assert.deepEqual(result.added[1].claims, ['claim-2'])
  // source survived even though its claim was rejected
  assert.equal(result.added[2].claims, undefined)
  assert.match(result.errors[0].error, /invalid claim\.dimension/)
  assert.match(result.errors[1].error, /exceeds its strongest source/)

  // claims landed in the case with source links and events
  const report = await tools.get('scout_report').execute({ caseId: 'draft' }, { agent: { id: 'session-a' } })
  assert.match(report, /该岗位月薪 13k–26k。/)
  assert.match(report, /主体为深圳某科技有限公司。/)
  assert.doesNotMatch(report, /no dimension/)
})

test('scout_ingest rejects invalid claim enums explicitly and keeps claim ids collision-safe', async () => {
  const registered = []
  apply({
    get(name) { return this[name] },
    tools: { register(tool) { registered.push(tool); return () => undefined } },
    effect(execute) { Array.from(execute()) },
  })
  const tools = new Map(registered.map(t => [t.name, t]))
  await tools.get('scout_start').execute({
    caseId: 'enum', companyName: 'Example Co', roleTitle: 'HR Head', location: '',
  }, { agent: { id: 'session-a' } })

  // pre-seed a claim so the next generated id must skip claim-1
  await tools.get('scout_add_claim').execute({
    caseId: 'enum',
    claimId: 'claim-1',
    text: 'pre-seeded',
    status: 'unknown',
    evidenceLevel: 'E0',
    dimension: 'risk',
    impact: 'material',
    sourceIds: '',
    confidenceNote: 'none',
    nextAction: 'verify',
  }, { agent: { id: 'session-a' } })

  const result = JSON.parse(await tools.get('scout_ingest').execute({
    caseId: 'enum',
    itemsJson: JSON.stringify([
      { url: 'https://m.liepin.com/job/1.shtml', claim: { text: 'ok claim', dimension: 'risk', status: 'contradictedd' } },
      { url: 'https://m.liepin.com/job/2.shtml', claim: { text: 'bad impact', dimension: 'risk', impact: 'huge' } },
      { url: 'https://m.liepin.com/job/3.shtml', claim: { text: 'bad level', dimension: 'risk', evidenceLevel: 'E9' } },
      { url: 'https://m.liepin.com/job/4.shtml', claim: { text: 'good claim', dimension: 'mandate' } },
    ]),
  }, { agent: { id: 'session-a' } }))

  // all four sources registered; three claims rejected with explicit enum errors
  assert.equal(result.added.length, 4)
  assert.equal(result.errors.length, 3)
  assert.match(result.errors[0].error, /invalid claim\.status: contradictedd/)
  assert.match(result.errors[1].error, /invalid claim\.impact: huge/)
  assert.match(result.errors[2].error, /invalid claim\.evidenceLevel: E9/)
  // the valid claim skipped the pre-seeded claim-1
  assert.deepEqual(result.added[3].claims, ['claim-2'])
})

test('covers registry boundaries, non-object claims, and verified-E0 rejection via claim drafts', async () => {
  // registry classification boundaries
  assert.deepEqual(inferSourceType('https://brreg.no/'), { type: 'company_registry', inferred: true })
  assert.deepEqual(inferSourceType('https://www.sse.com.cn/'), { type: 'company_registry', inferred: true })
  assert.deepEqual(inferSourceType('https://www.szse.cn/'), { type: 'company_registry', inferred: true })
  assert.deepEqual(inferSourceType('https://brreg.no.evil.com/'), { type: 'other', inferred: true })

  const registered = []
  const store = new Map()
  apply({
    get(name) { return this[name] },
    tools: { register(tool) { registered.push(tool); return () => undefined } },
    fs: {
      async resolve(path) { return { targetKey: path, displayPath: path } },
      async readText(target) { return store.get(target.displayPath) },
      async writeText(target, content) { store.set(target.displayPath, content); return { operation: 'create' } },
    },
    effect(execute) { Array.from(execute()) },
  })
  const tools = new Map(registered.map(t => [t.name, t]))
  await tools.get('scout_start').execute({
    caseId: 'edge', companyName: 'Example Co', roleTitle: 'HR Head', location: '',
  }, { agent: { id: 'session-a' } })

  const result = JSON.parse(await tools.get('scout_ingest').execute({
    caseId: 'edge',
    itemsJson: JSON.stringify([
      { url: 'https://m.liepin.com/job/1.shtml', claim: 'not-an-object' },
      { url: 'https://example.com/e0', sourceType: 'other', evidenceLevel: 'E0', claim: { text: 'no evidence', dimension: 'risk', status: 'verified', evidenceLevel: 'E0' } },
      { url: 'https://m.liepin.com/job/2.shtml', claim: { text: 'event payload check', dimension: 'mandate' } },
    ]),
  }, { agent: { id: 'session-a' } }))

  // non-object claim and verified-E0 claim are rejected; sources survive
  assert.equal(result.added.length, 3)
  assert.equal(result.errors.length, 2)
  assert.match(result.errors[0].error, /claim must be an object/)
  assert.match(result.errors[1].error, /at least E1 evidence/)
  assert.equal(result.added[1].claims, undefined) // E0 verified claim not attached
  assert.deepEqual(result.added[2].claims, ['claim-2'])

  // claim_added event detail carries text and sourceIds in the export
  await tools.get('scout_export').execute(
    { caseId: 'edge' },
    { agent: { id: 'session-a' } },
  )
  const events = store.get('dsh-scout/edge/events.jsonl')
  assert.ok(events.includes('"text":"event payload check"'))
  assert.ok(events.includes('"sourceIds":["src-3"]'))
})

test('scout_search registers provider results as sources and requires the web service', async () => {
  const registered = []
  const searched = []
  apply({
    get(name) { return this[name] },
    tools: { register(tool) { registered.push(tool); return () => undefined } },
    web: {
      async search(request) {
        searched.push(request)
        return {
          content: 'answer snippet',
          truncated: false,
          sources: [
            { url: 'https://www.gsxt.gov.cn/registry/9', title: 'Registry' },
            { url: 'https://m.liepin.com/job/7.shtml' },
            { url: 'https://example.com/unknown', snippet: 'a snippet' },
          ],
        }
      },
    },
    effect(execute) { Array.from(execute()) },
  })
  const tools = new Map(registered.map(t => [t.name, t]))
  await tools.get('scout_start').execute({
    caseId: 'search', companyName: 'Example Co', roleTitle: 'HR Head', location: '',
  }, { agent: { id: 'session-a' } })

  const result = JSON.parse(await tools.get('scout_search').execute({
    caseId: 'search',
    query: 'Example Co company registry',
    limit: 10,
  }, { agent: { id: 'session-a' } }))

  assert.equal(searched.length, 1)
  assert.equal(searched[0].query, 'Example Co company registry')
  assert.equal(searched[0].maxResults, 10)
  assert.equal(result.added.length, 3)
  assert.equal(result.errors.length, 0)
  assert.equal(result.added[0].type, 'company_registry')
  assert.equal(result.added[0].evidenceLevel, 'E3')
  assert.equal(result.added[1].type, 'job_posting')
  assert.equal(result.added[2].snippet, 'a snippet')
  assert.equal(result.content, 'answer snippet')
  assert.equal(result.truncated, false)

  // sources landed in the case
  const report = await tools.get('scout_report').execute({ caseId: 'search' }, { agent: { id: 'session-a' } })
  assert.match(report, /src-1/)
  assert.match(report, /src-3/)

  // web service missing -> explicit error
  const noWeb = []
  apply({
    get(name) { return this[name] },
    tools: { register(tool) { noWeb.push(tool); return () => undefined } },
    effect(execute) { Array.from(execute()) },
  })
  const toolsNoWeb = new Map(noWeb.map(t => [t.name, t]))
  await toolsNoWeb.get('scout_start').execute({
    caseId: 'x', companyName: 'C', roleTitle: 'R', location: '',
  }, { agent: { id: 'session-b' } })
  await assert.rejects(
    toolsNoWeb.get('scout_search').execute({ caseId: 'x', query: 'q' }, { agent: { id: 'session-b' } }),
    /Web search service is unavailable/,
  )
})

test('scout_search handles provider edge cases and limit bounds', async () => {
  const registered = []
  const providerCalls = []
  let failSearch = false
  apply({
    get(name) { return this[name] },
    tools: { register(tool) { registered.push(tool); return () => undefined } },
    web: {
      async search(request) {
        if (failSearch) throw new Error('provider down')
        providerCalls.push(request)
        return {
          sources: [
            null,
            { url: 123 },
            { url: '' },
            { url: 'https://m.liepin.com/job/1.shtml', publishedAt: '2026-08-16' },
          ],
          truncated: undefined,
        }
      },
    },
    effect(execute) { Array.from(execute()) },
  })
  const tools = new Map(registered.map(t => [t.name, t]))
  await tools.get('scout_start').execute({
    caseId: 'edge', companyName: 'Example Co', roleTitle: 'HR Head', location: '',
  }, { agent: { id: 'session-a' } })

  // limit: 0 / -1 normalize to default 5, 100 caps at 10
  for (const [limit, expected] of [[0, 5], [-1, 5], [100, 10]]) {
    await tools.get('scout_search').execute(
      { caseId: 'edge', query: 'q', limit },
      { agent: { id: 'session-a' } },
    )
  }
  assert.deepEqual(providerCalls.map(c => c.maxResults), [5, 5, 10])
  // NaN is rejected by the tool-layer argument validation
  await assert.rejects(
    tools.get('scout_search').execute({ caseId: 'edge', query: 'q', limit: NaN }, { agent: { id: 'session-a' } }),
    /finite JSON number/,
  )

  // malformed sources are isolated; valid ones register with publishedAt
  const result = JSON.parse(await tools.get('scout_search').execute(
    { caseId: 'edge', query: 'q' },
    { agent: { id: 'session-a' } },
  ))
  assert.equal(result.errors.length, 3)
  assert.match(result.errors[0].error, /result 0 must be an object/)
  assert.match(result.errors[1].error, /result 1 missing url/)
  assert.match(result.errors[2].error, /result 2 missing url/)
  assert.equal(result.added.length, 1)
  assert.equal(result.added[0].type, 'job_posting')
  assert.equal(result.added[0].publishedAt, '2026-08-16')
  // truncated missing -> false, never dropped from the payload
  assert.equal(result.truncated, false)

  // provider throwing -> tool rejects with the provider error
  failSearch = true
  await assert.rejects(
    tools.get('scout_search').execute({ caseId: 'edge', query: 'q' }, { agent: { id: 'session-a' } }),
    /provider down/,
  )

  // non-array sources -> reported as an error, tool still succeeds
  const noArray = []
  apply({
    get(name) { return this[name] },
    tools: { register(tool) { noArray.push(tool); return () => undefined } },
    web: { async search() { return { sources: 'nope' } } },
    effect(execute) { Array.from(execute()) },
  })
  const tools2 = new Map(noArray.map(t => [t.name, t]))
  await tools2.get('scout_start').execute({
    caseId: 'na', companyName: 'C', roleTitle: 'R', location: '',
  }, { agent: { id: 'session-a' } })
  const nonArray = JSON.parse(await tools2.get('scout_search').execute(
    { caseId: 'na', query: 'q' },
    { agent: { id: 'session-a' } },
  ))
  assert.equal(nonArray.added.length, 0)
  assert.match(nonArray.errors[0].error, /non-array sources/)
})

test('exports a schemastery Config with sensible defaults', () => {
  const parsed = Config({})
  assert.equal(parsed.scoutDir, 'dsh-scout')
  assert.equal(parsed.autoPersist, false)
  assert.ok(parsed.authorityHostSuffixes.includes('gov.cn'))
  assert.ok(parsed.authorityHostSuffixes.includes('gsxt.gov.cn') === false)
})

test('custom authority host suffixes extend the E3 trust boundary', async () => {
  const registered = []
  apply({
    get(name) { return this[name] },
    tools: {
      register(tool) {
        registered.push(tool)
        return () => undefined
      },
    },
    effect(execute) {
      Array.from(execute())
    },
  }, {
    authorityHostSuffixes: ['example-registry.example'],
  })
  const tools = new Map(registered.map(tool => [tool.name, tool]))
  const start = tools.get('scout_start')
  const addSource = tools.get('scout_add_source')
  await start.execute({
    caseId: 'custom-trust',
    companyName: 'Custom Co',
    roleTitle: 'Role',
    location: '',
  }, { agent: { id: 'session-a' } })
  // The configured suffix makes this registry origin a valid E3 source.
  const result = await addSource.execute({
    caseId: 'custom-trust',
    sourceId: 'registry',
    sourceType: 'company_registry',
    title: 'Custom registry',
    url: 'https://registry.example-registry.example/rec/1',
    evidenceLevel: 'E3',
  }, { agent: { id: 'session-a' } })
  assert.match(result, /"evidenceLevel": "E3"/)
  // The default trust boundary still rejects the same origin without the override.
  assert.equal(isTrustedAuthorityUrl('https://registry.example-registry.example/rec/1'), false)
})
