import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  addClaim,
  addSource,
  appendEvent,
  CLAIM_DIMENSIONS,
  computeCoverage,
  createCase,
  decideCase,
  EVENT_TYPES,
  explainDecision,
  exportCaseFiles,
  findSourceByUrl,
  formatScoutString,
  generateInterviewQuestions,
  importCaseFromFiles,
  inferEvidenceLevel,
  inferSourceType,
  isScoutLanguage,
  isTrustedAuthorityUrl,
  normalizeScoutLanguage,
  normalizeSourceUrl,
  renderComparison,
  renderReport,
  SCOUT_LANGUAGES,
  scoutStrings,
  verifyClaim,
  verifyIdentity,
} from '../dist/model.js'

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
  const mandateQuestion = questions.findIndex(q => q.includes('最终决定权'))
  assert.ok(mandateQuestion >= 0)
  // 0.9.1 ordering: untouched dimensions rank after the missing required ones
  const untouchedQuestion = questions.findIndex(q => q.includes('法定名称'))
  assert.ok(
    untouchedQuestion > mandateQuestion,
    'untouched-dimension questions rank after missing required dimensions',
  )
  // dedupe and the 12-item cap keep holding
  assert.equal(new Set(questions).size, questions.length)
  assert.equal(questions.length, 12)
  // the curated questions reserve their full quota (task-7 budget rule)
  for (const curated of scoutCase.interviewQuestions) {
    assert.ok(questions.includes(curated), `curated question kept: ${curated}`)
  }
})

test('covers question-generation, duplicate-id, authority-url, and import edge cases', () => {
  // empty case: the 3 required dimensions first, then the other 8 untouched
  // dimensions, then defaults — deduplicated and capped at 12
  const empty = createCase({ caseId: 'e', companyName: 'C', roleTitle: 'R' })
  const emptyQuestions = generateInterviewQuestions(empty)
  assert.equal(emptyQuestions.length, 12)
  assert.deepEqual(emptyQuestions.slice(0, 3), [
    '该岗位当前是否真实在招？招聘状态与到岗时间如何？',
    '该岗位直接向谁汇报？虚线/实线如何划分？',
    '该岗位在哪些事项上拥有最终决定权？团队与预算规模如何？',
  ])
  assert.ok(emptyQuestions.includes(empty.interviewQuestions[0]))
  for (const curated of empty.interviewQuestions) {
    assert.ok(emptyQuestions.includes(curated), `curated question kept: ${curated}`)
  }

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
  // role dimensions verified: the other 8 dimensions are still untouched, so
  // their questions take the 7 head slots and all 5 curated questions follow
  const verifiedQuestions = generateInterviewQuestions(verifiedCase)
  assert.equal(verifiedQuestions.length, 12)
  assert.deepEqual(verifiedQuestions.slice(-5), verifiedCase.interviewQuestions)
  assert.ok(verifiedQuestions.includes('公司主体的法定名称、注册号与注册地是什么？如何与品牌对应？'))

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

test('reserves the 12-item quota for curated questions', () => {
  // fresh case: 11 deduplicated head questions, budget 7, plus all 5 curated
  const fresh = createCase({ caseId: 'fresh', companyName: 'C', roleTitle: 'R' })
  const freshQuestions = generateInterviewQuestions(fresh)
  assert.equal(freshQuestions.length, 12)
  assert.deepEqual(freshQuestions.slice(0, 3), [
    '该岗位当前是否真实在招？招聘状态与到岗时间如何？',
    '该岗位直接向谁汇报？虚线/实线如何划分？',
    '该岗位在哪些事项上拥有最终决定权？团队与预算规模如何？',
  ])
  assert.deepEqual(freshQuestions.slice(7), fresh.interviewQuestions)

  // required role dimensions verified, the other 8 dimensions untouched
  let requiredOnly = createCase({ caseId: 'required', companyName: 'C', roleTitle: 'R' })
  requiredOnly = addSource(requiredOnly, {
    sourceId: 's1', type: 'user_provided', title: 'notes', url: null,
    capturedAt: '2026-08-16T00:00:00.000Z', evidenceLevel: 'E1', status: 'captured',
  })
  for (const [claimId, dimension] of [
    ['role', 'role_existence'], ['reporting', 'reporting_line'], ['mandate', 'mandate'],
  ]) {
    requiredOnly = addClaim(requiredOnly, {
      claimId, text: 'confirmed', status: 'verified', evidenceLevel: 'E1', dimension,
      impact: 'blocking', sourceIds: ['s1'], confidenceNote: 'direct', nextAction: 'done',
    })
  }
  const requiredQuestions = generateInterviewQuestions(requiredOnly)
  assert.equal(requiredQuestions.length, 12)
  assert.deepEqual(requiredQuestions.slice(7), requiredOnly.interviewQuestions)

  // fully verified with no untouched dimension: exactly the 0.9.0 curated list
  let complete = createCase({ caseId: 'complete', companyName: 'C', roleTitle: 'R' })
  complete = addSource(complete, {
    sourceId: 's1', type: 'user_provided', title: 'notes', url: null,
    capturedAt: '2026-08-16T00:00:00.000Z', evidenceLevel: 'E1', status: 'captured',
  })
  for (const dimension of CLAIM_DIMENSIONS) {
    complete = addClaim(complete, {
      claimId: `c-${dimension}`, text: 'confirmed', status: 'verified', evidenceLevel: 'E1',
      dimension, impact: 'informational', sourceIds: ['s1'],
      confidenceNote: 'direct', nextAction: 'done',
    })
  }
  assert.deepEqual(generateInterviewQuestions(complete), complete.interviewQuestions)
  assert.equal(generateInterviewQuestions(complete).length, 5)
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

// ---------------------------------------------------------------------------
// 0.9.1 model layer: languages, coverage, decision reason codes, source lookup
// ---------------------------------------------------------------------------

/** Deterministic case reused by the byte-for-byte zh-CN regression baseline. */
function legacyCase() {
  let scoutCase = createCase({ caseId: 'legacy', companyName: 'Legacy Co', roleTitle: 'HR Head' })
  scoutCase = addSource(scoutCase, {
    sourceId: 'job-posting', type: 'job_posting', title: 'Legacy job posting',
    url: 'https://example.com/job', capturedAt: '2026-08-16T00:00:00.000Z',
    evidenceLevel: 'E1', status: 'captured',
  })
  scoutCase = addClaim(scoutCase, {
    claimId: 'claim-1', text: 'The role may own the people roadmap.', status: 'reported',
    evidenceLevel: 'E1', dimension: 'mandate', impact: 'blocking', sourceIds: ['job-posting'],
    confidenceNote: 'Only the job posting says so.', nextAction: 'Confirm the mandate in the interview.',
  })
  return decideCase(scoutCase)
}

// Captured verbatim from dsh-scout 0.9.0 (HEAD 3406a4e) before the 0.9.1
// Coverage block existed. Only that block may be inserted: any other byte
// change to the zh-CN report is a regression.
const LEGACY_REPORT_GOLDEN = [
  "# Legacy Co — HR Head",
  "",
  "- 判断：**VERIFY**",
  "- 理由：公司主体仍未核验，不能直接推进。",
  "- 目标：判断是否值得进入下一轮，并准备面试反问",
  "- 证据概况：1 reported",
  "",
  "## Key supporting evidence (up to 3)",
  "",
  "- 暂无已核验的支持证据",
  "",
  "## Blocking or unresolved risks (up to 3)",
  "",
  "- **reported / E1 / blocking** The role may own the people roadmap.（维度：mandate；来源：job-posting；置信说明：Only the job posting says so.；下一步：Confirm the mandate in the interview.）",
  "",
  "## Role task and authority hypotheses",
  "",
  "- **reported / E1 / blocking** The role may own the people roadmap.（维度：mandate；来源：job-posting；置信说明：Only the job posting says so.；下一步：Confirm the mandate in the interview.）",
  "",
  "## Verification checklist",
  "",
  "- [blocking] claim-1: The role may own the people roadmap. → 下一步：Confirm the mandate in the interview.",
  "",
  "## Claim ledger",
  "",
  "- **reported / E1 / blocking** The role may own the people roadmap.（维度：mandate；来源：job-posting；置信说明：Only the job posting says so.；下一步：Confirm the mandate in the interview.）",
  "",
  "## Sources",
  "",
  "- job-posting: Legacy job posting [job_posting / E1] — https://example.com/job",
  "",
  "## Interview questions",
  "",
  "- 这个岗位在前三个月最重要的业务结果是什么？",
  "- 该岗位直接向谁汇报，在哪些事项上拥有最终决定权？",
  "- 现有团队、预算和外部供应商资源分别是什么？",
  "- 当前最影响业务增长的组织问题是什么？",
  "- 六个月后，哪些可观察结果代表这个岗位取得成功？",
  "",
  "> 本报告只表达当前证据边界内的判断，不替代法律、投资或医疗意见。",
  "",
].join('\n')

test('keeps the zh-CN report byte-identical apart from the Coverage block', () => {
  const report = renderReport(legacyCase())
  const lines = report.split('\n')
  const start = lines.indexOf('## Coverage')
  assert.ok(start > 0, 'the Coverage block is present')
  let end = start + 1
  while (end < lines.length && !lines[end].startsWith('## ')) end += 1
  const withoutCoverage = [...lines.slice(0, start), ...lines.slice(end)].join('\n')
  assert.equal(withoutCoverage, LEGACY_REPORT_GOLDEN)
  assert.match(report, /## Coverage\n\n- identity/)
})

test('renders an English report and English questions, defaulting to the case language', () => {
  let scoutCase = createCase({
    caseId: 'en', companyName: 'English Co', roleTitle: 'CTO', language: 'en',
  })
  assert.equal(scoutCase.language, 'en')
  assert.match(scoutCase.decisionReason, /not been verified yet/)
  scoutCase = addSource(scoutCase, {
    sourceId: 'job-posting', type: 'job_posting', title: 'English job posting',
    url: 'https://example.com/job', capturedAt: '2026-08-16T00:00:00.000Z',
    evidenceLevel: 'E1', status: 'captured',
  })
  scoutCase = addClaim(scoutCase, {
    claimId: 'claim-1', text: 'The role may own the people roadmap.', status: 'reported',
    evidenceLevel: 'E1', dimension: 'mandate', impact: 'blocking', sourceIds: ['job-posting'],
    confidenceNote: 'Only the job posting says so.', nextAction: 'Confirm the mandate in the interview.',
  })
  scoutCase = decideCase(scoutCase)

  const report = renderReport(scoutCase)
  assert.match(report, /- Decision: \*\*VERIFY\*\*/)
  assert.match(report, /- Reason: The company identity is not verified yet/)
  assert.match(report, /- identity \(Company identity\): verified 0 \/ open 0 \/ untouched: yes/)
  assert.match(report, /- mandate \(Mandate and authority\): verified 0 \/ open 1 \/ untouched: no/)
  assert.match(report, /Untouched dimensions \(10\):/)
  assert.match(report, /The role may own the people roadmap\. \(dimension: mandate; sources: job-posting/)
  assert.doesNotMatch(report, /[\u4e00-\u9fff]/, 'the English report contains no CJK characters')

  const questions = generateInterviewQuestions(scoutCase)
  assert.equal(questions.length, 12)
  assert.equal(questions[0], 'Confirm the mandate in the interview.')
  assert.ok(questions.includes('Is this role actually open right now, and what are the hiring status and start date?'))
  assert.ok(questions.every(question => !/[\u4e00-\u9fff]/.test(question)))

  // an explicit option overrides the case language in either direction
  const zhReport = renderReport(scoutCase, { language: 'zh-CN' })
  assert.match(zhReport, /- 判断：\*\*VERIFY\*\*/)
  assert.doesNotMatch(zhReport, /- Decision:/)
  const zhQuestions = generateInterviewQuestions(scoutCase, { language: 'zh-CN' })
  assert.ok(zhQuestions.includes('公司主体的法定名称、注册号与注册地是什么？如何与品牌对应？'))
  // the comparison report follows the same language resolution
  const comparison = renderComparison([
    scoutCase,
    createCase({ caseId: 'en-2', companyName: 'Other Co', roleTitle: 'CTO', language: 'en' }),
  ])
  assert.match(comparison, /# Company \/ role comparison \(2 cases\)/)
  assert.match(comparison, /\| Case \| Decision \| Identity \| Claims \|/)
  assert.match(comparison, /## Interview questions \(merged and deduplicated, first 12\)/)
  assert.doesNotMatch(comparison, /[\u4e00-\u9fff]/, 'the English comparison contains no CJK characters')
  // newly created cases default to zh-CN
  assert.equal(createCase({ caseId: 'z', companyName: 'C', roleTitle: 'R' }).language, 'zh-CN')
})

test('computes coverage for all 11 dimensions, including untouched ones', () => {
  let scoutCase = createCase({ caseId: 'coverage', companyName: 'Coverage Co', roleTitle: 'HR Head' })
  const emptyCoverage = computeCoverage(scoutCase)
  assert.equal(emptyCoverage.length, 11)
  assert.deepEqual(emptyCoverage.map(item => item.dimension), [...CLAIM_DIMENSIONS])
  assert.ok(emptyCoverage.every(item => item.untouched && item.verified === 0 && item.open === 0))

  scoutCase = addSource(scoutCase, {
    sourceId: 'interview', type: 'user_provided', title: 'Interview notes',
    url: 'https://example.com/notes', capturedAt: '2026-08-16T00:00:00.000Z',
    evidenceLevel: 'E1', status: 'captured',
  })
  scoutCase = addClaim(scoutCase, {
    claimId: 'identity-claim', text: 'The legal entity matches the brand.', status: 'verified',
    evidenceLevel: 'E1', dimension: 'identity', impact: 'material', sourceIds: ['interview'],
    confidenceNote: 'Confirmed by the interview.', nextAction: 'Use it in later searches.',
  })
  scoutCase = addClaim(scoutCase, {
    claimId: 'risk-claim', text: 'A litigation risk is reported.', status: 'reported',
    evidenceLevel: 'E1', dimension: 'risk', impact: 'material', sourceIds: ['interview'],
    confidenceNote: 'Reported by one person.', nextAction: 'Check the court docket.',
  })

  const coverage = computeCoverage(scoutCase)
  assert.deepEqual(coverage.find(item => item.dimension === 'identity'), {
    dimension: 'identity', verified: 1, open: 0, untouched: false,
  })
  assert.deepEqual(coverage.find(item => item.dimension === 'risk'), {
    dimension: 'risk', verified: 0, open: 1, untouched: false,
  })
  assert.deepEqual(coverage.find(item => item.dimension === 'mandate'), {
    dimension: 'mandate', verified: 0, open: 0, untouched: true,
  })

  const report = renderReport(scoutCase)
  assert.match(report, /## Coverage/)
  assert.ok(report.indexOf('## Coverage') < report.indexOf('## Key supporting evidence'))
  assert.match(report, /- identity（主体身份）：已核验 1 \/ 待核验 0 \/ 未调查：否/)
  assert.match(report, /- mandate（授权与职责）：已核验 0 \/ 待核验 0 \/ 未调查：是/)
  assert.match(
    report,
    /未调查维度（9）：role_existence、reporting_line、mandate、company_and_founder、product_and_technology、market_and_competition、financing_and_commercialization、organization_and_hr、role_fit/,
  )
  // coverage drives the question list
  assert.ok(generateInterviewQuestions(scoutCase)
    .includes('该岗位当前是否真实在招？招聘状态与到岗时间如何？'))
})

test('finds a source by normalized URL and rejects empty or invalid URLs', () => {
  let scoutCase = createCase({ caseId: 'url', companyName: 'C', roleTitle: 'R' })
  scoutCase = addSource(scoutCase, {
    sourceId: 's1', type: 'job_posting', title: 'posting', url: 'https://Example.COM/job/',
    capturedAt: null, evidenceLevel: 'E1', status: 'captured',
  })
  scoutCase = addSource(scoutCase, {
    sourceId: 's2', type: 'other', title: 'no url', url: null,
    capturedAt: null, evidenceLevel: 'E1', status: 'captured',
  })

  assert.equal(findSourceByUrl(scoutCase, 'https://example.com/job')?.sourceId, 's1')
  assert.equal(findSourceByUrl(scoutCase, '  https://EXAMPLE.com/job//  ')?.sourceId, 's1')
  assert.equal(findSourceByUrl(scoutCase, 'https://example.com/job#section')?.sourceId, 's1')
  assert.equal(findSourceByUrl(scoutCase, 'https://example.com/job?x=1'), undefined)
  assert.equal(findSourceByUrl(scoutCase, 'https://example.com/other'), undefined)
  assert.equal(findSourceByUrl(scoutCase, ''), undefined)
  assert.equal(findSourceByUrl(scoutCase, '   '), undefined)
  assert.equal(findSourceByUrl(scoutCase, 'not a url'), undefined)
  assert.equal(findSourceByUrl(scoutCase, 'example.com/job'), undefined)

  assert.equal(normalizeSourceUrl('https://Example.com/job/'), 'https://example.com/job')
  assert.equal(normalizeSourceUrl(' https://example.com '), 'https://example.com')
  assert.equal(normalizeSourceUrl(null), undefined)
  assert.equal(normalizeSourceUrl(''), undefined)
})

test('recomputes decision reason codes from subject and claims', () => {
  const empty = createCase({ caseId: 'r', companyName: 'C', roleTitle: 'R' })
  assert.equal(explainDecision(empty), 'identity')
  assert.equal(decideCase(empty).decisionReasonCode, 'identity')
  assert.equal(decideCase(empty).decisionReason, '公司主体仍未核验，不能直接推进。')

  const identified = (caseId) => {
    let scoutCase = createCase({ caseId, companyName: 'C', roleTitle: 'R' })
    scoutCase = addSource(scoutCase, {
      sourceId: 'registry', type: 'company_registry', title: 'registry',
      url: 'https://www.gsxt.gov.cn/registry/REG-1', capturedAt: '2026-08-16T00:00:00.000Z',
      evidenceLevel: 'E3', status: 'captured',
    })
    return verifyIdentity(scoutCase, {
      legalEntity: 'C Ltd', registrationNumber: 'REG-1', registeredRegion: 'Shenzhen',
      legalRepresentative: 'P', brandRelationship: 'brand', sourceIds: ['registry'],
    })
  }

  let unresolved = identified('u')
  unresolved = addClaim(unresolved, {
    claimId: 'c1', text: 'The role exists.', status: 'reported', evidenceLevel: 'E3',
    dimension: 'role_existence', impact: 'blocking', sourceIds: ['registry'],
    confidenceNote: 'registry', nextAction: 'confirm in the interview',
  })
  assert.equal(explainDecision(unresolved), 'unresolved')
  assert.equal(decideCase(unresolved).decision, 'VERIFY')
  assert.equal(decideCase(unresolved).decisionReason, '仍有阻断级或重要结论未完成核验，不能直接推进。')

  const missing = identified('m')
  assert.equal(explainDecision(missing), 'missing_dimension')
  assert.equal(decideCase(missing).decision, 'VERIFY')
  assert.equal(decideCase(missing).decisionReason, '缺少已核验的必需维度：role_existence。')

  let proceed = identified('p')
  for (const [claimId, dimension] of [
    ['role', 'role_existence'], ['reporting', 'reporting_line'], ['mandate', 'mandate'],
  ]) {
    proceed = addClaim(proceed, {
      claimId, text: 'confirmed', status: 'verified', evidenceLevel: 'E3', dimension,
      impact: 'blocking', sourceIds: ['registry'], confidenceNote: 'registry', nextAction: 'done',
    })
  }
  assert.equal(explainDecision(proceed), 'proceed')
  const decided = decideCase(proceed)
  assert.equal(decided.decision, 'PROCEED')
  assert.equal(decided.decisionReasonCode, 'proceed')
  assert.equal(decided.decisionReason, '当前关键结论均有来源支撑，建议进入下一轮并继续现场核验。')

  let stop = identified('s')
  stop = addClaim(stop, {
    claimId: 'c1', text: 'The role is closed.', status: 'contradicted', evidenceLevel: 'E3',
    dimension: 'role_existence', impact: 'blocking', sourceIds: ['registry'],
    confidenceNote: 'contradicts the posting', nextAction: 'resolve the conflict',
  })
  assert.equal(explainDecision(stop), 'unresolved')
  const stopped = decideCase(stop)
  assert.equal(stopped.decision, 'STOP')
  assert.equal(stopped.decisionReasonCode, 'unresolved')
  assert.equal(stopped.decisionReason, '存在相互矛盾的关键事实，需先解决冲突。')

  // the stored reason is localized from the case language
  const english = decideCase(identified('en'), { language: 'en' })
  assert.equal(english.decisionReasonCode, 'missing_dimension')
  assert.equal(english.decisionReason, 'Missing verified required dimension: role_existence.')
})

test('imports a legacy five-file export without the new optional fields', () => {
  const legacyCaseJson = {
    schemaVersion: 'dsh-scout.case.v0',
    caseId: 'legacy',
    title: 'Legacy Co — HR Head',
    language: 'zh-CN',
    decisionObjective: '判断是否值得进入下一轮，并准备面试反问',
    subject: { name: 'Legacy Co', identitySourceIds: [], identityStatus: 'needs_verification' },
    role: { title: 'HR Head', fitQuestion: '该岗位是否拥有足够的业务授权，值得继续推进？' },
    decision: 'VERIFY',
    decisionReason: '尚未完成公司主体和岗位授权核验。',
    interviewQuestions: ['第一个问题？'],
  }
  const payload = {
    'case.json': JSON.stringify(legacyCaseJson),
    'sources.json': '[]',
    'claims.json': '[]',
    'events.jsonl': '',
  }
  const restored = importCaseFromFiles(payload)
  assert.equal(restored.caseId, 'legacy')
  assert.equal(restored.language, 'zh-CN')
  assert.equal(restored.decisionReasonCode, undefined)
  assert.equal('decisionReasonCode' in restored, false)
  assert.deepEqual(restored.interviewQuestions, ['第一个问题？'])
  assert.match(renderReport(restored), /## Coverage/)

  // a payload that predates the language field still imports as zh-CN
  const withoutLanguage = importCaseFromFiles({
    ...payload,
    'case.json': JSON.stringify({ ...legacyCaseJson, language: undefined }),
  })
  assert.equal(withoutLanguage.language, 'zh-CN')

  // the new reason code round-trips, and an unknown code is dropped
  const decided = decideCase(legacyCase())
  assert.equal(decided.decisionReasonCode, 'identity')
  const files = exportCaseFiles(decided)
  assert.match(files['case.json'], /"decisionReasonCode": "identity"/)
  const roundTripped = importCaseFromFiles(files)
  assert.equal(roundTripped.decisionReasonCode, 'identity')
  assert.equal(roundTripped.decision, decided.decision)
  const bogus = importCaseFromFiles({
    ...files,
    'case.json': files['case.json'].replace('"decisionReasonCode": "identity"', '"decisionReasonCode": "bogus"'),
  })
  assert.equal(bogus.decisionReasonCode, undefined)

  // an undecided case stays free of the optional field
  const legacyFiles = exportCaseFiles(createCase({ caseId: 'l', companyName: 'C', roleTitle: 'R' }))
  assert.doesNotMatch(legacyFiles['case.json'], /decisionReasonCode/)
})

test('accepts a case_rehydrated event through the closed event union', () => {
  assert.ok(EVENT_TYPES.includes('case_rehydrated'))
  let scoutCase = createCase({ caseId: 'rehydrate', companyName: 'C', roleTitle: 'R' })
  scoutCase = appendEvent(scoutCase, {
    eventId: 'evt-rehydrated', type: 'case_rehydrated', at: '2026-08-16T00:00:00.000Z',
    detail: { dir: '/tmp/dsh-scout/rehydrate' },
  })
  assert.equal(scoutCase.events?.at(-1)?.type, 'case_rehydrated')
})

test('exposes the language dictionary and resolution helpers', () => {
  assert.deepEqual([...SCOUT_LANGUAGES], ['zh-CN', 'en'])
  assert.equal(isScoutLanguage('en'), true)
  assert.equal(isScoutLanguage('fr'), false)
  assert.equal(isScoutLanguage(undefined), false)
  assert.equal(normalizeScoutLanguage('en'), 'en')
  assert.equal(normalizeScoutLanguage('fr'), 'zh-CN')
  assert.equal(normalizeScoutLanguage(null), 'zh-CN')

  const zh = scoutStrings(undefined)
  const en = scoutStrings('en')
  assert.equal(zh.language, 'zh-CN')
  assert.equal(en.language, 'en')
  // an unsupported runtime value falls back to the default table
  assert.equal(scoutStrings('fr').language, 'zh-CN')
  assert.equal(zh.statuses.verified, '已核验')
  assert.equal(en.statuses.needs_verification, 'needs verification')
  assert.equal(zh.impacts.blocking, '阻断级')
  assert.equal(en.evidenceLevels.E3, 'E3 (authoritative source)')
  assert.equal(zh.dimensions.financing_and_commercialization, '融资与商业化')
  assert.equal(en.dimensions.financing_and_commercialization, 'Financing and commercialization')
  assert.equal(zh.decisions.PROCEED, '继续推进')
  assert.equal(en.decisions.PROCEED, 'proceed')
  assert.equal(zh.defaults.interviewQuestions.length, 5)
  assert.equal(en.defaults.interviewQuestions.length, 5)
  // template filling leaves unknown slots verbatim
  assert.equal(formatScoutString('- {a} / {b}', { a: 1 }), '- 1 / {b}')
  assert.equal(formatScoutString('- 判断：{decision}', { decision: 'VERIFY' }), '- 判断：VERIFY')
})

test('renders the exported report.md in the requested language', () => {
  // an en case exports an en report.md by default
  const enCase = createCase({ caseId: 'export-en', companyName: 'English Co', roleTitle: 'CTO', language: 'en' })
  assert.equal(exportCaseFiles(enCase)['report.md'], renderReport(enCase))
  assert.doesNotMatch(exportCaseFiles(enCase)['report.md'], /[\u4e00-\u9fff]/)

  // a zh case can be exported in the requested language without touching case.json
  const zhCase = legacyCase()
  const zhFiles = exportCaseFiles(zhCase)
  assert.equal(zhFiles['report.md'], renderReport(zhCase))
  assert.match(zhFiles['report.md'], /^- 判断：\*\*VERIFY\*\*$/m)
  const enFiles = exportCaseFiles(zhCase, { language: 'en' })
  assert.equal(enFiles['report.md'], renderReport(zhCase, { language: 'en' }))
  // the framework text follows the requested language; stored case data
  // (claim text, decisionReason, curated questions) is not translated
  assert.match(enFiles['report.md'], /^- Decision: \*\*VERIFY\*\*$/m)
  assert.match(enFiles['report.md'], /^Untouched dimensions \(10\):/m)
  assert.doesNotMatch(enFiles['report.md'], /- 判断：/)
  assert.equal(
    JSON.parse(enFiles['case.json']).language,
    'zh-CN',
    'case.json keeps the language the case was created in',
  )
  assert.equal(enFiles['case.json'], zhFiles['case.json'])

  // and an en case can be exported back to zh-CN
  assert.equal(
    exportCaseFiles(enCase, { language: 'zh-CN' })['report.md'],
    renderReport(enCase, { language: 'zh-CN' }),
  )
})

test('keeps the ingest draft defaults in both language tables', () => {
  const zh = scoutStrings('zh-CN')
  const en = scoutStrings('en')
  for (const table of [zh, en]) {
    assert.ok(table.ingest.autoConfidenceNote.length > 0)
    assert.ok(table.ingest.autoNextAction.length > 0)
  }
  // the zh-CN template keeps reproducing the pre-0.9.1 literal
  assert.match(zh.ingest.autoConfidenceNote, /\{sourceId\}/)
  assert.equal(
    formatScoutString(zh.ingest.autoConfidenceNote, { sourceId: 'src-1' }),
    '由采集项自动登记，来源 src-1',
  )
  assert.equal(zh.ingest.autoNextAction, '核验该主张并补充独立来源')
  // the English table carries no CJK and keeps the source placeholder
  assert.match(en.ingest.autoConfidenceNote, /\{sourceId\}/)
  assert.doesNotMatch(en.ingest.autoConfidenceNote, /[\u4e00-\u9fff]/)
  assert.doesNotMatch(en.ingest.autoNextAction, /[\u4e00-\u9fff]/)
  assert.equal(
    formatScoutString(en.ingest.autoConfidenceNote, { sourceId: 'src-1' }),
    'Auto-registered from an ingested item; source src-1',
  )

  // the documented draft defaults keep an English report fully English
  let ingestCase = createCase({
    caseId: 'ingest-en', companyName: 'Example Co', roleTitle: 'HR Head', language: 'en',
  })
  ingestCase = addSource(ingestCase, {
    sourceId: 'src-1', type: 'job_posting', title: 'Report A', url: 'https://example.com/a',
    capturedAt: null, evidenceLevel: 'E1', status: 'captured',
  })
  ingestCase = addClaim(ingestCase, {
    claimId: 'claim-1', text: 'The role exists.', status: 'reported', evidenceLevel: 'E1',
    dimension: 'role_existence', impact: 'material', sourceIds: ['src-1'],
    confidenceNote: formatScoutString(en.ingest.autoConfidenceNote, { sourceId: 'src-1' }),
    nextAction: en.ingest.autoNextAction,
  })
  ingestCase = decideCase(ingestCase)
  assert.doesNotMatch(renderReport(ingestCase), /[\u4e00-\u9fff]/)
  assert.ok(generateInterviewQuestions(ingestCase).every(question => !/[\u4e00-\u9fff]/.test(question)))
})
