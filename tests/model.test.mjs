import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  addClaim,
  addSource,
  createCase,
  decideCase,
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
  assert.deepEqual(inject, ['tools'])
  assert.deepEqual(
    registered.map(tool => tool.name).sort(),
    [
      'scout_add_claim',
      'scout_add_source',
      'scout_report',
      'scout_start',
      'scout_verify_claim',
      'scout_verify_identity',
    ],
  )

  for (const dispose of effects.reverse()) dispose()
  assert.deepEqual(disposed.sort(), registered.map(tool => tool.name).sort())
})
