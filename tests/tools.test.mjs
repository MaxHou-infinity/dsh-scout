import test from 'node:test'
import assert from 'node:assert/strict'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { apply, Config, inject, name } from '../dist/index.js'
import {
  createCase,
  exportCaseFiles,
  inferEvidenceLevel,
  inferSourceType,
  isTrustedAuthorityUrl,
} from '../dist/model.js'

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */

const ALL_TOOLS = [
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
]

const execFor = (sessionId = 'session-a') => ({ agent: { id: sessionId } })

/** In-memory fs double keyed by display path. */
function mockFs(store = new Map(), options = {}) {
  return {
    store,
    async resolve(path) {
      return { targetKey: path, displayPath: path }
    },
    async readText(target) {
      if (!store.has(target.displayPath)) throw new Error(`not found: ${target.displayPath}`)
      return store.get(target.displayPath)
    },
    async writeText(target, content) {
      if (options.failWrites) throw new Error(options.failWrites)
      store.set(target.displayPath, content)
      return { operation: 'create' }
    },
  }
}

/**
 * Mount the plugin with the minimal Context surface it touches. `ctx.get`
 * reads the live object, so a service can be attached after `apply()` to
 * exercise call-time service resolution.
 */
function mountPlugin({ config, services = {} } = {}) {
  const registered = []
  const disposed = []
  const effects = []
  const injections = []
  const ctx = {
    get(serviceName) {
      return this[serviceName]
    },
    tools: {
      register(tool) {
        registered.push(tool)
        return () => disposed.push(tool.name)
      },
    },
    effect(execute) {
      effects.push(...execute())
    },
    inject(dependencies, callback) {
      injections.push([...dependencies, callback])
    },
  }
  Object.assign(ctx, services)
  apply(ctx, config)
  return {
    ctx,
    registered,
    disposed,
    effects,
    injections,
    tools: new Map(registered.map(tool => [tool.name, tool])),
  }
}

/** Assert a canonical value satisfies the tool's own declared output schema. */
function assertSchemaConforms(mounted, toolName, value) {
  const tool = mounted.tools.get(toolName)
  const violations = validateJsonSchemaValue(tool.output.schema, value)
  assert.deepEqual(violations, [], `${toolName} value violates its declared schema`)
}

const renderedText = (blocks) => blocks.filter(block => block.type === 'text').map(block => block.text).join('')
const outputBytes = (blocks) => Buffer.byteLength(renderedText(blocks), 'utf8')
const renderOutput = (mounted, toolName, value) => mounted.tools.get(toolName).output.render({}, value)

/* ------------------------------------------------------------------ *
 * Tool surface
 * ------------------------------------------------------------------ */

test('exports a disposable DSH plugin tool surface', async () => {
  const mounted = mountPlugin()
  assert.equal(name, 'dsh-scout')
  assert.deepEqual(inject, ['tools'])
  assert.deepEqual(mounted.registered.map(tool => tool.name).sort(), ALL_TOOLS)
  for (const dispose of mounted.effects.reverse()) dispose()
  assert.deepEqual(mounted.disposed.sort(), [...ALL_TOOLS].sort())
})

test('isolates identical case ids by DSH agent session identity', async () => {
  const mounted = mountPlugin()
  const start = mounted.tools.get('scout_start')
  const report = mounted.tools.get('scout_report')

  await start.execute({ caseId: 'same-id', companyName: 'Company A', roleTitle: 'Role A', location: '' }, execFor('session-a'))
  await start.execute({ caseId: 'same-id', companyName: 'Company B', roleTitle: 'Role B', location: '' }, execFor('session-b'))

  const reportA = (await report.execute({ caseId: 'same-id' }, execFor('session-a'))).report
  const reportB = (await report.execute({ caseId: 'same-id' }, execFor('session-b'))).report
  assert.match(reportA, /Company A — Role A/)
  assert.doesNotMatch(reportA, /Company B/)
  assert.match(reportB, /Company B — Role B/)
})

/* ------------------------------------------------------------------ *
 * Output contract
 * ------------------------------------------------------------------ */

test('mutation tools return a schema-valid compact envelope instead of the whole case', async () => {
  const mounted = mountPlugin()
  const value = await mounted.tools.get('scout_start').execute({
    caseId: 'compact',
    companyName: 'Example Co',
    roleTitle: 'HR Head',
    location: 'Shenzhen',
  }, execFor())

  assertSchemaConforms(mounted, 'scout_start', value)
  assert.deepEqual(Object.keys(value).sort(), [
    'caseId', 'changed', 'counts', 'decision', 'identity', 'nextActions', 'ok',
  ])
  assert.equal(value.changed.kind, 'case_started')
  assert.equal(value.decision, 'VERIFY')
  assert.deepEqual(value.counts, { sources: 0, claims: 0, verified: 0, open: 0 })

  const content = renderOutput(mounted, 'scout_start', value)
  assert.ok(outputBytes(content) < 1024, `render was ${outputBytes(content)} bytes`)
  assert.doesNotMatch(renderedText(content), /"schemaVersion"/, 'must not dump the raw case JSON')
})

test('every mutating tool renders under the 1 KB model-facing budget on a loaded case', async () => {
  const mounted = mountPlugin()
  await mounted.tools.get('scout_start').execute({
    caseId: 'budget', companyName: 'Example Co', roleTitle: 'HR Head', location: '',
  }, execFor())

  const items = []
  for (let index = 1; index <= 12; index += 1) {
    items.push({
      url: `https://example.com/report-${index}`,
      title: `Independent report ${index}`,
      claim: { text: `Finding number ${index} about the company and the role.`, dimension: 'risk', impact: 'material' },
    })
  }
  const value = await mounted.tools.get('scout_ingest').execute({
    caseId: 'budget', itemsJson: JSON.stringify(items),
  }, execFor())

  assertSchemaConforms(mounted, 'scout_ingest', value)
  assert.equal(value.counts.sources, 12)
  assert.equal(value.counts.claims, 12)
  assert.ok(value.changed.ids.length > 0)
  assert.ok(value.nextActions.length <= 3)

  const content = renderOutput(mounted, 'scout_ingest', value)
  assert.ok(outputBytes(content) < 1024, `render was ${outputBytes(content)} bytes`)
})

test('scout_report stays the only tool that returns the full artifact', async () => {
  const mounted = mountPlugin()
  await mounted.tools.get('scout_start').execute({
    caseId: 'full', companyName: 'Example Co', roleTitle: 'HR Head', location: '',
  }, execFor())

  const value = await mounted.tools.get('scout_report').execute({ caseId: 'full' }, execFor())
  assertSchemaConforms(mounted, 'scout_report', value)
  assert.equal(value.caseId, 'full')
  assert.equal(value.decision, 'VERIFY')
  assert.match(value.report, /# Example Co — HR Head/)
  assert.match(value.report, /## Verification checklist/)
})

/* ------------------------------------------------------------------ *
 * Durable export
 * ------------------------------------------------------------------ */

test('exports and imports a case through the fs-backed tools, reporting the resolved path', async () => {
  const fs = mockFs()
  const mounted = mountPlugin({ services: { fs } })

  await mounted.tools.get('scout_start').execute({
    caseId: 'persisted', companyName: 'Example Co', roleTitle: 'HR Head', location: 'Shenzhen',
  }, execFor())
  await mounted.tools.get('scout_add_source').execute({
    caseId: 'persisted', sourceId: 'job-posting', sourceType: 'job_posting',
    title: 'Example job posting', url: 'https://example.com/job', evidenceLevel: 'E1',
  }, execFor())
  await mounted.tools.get('scout_add_claim').execute({
    caseId: 'persisted', claimId: 'claim-1', text: 'The role exists.', status: 'reported',
    evidenceLevel: 'E1', dimension: 'role_existence', impact: 'blocking', sourceIds: 'job-posting',
    confidenceNote: 'The job posting is a company-controlled source.',
    nextAction: 'Confirm the mandate in the interview.',
  }, execFor())

  const exported = await mounted.tools.get('scout_export').execute({
    caseId: 'persisted', targetDir: '/tmp/scout-cases/persisted',
  }, execFor())
  assertSchemaConforms(mounted, 'scout_export', exported)
  assert.equal(exported.persisted, true)
  assert.equal(exported.complete, true)
  assert.equal(exported.targetDir, '/tmp/scout-cases/persisted')
  assert.deepEqual(exported.files, [
    'case.json', 'sources.json', 'claims.json', 'events.jsonl', 'report.md', 'export.complete.json',
  ])
  for (const fileName of exported.files) {
    assert.ok(fs.store.has(`/tmp/scout-cases/persisted/${fileName}`), `missing ${fileName}`)
  }

  const imported = await mounted.tools.get('scout_import').execute({
    caseId: 'persisted', sourceDir: '/tmp/scout-cases/persisted',
  }, execFor())
  assertSchemaConforms(mounted, 'scout_import', imported)
  assert.equal(imported.caseId, 'persisted')
  assert.equal(imported.complete, true)
  assert.equal(imported.counts.sources, 1)
  assert.equal(imported.counts.claims, 1)
  assert.equal(imported.decision, 'VERIFY')
})

test('a completed export contains the case_exported event it records, and extends stably', async () => {
  const fs = mockFs()
  const mounted = mountPlugin({ services: { fs } })
  await mounted.tools.get('scout_start').execute({
    caseId: 'faithful', companyName: 'Example Co', roleTitle: 'HR Head', location: '',
  }, execFor())

  const exportTool = mounted.tools.get('scout_export')
  await exportTool.execute({ caseId: 'faithful', targetDir: '/tmp/faithful' }, execFor())

  const firstTypes = fs.store.get('/tmp/faithful/events.jsonl').trim().split('\n').map(line => JSON.parse(line).type)
  assert.deepEqual(firstTypes, ['case_started', 'case_exported'])

  await mounted.tools.get('scout_import').execute({ caseId: 'faithful', sourceDir: '/tmp/faithful' }, execFor())
  await exportTool.execute({ caseId: 'faithful', targetDir: '/tmp/faithful' }, execFor())

  const secondTypes = fs.store.get('/tmp/faithful/events.jsonl').trim().split('\n').map(line => JSON.parse(line).type)
  assert.deepEqual(secondTypes, ['case_started', 'case_exported', 'case_imported', 'case_exported'])
})

test('an older export without a completion marker still imports but reports complete:false', async () => {
  const store = new Map()
  const legacy = exportCaseFiles(createCase({ caseId: 'legacy', companyName: 'Legacy Co', roleTitle: 'HR Head' }))
  for (const [fileName, content] of Object.entries(legacy)) {
    store.set(`/tmp/legacy/${fileName}`, content)
  }
  const mounted = mountPlugin({ services: { fs: mockFs(store) } })
  const imported = await mounted.tools.get('scout_import').execute({
    caseId: 'legacy', sourceDir: '/tmp/legacy',
  }, execFor())
  assert.equal(imported.complete, false)
  assert.equal(imported.caseId, 'legacy')
})

/* ------------------------------------------------------------------ *
 * autoPersist
 * ------------------------------------------------------------------ */

test('auto-persist reports success with the resolved directory on every mutation', async () => {
  const fs = mockFs()
  const mounted = mountPlugin({ config: { scoutDir: '/tmp/scout-cases', autoPersist: true }, services: { fs } })
  const started = await mounted.tools.get('scout_start').execute({
    caseId: 'auto', companyName: 'Example Co', roleTitle: 'HR Head', location: '',
  }, execFor())

  assertSchemaConforms(mounted, 'scout_start', started)
  assert.deepEqual(started.persist, { persisted: true, targetDir: '/tmp/scout-cases/auto' })
  assert.ok(fs.store.has('/tmp/scout-cases/auto/case.json'))
  assert.ok(fs.store.has('/tmp/scout-cases/auto/export.complete.json'))
  assert.match(fs.store.get('/tmp/scout-cases/auto/events.jsonl'), /"type":"case_exported"/)
})

test('auto-persist failure is surfaced instead of silently swallowed', async () => {
  const fs = mockFs(new Map(), { failWrites: 'disk full' })
  const mounted = mountPlugin({ config: { scoutDir: '/tmp/scout-cases', autoPersist: true }, services: { fs } })
  const started = await mounted.tools.get('scout_start').execute({
    caseId: 'failing', companyName: 'Example Co', roleTitle: 'HR Head', location: '',
  }, execFor())

  assertSchemaConforms(mounted, 'scout_start', started)
  assert.equal(started.persist.persisted, false)
  assert.match(started.persist.error, /disk full/)
  assert.match(renderedText(renderOutput(mounted, 'scout_start', started)), /PERSIST FAILED/)

  // A failed auto-persist must not claim that an export happened.
  const report = await mounted.tools.get('scout_report').execute({ caseId: 'failing' }, execFor())
  assert.match(report.report, /# Example Co — HR Head/)
  const exported = await mounted.tools.get('scout_export').execute({
    caseId: 'failing', targetDir: '/tmp/nope',
  }, execFor())
  assert.equal(exported.persisted, false)
  assert.equal(exported.complete, false)
  assert.match(exported.error, /disk full/)
})

test('auto-persist without a filesystem service degrades gracefully', async () => {
  const mounted = mountPlugin({ config: { scoutDir: '/tmp/scout-cases', autoPersist: true } })
  const started = await mounted.tools.get('scout_start').execute({
    caseId: 'no-fs', companyName: 'Example Co', roleTitle: 'HR Head', location: '',
  }, execFor())
  assert.equal(started.persist.persisted, false)
  assert.match(started.persist.error, /Filesystem service is unavailable/)
  const report = await mounted.tools.get('scout_report').execute({ caseId: 'no-fs' }, execFor())
  assert.match(report.report, /# Example Co — HR Head/)
})

/* ------------------------------------------------------------------ *
 * Late binding + rehydration
 * ------------------------------------------------------------------ */

test('optional services are resolved per call, not snapshotted at apply time', async () => {
  const mounted = mountPlugin()
  await mounted.tools.get('scout_start').execute({
    caseId: 'late', companyName: 'Late Co', roleTitle: 'HR Head', location: '',
  }, execFor())

  // Both optional services appear only after the plugin was applied.
  mounted.ctx.web = {
    async search() {
      return { sources: [{ url: 'https://example.com/late', title: 'Late result' }], truncated: false }
    },
  }
  const found = await mounted.tools.get('scout_search').execute({ caseId: 'late', query: 'late' }, execFor())
  assert.equal(found.counts.sources, 1)

  mounted.ctx.fs = mockFs()
  const exported = await mounted.tools.get('scout_export').execute({
    caseId: 'late', targetDir: '/tmp/late',
  }, execFor())
  assert.equal(exported.persisted, true)
})

test('a cache miss rehydrates the case from the export directory and records it', async () => {
  const store = new Map()
  const files = exportCaseFiles(createCase({ caseId: 'restored', companyName: 'Restored Co', roleTitle: 'HR Head' }))
  for (const [fileName, content] of Object.entries(files)) {
    store.set(`/tmp/scout-cases/restored/${fileName}`, content)
  }
  store.set('/tmp/scout-cases/restored/export.complete.json', '{"schemaVersion":"dsh-scout.export.v1","complete":true}\n')

  const mounted = mountPlugin({ config: { scoutDir: '/tmp/scout-cases' }, services: { fs: mockFs(store) } })
  const report = await mounted.tools.get('scout_report').execute({ caseId: 'restored' }, execFor())
  assert.match(report.report, /# Restored Co — HR Head/)

  const exported = await mounted.tools.get('scout_export').execute({
    caseId: 'restored', targetDir: '/tmp/out',
  }, execFor())
  assert.equal(exported.persisted, true)
  assert.match(store.get('/tmp/out/events.jsonl'), /"type":"case_rehydrated"/)
})

test('an unknown case reports the known cases and how to restore one', async () => {
  const mounted = mountPlugin({ services: { fs: mockFs() } })
  await mounted.tools.get('scout_start').execute({
    caseId: 'known', companyName: 'Known Co', roleTitle: 'HR Head', location: '',
  }, execFor())

  await assert.rejects(
    () => mounted.tools.get('scout_report').execute({ caseId: 'missing' }, execFor()),
    error => {
      assert.match(error.message, /Unknown case: missing/)
      assert.match(error.message, /Known cases in this session: known/)
      assert.match(error.message, /scout_import/)
      return true
    },
  )
})

/* ------------------------------------------------------------------ *
 * Ingestion, search, comparison
 * ------------------------------------------------------------------ */

test('scout_questions returns the derived question list', async () => {
  const mounted = mountPlugin()
  await mounted.tools.get('scout_start').execute({
    caseId: 'questions', companyName: 'Example Co', roleTitle: 'HR Head', location: '',
  }, execFor())
  const value = await mounted.tools.get('scout_questions').execute({ caseId: 'questions' }, execFor())
  assertSchemaConforms(mounted, 'scout_questions', value)
  assert.ok(value.questions.length > 0)
  assert.equal(new Set(value.questions).size, value.questions.length)
  assert.match(renderedText(renderOutput(mounted, 'scout_questions', value)), /1\. /)
})

test('scout_ingest batch-registers sources with inference and isolates errors', async () => {
  const mounted = mountPlugin()
  await mounted.tools.get('scout_start').execute({
    caseId: 'ingest', companyName: 'Example Co', roleTitle: 'HR Head', location: '',
  }, execFor())

  const result = await mounted.tools.get('scout_ingest').execute({
    caseId: 'ingest',
    itemsJson: JSON.stringify([
      { url: 'https://www.gsxt.gov.cn/company/1', title: 'Registry record' },
      { url: 'https://www.liepin.com/job/1', title: 'Job posting' },
      { url: 'https://example.com/unknown', title: 'Unclassified origin' },
      { url: 'https://example.com/bad-enum', title: 'Bad enum', sourceType: 'not-a-type' },
      { title: 'Missing url' },
    ]),
  }, execFor())

  assertSchemaConforms(mounted, 'scout_ingest', result)
  assert.equal(result.counts.sources, 3)
  assert.equal(result.counts.claims, 0)
  assert.equal(result.errors.length, 2, 'the invalid sourceType and the missing url are both reported')

  const report = (await mounted.tools.get('scout_report').execute({ caseId: 'ingest' }, execFor())).report
  assert.match(report, /gsxt\.gov\.cn/)
  assert.match(report, /company_registry \/ E3/)
  assert.match(report, /job_posting \/ E2/)
  assert.match(report, /other \/ E2/)
})

test('scout_ingest reuses an already-registered URL instead of duplicating the source', async () => {
  const mounted = mountPlugin()
  await mounted.tools.get('scout_start').execute({
    caseId: 'dedupe', companyName: 'Example Co', roleTitle: 'HR Head', location: '',
  }, execFor())
  const ingest = mounted.tools.get('scout_ingest')
  const payload = JSON.stringify([{ url: 'https://example.com/report', title: 'Report' }])

  const first = await ingest.execute({ caseId: 'dedupe', itemsJson: payload }, execFor())
  assert.deepEqual(first.changed.ids, ['src-1'])
  const second = await ingest.execute({ caseId: 'dedupe', itemsJson: payload }, execFor())
  assert.deepEqual(second.changed.ids, ['src-1'], 'the same URL must reuse its source id')
  assert.equal(second.counts.sources, 1)
})

test('scout_ingest drafts claims from items and keeps claim ids collision-safe', async () => {
  const mounted = mountPlugin()
  await mounted.tools.get('scout_start').execute({
    caseId: 'draft', companyName: 'Example Co', roleTitle: 'HR Head', location: '',
  }, execFor())
  const result = await mounted.tools.get('scout_ingest').execute({
    caseId: 'draft',
    itemsJson: JSON.stringify([
      { url: 'https://example.com/a', claim: { text: 'The role exists.', dimension: 'role_existence', impact: 'blocking' } },
      { url: 'https://example.com/b', claim: { text: 'Reporting line is unclear.', dimension: 'reporting_line' } },
    ]),
  }, execFor())

  assert.equal(result.counts.claims, 2)
  assert.equal(new Set(result.changed.ids).size, result.changed.ids.length)
  const report = (await mounted.tools.get('scout_report').execute({ caseId: 'draft' }, execFor())).report
  assert.match(report, /The role exists\./)
  assert.match(report, /Reporting line is unclear\./)
})

test('scout_ingest rejects malformed claims without aborting the batch', async () => {
  const mounted = mountPlugin()
  await mounted.tools.get('scout_start').execute({
    caseId: 'reject', companyName: 'Example Co', roleTitle: 'HR Head', location: '',
  }, execFor())
  const result = await mounted.tools.get('scout_ingest').execute({
    caseId: 'reject',
    itemsJson: JSON.stringify([
      { url: 'https://example.com/a', claim: { text: 'Bad status.', dimension: 'risk', status: 'certain' } },
      { url: 'https://example.com/b', claim: { text: 'Bad dimension.', dimension: 'nonsense' } },
      { url: 'https://example.com/c', claim: 'not-an-object' },
      { url: 'https://example.com/d', claim: { text: 'No source can back E3.', dimension: 'risk', evidenceLevel: 'E3' } },
      { url: 'https://example.com/e', claim: { text: 'This one is fine.', dimension: 'risk' } },
    ]),
  }, execFor())

  assert.equal(result.counts.claims, 1)
  assert.equal(result.errors.length, 4)
  assert.equal(result.counts.sources, 5, 'a rejected claim must not undo its registered source')
})

test('scout_search registers provider results, dedupes them, and requires the web service', async () => {
  const withoutWeb = mountPlugin()
  await withoutWeb.tools.get('scout_start').execute({
    caseId: 'search', companyName: 'Example Co', roleTitle: 'HR Head', location: '',
  }, execFor())
  await assert.rejects(
    () => withoutWeb.tools.get('scout_search').execute({ caseId: 'search', query: 'x' }, execFor()),
    /Web search service is unavailable/,
  )

  let seenLimit
  const mounted = mountPlugin({
    services: {
      web: {
        async search(request) {
          seenLimit = request.maxResults
          return {
            sources: [
              { url: 'https://www.gsxt.gov.cn/a', title: 'Registry' },
              { url: 'https://example.com/b', title: 'Media' },
              { title: 'No url' },
              'not-an-object',
            ],
            truncated: true,
          }
        },
      },
    },
  })
  await mounted.tools.get('scout_start').execute({
    caseId: 'search', companyName: 'Example Co', roleTitle: 'HR Head', location: '',
  }, execFor())

  const searchTool = mounted.tools.get('scout_search')
  const first = await searchTool.execute({ caseId: 'search', query: 'example', limit: 99 }, execFor())
  assertSchemaConforms(mounted, 'scout_search', first)
  assert.equal(seenLimit, 10, 'limit must be capped at 10')
  assert.equal(first.counts.sources, 2)
  assert.equal(first.errors.length, 2, 'a source without a url and a non-object are both rejected')

  const second = await searchTool.execute({ caseId: 'search', query: 'example', limit: 5 }, execFor())
  assert.equal(second.counts.sources, 2, 're-running the same search must not duplicate sources')
})

test('scout_compare renders a comparison, dedupes ids and rejects a single case', async () => {
  const mounted = mountPlugin()
  const start = mounted.tools.get('scout_start')
  await start.execute({ caseId: 'a', companyName: 'Company A', roleTitle: 'HR Head', location: '' }, execFor())
  await start.execute({ caseId: 'b', companyName: 'Company B', roleTitle: 'HRBP', location: '' }, execFor())

  const compare = mounted.tools.get('scout_compare')
  const value = await compare.execute({ caseIds: 'a, a, b' }, execFor())
  assertSchemaConforms(mounted, 'scout_compare', value)
  assert.deepEqual(value.caseIds, ['a', 'b'])
  assert.match(value.report, /Company A/)
  assert.match(value.report, /Company B/)

  await assert.rejects(() => compare.execute({ caseIds: 'a' }, execFor()), /at least two distinct/)
  await assert.rejects(() => compare.execute({ caseIds: ' , ' }, execFor()), /No case ids provided/)
  await assert.rejects(() => compare.execute({ caseIds: 'a, missing' }, execFor()), /Unknown case: missing/)
})

/* ------------------------------------------------------------------ *
 * Config and evidence policy through the tool surface
 * ------------------------------------------------------------------ */

test('exports a schemastery Config with sensible defaults', () => {
  const resolved = new Config({})
  assert.equal(resolved.scoutDir, 'dsh-scout')
  assert.equal(resolved.autoPersist, false)
  assert.ok(Array.isArray(resolved.authorityHostSuffixes))
  assert.ok(resolved.authorityHostSuffixes.includes('gov.cn'))
})

test('custom authority host suffixes replace the E3 trust boundary', async () => {
  const mounted = mountPlugin({ config: { authorityHostSuffixes: ['example.gov'] } })
  await mounted.tools.get('scout_start').execute({
    caseId: 'authority', companyName: 'Example Co', roleTitle: 'HR Head', location: '',
  }, execFor())

  // The replacement list trusts example.gov ...
  const accepted = await mounted.tools.get('scout_add_source').execute({
    caseId: 'authority', sourceId: 'registry', sourceType: 'company_registry',
    title: 'Registry', url: 'https://registry.example.gov/co/1', evidenceLevel: 'E3',
  }, execFor())
  assert.equal(accepted.counts.sources, 1)

  // ... and no longer trusts the built-in gsxt origin.
  await assert.rejects(
    () => mounted.tools.get('scout_add_source').execute({
      caseId: 'authority', sourceId: 'gsxt', sourceType: 'company_registry',
      title: 'Gsxt', url: 'https://www.gsxt.gov.cn/co/9', evidenceLevel: 'E3',
    }, execFor()),
    /E3 sources require a supported registry/,
  )

  const verified = await mounted.tools.get('scout_verify_identity').execute({
    caseId: 'authority', legalEntity: 'Example Co Ltd', registrationNumber: '123',
    registeredRegion: 'Shenzhen', legalRepresentative: 'Zhang San',
    brandRelationship: 'Operating entity', sourceIds: 'registry',
  }, execFor())
  assert.equal(verified.identity, 'verified')

  assert.equal(isTrustedAuthorityUrl('https://www.gsxt.gov.cn/a', ['example.gov']), false)
  assert.equal(isTrustedAuthorityUrl('https://registry.example.gov/a', ['example.gov']), true)
})

test('the evidence constraints stay enforced through the tool surface', async () => {
  const mounted = mountPlugin()
  await mounted.tools.get('scout_start').execute({
    caseId: 'evidence', companyName: 'Example Co', roleTitle: 'HR Head', location: '',
  }, execFor())
  const addSource = mounted.tools.get('scout_add_source')
  const addClaim = mounted.tools.get('scout_add_claim')

  // A self-labelled E3 source outside a trusted authority origin is refused.
  await assert.rejects(
    () => addSource.execute({
      caseId: 'evidence', sourceId: 'fake', sourceType: 'company_registry',
      title: 'Fake registry', url: 'https://not-really-a-registry.example/', evidenceLevel: 'E3',
    }, execFor()),
    /E3 sources require a supported registry/,
  )

  await addSource.execute({
    caseId: 'evidence', sourceId: 'media', sourceType: 'independent_media',
    title: 'Media', url: 'https://example.com/media', evidenceLevel: 'E2',
  }, execFor())

  // A claim may not exceed its strongest source.
  await assert.rejects(
    () => addClaim.execute({
      caseId: 'evidence', claimId: 'c1', text: 'Over-claimed.', status: 'verified',
      evidenceLevel: 'E3', dimension: 'risk', impact: 'material', sourceIds: 'media',
      confidenceNote: 'No.', nextAction: 'Verify.',
    }, execFor()),
    /exceeds its strongest source/,
  )

  // A claim cannot be verified on E0.
  await assert.rejects(
    () => addClaim.execute({
      caseId: 'evidence', claimId: 'c2', text: 'No evidence.', status: 'verified',
      evidenceLevel: 'E0', dimension: 'risk', impact: 'material', sourceIds: 'media',
      confidenceNote: 'No.', nextAction: 'Verify.',
    }, execFor()),
    /at least E1/,
  )

  // A claim with no source must stay unknown / needs_verification.
  await assert.rejects(
    () => addClaim.execute({
      caseId: 'evidence', claimId: 'c3', text: 'Unsourced.', status: 'reported',
      evidenceLevel: 'E1', dimension: 'risk', impact: 'material', sourceIds: '',
      confidenceNote: 'No.', nextAction: 'Verify.',
    }, execFor()),
    /must remain unknown or needs_verification/,
  )

  const ok = await addClaim.execute({
    caseId: 'evidence', claimId: 'c4', text: 'Sourced finding.', status: 'reported',
    evidenceLevel: 'E2', dimension: 'risk', impact: 'material', sourceIds: 'media',
    confidenceNote: 'Independent media.', nextAction: 'Cross-check.',
  }, execFor())
  assertSchemaConforms(mounted, 'scout_add_claim', ok)
  assert.equal(ok.counts.claims, 1)
  assert.deepEqual(ok.nextActions, ['Cross-check.'])
})

test('inference helpers keep matching the documented classification', () => {
  assert.deepEqual(inferSourceType('https://www.gsxt.gov.cn/a'), { type: 'company_registry', inferred: true })
  assert.deepEqual(inferSourceType('https://www.liepin.com/a'), { type: 'job_posting', inferred: true })
  assert.equal(inferEvidenceLevel('https://www.gsxt.gov.cn/a', 'company_registry').evidenceLevel, 'E3')
  assert.equal(inferEvidenceLevel('https://example.com/a', 'other').evidenceLevel, 'E2')
})

/* ------------------------------------------------------------------ *
 * 0.9.1: coverage, language, normalized dedupe
 * ------------------------------------------------------------------ */

test('scout_report returns per-dimension coverage alongside the rendered report', async () => {
  const mounted = mountPlugin()
  await mounted.tools.get('scout_start').execute({
    caseId: 'coverage', companyName: 'Example Co', roleTitle: 'HR Head', location: '',
  }, execFor())

  const value = await mounted.tools.get('scout_report').execute({ caseId: 'coverage' }, execFor())
  assertSchemaConforms(mounted, 'scout_report', value)
  assert.equal(value.coverage.length, 11)
  assert.ok(value.coverage.every(entry => entry.untouched === true))
  const identity = value.coverage.find(entry => entry.dimension === 'identity')
  assert.deepEqual(identity, { dimension: 'identity', verified: 0, open: 0, untouched: true })
  assert.match(value.report, /## Coverage/)
})

test('the configured language drives the report, the questions and the structured value', async () => {
  const mounted = mountPlugin({ config: { language: 'en' } })
  await mounted.tools.get('scout_start').execute({
    caseId: 'english', companyName: 'Example Co', roleTitle: 'HR Head', location: '',
  }, execFor())

  const report = (await mounted.tools.get('scout_report').execute({ caseId: 'english' }, execFor())).report
  assert.match(report, /- Decision: \*\*VERIFY\*\*/)
  assert.match(report, /- Reason: /)
  assert.doesNotMatch(report, /判断|理由/)

  const questions = await mounted.tools.get('scout_questions').execute({ caseId: 'english' }, execFor())
  assert.ok(questions.questions.length > 0)
  assert.ok(questions.questions.some(question => /role|reporting|mandate|decision/i.test(question)))

  // The default deployment stays byte-compatible in Chinese.
  const chinese = mountPlugin()
  await chinese.tools.get('scout_start').execute({
    caseId: 'chinese', companyName: 'Example Co', roleTitle: 'HR Head', location: '',
  }, execFor())
  const zhReport = (await chinese.tools.get('scout_report').execute({ caseId: 'chinese' }, execFor())).report
  assert.match(zhReport, /- 判断：\*\*VERIFY\*\*/)

  const defaults = new Config({})
  assert.equal(defaults.language, 'zh-CN')
})

test('URL dedupe normalizes equivalents before creating a second source', async () => {
  const mounted = mountPlugin()
  await mounted.tools.get('scout_start').execute({
    caseId: 'normalized', companyName: 'Example Co', roleTitle: 'HR Head', location: '',
  }, execFor())
  const ingest = mounted.tools.get('scout_ingest')

  const first = await ingest.execute({
    caseId: 'normalized',
    itemsJson: JSON.stringify([{ url: 'https://Example.com/report/', title: 'Report' }]),
  }, execFor())
  const second = await ingest.execute({
    caseId: 'normalized',
    itemsJson: JSON.stringify([{ url: 'https://example.com/report', title: 'Report' }]),
  }, execFor())

  assert.deepEqual(second.changed.ids, first.changed.ids, 'host case and a trailing slash must not fork the source')
  assert.equal(second.counts.sources, 1)
})

/* ------------------------------------------------------------------ *
 * 0.9.1 verification fixes: marker integrity, rehydration strictness,
 * and the enforced render budget.
 * ------------------------------------------------------------------ */

test('the completion marker carries complete:false while an export is in flight', async () => {
  let failAfterMarker = false
  const store = new Map()
  const fs = {
    store,
    async resolve(path) {
      return { targetKey: path, displayPath: path }
    },
    async readText(target) {
      if (!store.has(target.displayPath)) throw new Error(`not found: ${target.displayPath}`)
      return store.get(target.displayPath)
    },
    async writeText(target, content) {
      if (failAfterMarker && target.displayPath.endsWith('claims.json')) throw new Error('disk full')
      store.set(target.displayPath, content)
      return { operation: 'create' }
    },
  }
  const mounted = mountPlugin({ services: { fs } })
  await mounted.tools.get('scout_start').execute({
    caseId: 'torn', companyName: 'Example Co', roleTitle: 'HR Head', location: '',
  }, execFor())

  // A first, complete export.
  const good = await mounted.tools.get('scout_export').execute({ caseId: 'torn', targetDir: '/tmp/torn' }, execFor())
  assert.equal(good.complete, true)
  assert.equal(JSON.parse(store.get('/tmp/torn/export.complete.json')).complete, true)

  // A later export that dies in the middle must not leave a stale "complete".
  failAfterMarker = true
  const bad = await mounted.tools.get('scout_export').execute({ caseId: 'torn', targetDir: '/tmp/torn' }, execFor())
  assert.equal(bad.persisted, false)
  assert.equal(bad.complete, false)
  assert.equal(
    JSON.parse(store.get('/tmp/torn/export.complete.json')).complete,
    false,
    'the marker must be invalidated before the payload is rewritten',
  )

  failAfterMarker = false
  const imported = await mounted.tools.get('scout_import').execute({ caseId: 'torn', sourceDir: '/tmp/torn' }, execFor())
  assert.equal(imported.complete, false, 'a mixed-generation directory must not report complete')
})

test('the completion marker records the export it belongs to', async () => {
  const fs = mockFs()
  const mounted = mountPlugin({ services: { fs } })
  await mounted.tools.get('scout_start').execute({
    caseId: 'marker', companyName: 'Example Co', roleTitle: 'HR Head', location: '',
  }, execFor())
  await mounted.tools.get('scout_export').execute({ caseId: 'marker', targetDir: '/tmp/marker' }, execFor())

  const marker = JSON.parse(fs.store.get('/tmp/marker/export.complete.json'))
  assert.equal(marker.caseId, 'marker')
  assert.equal(marker.complete, true)
  assert.deepEqual(marker.files, ['case.json', 'sources.json', 'claims.json', 'events.jsonl', 'report.md'])
  const eventLines = fs.store.get('/tmp/marker/events.jsonl').trim().split('\n')
  assert.equal(marker.eventCount, eventLines.length, 'marker must describe the events it shipped with')
})

test('lazy rehydration refuses an export that never completed', async () => {
  const store = new Map()
  const files = exportCaseFiles(createCase({ caseId: 'partial', companyName: 'Partial Co', roleTitle: 'HR Head' }))
  for (const [fileName, content] of Object.entries(files)) {
    store.set(`/tmp/scout-cases/partial/${fileName}`, content)
  }
  // The marker exists but was never re-asserted as complete.
  store.set('/tmp/scout-cases/partial/export.complete.json', '{"schemaVersion":"dsh-scout.export.v1","complete":false}\n')

  const mounted = mountPlugin({ config: { scoutDir: '/tmp/scout-cases' }, services: { fs: mockFs(store) } })
  await assert.rejects(
    () => mounted.tools.get('scout_report').execute({ caseId: 'partial' }, execFor()),
    /Unknown case: partial/,
    'an incomplete export must not silently become this session case state',
  )
  // The explicit import path still works, and says so honestly.
  store.set('/tmp/partial/export.complete.json', '{"schemaVersion":"dsh-scout.export.v1","complete":false}\n')
  for (const [fileName, content] of Object.entries(files)) {
    store.set(`/tmp/partial/${fileName}`, content)
  }
  const imported = await mounted.tools.get('scout_import').execute({ caseId: 'partial', sourceDir: '/tmp/partial' }, execFor())
  assert.equal(imported.complete, false)
})

test('the render budget holds even for pathologically long free-text fields', async () => {
  const mounted = mountPlugin()
  await mounted.tools.get('scout_start').execute({
    caseId: 'long', companyName: 'Example Co', roleTitle: 'HR Head', location: '',
  }, execFor())
  await mounted.tools.get('scout_add_source').execute({
    caseId: 'long', sourceId: 'media', sourceType: 'independent_media',
    title: 'Media', url: 'https://example.com/media', evidenceLevel: 'E2',
  }, execFor())

  const value = await mounted.tools.get('scout_add_claim').execute({
    caseId: 'long', claimId: 'c1', text: 'A very long next action.', status: 'reported',
    evidenceLevel: 'E2', dimension: 'risk', impact: 'material', sourceIds: 'media',
    confidenceNote: 'x'.repeat(400),
    nextAction: 'y'.repeat(3000),
  }, execFor())

  assert.equal(value.nextActions[0].length, 3000, 'the canonical value keeps the full text')
  const content = renderOutput(mounted, 'scout_add_claim', value)
  assert.ok(outputBytes(content) <= 1024, `render was ${outputBytes(content)} bytes`)
})

test('a language change re-localizes untouched case-authored copy but keeps user edits', async () => {
  const store = new Map()
  const seed = (caseId, dir, mutate) => {
    let scoutCase = createCase({ caseId, companyName: 'Example Co', roleTitle: 'HR Head' })
    if (mutate) scoutCase = mutate(scoutCase)
    for (const [fileName, content] of Object.entries(exportCaseFiles(scoutCase))) {
      store.set(`${dir}/${fileName}`, content)
    }
    store.set(`${dir}/export.complete.json`, '{"schemaVersion":"dsh-scout.export.v1","complete":true}\n')
  }
  seed('relabel', '/tmp/relabel')
  seed('edited', '/tmp/edited', scoutCase => ({
    ...scoutCase,
    decisionObjective: 'Prüfen, ob diese Rolle passt.',
  }))

  const mounted = mountPlugin({ config: { language: 'en' }, services: { fs: mockFs(store) } })
  const cjk = /[\u4e00-\u9fff]/

  const imported = await mounted.tools.get('scout_import').execute({ caseId: 'relabel', sourceDir: '/tmp/relabel' }, execFor())
  assert.equal(imported.complete, true)
  const report = (await mounted.tools.get('scout_report').execute({ caseId: 'relabel' }, execFor())).report
  assert.doesNotMatch(report, cjk, 'an en deployment must not render mixed-language case prose')
  assert.match(report, /- Objective: Decide whether this role is worth pursuing/)
  const questions = await mounted.tools.get('scout_questions').execute({ caseId: 'relabel' }, execFor())
  assert.ok(questions.questions.every(question => !cjk.test(question)), 'interview questions must follow the deployment language')

  // The exported case.json now agrees with its own content language.
  const exported = await mounted.tools.get('scout_export').execute({ caseId: 'relabel', targetDir: '/tmp/relabel-out' }, execFor())
  assert.equal(exported.persisted, true)
  const caseJson = JSON.parse(store.get('/tmp/relabel-out/case.json'))
  assert.equal(caseJson.language, 'en')
  assert.doesNotMatch(caseJson.decisionObjective, cjk)

  // A value the user wrote is not a factory default and must survive untouched.
  await mounted.tools.get('scout_import').execute({ caseId: 'edited', sourceDir: '/tmp/edited' }, execFor())
  const edited = (await mounted.tools.get('scout_report').execute({ caseId: 'edited' }, execFor())).report
  assert.match(edited, /Prüfen, ob diese Rolle passt\./)
})
