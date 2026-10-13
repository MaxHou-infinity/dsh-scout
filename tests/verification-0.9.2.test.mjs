/**
 * dsh-scout 0.9.2 — independent verification suite (task-5 / T5).
 *
 * Owned by the independent verifier. It does not import or extend
 * `tests/acceptance.test.mjs`; it drives the frozen build through its own
 * minimal Cordis-shaped harness and takes angles that suite does not:
 *
 *   V1  positional proof by DERANGEMENT — a set holding the factory values in a
 *       different order must align nothing, which rules out "any entry that is a
 *       member of the factory set gets replaced" in favour of slot-wise compare;
 *   V2  positional proof by DUPLICATION — every slot set to `factory[0]` must
 *       align slot 0 only, which rules out value-based dedupe;
 *   V3  EXHAUSTIVE single-slot sweep (all five slots, not just one), each with
 *       the count assertion `countCjk(en report) === countCjk(user entry)`;
 *   V4  the LENGTH gate isolated: a factory-identical prefix of length n-1 is
 *       kept whole even though every entry equals its own factory slot, so only
 *       the length decides — the sharpest test of the `length === factory.length`
 *       condition;
 *   V5  longer-than-factory and EMPTY sets are preserved whole;
 *   V6  same-length fully custom set (whole-set replacement in effect);
 *   V7  symmetric direction en → zh-CN with a sentinel: no en factory sentence
 *       may survive into the zh artifact;
 *   V8  round trip zh → en → zh restores every factory slot and carries the
 *       user edit through both hops;
 *   V9  BYTE-EXACT preservation of a torture edit (NBSP, CJK, keycap, ZWJ
 *       family emoji, combining mark, zero-width space, trailing spaces);
 *   V10 same-language import of a case that already carries evidence rewrites
 *       NO `case.json` key at all (the strong form of "no-op");
 *   V11 same-language import of a bare `scout_start` case moves only the
 *       documented import-recompute keys, and the reason stays one of the two
 *       shipped i18n constants (never an invented wording);
 *   V12 the LAZY-REHYDRATION path (no `scout_import`), with `case_rehydrated` as
 *       proof that this path and not the import path ran;
 *   V13 idempotence: an already-aligned en export re-imported into en is a fixed
 *       point;
 *   V14 F5 whole-render cap: `<= 1024` UTF-8 bytes for 1-, 3- and 4-byte
 *       adversarial text, clipping only when the budget is exceeded, and the
 *       structured `value` keeps the caller's full text;
 *   V15 F2 gate shape: the anti-false-green guards in `scripts/profile-smoke.mjs`
 *       are still declared (absolute `targetDir`, marker-control payload
 *       survival, cold-restart pid change, loud escape hatches).
 *
 * Discipline: every piece of copy asserted here is read from the shipped i18n
 * table (`scoutStrings`), never hard-coded. No test in this file asserts that a
 * defect exists; each one states the positive 0.9.2 contract.
 *
 * Scope note: this suite runs against an in-memory `fs` double, like every other
 * unit suite in this repository. The real-host evidence for the export / import
 * / rehydrate / uninstall paths is the `test:profile` gate (see
 * `docs/verification-0.9.2.md`), not this file.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { apply } from '../dist/index.js'
import { DECISION_REASON_CODES, scoutStrings } from '../dist/model.js'

/* ------------------------------------------------------------------ *
 * Shipped constants — the only source of expected copy in this file
 * ------------------------------------------------------------------ */

/** Factory defaults per deployment language, straight from `src/i18n.ts`. */
const FACTORY = {
  'zh-CN': scoutStrings('zh-CN').defaults,
  en: scoutStrings('en').defaults,
}
const REASONS = {
  'zh-CN': scoutStrings('zh-CN').decisionReasons,
  en: scoutStrings('en').decisionReasons,
}

/** `scout_import` recomputes the decision on the way in (documented behaviour). */
const IMPORT_RECOMPUTED_KEYS = ['decision', 'decisionReason', 'decisionReasonCode']

const HAN = /[\u4e00-\u9fff]/gu
const countCjk = text => (text.match(HAN) ?? []).length
/** U+2026, the clip marker `clampUtf8` appends (3 UTF-8 bytes). */
const ELLIPSIS = '\u2026'
const RENDER_BUDGET_BYTES = 1024

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */

/** In-memory `fs` seam double. */
class MemoryFs {
  constructor() {
    this.files = new Map()
  }

  async resolve(path) {
    return { targetKey: `key:${path}`, displayPath: path }
  }

  async readText(target) {
    if (!this.files.has(target.displayPath)) {
      throw new Error(`ENOENT: no such file: ${target.displayPath}`)
    }
    return this.files.get(target.displayPath)
  }

  async writeText(target, content) {
    this.files.set(target.displayPath, content)
    return { operation: 'create' }
  }

  read(path) {
    return this.files.get(path)
  }

  /** Overwrite an exported `case.json` by hand — the "foreign file" path. */
  editJson(path, mutate) {
    const parsed = JSON.parse(this.read(path))
    mutate(parsed)
    this.files.set(path, `${JSON.stringify(parsed, null, 2)}\n`)
    return parsed
  }
}

/**
 * Mount the plugin on a minimal Cordis-shaped context. Only the surface this
 * plugin actually touches is implemented: `tools.register`, `effect`
 * (generator/function disposers) and `inject` for deferred optional services.
 */
function mount({ config, services = {} } = {}) {
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
      if (typeof produced === 'function') disposers.push(produced)
      else if (produced && typeof produced[Symbol.iterator] === 'function') {
        for (const item of produced) if (typeof item === 'function') disposers.push(item)
      }
      return () => {}
    },
    inject(dependencies, callback) {
      const entry = { dependencies: [...dependencies], callback, flushed: false }
      injections.push(entry)
      flush()
    },
  }

  function flush() {
    for (const entry of injections) {
      if (entry.flushed) continue
      if (!entry.dependencies.every(name => ctx[name])) continue
      entry.flushed = true
      entry.callback(ctx)
    }
  }

  Object.assign(ctx, services)
  apply(ctx, config)
  flush()

  return {
    ctx,
    tools,
    call: (name, args) => tools.get(name).execute(args, execEnv()),
    render: (name, value) => tools.get(name).output.render({}, value),
    dispose() {
      while (disposers.length) disposers.pop()()
    },
  }
}

const execEnv = () => ({
  agent: { id: 'verifier', session: { header: { cwd: '/verification/cwd' } } },
  signal: new AbortController().signal,
})

const renderText = blocks => blocks
  .filter(block => block && block.type === 'text')
  .map(block => block.text)
  .join('\n')

/** Register the ASCII evidence fixture the alignment tests rely on. */
async function seedEvidencedCase(harness, caseId) {
  await harness.call('scout_start', {
    caseId,
    companyName: 'Verification Co',
    roleTitle: 'HRBP',
    location: 'Shanghai',
  })
  await harness.call('scout_add_source', {
    caseId,
    sourceId: 'src-1',
    sourceType: 'other',
    title: 'Independent source',
    url: 'https://example.com/verification-source',
    evidenceLevel: 'E2',
  })
  await harness.call('scout_add_claim', {
    caseId,
    claimId: 'clm-1',
    text: 'The role reports to the founder.',
    status: 'reported',
    evidenceLevel: 'E2',
    dimension: 'reporting_line',
    impact: 'material',
    sourceIds: 'src-1',
    confidenceNote: 'Stated in the posting.',
    nextAction: 'Confirm in the first interview.',
  })
}

/**
 * Create a case in `from`, hand-edit its exported `case.json`, then import that
 * export into a deployment rendering `to`. Returns the case.json as imported,
 * the case.json the target re-exported, the rendered report and the fs double.
 */
async function crossLanguage({ caseId, from, to, edit, evidenced = true, fs = new MemoryFs() }) {
  const sourceDir = `/verify/${caseId}/from`
  const targetDir = `/verify/${caseId}/to`
  const scoutDir = `/verify/${caseId}`

  const writer = mount({ config: { language: from, scoutDir }, services: { fs } })
  if (evidenced) await seedEvidencedCase(writer, caseId)
  else {
    await writer.call('scout_start', {
      caseId, companyName: 'Verification Co', roleTitle: 'HRBP', location: 'Shanghai',
    })
  }
  await writer.call('scout_export', { caseId, targetDir: sourceDir })
  const imported = edit ? fs.editJson(`${sourceDir}/case.json`, edit) : JSON.parse(fs.read(`${sourceDir}/case.json`))

  const reader = mount({ config: { language: to, scoutDir }, services: { fs } })
  await reader.call('scout_import', { caseId, sourceDir })
  const report = await reader.call('scout_report', { caseId })
  await reader.call('scout_export', { caseId, targetDir })
  return { imported, exported: JSON.parse(fs.read(`${targetDir}/case.json`)), report: report.report, fs, sourceDir, targetDir }
}

/** Keys whose serialized value differs between two case.json objects. */
const movedKeys = (before, after) => {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...keys]
    .filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .sort()
}

const alignedVector = (questions, factory, userIndex, userValue) =>
  factory.map((question, index) => (index === userIndex ? userValue : question))

/* ------------------------------------------------------------------ *
 * V1–V2 · The rule is positional, not value-based
 * ------------------------------------------------------------------ */

test('V1 · a derangement of the factory set aligns nothing, so the rule compares slots and not membership', async () => {
  const zh = FACTORY['zh-CN'].interviewQuestions
  const en = FACTORY.en.interviewQuestions
  // Rotate by one: every slot holds a real factory value, but never its own.
  const derangement = zh.map((_, index) => zh[(index + 1) % zh.length])
  assert.equal(
    derangement.some((question, index) => question === zh[index]),
    false,
    'the probe is only meaningful if no slot keeps its own factory value',
  )
  assert.deepEqual([...derangement].sort(), [...zh].sort(), 'the probe must permute the same value set')

  const moved = await crossLanguage({ caseId: 'v1', from: 'zh-CN', to: 'en', edit: c => { c.interviewQuestions = derangement } })

  assert.deepEqual(moved.exported.interviewQuestions, derangement, 'a permuted set must be kept exactly as authored')
  assert.equal(
    moved.exported.interviewQuestions.some(question => en.includes(question)),
    false,
    'no deployment-language factory sentence may be injected into a permuted set',
  )
  assert.equal(countCjk(moved.report), derangement.reduce((total, q) => total + countCjk(q), 0))
})

test('V2 · with every slot holding factory[0], only slot 0 aligns — the mapping is by index, never by value', async () => {
  const zh = FACTORY['zh-CN'].interviewQuestions
  const en = FACTORY.en.interviewQuestions
  const duplicated = zh.map(() => zh[0])

  const moved = await crossLanguage({ caseId: 'v2', from: 'zh-CN', to: 'en', edit: c => { c.interviewQuestions = duplicated } })

  assert.deepEqual(
    moved.exported.interviewQuestions,
    [en[0], zh[0], zh[0], zh[0], zh[0]],
    'only the slot that equals its own factory value may be aligned',
  )
  assert.equal(
    moved.exported.interviewQuestions.filter(question => question === en[0]).length,
    1,
    'a value-based rule would have aligned all five identical entries',
  )
})

/* ------------------------------------------------------------------ *
 * V3 · Exhaustive single-slot sweep with the CJK count assertion
 * ------------------------------------------------------------------ */

test('V3 · every single-slot edit (5/5) keeps that entry verbatim and the en report CJK equals that entry', async () => {
  const en = FACTORY.en.interviewQuestions
  const zh = FACTORY['zh-CN'].interviewQuestions
  const observed = []
  const expected = []

  for (let index = 0; index < zh.length; index += 1) {
    const userQuestion = `用户手写的第${index + 1}个问题？`
    assert.ok(countCjk(userQuestion) > 0, 'the count assertion is only meaningful for a CJK edit')

    const moved = await crossLanguage({
      caseId: `v3-${index}`,
      from: 'zh-CN',
      to: 'en',
      edit: c => { c.interviewQuestions[index] = userQuestion },
    })

    assert.deepEqual(
      moved.exported.interviewQuestions,
      alignedVector(zh, en, index, userQuestion),
      `slot ${index}: the edited entry is kept verbatim and the other four align`,
    )
    assert.ok(moved.report.includes(userQuestion), `slot ${index}: the report renders the user's own question`)
    for (const [slot, factoryQuestion] of en.entries()) {
      if (slot === index) continue // this slot is the user's, so its factory wording is gone by design
      assert.ok(moved.report.includes(factoryQuestion), `slot ${index}: the aligned entry in slot ${slot} is rendered`)
    }
    // The heart of D10: the leftover CJK is exactly the user's own entry, which
    // is a COUNT, not "is it zero".
    assert.equal(
      countCjk(moved.report),
      countCjk(userQuestion),
      `slot ${index}: the only CJK left in the en report is the user's own entry`,
    )
    observed.push(countCjk(moved.report))
    expected.push(countCjk(userQuestion))
  }

  // Five independent slots, five independent counts — all equal to the user's
  // own entry and none of them zero (the edited entry is CJK by construction).
  assert.deepEqual(observed, expected)
  assert.equal(observed.every(count => count > 0), true, 'the D10 residue is the user text, not an empty string')
})

/* ------------------------------------------------------------------ *
 * V4–V6 · The length gate
 * ------------------------------------------------------------------ */

test('V4 · length alone preserves a set: an (n-1)-length factory prefix is kept whole while the full-length set aligns', async () => {
  const zh = FACTORY['zh-CN'].interviewQuestions
  const en = FACTORY.en.interviewQuestions
  const prefix = zh.slice(0, zh.length - 1)
  assert.equal(prefix.length, zh.length - 1, 'this probe needs a different length')
  assert.deepEqual(prefix, zh.slice(0, zh.length - 1), 'and the entries must all equal their own factory slots')

  const short = await crossLanguage({ caseId: 'v4-short', from: 'zh-CN', to: 'en', edit: c => { c.interviewQuestions = prefix } })
  assert.deepEqual(short.exported.interviewQuestions, prefix, 'content alone must not align a differently sized set')
  assert.equal(en.some(question => short.report.includes(question)), false, 'no en factory sentence may be injected')
  assert.equal(countCjk(short.report), prefix.reduce((total, q) => total + countCjk(q), 0))

  // Control for the same probe: the full-length set, same content, DOES align.
  const full = await crossLanguage({ caseId: 'v4-full', from: 'zh-CN', to: 'en' })
  assert.deepEqual(full.exported.interviewQuestions, en, 'the same content at factory length must align')
  assert.equal(countCjk(full.report), 0)
})

test('V5 · a set longer than the factory array and an empty set are both preserved whole', async () => {
  const zh = FACTORY['zh-CN'].interviewQuestions
  const en = FACTORY.en.interviewQuestions
  const longer = [...zh, '额外追加的问题？']
  assert.equal(longer.length > zh.length, true)

  const extended = await crossLanguage({ caseId: 'v5-longer', from: 'zh-CN', to: 'en', edit: c => { c.interviewQuestions = longer } })
  assert.deepEqual(extended.exported.interviewQuestions, longer)
  assert.equal(en.some(question => extended.report.includes(question)), false)

  const emptied = await crossLanguage({ caseId: 'v5-empty', from: 'zh-CN', to: 'en', edit: c => { c.interviewQuestions = [] } })
  assert.deepEqual(emptied.exported.interviewQuestions, [], 'an empty set has no index to map and stays empty')
  assert.equal(zh.some(question => emptied.report.includes(question)), false, 'no factory question may reappear')
})

test('V6 · a same-length fully custom set behaves as a whole-set replacement', async () => {
  const zh = FACTORY['zh-CN'].interviewQuestions
  const en = FACTORY.en.interviewQuestions
  const custom = ['自定义一？', 'Custom two?', '自定义三？', 'Custom four?', '自定义五？']
  assert.equal(custom.length, zh.length, 'this probe needs the factory length')

  const moved = await crossLanguage({ caseId: 'v6', from: 'zh-CN', to: 'en', edit: c => { c.interviewQuestions = custom } })

  assert.deepEqual(moved.exported.interviewQuestions, custom)
  assert.equal(zh.some(question => moved.report.includes(question)), false, 'no zh factory sentence may survive')
  assert.equal(en.some(question => moved.report.includes(question)), false, 'no en factory sentence may be injected')
  assert.equal(countCjk(moved.report), custom.reduce((total, q) => total + countCjk(q), 0))
})

/* ------------------------------------------------------------------ *
 * V7–V9 · Reverse direction, round trip, byte-exact preservation
 * ------------------------------------------------------------------ */

test('V7 · the rule is symmetric: an en case aligns entry by entry into zh-CN and no en factory sentence survives', async () => {
  const en = FACTORY.en.interviewQuestions
  const zh = FACTORY['zh-CN'].interviewQuestions
  const userQuestion = 'User-authored question kept as-is?'
  const editedIndex = 1

  const moved = await crossLanguage({
    caseId: 'v7',
    from: 'en',
    to: 'zh-CN',
    edit: c => { c.interviewQuestions[editedIndex] = userQuestion },
  })

  assert.deepEqual(moved.imported.interviewQuestions, alignedVector(en, en, editedIndex, userQuestion), 'the source really was the en factory set with one edit')
  assert.deepEqual(moved.exported.interviewQuestions, alignedVector(en, zh, editedIndex, userQuestion))
  assert.equal(moved.exported.language, 'zh-CN')
  assert.ok(moved.report.includes(userQuestion))
  for (const sentence of [FACTORY.en.decisionObjective, FACTORY.en.fitQuestion, ...en]) {
    assert.equal(moved.report.includes(sentence), false, `no en factory sentence may survive into the zh artifact: ${JSON.stringify(sentence)}`)
  }
})

test('V8 · zh → en → zh restores every factory slot and carries the user edit through both hops', async () => {
  const zh = FACTORY['zh-CN'].interviewQuestions
  const en = FACTORY.en.interviewQuestions
  const caseId = 'v8'
  const scoutDir = `/verify/${caseId}`
  const fs = new MemoryFs()
  const userQuestion = '往返两跳之后仍要保留？'
  const editedIndex = 2

  const writer = mount({ config: { language: 'zh-CN', scoutDir }, services: { fs } })
  await seedEvidencedCase(writer, caseId)
  await writer.call('scout_export', { caseId, targetDir: `${scoutDir}/zh-1` })
  fs.editJson(`${scoutDir}/zh-1/case.json`, c => { c.interviewQuestions[editedIndex] = userQuestion })

  const english = mount({ config: { language: 'en', scoutDir }, services: { fs } })
  await english.call('scout_import', { caseId, sourceDir: `${scoutDir}/zh-1` })
  await english.call('scout_export', { caseId, targetDir: `${scoutDir}/en-1` })
  const middle = JSON.parse(fs.read(`${scoutDir}/en-1/case.json`))
  assert.deepEqual(middle.interviewQuestions, alignedVector(zh, en, editedIndex, userQuestion), 'hop 1 aligns and keeps the edit')

  const back = mount({ config: { language: 'zh-CN', scoutDir }, services: { fs } })
  await back.call('scout_import', { caseId, sourceDir: `${scoutDir}/en-1` })
  const report = await back.call('scout_report', { caseId })
  await back.call('scout_export', { caseId, targetDir: `${scoutDir}/zh-2` })
  const restored = JSON.parse(fs.read(`${scoutDir}/zh-2/case.json`))

  assert.deepEqual(restored.interviewQuestions, alignedVector(zh, zh, editedIndex, userQuestion), 'hop 2 restores every factory slot verbatim')
  assert.equal(restored.language, 'zh-CN')
  assert.ok(report.report.includes(userQuestion), 'the restored report still carries the user edit')
  for (const [index, question] of zh.entries()) {
    if (index === editedIndex) continue
    assert.ok(report.report.includes(question), `restored zh factory slot ${index} is rendered verbatim`)
  }
  assert.equal(report.report.includes(en[0]), false, 'no en factory wording may survive the round trip')
})

test('V9 · a torture edit survives both hops byte for byte', async () => {
  const zh = FACTORY['zh-CN'].interviewQuestions
  const en = FACTORY.en.interviewQuestions
  // NBSP (not trimmable whitespace), CJK, a keycap sequence, a ZWJ family emoji
  // (surrogate pairs), a combining mark, a zero-width space and trailing spaces.
  const TORTURE = '\u00a0第3️⃣问：😀👨‍👩‍👧 e\u0301 \u200b  '
  const editedIndex = 4
  assert.ok(countCjk(TORTURE) > 0, 'the torture string must carry CJK for the count assertion')
  assert.notEqual(TORTURE, TORTURE.trim(), 'the probe must carry edge whitespace a naive trim would delete')

  const moved = await crossLanguage({
    caseId: 'v9',
    from: 'zh-CN',
    to: 'en',
    edit: c => { c.interviewQuestions[editedIndex] = TORTURE },
  })

  assert.equal(moved.exported.interviewQuestions[editedIndex], TORTURE, 'the user entry must be strictly equal')
  assert.equal(
    Buffer.compare(Buffer.from(moved.exported.interviewQuestions[editedIndex], 'utf8'), Buffer.from(TORTURE, 'utf8')),
    0,
    'and byte-identical in UTF-8',
  )
  assert.deepEqual(
    moved.exported.interviewQuestions.slice(0, editedIndex),
    en.slice(0, editedIndex),
    'the other four slots still align around the torture entry',
  )
  assert.ok(moved.report.includes(TORTURE), 'the report must render the user bytes unchanged')
  assert.equal(countCjk(moved.report), countCjk(TORTURE))
  assert.deepEqual(moved.exported.interviewQuestions, alignedVector(zh, en, editedIndex, TORTURE))
})

/* ------------------------------------------------------------------ *
 * V10–V11 · Same-language no-op
 * ------------------------------------------------------------------ */

test('V10 · importing a case into its own language rewrites no case.json field at all once the case carries evidence', async () => {
  const zh = FACTORY['zh-CN'].interviewQuestions
  const moved = await crossLanguage({ caseId: 'v10', from: 'zh-CN', to: 'zh-CN' })

  // Non-vacuity: the source really carried the untouched zh factory set.
  assert.deepEqual(moved.imported.interviewQuestions, zh, 'the exported case must start from the factory set')
  assert.deepEqual(moved.exported.interviewQuestions, zh, 'the authored questions must be untouched')
  assert.equal(moved.exported.decisionObjective, moved.imported.decisionObjective)
  assert.equal(moved.exported.role.fitQuestion, moved.imported.role.fitQuestion)
  assert.equal(moved.exported.language, 'zh-CN')

  const moved2 = movedKeys(moved.imported, moved.exported)
  assert.deepEqual(
    moved2,
    [],
    `a same-language import must be a field-for-field no-op on an evidenced case, moved keys: ${JSON.stringify(moved2)}`,
  )
  assert.equal(countCjk(moved.report) > 0, true, 'the zh deployment still renders its own language')
  assert.ok(zh.every(question => moved.report.includes(question)), 'and every factory question is rendered verbatim')
})

test('V11 · a bare scout_start case imported into its own language moves only the documented recompute keys', async () => {
  const zh = scoutStrings('zh-CN')
  const moved = await crossLanguage({ caseId: 'v11', from: 'zh-CN', to: 'zh-CN', evidenced: false })

  assert.deepEqual(moved.imported.interviewQuestions, zh.defaults.interviewQuestions, 'the source is the untouched factory set')
  assert.equal(moved.imported.language, 'zh-CN')

  // The authored half of the case is a real no-op.
  for (const key of ['schemaVersion', 'caseId', 'title', 'language', 'decisionObjective', 'interviewQuestions', 'subject', 'role']) {
    assert.deepEqual(moved.exported[key], moved.imported[key], `${key} must not move on a same-language import`)
  }
  assert.equal(moved.exported.decision, moved.imported.decision, 'the decision itself is stable')

  const moved2 = movedKeys(moved.imported, moved.exported)
  assert.ok(
    moved2.every(key => IMPORT_RECOMPUTED_KEYS.includes(key)),
    `only the documented import-recompute keys may move, moved: ${JSON.stringify(moved2)}`,
  )
  // Whatever the reason becomes, it must be one of the two shipped zh-CN
  // wordings — never an invented one, and never the other language's wording.
  assert.ok(
    [zh.defaults.initialDecisionReason, zh.decisionReasons.identity].includes(moved.exported.decisionReason),
    `the reason must be a shipped i18n constant, got ${JSON.stringify(moved.exported.decisionReason)}`,
  )
  assert.notEqual(
    moved.exported.decisionReason,
    REASONS.en.identity,
    'a zh-CN deployment must never stamp the en wording onto the case',
  )
  assert.ok(
    moved.exported.decisionReasonCode === undefined || DECISION_REASON_CODES.includes(moved.exported.decisionReasonCode),
    `the reason code must be a shipped code, got ${JSON.stringify(moved.exported.decisionReasonCode)}`,
  )
})

/* ------------------------------------------------------------------ *
 * V12–V13 · Lazy rehydration path and idempotence
 * ------------------------------------------------------------------ */

test('V12 · the lazy-rehydration path aligns a partially edited set, and case_rehydrated proves which path ran', async () => {
  const en = FACTORY.en.interviewQuestions
  const zh = FACTORY['zh-CN'].interviewQuestions
  const caseId = 'v12'
  const scoutDir = `/verify/${caseId}`
  const fs = new MemoryFs()
  const userQuestion = '回填路径下保留的自定义问题？'
  const editedIndex = 1

  const writer = mount({ config: { language: 'zh-CN', scoutDir }, services: { fs } })
  await seedEvidencedCase(writer, caseId)
  // The lazy path reads `<scoutDir>/<caseId>/`, so that is where it must land.
  await writer.call('scout_export', { caseId, targetDir: `${scoutDir}/${caseId}` })
  assert.equal(fs.read(`${scoutDir}/${caseId}/export.complete.json`) !== undefined, true, 'the completion marker must exist for rehydration')
  fs.editJson(`${scoutDir}/${caseId}/case.json`, c => { c.interviewQuestions[editedIndex] = userQuestion })

  // A fresh mount: empty in-memory case cache, no scout_import anywhere below.
  const reader = mount({ config: { language: 'en', scoutDir }, services: { fs } })
  const report = await reader.call('scout_report', { caseId })
  assert.ok(report.report.includes(userQuestion), 'the rehydrated report carries the user entry')
  assert.equal(
    countCjk(report.report),
    countCjk(userQuestion),
    'the rehydrate path must align the untouched slots too, leaving only the user entry in CJK',
  )

  await reader.call('scout_export', { caseId, targetDir: `${scoutDir}/again` })
  const reExported = JSON.parse(fs.read(`${scoutDir}/again/case.json`))
  assert.deepEqual(reExported.interviewQuestions, alignedVector(zh, en, editedIndex, userQuestion))
  assert.equal(reExported.language, 'en', 'the deployment language is stamped on the restored case')
  const events = fs.read(`${scoutDir}/again/events.jsonl`)
  assert.ok(events.includes('"case_rehydrated"'), 'the rehydration event is what identifies this path')
  assert.ok(events.includes(scoutDir), 'and it names the directory it restored from')
})

test('V13 · alignment is idempotent: an already-aligned en export re-imported into en is a fixed point', async () => {
  const en = FACTORY.en.interviewQuestions
  const zh = FACTORY['zh-CN'].interviewQuestions
  const caseId = 'v13'
  const scoutDir = `/verify/${caseId}`
  const fs = new MemoryFs()
  const userQuestion = '幂等性检查用的问题？'
  const editedIndex = 3

  const first = await crossLanguage({
    caseId, from: 'zh-CN', to: 'en', fs,
    edit: c => { c.interviewQuestions[editedIndex] = userQuestion },
  })
  assert.deepEqual(first.exported.interviewQuestions, alignedVector(zh, en, editedIndex, userQuestion))

  const second = mount({ config: { language: 'en', scoutDir }, services: { fs } })
  await second.call('scout_import', { caseId, sourceDir: first.targetDir })
  await second.call('scout_export', { caseId, targetDir: `/verify/${caseId}/to-again` })
  const again = JSON.parse(fs.read(`/verify/${caseId}/to-again/case.json`))

  assert.deepEqual(again.interviewQuestions, first.exported.interviewQuestions, 'a second pass must not move a single entry')
  assert.equal(again.interviewQuestions[editedIndex], userQuestion, 'and must not touch the user edit')
  const drift = movedKeys(first.exported, again)
  assert.ok(
    drift.every(key => IMPORT_RECOMPUTED_KEYS.includes(key)),
    `re-import may only move documented keys, moved: ${JSON.stringify(drift)}`,
  )
})

/* ------------------------------------------------------------------ *
 * V14 · F5 whole-render cap
 * ------------------------------------------------------------------ */

test('V14 · the whole-render cap stays at 1024 UTF-8 bytes for 1-, 3- and 4-byte text, and only clippable renders are clipped', async () => {
  // Negative control for the clip: an under-budget envelope must NOT carry the
  // ellipsis, so "ends with the ellipsis" really means the budget was exceeded.
  const smallHarness = mount({ services: { fs: new MemoryFs() } })
  const small = smallHarness.render('scout_start', await smallHarness.call('scout_start', {
    caseId: 'v14-small', companyName: 'Small Co', roleTitle: 'HRBP', location: '',
  }))
  const smallText = renderText(small)
  assert.ok(Buffer.byteLength(smallText, 'utf8') < RENDER_BUDGET_BYTES)
  assert.equal(smallText.endsWith(ELLIPSIS), false, 'an under-budget render must not be clipped')

  /** 1-, 3- and 4-byte text, including a ZWJ sequence of several scalars. */
  const shapes = {
    '3-byte CJK': '中'.repeat(600),
    '4-byte emoji': '😀'.repeat(400),
    'mixed 1/3/4-byte': '中😀a'.repeat(300),
    '4-byte ZWJ family': '👨‍👩‍👧'.repeat(200),
  }

  let clipped = 0
  for (const [label, shape] of Object.entries(shapes)) {
    // A fresh case per shape, so the three derived next actions are exactly the
    // ones this shape contributed and none of them is sliced off the top three.
    const caseId = `v14-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`
    const harness = mount({ services: { fs: new MemoryFs() } })
    await harness.call('scout_start', { caseId, companyName: 'Cap Co', roleTitle: 'HRBP', location: '' })
    await harness.call('scout_add_source', {
      caseId, sourceId: 'src', sourceType: 'other', title: 'S',
      url: 'https://example.com/cap', evidenceLevel: 'E2',
    })
    const actions = ['A', 'B', 'C'].map(suffix => `${shape}${suffix}`)
    let value
    for (const [index, nextAction] of actions.entries()) {
      value = await harness.call('scout_add_claim', {
        caseId,
        claimId: `clm-${index}`,
        text: 'Finding.',
        status: 'reported',
        evidenceLevel: 'E2',
        dimension: 'risk',
        impact: 'blocking',
        sourceIds: 'src',
        confidenceNote: 'Note.',
        nextAction,
      })
    }

    const text = renderText(harness.render('scout_add_claim', value))
    const bytes = Buffer.byteLength(text, 'utf8')
    assert.ok(bytes <= RENDER_BUDGET_BYTES, `${label}: render was ${bytes} bytes, over the ${RENDER_BUDGET_BYTES}-byte cap`)
    // The bytes the host actually transports: encoding the clipped string must
    // not grow it past the cap either.
    assert.ok(
      Buffer.byteLength(Buffer.from(text, 'utf8').toString('utf8'), 'utf8') <= RENDER_BUDGET_BYTES,
      `${label}: the UTF-8 wire form must stay inside the cap`,
    )
    // Only the render is capped: the structured value keeps the caller's text.
    for (const action of actions) {
      assert.ok(value.nextActions.includes(action), `${label}: the value must keep the caller's full nextAction`)
    }
    if (text.endsWith(ELLIPSIS)) clipped += 1
  }

  // Non-vacuity: the cap has to actually fire for at least one adversarial
  // shape, otherwise the `<= 1024` assertions above prove nothing.
  assert.ok(clipped > 0, 'the adversarial inputs must push at least one render past the budget')
})

/* ------------------------------------------------------------------ *
 * V15 · F2 gate shape (behavioural proof lives in the report)
 * ------------------------------------------------------------------ */

test('V15 · the shipped host gate keeps every anti-false-green guard and both cold-restart controls', () => {
  const source = readFileSync(new URL('../scripts/profile-smoke.mjs', import.meta.url), 'utf8')

  // Absolute path basis: the resolved directory is asserted absolute AND equal
  // to the requested directory, so a relative path cannot pass by accident.
  assert.ok(source.includes('isAbsolute('), 'the gate must assert an absolute targetDir')
  assert.ok(source.includes('realpathOrNull('), 'and compare its canonical form with the requested path')
  // The marker controls must show the payload files survived, otherwise a
  // missing export directory could explain the refusal.
  assert.ok(source.includes('survivingPayload'), 'the marker controls must prove the payload survived')
  assert.ok(source.includes('Unknown case'), 'both controls must pin the plugin refusal')
  // Cold restart must be a real second process.
  assert.ok(source.includes('createPid !== rehydratePid'), 'the cold restart must be proven by a pid change')
  // Both marker controls must run against a fully mounted registry.
  assert.ok(source.includes('assertRegistry(missingMarker)'), 'the missing-marker control needs a healthy registry')
  assert.ok(source.includes('assertRegistry(falseMarker)'), 'the complete:false control needs a healthy registry')
  // Rehydration evidence.
  assert.ok(source.includes('"case_rehydrated"'), 'the rehydrate path must be identified by its event')
  // The three escape hatches are opt-in and must announce degraded coverage.
  for (const flag of [
    'DSH_SCOUT_SMOKE_SKIP_CROSS_LANGUAGE',
    'DSH_SCOUT_SMOKE_SKIP_REHYDRATION_CONTROL',
    'DSH_SCOUT_SMOKE_SKIP_NEGATIVE_CONTROL',
  ]) {
    assert.ok(source.includes(flag), `${flag} must be declared`)
    assert.ok(source.includes(`process.env.${flag} === '1'`), `${flag} must be an explicit opt-in`)
  }
  assert.ok(source.includes('coverage degraded'), 'a skip must be reported as degraded coverage, never silently')
  // The six-step chain plus the marker control.
  for (const scenario of ['create-export', 'rehydrate', 'import-en', 'report-only', 'registry-only']) {
    assert.ok(source.includes(`'${scenario}'`), `scenario ${scenario} must exist in the gate`)
  }
})
