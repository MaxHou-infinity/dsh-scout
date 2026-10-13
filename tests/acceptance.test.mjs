/**
 * dsh-scout 0.9.1 — independent acceptance suite (task-6).
 *
 * Owned by the independent verifier, not by any implementer. It deliberately
 * does NOT re-use the assertions from `tests/tools.test.mjs` / `tests/model.test.mjs`;
 * it drives the frozen build through its own Cordis-shaped harness and takes
 * angles those suites do not cover:
 *
 *   1. `output.schema` is a *compiled native* JSON Schema, and the values of all
 *      twelve tools are validated against their own schema, with tamper controls
 *      proving the validator is live rather than vacuous;
 *   2. per-class render budgets, including the adversarial inputs that used to
 *      break them (the whole-render UTF-8 cap is asserted, not just observed);
 *   3. torn writes: the marker protocol (downgrade first, close last), what an
 *      interrupted write leaves on disk, and how `scout_import` and lazy
 *      rehydration each react — including the marker-vs-missing-file matrix;
 *   4. the *content* of `export.complete.json` (`complete`, `eventCount`, file
 *      list, case id) versus `events.jsonl` and `report.md`, not its existence;
 *   5. in-memory versus on-disk event counts under `autoPersist`, and three
 *      consecutive exports (complete → interrupted → complete);
 *   6. call-site service binding, provider replacement, cwd/signal forwarding
 *      and disposal;
 *   7. lazy rehydration from `<scoutDir>/<caseId>/`, including the case-id guard
 *      that stops an export of another case being adopted;
 *   8. `language: 'en'` end to end (including the persisted `report.md`) and the
 *      unchanged `zh-CN` byte shape.
 *
 * Round 1 of this suite pinned six defects as *characterization* tests; round 2
 * pinned a seventh as a *documented boundary* (`D10`). All seven were fixed and
 * are now asserted as the positive contract; the names say which defect each one
 * guards:
 *
 *   - G1 (lazy rehydration ignored the completion marker)   → marker is now required
 *   - G2 (the 1 KB render budget was not enforced)          → per-field + whole-render caps
 *   - G3 (a failed overwrite left a stale `complete:true`)  → marker is downgraded first
 *   - D1 (persisted report.md followed the case language)   → export follows the render language
 *   - D7 (ingest drafts hard-coded Chinese notes)           → both strings moved into i18n
 *   - D8 (stored factory prose kept the creation language)  → untouched defaults align
 *   - D10 (a partially edited question set froze its untouched factory entries)
 *                                                           → questions align entry by entry
 *
 * No test in this file asserts that a defect exists; §10b carries the seven-row
 * behaviour matrix for the entry-by-entry rule. No real assertion is relaxed
 * anywhere in this file.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { assertSupportedJsonSchema, validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { Config, apply } from '../dist/index.js'
import { CLAIM_DIMENSIONS, EXPORT_FILE_NAMES, scoutStrings } from '../dist/model.js'

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

/** Mutation-envelope tools: they share one `output.schema` and one renderer. */
const ENVELOPE_TOOLS = [
  'scout_add_claim',
  'scout_add_source',
  'scout_import',
  'scout_ingest',
  'scout_search',
  'scout_start',
  'scout_verify_claim',
  'scout_verify_identity',
]

const EXPORT_MARKER_FILE = 'export.complete.json'
/** Model-facing byte budget the README states for a compact render. */
const RENDER_BUDGET_BYTES = 1024
const CJK = /[\u4e00-\u9fff]/
const countCjk = text => (text.match(/[\u4e00-\u9fff]/gu) ?? []).length

const execFor = (sessionId = 'verifier', cwd = '/session/cwd') => ({
  agent: { id: sessionId, session: { header: { cwd } } },
  signal: new AbortController().signal,
})

/**
 * Mount the plugin on a minimal Cordis-shaped context.
 *
 * `effect()` mirrors Cordis' contract for the two shapes this plugin uses: the
 * tool registration is a *generator* yielding disposers, while the optional
 * service bindings are plain functions returning one disposer. `inject()`
 * defers until every dependency is mounted, so a service attached after
 * `apply()` still reaches its registration callback.
 */
function createHarness({ config, services = {} } = {}) {
  const tools = new Map()
  const disposers = []
  const injections = []

  const ctx = {
    get(serviceName) {
      return this[serviceName]
    },
    tools: {
      register(tool) {
        tools.set(tool.name, tool)
        return () => tools.delete(tool.name)
      },
    },
    effect(callback) {
      const produced = callback()
      if (typeof produced === 'function') {
        disposers.push(produced)
      } else if (produced && typeof produced[Symbol.iterator] === 'function') {
        for (const item of produced) if (typeof item === 'function') disposers.push(item)
      }
      return () => {}
    },
    inject(dependencies, callback) {
      const entry = { dependencies: [...dependencies], callback, flushed: false }
      injections.push(entry)
      flushInjections()
    },
    /** Attach a host service, then re-run every deferred injection. */
    mount(serviceName, service) {
      this[serviceName] = service
      flushInjections()
    },
  }

  function flushInjections() {
    for (const entry of injections) {
      if (entry.flushed) continue
      if (!entry.dependencies.every(name => ctx[name])) continue
      entry.flushed = true
      entry.callback(ctx)
    }
  }

  Object.assign(ctx, services)
  apply(ctx, config)
  flushInjections()

  return {
    ctx,
    tools,
    injections,
    get disposerCount() {
      return disposers.length
    },
    dispose() {
      while (disposers.length) disposers.pop()()
    },
  }
}

/** In-memory filesystem double that can fail on one named file. */
class MemoryFs {
  constructor({ failOn = null } = {}) {
    this.files = new Map()
    this.calls = []
    this.failOn = failOn
  }

  async resolve(path, options) {
    this.calls.push({ op: 'resolve', path, options })
    return { targetKey: `key:${path}`, displayPath: path }
  }

  async readText(target, signal) {
    this.calls.push({ op: 'readText', path: target.displayPath, signal })
    if (!this.files.has(target.displayPath)) {
      throw new Error(`ENOENT: no such file: ${target.displayPath}`)
    }
    return this.files.get(target.displayPath)
  }

  async writeText(target, content, intent, signal) {
    this.calls.push({ op: 'writeText', path: target.displayPath, content, intent, signal })
    const baseName = target.displayPath.slice(target.displayPath.lastIndexOf('/') + 1)
    if (this.failOn === baseName) {
      throw new Error(`simulated write failure on ${baseName}`)
    }
    this.files.set(target.displayPath, content)
    return { operation: 'create' }
  }

  read(path) {
    return this.files.get(path)
  }

  has(path) {
    return this.files.has(path)
  }

  list() {
    return [...this.files.keys()]
  }

  /** Basenames written, in call order — the completion marker appears twice. */
  get writeOrder() {
    return this.calls
      .filter(entry => entry.op === 'writeText')
      .map(entry => entry.path.slice(entry.path.lastIndexOf('/') + 1))
  }
}

function webStub(urls) {
  return {
    seen: [],
    async search(request) {
      this.seen.push(request)
      return { sources: urls.map(url => ({ url, title: `Result ${url}` })), truncated: false }
    },
  }
}

const call = (harness, name, args, exec) => harness.tools.get(name).execute(args, exec)

const renderBlocks = (harness, name, value) => harness.tools.get(name).output.render({}, value)
const renderText = blocks =>
  blocks.filter(block => block.type === 'text').map(block => block.text).join('\n')
const renderBytes = blocks => Buffer.byteLength(renderText(blocks), 'utf8')
const eventTypes = jsonl => (jsonl ?? '').trim()
  ? jsonl.trim().split('\n').map(line => JSON.parse(line).type)
  : []
const parseJsonl = jsonl => (jsonl ?? '').trim()
  ? jsonl.trim().split('\n').map(line => JSON.parse(line))
  : []

/** Seed a case with twelve sourced claims, the realistic "loaded" shape. */
async function seedLoadedCase(harness, caseId, exec) {
  await call(harness, 'scout_start', {
    caseId,
    companyName: 'Example Co',
    roleTitle: 'HR Head',
    location: 'Shenzhen',
  }, exec)
  const items = []
  for (let index = 1; index <= 12; index += 1) {
    items.push({
      url: `https://example.com/report-${index}`,
      title: `Independent report ${index}`,
      claim: {
        text: `Finding ${index} about the company and the role.`,
        dimension: index % 2 ? 'risk' : 'mandate',
        impact: index % 3 ? 'material' : 'blocking',
      },
    })
  }
  await call(harness, 'scout_ingest', { caseId, itemsJson: JSON.stringify(items) }, exec)
  return exec
}

/* ------------------------------------------------------------------ *
 * 1. Output schema is a real, compiled, enforced contract (12/12)
 * ------------------------------------------------------------------ */

test('all twelve tools publish a compiled JSON Schema that their own returned values satisfy', async () => {
  const fs = new MemoryFs()
  const harness = createHarness({ services: { fs, web: webStub(['https://example.com/found']) } })
  assert.deepEqual([...harness.tools.keys()].sort(), ALL_TOOLS)

  for (const [name, tool] of harness.tools) {
    // `assertSupportedJsonSchema` rejects the *spec* form (`required: true`
    // inside a property). Passing here means defineTool really compiled it.
    assert.doesNotThrow(() => assertSupportedJsonSchema(tool.output.schema), `${name} output schema`)
    assert.equal(typeof tool.output.render, 'function', `${name} must render`)
    assert.ok(
      !/"required":(true|false)/.test(JSON.stringify(tool.output.schema)),
      `${name} still exposes the uncompiled spec form of \`required\``,
    )
  }

  // One call per tool, in a sequence that is valid under the evidence policy.
  const exec = execFor()
  const values = new Map()
  values.set('scout_start', await call(harness, 'scout_start', {
    caseId: 'a', companyName: 'Alpha Co', roleTitle: 'HR Head', location: '',
  }, exec))
  assert.equal((await call(harness, 'scout_start', {
    caseId: 'b', companyName: 'Beta Co', roleTitle: 'CTO', location: '',
  }, exec)).ok, true)
  values.set('scout_add_source', await call(harness, 'scout_add_source', {
    caseId: 'a', sourceId: 'media', sourceType: 'independent_media',
    title: 'Media', url: 'https://example.com/media', evidenceLevel: 'E2',
  }, exec))
  assert.equal((await call(harness, 'scout_add_source', {
    caseId: 'a', sourceId: 'registry', sourceType: 'company_registry', title: 'Registry',
    url: 'https://www.gsxt.gov.cn/co/1', evidenceLevel: 'E3',
  }, exec)).ok, true)
  values.set('scout_add_claim', await call(harness, 'scout_add_claim', {
    caseId: 'a', claimId: 'c1', text: 'The role exists.', status: 'reported', evidenceLevel: 'E2',
    dimension: 'role_existence', impact: 'blocking', sourceIds: 'media',
    confidenceNote: 'Independent media.', nextAction: 'Confirm the mandate.',
  }, exec))
  values.set('scout_ingest', await call(harness, 'scout_ingest', {
    caseId: 'a', itemsJson: JSON.stringify([{ url: 'https://example.com/extra', title: 'Extra' }]),
  }, exec))
  values.set('scout_search', await call(harness, 'scout_search', { caseId: 'a', query: 'alpha' }, exec))
  values.set('scout_verify_identity', await call(harness, 'scout_verify_identity', {
    caseId: 'a', legalEntity: 'Alpha Co Ltd', registrationNumber: '91440300X',
    registeredRegion: 'Shenzhen', legalRepresentative: 'Zhang San',
    brandRelationship: 'Operating entity', sourceIds: 'registry',
  }, exec))
  values.set('scout_verify_claim', await call(harness, 'scout_verify_claim', {
    caseId: 'a', claimId: 'c1', evidenceLevel: 'E2', sourceIds: 'media,registry',
    confidenceNote: 'Two sources.', nextAction: 'Keep.',
  }, exec))
  values.set('scout_report', await call(harness, 'scout_report', { caseId: 'a' }, exec))
  values.set('scout_questions', await call(harness, 'scout_questions', { caseId: 'a' }, exec))
  values.set('scout_compare', await call(harness, 'scout_compare', { caseIds: 'a,b' }, exec))
  values.set('scout_export', await call(harness, 'scout_export', { caseId: 'a', targetDir: '/export/a' }, exec))
  values.set('scout_import', await call(harness, 'scout_import', { caseId: 'a', sourceDir: '/export/a' }, exec))

  assert.deepEqual([...values.keys()].sort(), ALL_TOOLS, 'every tool must be exercised exactly once')
  for (const [name, value] of values) {
    const schema = harness.tools.get(name).output.schema
    assert.deepEqual(
      validateJsonSchemaValue(schema, value),
      [],
      `${name} returned a value that violates its own declared output schema`,
    )
  }

  // Tamper controls: without these, the block above would also pass on a
  // validator that never reports anything.
  for (const [name, value] of values) {
    const schema = harness.tools.get(name).output.schema
    assert.ok(
      validateJsonSchemaValue(schema, {}).length > 0,
      `${name} schema must require its properties (an empty object was accepted)`,
    )
    assert.ok(
      validateJsonSchemaValue(schema, { ...value, __unexpected: true }).length > 0,
      `${name} schema must reject an undeclared property`,
    )
  }
  assert.ok(
    validateJsonSchemaValue(harness.tools.get('scout_report').output.schema, {
      ...values.get('scout_report'),
      decision: 'MAYBE',
    }).length > 0,
    'scout_report must reject a decision outside the closed enum',
  )
})

/* ------------------------------------------------------------------ *
 * 2. Render budgets
 * ------------------------------------------------------------------ */

test('mutating tools render a compact summary while report and compare stay the full artifact', async () => {
  const harness = createHarness({ services: { fs: new MemoryFs() } })
  const exec = await seedLoadedCase(harness, 'budget', execFor())

  const compact = new Map()
  compact.set('scout_ingest', await call(harness, 'scout_ingest', {
    caseId: 'budget', itemsJson: JSON.stringify([{ url: 'https://example.com/late', title: 'Late' }]),
  }, exec))
  compact.set('scout_add_source', await call(harness, 'scout_add_source', {
    caseId: 'budget', sourceId: 'late-src', sourceType: 'other', title: 'Late',
    url: 'https://example.com/late-2', evidenceLevel: 'E2',
  }, exec))
  compact.set('scout_add_claim', await call(harness, 'scout_add_claim', {
    caseId: 'budget', claimId: 'late-claim', text: 'Late claim.', status: 'reported', evidenceLevel: 'E2',
    dimension: 'risk', impact: 'material', sourceIds: 'late-src',
    confidenceNote: 'Late.', nextAction: 'Check it.',
  }, exec))
  compact.set('scout_start', await call(harness, 'scout_start', {
    caseId: 'budget-2', companyName: 'Second Co', roleTitle: 'CTO', location: '',
  }, exec))
  compact.set('scout_questions', await call(harness, 'scout_questions', { caseId: 'budget' }, exec))
  compact.set('scout_export', await call(harness, 'scout_export', {
    caseId: 'budget', targetDir: '/export/budget',
  }, exec))
  compact.set('scout_import', await call(harness, 'scout_import', {
    caseId: 'budget', sourceDir: '/export/budget',
  }, exec))

  for (const [name, value] of compact) {
    const blocks = renderBlocks(harness, name, value)
    assert.ok(Array.isArray(blocks) && blocks.length > 0, `${name} render must emit content`)
    assert.ok(blocks.every(block => block.type === 'text'), `${name} render blocks must be text`)
    const bytes = renderBytes(blocks)
    assert.ok(bytes < RENDER_BUDGET_BYTES, `${name} render was ${bytes} bytes (budget ${RENDER_BUDGET_BYTES})`)
    assert.doesNotMatch(renderText(blocks), /"schemaVersion"/, `${name} must not dump the raw case JSON`)
  }

  // The two documented full artifacts are the only renders allowed past 1 KB.
  const reportBlocks = renderBlocks(harness, 'scout_report', await call(harness, 'scout_report', { caseId: 'budget' }, exec))
  assert.ok(renderBytes(reportBlocks) > RENDER_BUDGET_BYTES, 'scout_report carries the full report')
  const reportText = renderText(reportBlocks)
  assert.match(reportText, /^# Example Co — HR Head$/m)
  for (const heading of [
    '## Coverage',
    '## Key supporting evidence (up to 3)',
    '## Blocking or unresolved risks (up to 3)',
    '## Role task and authority hypotheses',
    '## Verification checklist',
    '## Claim ledger',
    '## Sources',
    '## Interview questions',
  ]) {
    assert.ok(reportText.includes(heading), `report is missing ${heading}`)
  }
  assert.match(reportText, /https:\/\/example\.com\/report-1/, 'report must carry source URLs')
})

test('the 1 KB render budget holds even against adversarial caller-supplied text', async () => {
  // Round 1 pinned the opposite: a 3000-character `nextAction` produced a
  // 3121-byte render because only `changed.ids` was capped. Round 2 added
  // per-field clipping plus a whole-render UTF-8 hard cap, so this test now
  // asserts the budget itself — for ASCII, for multi-byte text, and for a
  // synthetic envelope with every field at maximum size.
  const harness = createHarness({ services: { fs: new MemoryFs() } })
  const exec = execFor()
  await call(harness, 'scout_start', { caseId: 'long', companyName: 'Long Co', roleTitle: 'HR Head', location: '' }, exec)
  await call(harness, 'scout_add_source', {
    caseId: 'long', sourceId: 'src', sourceType: 'other', title: 'Source',
    url: 'https://example.com/src', evidenceLevel: 'E2',
  }, exec)

  const ascii = 'X'.repeat(3000)
  const asciiValue = await call(harness, 'scout_add_claim', {
    caseId: 'long', claimId: 'c1', text: 'Short text.', status: 'reported', evidenceLevel: 'E2',
    dimension: 'risk', impact: 'blocking', sourceIds: 'src',
    confidenceNote: 'Note.', nextAction: ascii,
  }, exec)
  const asciiBytes = renderBytes(renderBlocks(harness, 'scout_add_claim', asciiValue))
  assert.ok(asciiBytes <= RENDER_BUDGET_BYTES, `ASCII render was ${asciiBytes} bytes`)
  // Only the render is capped: the structured value still carries the caller's
  // full text, so nothing is silently lost from the machine-readable field.
  assert.equal(asciiValue.nextActions[0], ascii, 'the value keeps the full nextAction')

  const cjk = '中'.repeat(3000)
  const cjkValue = await call(harness, 'scout_add_claim', {
    caseId: 'long', claimId: 'c2', text: '多字节文本。', status: 'reported', evidenceLevel: 'E2',
    dimension: 'risk', impact: 'material', sourceIds: 'src',
    confidenceNote: '备注。', nextAction: cjk,
  }, exec)
  const cjkBytes = renderBytes(renderBlocks(harness, 'scout_add_claim', cjkValue))
  assert.ok(cjkBytes <= RENDER_BUDGET_BYTES, `multi-byte render was ${cjkBytes} bytes`)

  // Three maximal multi-byte next actions: the per-field caps alone would still
  // exceed 1 KB, so the whole-render cap has to fire.
  for (let index = 3; index <= 4; index += 1) {
    await call(harness, 'scout_add_claim', {
      caseId: 'long', claimId: `c${index}`, text: `多字节 ${index}`, status: 'reported', evidenceLevel: 'E2',
      dimension: 'risk', impact: 'blocking', sourceIds: 'src',
      confidenceNote: '备注。', nextAction: '中'.repeat(500),
    }, exec)
  }
  const synthetic = {
    ok: true,
    caseId: '案'.repeat(200),
    decision: 'VERIFY',
    identity: 'needs_verification',
    counts: { sources: 1, claims: 4, verified: 0, open: 4 },
    changed: { kind: 'case_imported', ids: ['案'.repeat(60)] },
    nextActions: ['中'.repeat(500), '中'.repeat(500), '中'.repeat(500)],
    sourceDir: '/目'.repeat(200),
    complete: false,
  }
  const syntheticBlocks = renderBlocks(harness, 'scout_import', synthetic)
  const syntheticBytes = renderBytes(syntheticBlocks)
  assert.ok(syntheticBytes <= RENDER_BUDGET_BYTES, `worst-case render was ${syntheticBytes} bytes`)
  assert.ok(
    renderText(syntheticBlocks).endsWith('…'),
    'the whole-render cap must clip rather than silently drop trailing lines',
  )

  // F5: the clip budget is derived from the ellipsis it appends, so the clipped
  // result — ellipsis included — lands *on* the budget rather than some magic
  // number of bytes short of it. An ASCII-only envelope of the same shape is
  // therefore exactly one budget wide, whichever way the clip falls.
  const asciiSynthetic = {
    ok: true,
    caseId: 'A'.repeat(80),
    decision: 'VERIFY',
    identity: 'needs_verification',
    counts: { sources: 1, claims: 4, verified: 0, open: 4 },
    changed: { kind: 'case_imported', ids: ['B'.repeat(200)] },
    nextActions: Array.from({ length: 6 }, () => 'C'.repeat(140)),
    sourceDir: '/D'.repeat(160),
    complete: false,
  }
  const asciiSyntheticBytes = renderBytes(renderBlocks(harness, 'scout_import', asciiSynthetic))
  assert.equal(
    asciiSyntheticBytes,
    RENDER_BUDGET_BYTES,
    'an ASCII clip must fill the whole budget, ellipsis bytes included',
  )
  assert.ok(renderText(renderBlocks(harness, 'scout_import', asciiSynthetic)).endsWith('…'))

  // Emoji are four UTF-8 bytes carried by a surrogate pair, and the per-field
  // clip slices UTF-16 code units, so it can stop between the halves of a pair.
  // Every one of those renders must still fit the budget.
  for (const copies of [2, 3, 4, 5, 6, 7]) {
    const emojiEnvelope = {
      ...asciiSynthetic,
      caseId: '🙂'.repeat(120),
      changed: { kind: 'case_imported', ids: ['🚀'.repeat(120)] },
      nextActions: Array.from({ length: copies }, () => '🧭'.repeat(300)),
      sourceDir: `/🌍${'🙂'.repeat(200)}`,
    }
    const blocks = renderBlocks(harness, 'scout_import', emojiEnvelope)
    const bytes = renderBytes(blocks)
    assert.ok(bytes <= RENDER_BUDGET_BYTES, `${copies} emoji actions rendered ${bytes} bytes`)
    assert.ok(renderText(blocks).endsWith('…'), `${copies} emoji actions must be clipped, not dropped`)
    assert.ok(
      bytes > RENDER_BUDGET_BYTES - 4,
      `${copies} emoji actions rendered ${bytes} bytes: the clip must use the budget it has`,
    )
  }
})

/* ------------------------------------------------------------------ *
 * 3. Declared parameters are enforced before execution
 * ------------------------------------------------------------------ */

test('every tool rejects an empty argument object, so the declared parameters are not decorative', async () => {
  const harness = createHarness({ services: { fs: new MemoryFs(), web: webStub([]) } })
  assert.deepEqual([...harness.tools.keys()].sort(), ALL_TOOLS)
  for (const name of ALL_TOOLS) {
    await assert.rejects(
      () => call(harness, name, {}, execFor()),
      error => {
        assert.equal(error.name, 'ToolArgsError', `${name} must fail argument validation, got ${error.name}`)
        assert.match(error.message, /missing required property/, `${name} must name the missing property`)
        return true
      },
      `${name} accepted an empty argument object`,
    )
  }
})

/* ------------------------------------------------------------------ *
 * 4. autoPersist failure visibility
 * ------------------------------------------------------------------ */

test('a failed autoPersist is visible in the return value and drops the case_exported event it could not write', async () => {
  const fs = new MemoryFs()
  const harness = createHarness({ config: { scoutDir: '/auto', autoPersist: true }, services: { fs } })
  const exec = execFor()
  await call(harness, 'scout_start', { caseId: 'auto', companyName: 'Auto Co', roleTitle: 'HR Head', location: '' }, exec)
  assert.deepEqual(eventTypes(fs.read('/auto/auto/events.jsonl')), ['case_started', 'case_exported'])
  assert.equal(JSON.parse(fs.read('/auto/auto/export.complete.json')).eventCount, 2)

  // Fail half-way through the next write: the event stream itself fails.
  fs.failOn = 'events.jsonl'
  const failed = await call(harness, 'scout_add_source', {
    caseId: 'auto', sourceId: 'src', sourceType: 'other', title: 'Source',
    url: 'https://example.com/src', evidenceLevel: 'E2',
  }, exec)

  assert.equal(failed.persist.persisted, false)
  assert.equal(failed.persist.targetDir, '/auto/auto')
  assert.match(failed.persist.error, /events\.jsonl/)
  assert.match(renderText(renderBlocks(harness, 'scout_add_source', failed)), /PERSIST FAILED/)

  // The event the failed write would have recorded is absent from disk: the
  // directory still holds the previous generation's event stream, so it never
  // claims a case_exported that did not happen.
  const onDisk = eventTypes(fs.read('/auto/auto/events.jsonl'))
  assert.deepEqual(onDisk, ['case_started', 'case_exported'], 'the failed write must not append an event')
  assert.ok(!onDisk.includes('source_added'))

  // The failed attempt left the directory explicitly invalid rather than
  // apparently complete.
  assert.equal(JSON.parse(fs.read('/auto/auto/export.complete.json')).complete, false)

  // The in-memory case must be just as honest: the next successful export
  // records exactly one more case_exported, not one per attempt.
  fs.failOn = null
  const healed = await call(harness, 'scout_export', { caseId: 'auto', targetDir: '/auto/healed' }, exec)
  assert.equal(healed.persisted, true)
  assert.deepEqual(eventTypes(fs.read('/auto/healed/events.jsonl')), [
    'case_started', 'case_exported', 'source_added', 'case_exported',
  ])
  const healedMarker = JSON.parse(fs.read('/auto/healed/export.complete.json'))
  assert.equal(healedMarker.complete, true)
  assert.equal(healedMarker.eventCount, 4)
})

test('an interrupted overwrite downgrades the completion marker instead of leaving a stale complete:true', async () => {
  // Round 1 pinned the opposite: the marker was written last, so an interrupted
  // *overwrite* of an existing export left the previous `complete:true` marker
  // beside mixed-generation files and `scout_import` reported `complete: true`.
  // Round 2 writes the marker as `complete:false` before touching the payload
  // and only re-asserts `complete:true` after every data file landed, so this
  // test now asserts the invalidation contract.
  const fs = new MemoryFs()
  const harness = createHarness({ config: { scoutDir: '/auto', autoPersist: true }, services: { fs } })
  const exec = execFor()
  await call(harness, 'scout_start', { caseId: 'gen', companyName: 'Gen Co', roleTitle: 'HR Head', location: '' }, exec)

  // Generation 1 is complete and self-consistent.
  const firstMarker = JSON.parse(fs.read('/auto/gen/export.complete.json'))
  assert.equal(firstMarker.complete, true)
  assert.equal(firstMarker.eventCount, 2)
  assert.equal(firstMarker.eventCount, eventTypes(fs.read('/auto/gen/events.jsonl')).length)

  // Generation 2 fails on events.jsonl, after case.json/sources.json/claims.json
  // were already overwritten.
  fs.failOn = 'events.jsonl'
  const failed = await call(harness, 'scout_add_claim', {
    caseId: 'gen', claimId: 'c1', text: 'A claim.', status: 'needs_verification', evidenceLevel: 'E0',
    dimension: 'risk', impact: 'material', sourceIds: '', confidenceNote: 'Note.', nextAction: 'Check.',
  }, exec)
  assert.equal(failed.persist.persisted, false)

  // The marker is now explicitly invalid — that, and not its existence, is what
  // a reader must trust. Its `eventCount` describes the attempt that failed, so
  // it deliberately disagrees with the still-old `events.jsonl` on disk.
  const tornMarker = JSON.parse(fs.read('/auto/gen/export.complete.json'))
  const eventsOnDisk = eventTypes(fs.read('/auto/gen/events.jsonl'))
  assert.equal(tornMarker.complete, false, 'an interrupted overwrite must downgrade the marker')
  assert.equal(JSON.parse(fs.read('/auto/gen/claims.json')).length, 1, 'claims.json is from the new generation')
  assert.ok(!eventsOnDisk.includes('claim_added'), 'events.jsonl still holds the previous generation')
  assert.notEqual(tornMarker.eventCount, eventsOnDisk.length, 'the invalidated marker describes the failed attempt')

  // A reader that respects the marker sees the directory as incomplete.
  const imported = await call(harness, 'scout_import', { caseId: 'gen', sourceDir: '/auto/gen' }, exec)
  assert.equal(imported.complete, false, 'a mixed-generation directory must not report complete:true')
  const freshInstance = createHarness({ config: { scoutDir: '/auto' }, services: { fs } })
  await assert.rejects(
    () => call(freshInstance, 'scout_report', { caseId: 'gen' }, execFor()),
    /Unknown case: gen/,
    'rehydration must refuse an invalidated export',
  )

  // A later successful write restores agreement between the data and the marker.
  fs.failOn = null
  await call(harness, 'scout_export', { caseId: 'gen', targetDir: '/auto/gen' }, exec)
  const healedMarker = JSON.parse(fs.read('/auto/gen/export.complete.json'))
  assert.equal(healedMarker.complete, true)
  assert.equal(healedMarker.eventCount, eventTypes(fs.read('/auto/gen/events.jsonl')).length)
  assert.equal(healedMarker.eventCount, 4)
})

/* ------------------------------------------------------------------ *
 * 5. Export marker content agreement
 * ------------------------------------------------------------------ */

test('the export marker, events.jsonl, report.md and case.json agree with the case that was exported', async () => {
  const fs = new MemoryFs()
  const harness = createHarness({ services: { fs } })
  const exec = await seedLoadedCase(harness, 'agree', execFor())
  await call(harness, 'scout_verify_claim', {
    caseId: 'agree', claimId: 'claim-1', evidenceLevel: 'E2', sourceIds: 'src-1',
    confidenceNote: 'Verifier note.', nextAction: 'Next step.',
  }, exec)

  const exported = await call(harness, 'scout_export', { caseId: 'agree', targetDir: '/export/agree' }, exec)
  assert.equal(exported.persisted, true)
  assert.equal(exported.complete, true)
  assert.deepEqual(exported.files, [...EXPORT_FILE_NAMES, EXPORT_MARKER_FILE])
  for (const fileName of exported.files) {
    assert.ok(fs.has(`/export/agree/${fileName}`), `export is missing ${fileName}`)
  }

  const events = parseJsonl(fs.read('/export/agree/events.jsonl'))
  assert.equal(events.at(-1).type, 'case_exported', 'the event this export records must be the last line on disk')
  assert.equal(events.at(-1).detail.targetDir, '/export/agree')
  assert.equal(events.at(-1).detail.auto, false, 'an explicit export must be marked as not automatic')

  const marker = JSON.parse(fs.read(`/export/agree/${EXPORT_MARKER_FILE}`))
  assert.equal(marker.schemaVersion, 'dsh-scout.export.v1')
  assert.equal(marker.caseId, 'agree')
  assert.deepEqual(marker.files, [...EXPORT_FILE_NAMES], 'the marker lists the five data files, not itself')
  assert.equal(marker.eventCount, events.length, 'the marker event count must match events.jsonl')

  const caseJson = JSON.parse(fs.read('/export/agree/case.json'))
  assert.equal(caseJson.caseId, 'agree')
  assert.equal(caseJson.decision, 'VERIFY')
  assert.ok(!('events' in caseJson), 'case.json must not duplicate the event stream')
  const sourcesJson = JSON.parse(fs.read('/export/agree/sources.json'))
  const claimsJson = JSON.parse(fs.read('/export/agree/claims.json'))
  assert.equal(sourcesJson.length, 12)
  assert.equal(claimsJson.length, 12)
  // The files must describe the same case the envelope reported, not a stale one.
  const envelopeCounts = (await call(harness, 'scout_import', {
    caseId: 'agree', sourceDir: '/export/agree',
  }, exec)).counts
  assert.equal(envelopeCounts.sources, sourcesJson.length)
  assert.equal(envelopeCounts.claims, claimsJson.length)

  // The persisted report snapshot must be the same artifact the report tool
  // returns — not a different rendering or a stale one.
  const report = await call(harness, 'scout_report', { caseId: 'agree' }, exec)
  assert.equal(fs.read('/export/agree/report.md'), report.report, 'report.md must equal the rendered report')
})

/* ------------------------------------------------------------------ *
 * 6. Memory vs disk event counts, stable export/import/export sequence
 * ------------------------------------------------------------------ */

test('autoPersist keeps the on-disk event stream equal to the in-memory event count', async () => {
  const fs = new MemoryFs()
  const harness = createHarness({ config: { scoutDir: '/auto', autoPersist: true }, services: { fs } })
  const exec = execFor()
  await call(harness, 'scout_start', { caseId: 'counts', companyName: 'Counts Co', roleTitle: 'HR Head', location: '' }, exec)
  await call(harness, 'scout_add_source', {
    caseId: 'counts', sourceId: 'src', sourceType: 'other', title: 'Source',
    url: 'https://example.com/src', evidenceLevel: 'E2',
  }, exec)
  await call(harness, 'scout_add_claim', {
    caseId: 'counts', claimId: 'c1', text: 'A claim.', status: 'reported', evidenceLevel: 'E2',
    dimension: 'risk', impact: 'material', sourceIds: 'src', confidenceNote: 'Note.', nextAction: 'Check.',
  }, exec)

  const lines = eventTypes(fs.read('/auto/counts/events.jsonl'))
  const marker = JSON.parse(fs.read('/auto/counts/export.complete.json'))
  assert.deepEqual(lines, [
    'case_started', 'case_exported', 'source_added', 'case_exported', 'claim_added', 'case_exported',
  ])
  assert.equal(marker.eventCount, lines.length, 'in-memory event count and events.jsonl line count must agree')

  // Export -> import -> export is append-only and does not renumber or repeat.
  await call(harness, 'scout_import', { caseId: 'counts', sourceDir: '/auto/counts' }, exec)
  await call(harness, 'scout_export', { caseId: 'counts', targetDir: '/auto/again' }, exec)
  const after = eventTypes(fs.read('/auto/again/events.jsonl'))
  assert.deepEqual(after.slice(0, lines.length), lines, 'the earlier stream must be preserved in order')
  assert.deepEqual(after.slice(lines.length), ['case_imported', 'case_exported'])
})

/* ------------------------------------------------------------------ *
 * 7. Torn exports
 * ------------------------------------------------------------------ */

test('a write that fails part-way leaves a torn export that is rejected or honestly marked incomplete', async () => {
  // (a) Interrupted on the third `writeText` call (case.json and sources.json
  // have landed, claims.json fails): the directory is unusable and
  // `scout_import` must say so instead of returning a partial case.
  const earlyFs = new MemoryFs({ failOn: 'claims.json' })
  const early = createHarness({ config: { scoutDir: '/scout' }, services: { fs: earlyFs } })
  const exec = execFor()
  await call(early, 'scout_start', { caseId: 'torn-early', companyName: 'Torn Co', roleTitle: 'HR Head', location: '' }, exec)
  const earlyExport = await call(early, 'scout_export', { caseId: 'torn-early', targetDir: '/scout/torn-early' }, exec)
  assert.equal(earlyExport.persisted, false)
  assert.equal(earlyExport.complete, false)
  assert.match(earlyExport.error, /claims\.json/)
  // Round 2 writes the marker *first*, as `complete: false`, and only re-asserts
  // it after the payload landed — so the interrupted directory now carries an
  // explicitly invalid marker rather than no marker at all.
  assert.deepEqual(earlyFs.list().sort(), [
    '/scout/torn-early/case.json',
    '/scout/torn-early/export.complete.json',
    '/scout/torn-early/sources.json',
  ])
  const earlyMarker = JSON.parse(earlyFs.read('/scout/torn-early/export.complete.json'))
  assert.equal(earlyMarker.complete, false)
  assert.equal(earlyMarker.caseId, 'torn-early')
  assert.ok(!earlyFs.has('/scout/torn-early/claims.json'))
  // The write order itself is the guarantee: marker(false) first, marker(true) last.
  assert.equal(earlyFs.writeOrder[0], EXPORT_MARKER_FILE)
  assert.equal(earlyFs.writeOrder.at(-1), 'claims.json', 'the failed run never reached the closing marker write')
  await assert.rejects(
    () => call(early, 'scout_import', { caseId: 'torn-early', sourceDir: '/scout/torn-early' }, exec),
    error => {
      assert.match(error.message, /claims\.json/, 'the rejection must name the missing file')
      return true
    },
  )
  // Retrying into the same directory converges, and the failed attempt left no
  // phantom export event behind.
  earlyFs.failOn = null
  const retried = await call(early, 'scout_export', { caseId: 'torn-early', targetDir: '/scout/torn-early' }, exec)
  assert.equal(retried.persisted, true)
  assert.deepEqual(eventTypes(earlyFs.read('/scout/torn-early/events.jsonl')), ['case_started', 'case_exported'])
  assert.equal(JSON.parse(earlyFs.read('/scout/torn-early/export.complete.json')).complete, true)
  // The retry brackets the payload with the marker: downgrade first, close last.
  assert.deepEqual(
    earlyFs.writeOrder.slice(-7),
    [EXPORT_MARKER_FILE, ...EXPORT_FILE_NAMES, EXPORT_MARKER_FILE],
    'the marker must be written both before and after the payload',
  )

  // (b) Interrupted on the closing marker write: all five data files exist, the
  // marker still says `complete: false`, and that is the only thing that says so.
  const lateFs = new MemoryFs()
  const late = createHarness({ config: { scoutDir: '/scout' }, services: { fs: lateFs } })
  await call(late, 'scout_start', { caseId: 'torn-late', companyName: 'Late Co', roleTitle: 'HR Head', location: '' }, exec)
  lateFs.failOn = null
  // Fail only the *second* marker write, i.e. the one that closes the export.
  const originalWrite = lateFs.writeText.bind(lateFs)
  let markerWrites = 0
  lateFs.writeText = async (target, content, intent, signal) => {
    const baseName = target.displayPath.slice(target.displayPath.lastIndexOf('/') + 1)
    if (baseName === EXPORT_MARKER_FILE && ++markerWrites === 2) {
      throw new Error(`simulated write failure on ${EXPORT_MARKER_FILE}`)
    }
    return originalWrite(target, content, intent, signal)
  }
  const lateExport = await call(late, 'scout_export', { caseId: 'torn-late', targetDir: '/scout/torn-late' }, exec)
  assert.equal(lateExport.persisted, false)
  assert.equal(lateExport.complete, false)
  for (const fileName of EXPORT_FILE_NAMES) {
    assert.ok(lateFs.has(`/scout/torn-late/${fileName}`), `${fileName} should have been written before the closing marker`)
  }
  assert.equal(
    JSON.parse(lateFs.read(`/scout/torn-late/${EXPORT_MARKER_FILE}`)).complete,
    false,
    'a run that never closed must leave the marker downgraded',
  )
  const imported = await call(late, 'scout_import', { caseId: 'torn-late', sourceDir: '/scout/torn-late' }, exec)
  assert.equal(imported.caseId, 'torn-late')
  assert.equal(imported.complete, false, 'a downgraded marker must report complete:false')

  // (c) The same directory *with* a closing marker imports as complete, and
  // deleting the marker afterwards downgrades it: the marker field is the only
  // completeness signal.
  lateFs.failOn = null
  await call(late, 'scout_export', { caseId: 'torn-late', targetDir: '/scout/torn-late' }, exec)
  assert.equal((await call(late, 'scout_import', {
    caseId: 'torn-late', sourceDir: '/scout/torn-late',
  }, exec)).complete, true)
  lateFs.files.delete(`/scout/torn-late/${EXPORT_MARKER_FILE}`)
  const withoutMarker = await call(late, 'scout_import', {
    caseId: 'torn-late', sourceDir: '/scout/torn-late',
  }, exec)
  assert.equal(withoutMarker.complete, false, 'a deleted marker must downgrade the import to incomplete')
  assert.equal(withoutMarker.counts.claims, 0)
})

test('three consecutive exports (complete, interrupted, complete) leave the marker and the event stream in agreement', async () => {
  // The round-2 marker protocol has to survive repeated overwrites, not just one
  // torn write: after a complete export, an interrupted one, and a final complete
  // one, the data on disk and the marker must agree again.
  const fs = new MemoryFs()
  const harness = createHarness({ config: { scoutDir: '/s' }, services: { fs } })
  const exec = execFor()
  const marker = () => JSON.parse(fs.read('/s/tri/export.complete.json'))
  const lines = () => eventTypes(fs.read('/s/tri/events.jsonl'))

  await call(harness, 'scout_start', { caseId: 'tri', companyName: 'Tri Co', roleTitle: 'HR Head', location: '' }, exec)
  const first = await call(harness, 'scout_export', { caseId: 'tri', targetDir: '/s/tri' }, exec)
  assert.equal(first.complete, true)
  assert.equal(marker().complete, true)
  assert.equal(marker().eventCount, lines().length)
  assert.deepEqual(lines(), ['case_started', 'case_exported'])

  await call(harness, 'scout_add_source', {
    caseId: 'tri', sourceId: 'src', sourceType: 'other', title: 'Source',
    url: 'https://example.com/src', evidenceLevel: 'E2',
  }, exec)
  fs.failOn = 'events.jsonl'
  const second = await call(harness, 'scout_export', { caseId: 'tri', targetDir: '/s/tri' }, exec)
  assert.equal(second.persisted, false)
  assert.equal(second.complete, false)
  assert.equal(marker().complete, false, 'the interrupted run leaves the marker invalid')
  assert.deepEqual(lines(), ['case_started', 'case_exported'], 'and leaves the old event stream intact')

  fs.failOn = null
  const third = await call(harness, 'scout_export', { caseId: 'tri', targetDir: '/s/tri' }, exec)
  assert.equal(third.complete, true)
  assert.equal(marker().complete, true)
  assert.deepEqual(lines(), ['case_started', 'case_exported', 'source_added', 'case_exported'])
  assert.equal(marker().eventCount, lines().length, 'the marker and events.jsonl agree again')
  assert.equal(JSON.parse(fs.read('/s/tri/sources.json')).length, 1)

  const imported = await call(harness, 'scout_import', { caseId: 'tri', sourceDir: '/s/tri' }, exec)
  assert.equal(imported.complete, true)
  assert.equal(imported.counts.sources, 1)
})

test('scout_import tells "no completion marker" apart from "a data file is missing"', async () => {
  // The completeness flag and the hard failure are two different signals: the
  // marker decides `complete`, the presence of the five data files decides
  // whether the import can happen at all.
  const buildComplete = async () => {
    const fs = new MemoryFs()
    const writer = createHarness({ config: { scoutDir: '/s' }, services: { fs } })
    const exec = execFor()
    await call(writer, 'scout_start', { caseId: 'mx', companyName: 'MX Co', roleTitle: 'HR Head', location: '' }, exec)
    await call(writer, 'scout_add_source', {
      caseId: 'mx', sourceId: 'src', sourceType: 'other', title: 'Source',
      url: 'https://example.com/src', evidenceLevel: 'E2',
    }, exec)
    await call(writer, 'scout_export', { caseId: 'mx', targetDir: '/s/mx' }, exec)
    return fs
  }
  const rewriteMarker = (fs, marker) => {
    fs.files.set('/s/mx/export.complete.json', marker === null ? '' : `${JSON.stringify(marker)}\n`)
  }
  const importOnce = async fs => {
    const reader = createHarness({ config: { scoutDir: '/s' }, services: { fs } })
    return call(reader, 'scout_import', { caseId: 'mx', sourceDir: '/s/mx' }, execFor())
      .then(value => ({ outcome: 'imported', complete: value.complete, counts: value.counts }), error => ({ outcome: 'threw', message: error.message }))
  }
  const rehydrateOnce = async fs => {
    const reader = createHarness({ config: { scoutDir: '/s' }, services: { fs } })
    return call(reader, 'scout_report', { caseId: 'mx' }, execFor())
      .then(() => 'rehydrated', () => 'refused')
  }

  const cases = []
  {
    const fs = await buildComplete()
    cases.push(['closing marker complete:true', fs, { imported: true }])
  }
  {
    const fs = await buildComplete()
    fs.files.delete('/s/mx/export.complete.json')
    cases.push(['marker file deleted', fs, { imported: false }])
  }
  {
    const fs = await buildComplete()
    rewriteMarker(fs, { schemaVersion: 'dsh-scout.export.v1', caseId: 'mx', complete: false, files: [...EXPORT_FILE_NAMES], eventCount: 2 })
    cases.push(['marker says complete:false', fs, { imported: false }])
  }
  {
    const fs = await buildComplete()
    fs.files.set('/s/mx/export.complete.json', 'not json at all')
    cases.push(['marker is unparsable', fs, { imported: false }])
  }
  {
    const fs = await buildComplete()
    fs.files.delete('/s/mx/claims.json')
    cases.push(['marker complete:true but a data file is missing', fs, { throws: true }])
  }
  {
    const fs = await buildComplete()
    fs.files.delete('/s/mx/export.complete.json')
    fs.files.delete('/s/mx/claims.json')
    cases.push(['no marker and a data file missing', fs, { throws: true }])
  }

  for (const [label, fs, expected] of cases) {
    const imported = await importOnce(fs)
    if (expected.throws) {
      assert.equal(imported.outcome, 'threw', `${label}: a missing data file must fail hard`)
      assert.match(imported.message, /claims\.json/, `${label}: the failure must name the missing file`)
    } else {
      assert.equal(imported.outcome, 'imported', `${label}: import must succeed`)
      assert.equal(imported.complete, expected.imported, `${label}: wrong complete flag`)
      assert.equal(imported.counts.sources, 1)
    }
    assert.equal(
      await rehydrateOnce(fs),
      expected.imported ? 'rehydrated' : 'refused',
      `${label}: rehydration follows the same rule`,
    )
  }
})

test('rehydration requires a completion marker asserting complete:true and refuses torn or legacy exports', async () => {
  // Round 1 pinned the opposite: rehydration only required the four data files,
  // so an export interrupted at `report.md` was adopted silently — including a
  // `case_exported` event the tool had reported as failed. Round 2 makes the
  // marker's `complete` field the gate, so this test now asserts the refusal.
  const fs = new MemoryFs()
  const writer = createHarness({ config: { scoutDir: '/scout' }, services: { fs } })
  const exec = execFor()
  await call(writer, 'scout_start', { caseId: 'silent', companyName: 'Silent Co', roleTitle: 'HR Head', location: '' }, exec)

  // Interrupted after four of five data files: the marker is left downgraded.
  fs.failOn = 'report.md'
  const torn = await call(writer, 'scout_export', { caseId: 'silent', targetDir: '/scout/silent' }, exec)
  assert.equal(torn.persisted, false)
  assert.equal(JSON.parse(fs.read('/scout/silent/export.complete.json')).complete, false)
  assert.ok(!fs.has('/scout/silent/report.md'))

  const reader = createHarness({ config: { scoutDir: '/scout' }, services: { fs } })
  await assert.rejects(
    () => call(reader, 'scout_report', { caseId: 'silent' }, execFor()),
    error => {
      assert.match(error.message, /Unknown case: silent/, 'an invalidated export must not be rehydrated')
      assert.match(error.message, /scout_import/, 'the error must still point at the explicit restore path')
      return true
    },
  )
  // ... while the explicit import still works and reports the truth.
  const imported = await call(reader, 'scout_import', { caseId: 'silent', sourceDir: '/scout/silent' }, exec)
  assert.equal(imported.complete, false)
  assert.equal(imported.counts.sources, 0)

  // Healing the export makes it rehydratable again.
  fs.failOn = null
  await call(writer, 'scout_export', { caseId: 'silent', targetDir: '/scout/silent' }, exec)
  assert.equal(JSON.parse(fs.read('/scout/silent/export.complete.json')).complete, true)
  const healed = createHarness({ config: { scoutDir: '/scout' }, services: { fs } })
  const report = await call(healed, 'scout_report', { caseId: 'silent' }, execFor())
  assert.match(report.report, /^# Silent Co — HR Head$/m)
  await call(healed, 'scout_export', { caseId: 'silent', targetDir: '/scout/silent-2' }, execFor())
  assert.deepEqual(eventTypes(fs.read('/scout/silent-2/events.jsonl')), [
    'case_started', 'case_exported', 'case_rehydrated', 'case_exported',
  ], 'a completed export rehydrates and records exactly one case_rehydrated')

  // A legacy 0.9.0 export has no marker at all: it must be restored explicitly
  // with `scout_import`, not silently adopted on a cache miss.
  fs.files.delete('/scout/silent/export.complete.json')
  const legacy = createHarness({ config: { scoutDir: '/scout' }, services: { fs } })
  await assert.rejects(
    () => call(legacy, 'scout_report', { caseId: 'silent' }, execFor()),
    /Unknown case: silent/,
    'a markerless legacy export must not be rehydrated',
  )
  const legacyImport = await call(legacy, 'scout_import', { caseId: 'silent', sourceDir: '/scout/silent' }, exec)
  assert.equal(legacyImport.complete, false, 'a legacy export still imports, honestly marked incomplete')
  assert.match((await call(legacy, 'scout_report', { caseId: 'silent' }, exec)).report, /Silent Co/)
})

/* ------------------------------------------------------------------ *
 * 8. Call-site service binding, replacement, forwarding and disposal
 * ------------------------------------------------------------------ */

test('services mounted after apply() are used, a replaced provider wins, and disposal removes every registration', async () => {
  const harness = createHarness()
  assert.equal(harness.tools.size, 12, 'tools register even with no host service present')
  assert.deepEqual(harness.injections.map(entry => entry.dependencies), [['commands'], ['skills']])

  const exec = execFor('late', '/session/cwd')
  await call(harness, 'scout_start', { caseId: 'late', companyName: 'Late Co', roleTitle: 'HR Head', location: '' }, exec)

  // `web` appears only now; `scout_search` must still see it.
  harness.ctx.mount('web', webStub(['https://www.gsxt.gov.cn/co/1']))
  const found = await call(harness, 'scout_search', { caseId: 'late', query: 'late' }, exec)
  assert.equal(found.counts.sources, 1)

  // `fs` appears only now; `scout_export` must still see it, and a *replaced*
  // provider must be the one that receives the writes.
  const firstFs = new MemoryFs()
  harness.ctx.mount('fs', firstFs)
  assert.equal((await call(harness, 'scout_export', { caseId: 'late', targetDir: 'relative/dir' }, exec)).persisted, true)
  assert.ok(firstFs.has('relative/dir/case.json'))

  const secondFs = new MemoryFs()
  harness.ctx.mount('fs', secondFs)
  assert.equal((await call(harness, 'scout_export', { caseId: 'late', targetDir: 'relative/dir' }, exec)).persisted, true)
  assert.ok(secondFs.has('relative/dir/case.json'), 'the replacement provider must receive the write')
  assert.equal(firstFs.list().filter(path => path.includes('export.complete.json')).length, 1, 'the old provider must not be used again')

  // The session cwd and the caller signal are forwarded to the write.
  const resolveCall = secondFs.calls.find(entry => entry.op === 'resolve')
  assert.equal(resolveCall.options.cwd, '/session/cwd', 'relative export paths resolve against the session cwd')
  assert.equal(resolveCall.options.signal, exec.signal)
  const writeCall = secondFs.calls.find(entry => entry.op === 'writeText')
  assert.equal(writeCall.signal, exec.signal, 'the write must forward exec.signal')

  // Optional host services registered after apply() are reached through inject.
  const commands = []
  const skills = []
  harness.ctx.mount('commands', { register: definition => { commands.push(definition); return () => commands.pop() } })
  harness.ctx.mount('skills', { register: definition => { skills.push(definition); return () => skills.pop() } })
  assert.deepEqual(commands.map(definition => definition.name), ['scout'])
  assert.deepEqual(skills.map(definition => definition.name), ['scout'])

  // Hold the tool object across disposal: the cache clearing is what must make
  // the call fail, not the registry lookup.
  const reportTool = harness.tools.get('scout_report')
  harness.dispose()
  assert.equal(harness.tools.size, 0, 'unload must remove every tool')
  assert.equal(commands.length, 0, 'unload must dispose the command registration')
  assert.equal(skills.length, 0, 'unload must dispose the skill registration')
  await assert.rejects(
    () => reportTool.execute({ caseId: 'late' }, exec),
    /Unknown case: late/,
    'unload must clear the in-memory case cache',
  )
})

/* ------------------------------------------------------------------ *
 * 9. Lazy rehydration
 * ------------------------------------------------------------------ */

test('a cache miss rehydrates from <scoutDir>/<caseId>/, records it, and refuses a mismatched case id', async () => {
  const fs = new MemoryFs()
  const writer = createHarness({ config: { scoutDir: '/scout' }, services: { fs } })
  const exec = execFor()
  await call(writer, 'scout_start', { caseId: 'restored', companyName: 'Restored Co', roleTitle: 'HR Head', location: '' }, exec)
  await call(writer, 'scout_export', { caseId: 'restored', targetDir: '/scout/restored' }, exec)
  assert.ok(fs.has('/scout/restored/export.complete.json'))

  const reader = createHarness({ config: { scoutDir: '/scout' }, services: { fs } })
  const report = await call(reader, 'scout_report', { caseId: 'restored' }, exec)
  assert.match(report.report, /^# Restored Co — HR Head$/m)
  await call(reader, 'scout_export', { caseId: 'restored', targetDir: '/scout/restored-2' }, exec)
  assert.deepEqual(eventTypes(fs.read('/scout/restored-2/events.jsonl')), [
    'case_started', 'case_exported', 'case_rehydrated', 'case_exported',
  ])

  // An export of a *different* case sitting in this case's directory must not be
  // adopted: rehydration is keyed by directory, and the id inside must match.
  const other = createHarness({ services: { fs } })
  await call(other, 'scout_start', { caseId: 'other', companyName: 'Other Co', roleTitle: 'HR Head', location: '' }, exec)
  await call(other, 'scout_export', { caseId: 'other', targetDir: '/scout/wanted' }, exec)
  const third = createHarness({ config: { scoutDir: '/scout' }, services: { fs } })
  await assert.rejects(
    () => call(third, 'scout_report', { caseId: 'wanted' }, execFor()),
    error => {
      assert.match(error.message, /Unknown case: wanted/)
      assert.match(error.message, /scout_import/, 'the error must suggest how to restore the case')
      return true
    },
  )
})

/* ------------------------------------------------------------------ *
 * 10. Language
 * ------------------------------------------------------------------ */

test('language: en renders every human surface, including the persisted report.md, in English', async () => {
  // Scope note: this covers claims added through `scout_add_claim`, i.e. every
  // string in the result is either framework text or caller-supplied. The
  // `scout_ingest` draft path is covered separately by the DEFECT D7 test below,
  // which shows it is NOT language-neutral.
  const fs = new MemoryFs()
  const harness = createHarness({ config: { language: 'en' }, services: { fs } })
  const exec = execFor()
  await call(harness, 'scout_start', { caseId: 'en-a', companyName: 'Example Co', roleTitle: 'HR Head', location: '' }, exec)
  await call(harness, 'scout_start', { caseId: 'en-b', companyName: 'Second Co', roleTitle: 'CTO', location: '' }, exec)

  const report = await call(harness, 'scout_report', { caseId: 'en-a' }, exec)
  assert.match(report.report, /- Decision: \*\*VERIFY\*\*/)
  assert.match(report.report, /- Reason: /)
  assert.match(report.report, /- Objective: /)
  assert.match(report.report, /- No sources yet/)
  assert.equal(CJK.test(report.report), false, 'an English report must not contain CJK characters')

  const questions = await call(harness, 'scout_questions', { caseId: 'en-a' }, exec)
  assert.ok(questions.questions.length > 0)
  assert.equal(CJK.test(questions.questions.join('')), false, 'English questions must not contain CJK')

  const comparison = await call(harness, 'scout_compare', { caseIds: 'en-a,en-b' }, exec)
  assert.match(comparison.report, /# Company \/ role comparison \(2 cases\)/)
  assert.equal(CJK.test(comparison.report), false, 'an English comparison must not contain CJK')

  // The export writes report.md through `exportCaseFiles`, a different code path
  // from `scout_report`; both must be English.
  const exported = await call(harness, 'scout_export', { caseId: 'en-a', targetDir: '/export/en' }, exec)
  assert.equal(exported.persisted, true)
  const persisted = fs.read('/export/en/report.md')
  assert.equal(CJK.test(persisted), false, 'the persisted report.md must be English too')
  assert.equal(persisted, report.report, 'the persisted snapshot must equal the rendered report')
  const caseJson = JSON.parse(fs.read('/export/en/case.json'))
  assert.equal(caseJson.language, 'en')
  assert.equal(CJK.test(caseJson.decisionReason), false)

  // The configured language must survive a round trip through an export.
  const reader = createHarness({ config: { language: 'en', scoutDir: '/export' }, services: { fs } })
  await call(reader, 'scout_import', { caseId: 'en-a', sourceDir: '/export/en' }, execFor())
  const reread = await call(reader, 'scout_report', { caseId: 'en-a' }, execFor())
  assert.match(reread.report, /- Decision: \*\*VERIFY\*\*/)
})

test('scout_ingest drafts its claim notes in the deployment language', async () => {
  // Round 1 pinned the opposite: the ingest draft path hard-coded Chinese
  // `confidenceNote` / `nextAction`, so an `en` case built through the documented
  // start -> ingest workflow produced 78 CJK characters in the report and in the
  // persisted report.md. Round 2 moved both strings into `i18n.ts`; this test now
  // asserts both languages, including that `zh-CN` is unchanged.
  const ingestOne = async (language, caseId) => {
    const fs = new MemoryFs()
    const harness = createHarness({ config: { language }, services: { fs } })
    const exec = execFor()
    await call(harness, 'scout_start', { caseId, companyName: 'Example Co', roleTitle: 'HR Head', location: '' }, exec)
    await call(harness, 'scout_ingest', {
      caseId,
      itemsJson: JSON.stringify([{
        url: 'https://example.com/a',
        title: 'Report A',
        claim: { text: 'The role exists.', dimension: 'role_existence' },
      }]),
    }, exec)
    const report = await call(harness, 'scout_report', { caseId }, exec)
    const questions = await call(harness, 'scout_questions', { caseId }, exec)
    await call(harness, 'scout_export', { caseId, targetDir: `/export/${caseId}` }, exec)
    return { report: report.report, questions: questions.questions, persisted: fs.read(`/export/${caseId}/report.md`) }
  }

  const english = await ingestOne('en', 'en-ingest')
  assert.equal(CJK.test(english.report), false, 'an English report must have no CJK on the ingest path either')
  assert.equal(CJK.test(english.persisted), false, 'and the persisted report.md must be English too')
  assert.equal(CJK.test(english.questions.join('')), false, 'and so must the derived interview questions')
  assert.match(
    english.report,
    /confidence: Auto-registered from an ingested item; source src-1; next action: Verify this claim and add an independent source/,
  )
  assert.equal(english.persisted, english.report, 'the persisted snapshot stays byte-equal to the report')

  const chinese = await ingestOne('zh-CN', 'zh-ingest')
  assert.match(
    chinese.report,
    /置信说明：由采集项自动登记，来源 src-1；下一步：核验该主张并补充独立来源/,
    'the zh-CN draft wording is unchanged, so the 0.9.0 byte-compat baseline still holds',
  )
  assert.equal(CJK.test(chinese.report), true)
})

test('the default zh-CN report keeps its pre-0.9.1 bytes and only adds the Coverage block', async () => {
  const defaults = new Config({})
  assert.equal(defaults.language, 'zh-CN')
  assert.equal(defaults.scoutDir, 'dsh-scout')
  assert.equal(defaults.autoPersist, false)

  const harness = createHarness({ services: { fs: new MemoryFs() } })
  const exec = execFor()
  await call(harness, 'scout_start', { caseId: 'zh', companyName: 'Example Co', roleTitle: 'HR Head', location: '' }, exec)
  const report = await call(harness, 'scout_report', { caseId: 'zh' }, exec)

  // Section headings are English in both languages — that is the shipped 0.9.0
  // shape, verified against `git show HEAD:src/model.ts`, not a translation gap.
  assert.deepEqual(
    report.report.split('\n').filter(line => line.startsWith('## ')),
    [
      '## Coverage',
      '## Key supporting evidence (up to 3)',
      '## Blocking or unresolved risks (up to 3)',
      '## Role task and authority hypotheses',
      '## Verification checklist',
      '## Claim ledger',
      '## Sources',
      '## Interview questions',
    ],
  )
  assert.match(report.report, /^- 判断：\*\*VERIFY\*\*$/m)
  assert.match(report.report, /^- 理由：尚未完成公司主体和岗位授权核验。$/m)
  assert.match(report.report, /^- 目标：判断是否值得进入下一轮，并准备面试反问$/m)
  assert.match(report.report, /^- 暂无来源$/m)
  assert.equal(CJK.test(report.report), true)

  // `## Coverage` reports all eleven dimensions, in CLAIM_DIMENSIONS order, and
  // the structured array must agree with the rendered block.
  assert.equal(report.coverage.length, CLAIM_DIMENSIONS.length)
  assert.deepEqual(report.coverage.map(entry => entry.dimension), [...CLAIM_DIMENSIONS])
  assert.ok(report.coverage.every(entry => entry.untouched === true))
  const coverageBlock = report.report.slice(
    report.report.indexOf('## Coverage'),
    report.report.indexOf('## Key supporting evidence'),
  )
  for (const dimension of CLAIM_DIMENSIONS) {
    assert.ok(coverageBlock.includes(`- ${dimension}（`), `coverage block is missing ${dimension}`)
  }
  assert.match(coverageBlock, /未调查维度（11）：/)
})

test('a case crossing a language boundary renders every surface, report.md included, in the deployment language', async () => {
  // Round 1 pinned the opposite: `exportCaseFiles` rendered with no language
  // override, so an `en` deployment importing a zh-CN case returned an English
  // `scout_report` but persisted a Chinese `report.md`. Round 2 threads the
  // deployment language through the export, so both are now the same artifact.
  const fs = new MemoryFs()
  const zh = createHarness({ services: { fs } })
  const exec = execFor()
  await call(zh, 'scout_start', { caseId: 'mixed', companyName: 'Mixed Co', roleTitle: 'HR Head', location: '' }, exec)
  await call(zh, 'scout_export', { caseId: 'mixed', targetDir: '/export/zh' }, exec)

  const en = createHarness({ config: { language: 'en' }, services: { fs } })
  await call(en, 'scout_import', { caseId: 'mixed', sourceDir: '/export/zh' }, exec)
  const report = await call(en, 'scout_report', { caseId: 'mixed' }, exec)
  await call(en, 'scout_export', { caseId: 'mixed', targetDir: '/export/en-from-zh' }, exec)

  assert.match(report.report, /^- Decision: \*\*VERIFY\*\*$/m, 'scout_report follows the configured language')
  assert.match(report.report, /^- Reason: /m)
  assert.match(report.report, /^- No sources yet$/m)
  const persisted = fs.read('/export/en-from-zh/report.md')
  assert.equal(persisted, report.report, 'the persisted snapshot and the rendered report are the same artifact')
  assert.doesNotMatch(persisted, /^- 判断：/, 'report.md no longer falls back to the case language')

  const caseJson = JSON.parse(fs.read('/export/en-from-zh/case.json'))
  assert.equal(caseJson.language, 'en', 'the case label follows the deployment language')
  assert.equal(CJK.test(caseJson.decisionReason), false, 'and the decision reason is rendered in it')

  // The mirror direction: a zh-CN deployment importing an en case.
  const fs2 = new MemoryFs()
  const enWriter = createHarness({ config: { language: 'en' }, services: { fs: fs2 } })
  await call(enWriter, 'scout_start', { caseId: 'rev', companyName: 'Rev Co', roleTitle: 'HR Head', location: '' }, execFor())
  await call(enWriter, 'scout_export', { caseId: 'rev', targetDir: '/export/rev-en' }, execFor())
  const zhReader = createHarness({ services: { fs: fs2 } })
  await call(zhReader, 'scout_import', { caseId: 'rev', sourceDir: '/export/rev-en' }, execFor())
  const zhReport = await call(zhReader, 'scout_report', { caseId: 'rev' }, execFor())
  await call(zhReader, 'scout_export', { caseId: 'rev', targetDir: '/export/rev-zh' }, execFor())
  assert.match(zhReport.report, /^- 判断：\*\*VERIFY\*\*$/m)
  assert.equal(fs2.read('/export/rev-zh/report.md'), zhReport.report)
  assert.equal(JSON.parse(fs2.read('/export/rev-zh/case.json')).language, 'zh-CN')
})

test('a case crossing a language boundary is single-language in both directions, on the import and rehydrate paths', async () => {
  // Round 1 pinned the render/export mismatch (D1) and round 2 pinned the residue
  // it left behind (D8): the case-stored prose fields kept the creation language,
  // so an "English" report carried a Chinese objective and five Chinese curated
  // questions while `case.json` claimed `language: "en"`. Round 3 aligns the
  // *untouched factory* values with the deployment language, so this test now
  // asserts a fully single-language artifact.
  const zhFactory = scoutStrings('zh-CN').defaults
  const enFactory = scoutStrings('en').defaults

  // --- zh-CN case into an `en` deployment, via the explicit import path -------
  const fs = new MemoryFs()
  const zh = createHarness({ services: { fs } })
  const exec = execFor()
  await call(zh, 'scout_start', { caseId: 'mixed', companyName: 'Mixed Co', roleTitle: 'HR Head', location: '' }, exec)
  await call(zh, 'scout_export', { caseId: 'mixed', targetDir: '/export/zh' }, exec)
  const originalZhCase = JSON.parse(fs.read('/export/zh/case.json'))
  assert.equal(originalZhCase.language, 'zh-CN')
  assert.deepEqual(originalZhCase.interviewQuestions, zhFactory.interviewQuestions)

  const en = createHarness({ config: { language: 'en' }, services: { fs } })
  await call(en, 'scout_import', { caseId: 'mixed', sourceDir: '/export/zh' }, exec)
  const report = await call(en, 'scout_report', { caseId: 'mixed' }, exec)
  const questions = await call(en, 'scout_questions', { caseId: 'mixed' }, exec)
  await call(en, 'scout_export', { caseId: 'mixed', targetDir: '/export/en-from-zh' }, exec)
  const caseJson = JSON.parse(fs.read('/export/en-from-zh/case.json'))

  assert.equal(CJK.test(report.report), false, 'the English report must contain no CJK at all')
  assert.equal(CJK.test(questions.questions.join('')), false, 'nor may the question list')
  assert.match(report.report, new RegExp(`^- Objective: ${enFactory.decisionObjective.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'))
  assert.equal(caseJson.language, 'en')
  assert.equal(caseJson.decisionObjective, enFactory.decisionObjective)
  assert.deepEqual(caseJson.interviewQuestions, enFactory.interviewQuestions)
  assert.equal(caseJson.role.fitQuestion, enFactory.fitQuestion)
  assert.deepEqual(questions.questions.slice(-5), enFactory.interviewQuestions, 'the curated tail is the English factory set')

  // --- en case into a zh-CN deployment: the mirror image ---------------------
  const fs2 = new MemoryFs()
  const enWriter = createHarness({ config: { language: 'en' }, services: { fs: fs2 } })
  await call(enWriter, 'scout_start', { caseId: 'rev', companyName: 'Rev Co', roleTitle: 'HR Head', location: '' }, execFor())
  await call(enWriter, 'scout_export', { caseId: 'rev', targetDir: '/export/rev-en' }, execFor())
  const zhReader = createHarness({ services: { fs: fs2 } })
  await call(zhReader, 'scout_import', { caseId: 'rev', sourceDir: '/export/rev-en' }, execFor())
  const zhReport = await call(zhReader, 'scout_report', { caseId: 'rev' }, execFor())
  const zhQuestions = await call(zhReader, 'scout_questions', { caseId: 'rev' }, execFor())
  await call(zhReader, 'scout_export', { caseId: 'rev', targetDir: '/export/rev-zh' }, execFor())
  const zhCase = JSON.parse(fs2.read('/export/rev-zh/case.json'))

  // No English factory prose may survive in a zh-CN deployment.
  for (const sentinel of [enFactory.decisionObjective, enFactory.fitQuestion, ...enFactory.interviewQuestions]) {
    assert.ok(!zhReport.report.includes(sentinel), `English factory prose leaked into the zh report: ${sentinel}`)
    assert.ok(!zhQuestions.questions.includes(sentinel), `English factory prose leaked into the zh questions: ${sentinel}`)
  }
  assert.equal(zhCase.language, 'zh-CN')
  assert.equal(zhCase.decisionObjective, zhFactory.decisionObjective)
  assert.deepEqual(zhCase.interviewQuestions, zhFactory.interviewQuestions)
  assert.equal(zhCase.role.fitQuestion, zhFactory.fitQuestion)

  // --- the lazy-rehydration path must align as well, not only scout_import ---
  const fs3 = new MemoryFs()
  const zhWriter = createHarness({ scoutDir: '/scout', services: { fs: fs3 } })
  await call(zhWriter, 'scout_start', { caseId: 'rehy', companyName: 'Rehy Co', roleTitle: 'HR Head', location: '' }, execFor())
  await call(zhWriter, 'scout_export', { caseId: 'rehy', targetDir: '/scout/rehy' }, execFor())
  const enReader = createHarness({ config: { language: 'en', scoutDir: '/scout' }, services: { fs: fs3 } })
  const rehydrated = await call(enReader, 'scout_report', { caseId: 'rehy' }, execFor())
  assert.equal(CJK.test(rehydrated.report), false, 'a rehydrated zh case must be aligned before rendering')
  assert.match(rehydrated.report, /^- Objective: /m)

  // --- round trip zh -> en -> zh restores the original factory prose ---------
  const fs4 = new MemoryFs()
  const first = createHarness({ scoutDir: '/rt', services: { fs: fs4 } })
  await call(first, 'scout_start', { caseId: 'rt', companyName: 'RT Co', roleTitle: 'HR Head', location: '' }, execFor())
  await call(first, 'scout_export', { caseId: 'rt', targetDir: '/rt/1' }, execFor())
  const middle = createHarness({ config: { language: 'en', scoutDir: '/rt' }, services: { fs: fs4 } })
  await call(middle, 'scout_import', { caseId: 'rt', sourceDir: '/rt/1' }, execFor())
  await call(middle, 'scout_export', { caseId: 'rt', targetDir: '/rt/2' }, execFor())
  const last = createHarness({ scoutDir: '/rt', services: { fs: fs4 } })
  await call(last, 'scout_import', { caseId: 'rt', sourceDir: '/rt/2' }, execFor())
  await call(last, 'scout_export', { caseId: 'rt', targetDir: '/rt/3' }, execFor())
  const restored = JSON.parse(fs4.read('/rt/3/case.json'))
  assert.equal(restored.language, 'zh-CN')
  assert.equal(restored.decisionObjective, zhFactory.decisionObjective)
  assert.deepEqual(restored.interviewQuestions, zhFactory.interviewQuestions)
  assert.equal(restored.role.fitQuestion, zhFactory.fitQuestion)
})

test('user-edited case prose survives a language change while untouched fields still align', async () => {
  // The complement of the test above: alignment must never overwrite what the
  // user wrote. Each field is decided independently, so editing the objective
  // does not freeze the questions (and the other way round).
  const enFactory = scoutStrings('en').defaults
  const zhFactory = scoutStrings('zh-CN').defaults
  const editAndMove = async (edit, caseId) => {
    const fs = new MemoryFs()
    const zh = createHarness({ scoutDir: '/u', services: { fs } })
    const exec = execFor()
    await call(zh, 'scout_start', { caseId, companyName: 'User Co', roleTitle: 'HR Head', location: '' }, exec)
    await call(zh, 'scout_export', { caseId, targetDir: `/u/${caseId}` }, exec)
    const edited = JSON.parse(fs.read(`/u/${caseId}/case.json`))
    edit(edited)
    fs.files.set(`/u/${caseId}/case.json`, `${JSON.stringify(edited, null, 2)}\n`)
    const en = createHarness({ config: { language: 'en', scoutDir: '/u2' }, services: { fs } })
    await call(en, 'scout_import', { caseId, sourceDir: `/u/${caseId}` }, exec)
    const report = await call(en, 'scout_report', { caseId }, exec)
    await call(en, 'scout_export', { caseId, targetDir: `/u/${caseId}-en` }, exec)
    return { reportText: report.report, caseJson: JSON.parse(fs.read(`/u/${caseId}-en/case.json`)) }
  }

  const customObjective = '用户自定义目标（勿改）'
  const objectiveEdited = await editAndMove(caseJson => { caseJson.decisionObjective = customObjective }, 'obj')
  assert.equal(objectiveEdited.caseJson.decisionObjective, customObjective, 'the edited objective is preserved verbatim')
  assert.match(objectiveEdited.reportText, /^- Objective: 用户自定义目标（勿改）$/m)
  assert.deepEqual(
    objectiveEdited.caseJson.interviewQuestions,
    enFactory.interviewQuestions,
    'the untouched question set still aligns',
  )
  assert.equal(objectiveEdited.caseJson.role.fitQuestion, enFactory.fitQuestion)

  const customFit = 'Custom fit question from the user'
  const fitEdited = await editAndMove(caseJson => { caseJson.role.fitQuestion = customFit }, 'fit')
  assert.equal(fitEdited.caseJson.role.fitQuestion, customFit)
  assert.equal(fitEdited.caseJson.decisionObjective, enFactory.decisionObjective, 'the objective still aligns')
  assert.deepEqual(fitEdited.caseJson.interviewQuestions, enFactory.interviewQuestions)

  // A fully user-authored question set is preserved as authored — in whatever
  // language the user wrote it.
  const customQuestions = ['Q1?', 'Q2?', 'Q3?', 'Q4?', 'Q5?']
  const questionsEdited = await editAndMove(caseJson => { caseJson.interviewQuestions = customQuestions }, 'qs')
  assert.deepEqual(questionsEdited.caseJson.interviewQuestions, customQuestions)
  assert.match(questionsEdited.reportText, /- Q1\?/, 'and the report renders them')
  assert.ok(!questionsEdited.reportText.includes(zhFactory.interviewQuestions[0]))

  // Sanity: nothing here is a factory string, so nothing may be swapped back.
  assert.notDeepEqual(questionsEdited.caseJson.interviewQuestions, enFactory.interviewQuestions)
})

/* ------------------------------------------------------------------ *
 * 10b. F1 — curated questions align entry by entry (D10, closed)
 *
 * Round 2 replaced the all-or-nothing rule with an index-wise one: when the
 * curated set still has the factory length, every entry that equals its factory
 * slot is aligned while an edited entry is kept verbatim; a set of a different
 * length is preserved as a whole. All seven rows of the behaviour matrix are
 * asserted below as the positive contract — no test here pins a defect.
 * ------------------------------------------------------------------ */

/**
 * Factory defaults per language. Every assertion in this section reads the
 * shipped i18n table, so wording changes in `src/i18n.ts` can never make a test
 * pass or fail for the wrong reason.
 */
const FACTORY = {
  'zh-CN': scoutStrings('zh-CN').defaults,
  en: scoutStrings('en').defaults,
}

/** `scout_import` recomputes the decision on the way in; no other key may move. */
const IMPORT_RECOMPUTED_KEYS = ['decision', 'decisionReason', 'decisionReasonCode']

const withoutRecomputed = caseJson => Object.fromEntries(
  Object.entries(caseJson).filter(([key]) => !IMPORT_RECOMPUTED_KEYS.includes(key)),
)

/**
 * Drive one case across a language boundary: create it in `from`, optionally
 * edit the exported `case.json`, then import that export into a deployment
 * rendering `to`. Returns the case.json that was imported, the case.json the
 * target deployment re-exported, and the report it rendered.
 */
async function crossLanguageImport({ caseId, from, to, edit, fs = new MemoryFs() }) {
  const exec = execFor()
  const sourceDir = `/matrix/${caseId}/from`
  const targetDir = `/matrix/${caseId}/to`
  const scoutDir = `/matrix/${caseId}`
  const writer = createHarness({ config: { language: from, scoutDir }, services: { fs } })
  await call(writer, 'scout_start', { caseId, companyName: 'Matrix Co', roleTitle: 'HR Head', location: '' }, exec)
  await call(writer, 'scout_export', { caseId, targetDir: sourceDir }, exec)
  const imported = JSON.parse(fs.read(`${sourceDir}/case.json`))
  if (edit) {
    edit(imported)
    fs.files.set(`${sourceDir}/case.json`, `${JSON.stringify(imported, null, 2)}\n`)
  }
  const reader = createHarness({ config: { language: to, scoutDir }, services: { fs } })
  await call(reader, 'scout_import', { caseId, sourceDir }, exec)
  const report = await call(reader, 'scout_report', { caseId }, exec)
  await call(reader, 'scout_export', { caseId, targetDir }, exec)
  return { imported, exported: JSON.parse(fs.read(`${targetDir}/case.json`)), report: report.report, fs }
}

test('F1 matrix 1/7 · an untouched factory question set aligns as a whole in an en deployment', async () => {
  const moved = await crossLanguageImport({ caseId: 'm1', from: 'zh-CN', to: 'en' })
  assert.deepEqual(
    moved.imported.interviewQuestions,
    FACTORY['zh-CN'].interviewQuestions,
    'the source really carried the untouched zh factory set',
  )
  assert.deepEqual(moved.exported.interviewQuestions, FACTORY.en.interviewQuestions)
  assert.equal(moved.exported.language, 'en')
  assert.equal(countCjk(moved.report), 0, 'an aligned en report carries no CJK at all')
})

test('F1 matrix 2/7 · D10 (closed): one edited entry is kept, the rest align, and the en report CJK equals that entry', async () => {
  const userQuestion = '我自己写的第三个问题？'
  const moved = await crossLanguageImport({
    caseId: 'm2',
    from: 'zh-CN',
    to: 'en',
    edit: caseJson => { caseJson.interviewQuestions[2] = userQuestion },
  })
  assert.equal(moved.exported.interviewQuestions[2], userQuestion, 'the edited entry is preserved verbatim')
  assert.deepEqual(
    moved.exported.interviewQuestions,
    FACTORY.en.interviewQuestions.map((question, index) => (index === 2 ? userQuestion : question)),
    'every untouched entry aligns to this deployment’s factory default',
  )
  assert.ok(moved.report.includes(userQuestion), 'the report renders the user’s own question')
  assert.ok(countCjk(userQuestion) > 0, 'the count assertion below is only meaningful if the user wrote CJK')
  assert.equal(
    countCjk(moved.report),
    countCjk(userQuestion),
    'the only CJK left in the en report is the user’s own question, not four frozen factory entries',
  )
})

test('F1 matrix 3/7 · a question set of a different length is preserved as a whole', async () => {
  const custom = ['自定义问题一？', '自定义问题二？', '自定义问题三？']
  const moved = await crossLanguageImport({
    caseId: 'm3',
    from: 'zh-CN',
    to: 'en',
    edit: caseJson => { caseJson.interviewQuestions = custom },
  })
  assert.equal(custom.length === FACTORY['zh-CN'].interviewQuestions.length, false, 'this row needs a different length')
  assert.deepEqual(moved.exported.interviewQuestions, custom)
  assert.ok(moved.report.includes(custom[0]), 'the report renders them as authored')
  assert.equal(
    moved.report.includes(FACTORY.en.interviewQuestions[0]),
    false,
    'no factory entry may be injected into a differently sized set',
  )
  assert.equal(
    countCjk(moved.report),
    custom.reduce((total, question) => total + countCjk(question), 0),
    'a differently sized set is kept whole, so its CJK is exactly what the user wrote',
  )
})

test('F1 matrix 4/7 · a same-length set with no factory entry left is equivalent to a whole-set replacement', async () => {
  const custom = ['A1?', 'A2?', 'A3?', 'A4?', 'A5?']
  const moved = await crossLanguageImport({
    caseId: 'm4',
    from: 'zh-CN',
    to: 'en',
    edit: caseJson => { caseJson.interviewQuestions = custom },
  })
  assert.equal(
    custom.length,
    FACTORY['zh-CN'].interviewQuestions.length,
    'the set has the factory length, so the entry-by-entry branch runs',
  )
  assert.deepEqual(moved.exported.interviewQuestions, custom, 'no entry matches its slot, so nothing is swapped')
  for (const question of custom) {
    assert.ok(moved.report.includes(`- ${question}`), `the report must render the user’s ${question}`)
  }
  assert.equal(
    FACTORY.en.interviewQuestions.some(question => moved.report.includes(question)),
    false,
    'no factory entry may be reintroduced into a fully custom set',
  )
})

test('F1 matrix 5/7 · the rule is symmetric: an en case aligns entry by entry into zh-CN', async () => {
  const whole = await crossLanguageImport({ caseId: 'm5a', from: 'en', to: 'zh-CN' })
  assert.deepEqual(whole.imported.interviewQuestions, FACTORY.en.interviewQuestions)
  assert.deepEqual(whole.exported.interviewQuestions, FACTORY['zh-CN'].interviewQuestions)
  assert.equal(whole.exported.language, 'zh-CN')

  const userQuestion = 'My own third question?'
  const partial = await crossLanguageImport({
    caseId: 'm5b',
    from: 'en',
    to: 'zh-CN',
    edit: caseJson => { caseJson.interviewQuestions[2] = userQuestion },
  })
  assert.deepEqual(
    partial.exported.interviewQuestions,
    FACTORY['zh-CN'].interviewQuestions.map((question, index) => (index === 2 ? userQuestion : question)),
    'the mirror image of row 2 holds with en as the source language',
  )
})

test('F1 matrix 6/7 · a zh → en → zh round trip restores every factory entry', async () => {
  const exec = execFor()
  const hop = async (fs, language, caseId, sourceDir, targetDir) => {
    const harness = createHarness({ config: { language, scoutDir: `/round/${caseId}` }, services: { fs } })
    if (sourceDir) {
      await call(harness, 'scout_import', { caseId, sourceDir }, exec)
    } else {
      await call(harness, 'scout_start', { caseId, companyName: 'Round Trip Co', roleTitle: 'HR Head', location: '' }, exec)
    }
    await call(harness, 'scout_export', { caseId, targetDir }, exec)
    return JSON.parse(fs.read(`${targetDir}/case.json`))
  }

  const fs = new MemoryFs()
  await hop(fs, 'zh-CN', 'm6', null, '/round/m6/1')
  const middle = await hop(fs, 'en', 'm6', '/round/m6/1', '/round/m6/2')
  assert.equal(middle.language, 'en')
  assert.deepEqual(middle.interviewQuestions, FACTORY.en.interviewQuestions)
  const restored = await hop(fs, 'zh-CN', 'm6', '/round/m6/2', '/round/m6/3')
  assert.equal(restored.language, 'zh-CN')
  assert.deepEqual(restored.interviewQuestions, FACTORY['zh-CN'].interviewQuestions)

  // The same trip with one entry edited: that entry survives both hops while
  // every other entry comes home to the zh factory value, slot by slot.
  const fs2 = new MemoryFs()
  const userQuestion = '只有这一条是用户改的？'
  await hop(fs2, 'zh-CN', 'm6b', null, '/round/m6b/1')
  const seeded = JSON.parse(fs2.read('/round/m6b/1/case.json'))
  seeded.interviewQuestions[2] = userQuestion
  fs2.files.set('/round/m6b/1/case.json', `${JSON.stringify(seeded, null, 2)}\n`)
  const middleB = await hop(fs2, 'en', 'm6b', '/round/m6b/1', '/round/m6b/2')
  assert.equal(middleB.interviewQuestions[2], userQuestion)
  assert.deepEqual(middleB.interviewQuestions.slice(0, 2), FACTORY.en.interviewQuestions.slice(0, 2))
  assert.deepEqual(middleB.interviewQuestions.slice(3), FACTORY.en.interviewQuestions.slice(3))
  const restoredB = await hop(fs2, 'zh-CN', 'm6b', '/round/m6b/2', '/round/m6b/3')
  assert.equal(restoredB.interviewQuestions[2], userQuestion, 'the user’s edit outlives both hops')
  assert.deepEqual(
    restoredB.interviewQuestions.filter((_, index) => index !== 2),
    FACTORY['zh-CN'].interviewQuestions.filter((_, index) => index !== 2),
    'and every other slot returns to the zh factory value',
  )
})

test('F1 matrix 7/7 · importing a case into its own language rewrites no case-authored field', async () => {
  const moved = await crossLanguageImport({ caseId: 'm7', from: 'zh-CN', to: 'zh-CN' })
  assert.equal(moved.imported.language, 'zh-CN')
  assert.deepEqual(
    withoutRecomputed(moved.exported),
    withoutRecomputed(moved.imported),
    'apart from the decision scout_import recomputes, case.json is field-for-field unchanged',
  )
  for (const field of ['language', 'title', 'decisionObjective', 'subject', 'role', 'interviewQuestions']) {
    assert.deepEqual(moved.exported[field], moved.imported[field], `${field} must survive a same-language import verbatim`)
  }
  assert.deepEqual(moved.exported.interviewQuestions, FACTORY['zh-CN'].interviewQuestions)
  assert.equal(moved.exported.decision, moved.imported.decision, 'the recomputed decision agrees with the imported one')
})

/* ------------------------------------------------------------------ *
 * 11. Explicit host entry points
 * ------------------------------------------------------------------ */

test('the /scout command exposes four working sub-actions and the scout Skill carries the evidence disciplines', async () => {
  const commands = []
  const skills = []
  const fs = new MemoryFs()
  const harness = createHarness()

  // Both services arrive after apply(), exercising the deferred inject path.
  harness.ctx.mount('commands', { register: definition => { commands.push(definition); return () => {} } })
  harness.ctx.mount('skills', { register: definition => { skills.push(definition); return () => {} } })
  harness.ctx.mount('fs', fs)

  assert.equal(commands.length, 1)
  assert.equal(commands[0].name, 'scout')
  assert.equal(skills[0].name, 'scout')
  assert.equal(skills[0].invocation.modelInvocable, true)
  assert.equal(skills[0].invocation.userInvocable, true)
  assert.match(skills[0].content, /Evidence discipline/)
  assert.match(skills[0].content, /scout_verify_identity/)
  assert.equal((skills[0].content.match(/^\d+\. /gm) ?? []).length >= 4, true)

  const exec = execFor('cmd-session')
  await call(harness, 'scout_start', { caseId: 'cmd', companyName: 'Command Co', roleTitle: 'HR Head', location: '' }, exec)
  const invoke = rawInput => commands[0].handler({
    rawInput,
    agent: { id: 'cmd-session', session: { header: { cwd: '/session/cwd' } } },
  })

  assert.match((await invoke('')).text, /^usage: \/scout status/, 'bare /scout prints usage')
  assert.match((await invoke('help')).text, /^usage: \/scout status/)
  assert.match((await invoke('status cmd')).text, /^\[cmd\] VERIFY · identity needs_verification/)
  assert.match((await invoke('questions cmd')).text, /^1\. /)
  assert.match((await invoke('report cmd')).text, /^# Command Co — HR Head$/m)
  const exported = await invoke('export cmd')
  assert.equal(exported.kind, 'success')
  assert.match(exported.text, /^exported to dsh-scout\/cmd$/)
  for (const fileName of [...EXPORT_FILE_NAMES, EXPORT_MARKER_FILE]) {
    assert.ok(fs.has(`dsh-scout/cmd/${fileName}`), `/scout export is missing ${fileName}`)
  }

  assert.equal((await invoke('bogus cmd')).kind, 'error')
  assert.match((await invoke('bogus cmd')).text, /Unknown \/scout action: bogus/)
  assert.equal((await invoke('status missing')).kind, 'error')
  assert.match((await invoke('status missing')).text, /Unknown case: missing/)
})
