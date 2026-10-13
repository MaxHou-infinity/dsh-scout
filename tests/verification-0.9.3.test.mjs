import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * dsh-scout 0.9.3 — independent verification suite (task-19).
 *
 * This file is the executable half of `docs/verification-0.9.3.md`. It exists to
 * re-derive 0.9.3's claims without reusing `tests/acceptance.test.mjs`,
 * `tests/tools.test.mjs`, `tests/package.test.mjs`, or `tests/model.test.mjs`:
 * it mounts the plugin on its own minimal Cordis-shaped context, carries its own
 * README reference extractor, and drives the *shipped* README guards from the
 * outside (in throwaway /tmp copies) instead of trusting their own fixtures.
 *
 * Scope: release-literal consistency (three independent statements), the
 * `/scout status` append-only contract, the untouched tool surface, the shipped
 * README guards as a mutation matrix, the current README reference set, the
 * frozen 0.9.2 documentation semantics, and the desktop-path facts that
 * `docs/install-verification.md` states about this repository.
 *
 * It deliberately contains NO assertion that a defect exists: every case here is
 * a positive contract (what must hold), including the mutation cases — "the guard
 * must fail when a stale exact pin is introduced" is the guard's job, not a
 * characterization of a defect. The 0.9.3 guard weaknesses found by the
 * independent attack (range-form pins, `@`-pins inside the success-criteria
 * section, the test-suite/preflight line-skip divergence) are recorded in the
 * report, not pinned here.
 *
 * Requires `dist/` (acceptance.test.mjs has the same requirement); `npm test`
 * builds before running.
 */

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')

/** Release anchor: hardcoded on purpose, so a forgotten bump cannot pass. */
const RELEASE_VERSION = '0.9.3'
/** Model-facing byte budget the README states for a compact render. */
const RENDER_BUDGET_BYTES = 1024
/** The `/scout status` usage line, quoted from `src/index.ts`. */
const USAGE_LINE =
  'usage: /scout status <caseId> | /scout questions <caseId> | /scout report <caseId> | /scout export <caseId> [targetDir]'
/** Mutation-envelope value keys, as documented in README "输出契约". */
const ENVELOPE_KEYS = [
  'caseId',
  'changed',
  'counts',
  'decision',
  'identity',
  'nextActions',
  'ok',
]

const readText = (relative) => readFileSync(join(repoRoot, relative), 'utf8')
const readJson = (relative) => JSON.parse(readText(relative))

const { PLUGIN_VERSION, apply } = await import('../dist/index.js')

/* ------------------------------------------------------------------ *
 * Minimal Cordis-shaped context (written for this suite)
 * ------------------------------------------------------------------ */

const execFor = (sessionId = 'v093', cwd = '/session/cwd') => ({
  agent: { id: sessionId, session: { header: { cwd } } },
  signal: new AbortController().signal,
})

function createHarness(config = {}) {
  const tools = new Map()
  const injections = []
  const ctx = {
    tools: {
      register(tool) {
        tools.set(tool.name, tool)
        return () => tools.delete(tool.name)
      },
    },
    get(serviceName) {
      return this[serviceName]
    },
    effect(callback) {
      // Cordis allows a generator here (the tool registration relies on it), so
      // the body only runs when the returned iterator is advanced.
      const produced = callback()
      if (produced !== null && typeof produced === 'object' && typeof produced.next === 'function') {
        for (let step = produced.next(); !step.done; step = produced.next());
      }
      return () => {}
    },
    inject(dependencies, callback) {
      injections.push({ dependencies: [...dependencies], callback, flushed: false })
      flush()
    },
    mount(serviceName, service) {
      this[serviceName] = service
      flush()
    },
  }
  function flush() {
    for (const entry of injections) {
      if (entry.flushed) continue
      if (!entry.dependencies.every((name) => ctx[name])) continue
      entry.flushed = true
      entry.callback(ctx)
    }
  }
  apply(ctx, config)
  flush()
  return { tools, mount: (name, service) => ctx.mount(name, service) }
}

/** Mount `commands`, create one case, and return a `/scout` invoker. */
async function scoutCommandHarness() {
  const harness = createHarness()
  const commands = []
  const skills = []
  harness.mount('commands', { register: (definition) => { commands.push(definition); return () => {} } })
  harness.mount('skills', { register: (definition) => { skills.push(definition); return () => {} } })
  assert.equal(commands.length, 1, 'the plugin must register exactly one /scout command')
  assert.equal(skills.length, 1, 'the plugin must register exactly one scout Skill')

  const exec = execFor('v093')
  const started = await harness.tools.get('scout_start').execute(
    { caseId: 'v093check', companyName: 'Version Co', roleTitle: 'HR Head', location: '' },
    exec,
  )
  assert.equal(started.ok, true, 'scout_start must succeed on the minimal context')
  const invoke = (rawInput) => commands[0].handler({ rawInput, agent: { id: 'v093' } })
  return { harness, exec, invoke, started }
}

const renderText = (harness, toolName, value) => {
  const blocks = harness.tools.get(toolName).output.render({}, value)
  return blocks.filter((block) => block.type === 'text').map((block) => block.text).join('\n')
}

/* ------------------------------------------------------------------ *
 * V1 · one release literal, three independent statements
 * ------------------------------------------------------------------ */

test('V1 · the release literal is stated identically in three independent places', () => {
  assert.equal(readJson('package.json').version, RELEASE_VERSION, 'package.json must carry the release literal')
  assert.equal(PLUGIN_VERSION, RELEASE_VERSION, 'the exported PLUGIN_VERSION must be the release literal')
  assert.match(
    readText('CHANGELOG.md'),
    new RegExp(`^## \\[${RELEASE_VERSION.replaceAll('.', '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}$`, 'm'),
    'the CHANGELOG must open a dated section for the release literal',
  )
  // The install chapter must pin the released version, not a retired one: a
  // document that installs 0.9.2 while the manifest says 0.9.3 is the exact
  // silent drift this round exists to make visible.
  for (const file of ['README.md', 'README.en.md']) {
    const text = readText(file)
    assert.ok(
      text.includes(`dsh-scout@${RELEASE_VERSION}`),
      `${file}: the install chapter must pin the released version`,
    )
    assert.ok(
      text.includes(`dsh-scout-${RELEASE_VERSION}.tgz`),
      `${file}: the tarball name must carry the released version`,
    )
  }
})

/* ------------------------------------------------------------------ *
 * V2 · /scout status is a pure append
 * ------------------------------------------------------------------ */

test('V2 · /scout status appends the banner without moving the case facts', async () => {
  const { invoke } = await scoutCommandHarness()

  const status = await invoke('status v093check')
  assert.equal(status.kind, 'success')
  const prefix = '[v093check] VERIFY · identity needs_verification · sources 0 / claims 0 (verified 0, open 0)'
  assert.ok(status.text.startsWith(prefix), `the leading case facts must be byte-stable, got: ${status.text}`)
  assert.ok(
    status.text.endsWith(` · dsh-scout ${RELEASE_VERSION}`),
    `the banner must be the trailing addition, got: ${status.text}`,
  )
  assert.equal(
    status.text.split('dsh-scout').length - 1,
    1,
    'the banner must appear exactly once on the status line',
  )
  assert.equal(status.text, `${prefix} · dsh-scout ${RELEASE_VERSION}`, 'the status line must be prefix + banner and nothing else')

  // The banner belongs to the plugin, not to the case: no other sub-action and
  // not the usage line may carry it.
  assert.equal((await invoke('')).text, USAGE_LINE, 'the bare /scout usage line must stay byte-identical')
  assert.equal((await invoke('help')).text, USAGE_LINE, 'the help usage line must stay byte-identical')
  for (const sub of ['questions v093check', 'report v093check']) {
    const result = await invoke(sub)
    assert.equal(result.kind, 'success', `${sub} must succeed`)
    assert.ok(!result.text.includes(`dsh-scout ${RELEASE_VERSION}`), `${sub} must not carry the version banner`)
  }
})

/* ------------------------------------------------------------------ *
 * V3 · the tool surface is untouched
 * ------------------------------------------------------------------ */

test('V3 · the 12 tools keep their documented value shape and the 1024 B render budget', async () => {
  const harness = createHarness()
  assert.equal(harness.tools.size, 12, 'exactly 12 tools must be mounted')

  const exec = execFor('v093-tools')
  const start = await harness.tools.get('scout_start').execute(
    { caseId: 'v093tools', companyName: 'Surface Co', roleTitle: 'HR Head', location: '' },
    exec,
  )
  const source = await harness.tools.get('scout_add_source').execute(
    {
      caseId: 'v093tools',
      sourceId: 'src-1',
      sourceType: 'company_official',
      title: 'About',
      url: 'https://example.com/about',
      evidenceLevel: 'E2',
    },
    exec,
  )
  const report = await harness.tools.get('scout_report').execute({ caseId: 'v093tools' }, exec)
  const questions = await harness.tools.get('scout_questions').execute({ caseId: 'v093tools' }, exec)

  assert.deepEqual(Object.keys(start).sort(), ENVELOPE_KEYS, 'the mutation envelope keys must be unchanged')
  assert.deepEqual(Object.keys(source).sort(), ENVELOPE_KEYS, 'the mutation envelope keys must be unchanged')
  assert.deepEqual(
    Object.keys(report).sort(),
    ['caseId', 'coverage', 'decision', 'report'],
    'scout_report must keep its read-class shape',
  )
  assert.deepEqual(Object.keys(questions).sort(), ['caseId', 'questions'], 'scout_questions must keep its shape')

  for (const [name, value] of [['scout_start', start], ['scout_add_source', source]]) {
    const text = renderText(harness, name, value)
    assert.ok(
      Buffer.byteLength(text, 'utf8') <= RENDER_BUDGET_BYTES,
      `${name} render must stay inside ${RENDER_BUDGET_BYTES} B, got ${Buffer.byteLength(text, 'utf8')}`,
    )
    assert.ok(
      !new RegExp(`dsh-scout\\s+${RELEASE_VERSION.replaceAll('.', '\\.')}`).test(text),
      `${name} render must not carry the /scout status banner`,
    )
  }
})

/* ------------------------------------------------------------------ *
 * V4 · the shipped README guard, driven from the outside
 * ------------------------------------------------------------------ */

/**
 * Everything `tests/package.test.mjs` reads to decide green/red, plus a `dist`
 * directory so its packaging assertions can resolve. Nothing else from the
 * repository is needed, which keeps each mutation case cheap.
 */
const GUARD_INPUTS = [
  'package.json',
  'cordis.patch.yml',
  'README.md',
  'README.en.md',
  'CHANGELOG.md',
  'LICENSE',
  'assets/icon.svg',
  'locale/en.json',
  'locale/zh.json',
  'scripts/check-release.mjs',
  'scripts/profile-smoke.mjs',
  'docs/dsh-scout-product-contract.md',
  'docs/fixtures/dsh-scout/snapmaker-hr-head.json',
  'tests/package.test.mjs',
  'tests/model.test.mjs',
  'tests/tools.test.mjs',
  'tests/acceptance.test.mjs',
]

function stageGuardCopy(root) {
  for (const relative of GUARD_INPUTS) {
    const from = join(repoRoot, relative)
    if (!existsSync(from)) continue
    const to = join(root, relative)
    mkdirSync(dirname(to), { recursive: true })
    cpSync(from, to)
  }
  mkdirSync(join(root, 'dist'), { recursive: true })
  return root
}

/**
 * A child environment fit for running `node --test` from inside `node --test`:
 * the outer runner marks its children through NODE_TEST_CONTEXT, and a nested
 * runner that inherits it reports through that channel instead of stdout.
 */
function childEnv(extra = {}) {
  const env = { ...process.env, ...extra }
  delete env.NODE_TEST_CONTEXT
  // A test-runner flag arriving through NODE_OPTIONS would collide with the
  // explicit --test-reporter below (Node rejects two reporters for one
  // destination). Drop runner flags, keep every other NODE_OPTIONS flag.
  if (typeof env.NODE_OPTIONS === 'string') {
    const kept = []
    const tokens = env.NODE_OPTIONS.split(/\s+/).filter(Boolean)
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index]
      if (token.startsWith('--test-reporter=') || token.startsWith('--test-reporter-destination=')) continue
      if (token === '--test-reporter' || token === '--test-reporter-destination') {
        index += 1
        continue
      }
      if (token === '--test') continue
      kept.push(token)
    }
    if (kept.length === 0) delete env.NODE_OPTIONS
    else env.NODE_OPTIONS = kept.join(' ')
  }
  return env
}

/**
 * TAP is the one summary format that does not move with the Node major.
 *
 * The default test reporter is version- and TTY-dependent: Node 22 in CI prints
 * `tap` for a piped child, while this machine's Node 26 prints `spec` (`ℹ fail 0`).
 * An earlier revision of this suite asserted the spec shape, so it was green here
 * and red on the Node 22 release workflow even though the child had passed
 * (`# tests 18 / # pass 18 / # fail 0`). The child is now pinned to TAP and the
 * assertion reads TAP's `# fail <n>`, which is stable across the supported range.
 * The child also runs on `process.execPath`, so it exercises the runtime the suite
 * itself runs under instead of whatever `node` happens to be first on PATH.
 */
const TEST_REPORTER = '--test-reporter=tap'

/** TAP failure count, or null when the run printed no TAP summary at all. */
function tapFailures(output) {
  const match = /^# fail (\d+)$/m.exec(output)
  return match === null ? null : Number(match[1])
}

/** Run the shipped guard in one staged copy; returns exit code plus output. */
function runShippedGuard(root) {
  try {
    const stdout = execFileSync(process.execPath, ['--test', TEST_REPORTER, 'tests/package.test.mjs'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv(),
    })
    return { code: 0, output: stdout }
  } catch (error) {
    return { code: error.status ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

/** Stale exact references the shipped guard must report, with its own diagnostic. */
const GUARD_MUTATIONS = [
  { id: 'install operand', from: 'add dsh-scout@0.9.3', to: 'add dsh-scout@0.9.2', line: true },
  { id: 'standalone specifier', from: '\ndsh-scout@0.9.3\n', to: '\ndsh-scout@0.9.2\n', line: true },
  { id: 'tarball name', from: '# 生成 dsh-scout-0.9.3.tgz', to: '# 生成 dsh-scout-0.9.2.tgz', line: true },
  {
    id: 'git install ref',
    from: 'github:MaxHou-infinity/dsh-scout#v0.9.3',
    to: 'github:MaxHou-infinity/dsh-scout#v0.9.2',
    line: true,
  },
  { id: 'status banner', from: '`· dsh-scout 0.9.3`', to: '`· dsh-scout 0.9.2`', line: true },
  { id: 'release tag claim', from: '本次发布创建 `v0.9.3`', to: '本次发布创建 `v0.9.2`', line: true },
  { id: 'compatibility key', from: '"dsh-scout@0.9.3": ["0.2.0-rc.2"]', to: '"dsh-scout@0.9.2": ["0.2.0-rc.2"]', line: true },
  { id: 'success-criteria token', from: '标题旁带 `v0.9.3`', to: '标题旁带 `v0.9.2`', line: true },
  { id: 'section anchor reworded', from: '### 装上了吗（成功判据）', to: '### 装上了吗？（成功判据）', line: false },
  // Round-2 fail-closed policy: a range or comparison in a live position is a
  // version claim the guard cannot evaluate, so it must be reported rather than
  // waved through (the F-1 fix).
  { id: 'caret range, standalone', from: '\ndsh-scout@0.9.3\n', to: '\ndsh-scout@^0.9.2\n', line: true },
  { id: 'comparator range, standalone', from: '\ndsh-scout@0.9.3\n', to: '\ndsh-scout@>=0.9.2\n', line: true },
  { id: 'tilde range, install operand', from: 'add dsh-scout@0.9.3', to: 'add dsh-scout@~0.9.2', line: true },
  { id: 'equals range, install operand', from: 'add dsh-scout@0.9.3', to: 'add dsh-scout@=0.9.2', line: true },
  { id: 'partial version, standalone', from: '\ndsh-scout@0.9.3\n', to: '\ndsh-scout@0.9\n', line: true },
  { id: 'wildcard, standalone', from: '\ndsh-scout@0.9.3\n', to: '\ndsh-scout@*\n', line: true },
  // The section contract now sees `@`-prefixed prose tokens (the F-2 fix), and a
  // correct pin on the same line no longer hides a stale bare token (F-3).
  {
    id: 'stale @-pin in section prose',
    from: '**打开它的详情页**，标题旁带 `v0.9.3`',
    to: '安装 `dsh-scout@0.9.2` 后，**打开它的详情页**，标题旁带 `v0.9.3`',
    line: true,
  },
  {
    id: 'correct pin plus stale token on one section line',
    from: '1. **侧边栏 → 插件页**：`dsh-scout` 出现在「已安装」里；**打开它的详情页**，标题旁带 `v0.9.3`',
    to: '1. i dsh-scout@0.9.3 后打开详情页，标题旁带 `v0.9.2`',
    line: true,
  },
]

test('V4 · the shipped README guard fails on every stale exact reference, and passes on the frozen tree', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'dsh-scout-verify-guard-'))
  try {
    const pristine = stageGuardCopy(join(workspace, 'pristine'))
    const clean = runShippedGuard(pristine)
    assert.equal(clean.code, 0, `the frozen tree must pass its own guard:\n${clean.output}`)
    const cleanFailures = tapFailures(clean.output)
    assert.notEqual(
      cleanFailures,
      null,
      `the pristine guard run printed no TAP summary (reporter drift?):\n${clean.output}`,
    )
    assert.equal(
      cleanFailures,
      0,
      `the pristine guard run must report zero failures:\n${clean.output}`,
    )

    const failures = []
    for (const mutation of GUARD_MUTATIONS) {
      const root = stageGuardCopy(join(workspace, mutation.id.replaceAll(/[^a-z]+/gi, '-')))
      const path = join(root, 'README.md')
      const text = readFileSync(path, 'utf8')
      assert.ok(text.includes(mutation.from), `${mutation.id}: the mutation anchor must exist in the frozen README`)
      writeFileSync(path, text.replace(mutation.from, mutation.to))
      const result = runShippedGuard(root)
      if (result.code === 0) failures.push(`${mutation.id}: the guard stayed green with a stale reference`)
      else if (mutation.line && !/README\.md:\d+/.test(result.output)) {
        failures.push(`${mutation.id}: the failure carried no file:line diagnostic`)
      }
    }
    assert.deepEqual(failures, [], `the shipped guard must catch every stale exact reference:\n${failures.join('\n')}`)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

/* ------------------------------------------------------------------ *
 * V5 · an independent read of the current README reference set
 * ------------------------------------------------------------------ */

const SEMVER = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?`

/** My own extractor: every form that names the artifact a user installs. */
function collectLiveReferences(file, text) {
  const found = []
  text.split('\n').forEach((line, index) => {
    const push = (kind, match) => found.push({ file, line: index + 1, kind, version: match[1], text: match[0] })
    for (const match of line.matchAll(new RegExp(`dsh-scout-(${SEMVER})\\.tgz`, 'g'))) push('tarball', match)
    for (const match of line.matchAll(new RegExp(`dsh-scout(?:\\.git)?#v?(${SEMVER})`, 'g'))) push('git ref', match)
    for (const match of line.matchAll(new RegExp(`·\\s*dsh-scout (${SEMVER})`, 'g'))) push('status banner', match)
    const tagClaim = new RegExp(`(?:本次发布创建|this release creates)\\s*\`?v?(${SEMVER})`, 'g')
    for (const match of line.matchAll(tagClaim)) push('release tag claim', match)
    for (const match of line.matchAll(new RegExp(`dsh-scout@(${SEMVER})`, 'g'))) {
      const before = line.slice(0, match.index)
      const after = line.slice(match.index + match[0].length)
      const installOperand = /(?:^|[\s`'"(])(?:add|install|dlx|i)\s+(?:--?[\w-]+(?:=\S+)?\s+)*(?:file:)?$/.test(
        before.replace(/[`"')\]]+$/, ''),
      )
      const standalone =
        before.replace(/^[\s>]*(?:[-*+]\s+)?/, '') === '' && after.replace(/[`"')\]]+$/, '').trim() === ''
      const quotedKey = /["']$/.test(before) && /^["']\s*:/.test(after)
      if (installOperand || standalone || quotedKey) push('install pin', match)
    }
  })
  return found
}

test('V5 · every live version reference in both READMEs is the released version', () => {
  const manifest = readJson('package.json')
  const all = []
  for (const file of ['README.md', 'README.en.md']) {
    const references = collectLiveReferences(file, readText(file))
    assert.ok(references.length > 0, `${file}: no live reference found — the extractor or the docs went blind`)
    const kinds = new Set(references.map((reference) => reference.kind))
    for (const kind of ['tarball', 'git ref', 'status banner', 'release tag claim', 'install pin']) {
      assert.ok(kinds.has(kind), `${file}: no "${kind}" reference found; the install docs lost a pinned form`)
    }
    // Non-vacuity with a measured shape: the 0.9.3 install chapter carries eight
    // exact live references (four install pins, two tarball names, one git ref,
    // one status banner, one tag claim) and one intentional placeholder.
    assert.equal(references.length, 8, `${file}: expected eight exact live references`)
    all.push(...references)

    // The one live-position specifier that is not an exact version must be the
    // documented placeholder; a range, dist-tag, or alias would be a version
    // claim this verifier cannot resolve.
    const specifiers = [...readText(file).matchAll(/dsh-scout@([0-9A-Za-z.*^~<>=|:+_-]+)/g)]
    const nonExact = specifiers.filter((match) => !/^v?\d+\.\d+\.\d+/.test(match[1]))
    assert.deepEqual(
      nonExact.map((match) => match[1]),
      ['<new-version>'],
      `${file}: the only non-version live specifier must be the upgrade placeholder`,
    )
  }
  const offenders = all
    .filter((reference) => reference.version !== manifest.version)
    .map((reference) => `${reference.file}:${reference.line} pins ${reference.text} (${reference.kind})`)
  assert.deepEqual(offenders, [], `README references must track package.json (${manifest.version})`)

  // The success-criteria section is where a user confirms that *this* release
  // loaded, so no bare version token inside it may name another release.
  const sections = [
    { file: 'README.md', heading: /^#{2,4}\s*装上了吗（成功判据）$/ },
    { file: 'README.en.md', heading: /^#{2,4}\s*Did it install\? \(success criteria\)$/ },
  ]
  let tokens = 0
  for (const { file, heading } of sections) {
    const lines = readText(file).split('\n')
    let start = -1
    let level = 0
    let end = lines.length
    let fenced = false
    for (let index = 0; index < lines.length; index += 1) {
      const trimmed = lines[index].trim()
      if (/^(?:```|~~~)/.test(trimmed)) { fenced = !fenced; continue }
      if (fenced) continue
      const marker = /^(#{1,6})\s/.exec(trimmed)
      if (start === -1) {
        if (heading.test(trimmed)) { start = index; level = marker[1].length }
        continue
      }
      if (marker !== null && marker[1].length <= level) { end = index; break }
    }
    assert.notEqual(start, -1, `${file}: the success-criteria heading must resolve`)
    for (let index = start; index < end; index += 1) {
      for (const match of lines[index].matchAll(/(?<![\w.@/-])v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?![\w.-])/g)) {
        tokens += 1
        assert.equal(
          match[1],
          manifest.version,
          `${file}:${index + 1} states ${match[0]} inside the success-criteria section`,
        )
      }
    }
  }
  assert.ok(tokens > 0, 'the success-criteria sections carry no version token, so the scan proves nothing')
})

/* ------------------------------------------------------------------ *
 * V6 · the frozen 0.9.2 semantics were not rolled back by the 0.9.3 rewrite
 * ------------------------------------------------------------------ */

test('V6 · the frozen 0.9.2 statements survive the 0.9.3 README rewrite', () => {
  const frozen = [
    // F1: the per-index rule, both languages.
    ['README.md', '按下标逐条'],
    ['README.md', '判定依据是「是否等于该下标的出厂默认」，不是编辑历史'],
    ['README.en.md', 'entry by entry, by index'],
    // language: the rendering language, not the content language (O-4 trust assumption).
    ['README.md', '本部署的渲染语言'],
    ['README.md', '不校验标签与内容是否自洽'],
    ['README.en.md', 'rendering language of this deployment'],
    // F5: the 1024 B whole-string cap, both languages.
    ['README.md', 'MAX_RENDER_BYTES = 1024'],
    ['README.md', '含省略号的整串也不会超过 1024 B'],
    ['README.en.md', 'never exceeds 1024 B'],
    // G1 stays a documented boundary in the shipped contract.
    ['docs/dsh-scout-product-contract.md', '已知边界 G1'],
  ]
  for (const [file, phrase] of frozen) {
    assert.ok(readText(file).includes(phrase), `${file}: the frozen 0.9.2 statement is missing: ${phrase}`)
  }
  // Exactly one shipped document claims to be the current version, and it is
  // this release: a second "当前版本" would mean a stale marker survived.
  const contracts = readText('docs/dsh-scout-product-contract.md')
  assert.equal(contracts.split('当前版本').length - 1, 1, 'the product contract must name exactly one current version')
  assert.match(contracts, /v0\.9\.3（当前版本）/, 'the current-version marker must be 0.9.3')
})

/* ------------------------------------------------------------------ *
 * V7 · the desktop-path facts the checklist states about this repository
 * ------------------------------------------------------------------ */

test('V9 · the verified-version-matrix and CHANGELOG agree on the release state', () => {
  // Time point: this suite verifies RELEASE_VERSION after publication. The
  // shipped guard deliberately does not cover the matrix's live claims (KNOWN GAP
  // in tests/package.test.mjs), so this check re-derives them here.
  //
  // It is a STATE check, not a "must be published" check, because the release
  // workflow runs `check:release` on the tagged commit *before* `npm publish`:
  // that commit's docs necessarily say 待发布 / 候选 tarball, and a hard
  // "published" assertion would fail the gate of every future release. Each state
  // gets its own complete contract, mixed states fail, and the stale directions
  // (matrix back to candidate, metadata removed) are covered by the fixtures.
  const SEMVER = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?`
  const esc = (value) => value.replace(/\./g, '\\.')
  const HEADINGS = [/^#{2,4}\s*已实测版本矩阵$/, /^#{2,4}\s*Verified version matrix$/]
  const RELEASE_SENTENCE = [/实测通过/, /passed on four/]
  const CLOSING = /故更新为本版本|so the table is updated to this version/
  /** Does `text` present exactly `version` as published (within one clause)? */
  const claimsPublishedBy = (text, version) => {
    // The claim must be the phrase's own clause: walk back from every
    // publication phrase to the nearest mention of this version and reject a
    // sentence boundary in between (that is the 0.9.2 history line's shape).
    for (const match of text.matchAll(/已发布|is published|published on npm/g)) {
      const before = text.slice(0, match.index)
      const at = before.lastIndexOf(version)
      if (at === -1) continue
      const between = before.slice(at + version.length)
      if (between.length <= 40 && !/[。！？；;.!?]/.test(between)) return true
    }
    return false
  }

  /** Publication metadata a *published* entry must carry, built from the version. */
  const metadata = (version) => [
    ['tarball name', new RegExp(`dsh-scout-${esc(version)}\\.tgz`)],
    ['shasum', /\bshasum\b[^\n]{0,90}?\b[0-9a-f]{40}\b/],
    ['integrity', /\bintegrity\b[^\n]{0,90}?sha512-[A-Za-z0-9+/=]{20,}/],
    ['workflow run id', /\brun\s*`?\d{6,}`?/],
    ['dist-tag', new RegExp(`dist-tags\\.latest\`?\\s*=\\s*\`?${esc(version)}`)],
    ['release tag', new RegExp(`tag\\s*\`?\\s*v${esc(version)}`)],
  ]
  /** Values that only exist after publication (used to reject a fabricated candidate). */
  const publishedValues = (version) => [
    ['shasum', /\bshasum\b[^\n]{0,90}?\b[0-9a-f]{40}\b/],
    ['integrity', /\bintegrity\b[^\n]{0,90}?sha512-[A-Za-z0-9+/=]{20,}/],
    ['dist-tag', new RegExp(`dist-tags\\.latest\`?\\s*=\\s*\`?${esc(version)}`)],
  ]

  /** One `## [version]` section of the CHANGELOG. */
  function changelogSection(text, version) {
    const marker = `## [${version}]`
    const start = text.indexOf(marker)
    if (start === -1) return null
    const next = text.indexOf('\n## [', start + 1)
    return text.slice(start, next === -1 ? undefined : next)
  }

  /** Problems in the CHANGELOG entry for `version`, given the release `state`. */
  function changelogProblems(text, version, state) {
    const body = changelogSection(text, version)
    if (body === null) return [`CHANGELOG.md: no "## [${version}]" entry`]
    const problems = []
    const pending = /待发布/.test(body)
    const published = /已发布|is published/.test(body)
    if (state === 'published') {
      if (pending) problems.push(`the published entry still says 待发布`)
      if (!published) problems.push(`the published entry does not record the release`)
      for (const [label, pattern] of metadata(version)) {
        if (!pattern.test(body)) problems.push(`the published entry is missing its ${label}`)
      }
    } else {
      if (!pending) problems.push(`the unpublished entry must say 待发布`)
      if (published) problems.push(`the unpublished entry claims to be published`)
      for (const [label, pattern] of publishedValues(version)) {
        if (pattern.test(body)) problems.push(`the unpublished entry carries ${label} metadata`)
      }
    }
    return problems
  }

  /** Problems in one README matrix section, given the release `state`. */
  function matrixProblems(file, text, version, state) {
    const problems = []
    const lines = text.split('\n')
    let start = -1
    for (let index = 0; index < lines.length; index += 1) {
      if (HEADINGS.some((heading) => heading.test(lines[index].trim()))) { start = index; break }
    }
    if (start === -1) return [`${file}: the verified-version-matrix heading must resolve`]
    let end = lines.length
    for (let index = start + 1; index < lines.length; index += 1) {
      if (/^#{1,4}\s/.test(lines[index].trim())) { end = index; break }
    }
    const body = lines.slice(start, end)

    const sentence = body.find((line) => RELEASE_SENTENCE.some((pattern) => pattern.test(line)))
    const sentenceVersions = [...(sentence ?? '').matchAll(new RegExp(`dsh-scout@(${SEMVER})`, 'g'))].map((m) => m[1])
    if (sentenceVersions.length === 0) problems.push(`${file}: the release sentence names no dsh-scout@<version>`)
    for (const claimed of sentenceVersions) {
      if (claimed !== version) problems.push(`${file}: the release sentence claims dsh-scout@${claimed}`)
    }
    if (/(已发布|is published|published on npm)/.test(sentence ?? '')) {
      problems.push(`${file}: the release sentence presents the verification run as post-publication`)
    }

    const headerIndex = body.findIndex((line) => /^\|\s*(DSH 版本|DSH version)/.test(line.trim()))
    if (headerIndex === -1) {
      problems.push(`${file}: the matrix table header must resolve`)
    } else {
      const cells = body[headerIndex].split('|').map((cell) => cell.trim())
      const releaseCell = cells.find((cell) => new RegExp(SEMVER).test(cell))
      if (releaseCell === undefined) {
        problems.push(`${file}: the matrix header names no version column`)
      } else {
        const cellVersion = new RegExp(`(${SEMVER})`).exec(releaseCell)[1]
        if (cellVersion !== version) problems.push(`${file}: the matrix version column is ${cellVersion}`)
        if (state === 'published' && !/(已发布|released)/.test(releaseCell)) {
          problems.push(`${file}: the published ${version} column must say 已发布/released, got "${releaseCell}"`)
        }
        if (state === 'candidate' && /(已发布|released)/.test(releaseCell)) {
          problems.push(`${file}: the unpublished ${version} column must not claim publication, got "${releaseCell}"`)
        }
        if (state === 'candidate' && !/(候选|candidate)/.test(releaseCell)) {
          problems.push(`${file}: the candidate ${version} column must be marked as not yet published, got "${releaseCell}"`)
        }
      }
    }

    const closingIndex = body.findIndex((line) => CLOSING.test(line))
    if (closingIndex === -1) {
      problems.push(`${file}: the "updated to this version" closing claim is missing`)
    } else {
      const closing = body[closingIndex]
      const before = closing.split(CLOSING)[0]
      const subject = [...before.matchAll(new RegExp(`(${SEMVER})`, 'g'))].at(-1)?.[1]
      if (subject !== version) problems.push(`${file}: the closing update claim is about ${subject}`)
      const closingClaims = claimsPublishedBy(closing, version)
      if (state === 'published' && !closingClaims) {
        problems.push(`${file}: the closing paragraph must present ${version} as published`)
      }
      if (state === 'candidate' && closingClaims) {
        problems.push(`${file}: the closing paragraph presents unpublished ${version} as published`)
      }
    }

    // The previous release's immutable publication facts must survive in the section.
    for (const phrase of ['0.9.2', '38406696598']) {
      if (!body.some((line) => line.includes(phrase))) {
        problems.push(`${file}: the 0.9.2 publication fact "${phrase}" is missing from the matrix`)
      }
    }

    // The document as a whole must agree with the state.
    const documentClaims = claimsPublishedBy(text, version)
    if (state === 'published' && !documentClaims) {
      problems.push(`${file}: the published release ${version} is not claimed as published anywhere`)
    }
    if (state === 'candidate' && documentClaims) {
      problems.push(`${file}: the unpublished release ${version} is claimed as published`)
    }
    return problems
  }

  // ---- fixtures: both states must pass, and every stale direction must fail ----
  const matrixFixture = ({ sentence = '0.9.3', header, closing = '0.9.3', closingPublished, history = true }) => [
    '#### 已实测版本矩阵',
    '',
    `**\`dsh-scout@${sentence}\` 已在四个精确 DSH 版本上实测通过**（发布前）：覆盖安装与卸载。`,
    '',
    `| DSH 版本 | npm 渠道（2026-10-12 核对） | ${header} |`,
    '| --- | --- | --- |',
    '| `0.1.0-rc.6` | 兼容范围下界 | 通过 |',
    '',
    `本表此前记录过 0.9.0 与 0.9.1 候选 tarball 的结果；${closing} 沿用同一范围，并用同一道门禁在同样四个精确版本上复跑通过（4/4），故更新为本版本。`
      + (closingPublished ? `**${closing} 已发布到 npm**（\`dist-tags.latest\` = \`${closing}\`）。` : '')
      + (history ? '上一版 **0.9.2 已发布到 npm**（`dist-tags.latest` = `0.9.2`），发布 workflow（run `38406696598`）。' : ''),
  ].join('\n')

  const publishedFixture = matrixFixture({ header: '0.9.3（已发布）结果', closingPublished: true })
  const candidateFixture = matrixFixture({ sentence: '0.9.4', header: '0.9.4（候选 tarball）结果', closing: '0.9.4', closingPublished: false })
  assert.deepEqual(matrixProblems('README.fixture.md', publishedFixture, '0.9.3', 'published'), [], 'published shape must pass')
  assert.deepEqual(matrixProblems('README.fixture.md', candidateFixture, '0.9.4', 'candidate'), [], 'candidate shape must pass')

  const staleMatrix = [
    ['header back to candidate', matrixFixture({ header: '0.9.3（候选 tarball）结果', closingPublished: true }), '0.9.3', 'published', 1],
    ['header names another release', matrixFixture({ header: '0.9.2（已发布）结果', closingPublished: true }), '0.9.3', 'published', 1],
    ['closing does not record publication', matrixFixture({ header: '0.9.3（已发布）结果', closingPublished: false }), '0.9.3', 'published', 1],
    ['0.9.2 facts removed', matrixFixture({ header: '0.9.3（已发布）结果', closingPublished: true, history: false }), '0.9.3', 'published', 1],
    ['release sentence names another version', matrixFixture({ sentence: '0.9.2', header: '0.9.3（已发布）结果', closingPublished: true }), '0.9.3', 'published', 1],
    [
      'release sentence claims publication',
      matrixFixture({ header: '0.9.3（已发布）结果', closingPublished: true }).replace('实测通过**', '已发布并通过**'),
      '0.9.3',
      'published',
      1,
    ],
    ['candidate header claims publication', matrixFixture({ sentence: '0.9.4', header: '0.9.4（已发布）结果', closing: '0.9.4', closingPublished: false }), '0.9.4', 'candidate', 1],
    ['candidate closing claims publication', matrixFixture({ sentence: '0.9.4', header: '0.9.4（候选 tarball）结果', closing: '0.9.4', closingPublished: true }), '0.9.4', 'candidate', 1],
  ]
  for (const [label, fixture, version, state, minimum] of staleMatrix) {
    const problems = matrixProblems('README.fixture.md', fixture, version, state)
    assert.ok(problems.length >= minimum, `stale matrix fixture "${label}" must be reported, got ${problems.length}`)
  }

  const changelogFixture = (version, { pending = false, parts = {} } = {}) => {
    // A pending entry carries no publication metadata unless a fixture asks for
    // one on purpose (the "fabricated metadata" direction).
    const include = (key) => (parts[key] === true ? true : pending ? false : parts[key] !== false)
    return [
      `## [${version}] - 2026-10-13`,
      '',
      pending
        ? `**待发布**：本条目描述冻结为 ${version} 的工作树；npm 元数据在发布后补记。`
        : `**已发布**（2026-10-13）：npm \`dsh-scout@${version}\`（\`dist-tags.latest\` = \`${version}\`）`,
      include('shasum') ? `shasum \`${'a'.repeat(40)}\`` : '',
      include('integrity') ? `integrity \`sha512-${'A'.repeat(32)}==\`` : '',
      include('run') ? '发布 workflow run `38428072425` success' : '',
      include('tarball') ? `tarball \`https://registry.npmjs.org/dsh-scout/-/dsh-scout-${version}.tgz\`` : '',
      include('tag') ? `git tag \`v${version}\`（annotated）` : '',
      '',
      '### Added',
      '',
      '- nothing.',
    ].join('\n')
  }

  assert.deepEqual(changelogProblems(changelogFixture('0.9.3'), '0.9.3', 'published'), [], 'published CHANGELOG shape must pass')
  assert.deepEqual(changelogProblems(changelogFixture('0.9.4', { pending: true }), '0.9.4', 'candidate'), [], 'candidate CHANGELOG shape must pass')
  const staleChangelog = [
    ['entry still says 待发布', changelogFixture('0.9.3', { pending: true }), '0.9.3', 'published', 1],
    ['tarball name removed', changelogFixture('0.9.3', { parts: { tarball: false } }), '0.9.3', 'published', 1],
    ['shasum removed', changelogFixture('0.9.3', { parts: { shasum: false } }), '0.9.3', 'published', 1],
    ['integrity removed', changelogFixture('0.9.3', { parts: { integrity: false } }), '0.9.3', 'published', 1],
    ['run id removed', changelogFixture('0.9.3', { parts: { run: false } }), '0.9.3', 'published', 1],
    ['release tag removed', changelogFixture('0.9.3', { parts: { tag: false } }), '0.9.3', 'published', 1],
    ['candidate entry carries release metadata', changelogFixture('0.9.4', { pending: true, parts: { shasum: true } }), '0.9.4', 'candidate', 1],
  ]
  for (const [label, fixture, version, state, minimum] of staleChangelog) {
    const problems = changelogProblems(fixture, version, state)
    assert.ok(problems.length >= minimum, `stale CHANGELOG fixture "${label}" must be reported, got ${problems.length}`)
  }

  // ---- the frozen tree ----
  const changelog = readText('CHANGELOG.md')
  const entry = changelogSection(changelog, RELEASE_VERSION)
  assert.notEqual(entry, null, `CHANGELOG.md must carry a "## [${RELEASE_VERSION}]" entry`)
  const pending = /待发布/.test(entry)
  const released = /已发布|is published/.test(entry)
  assert.notEqual(pending, released, `the ${RELEASE_VERSION} entry must state exactly one release state`)
  const state = released ? 'published' : 'candidate'

  const problems = [
    ...changelogProblems(changelog, RELEASE_VERSION, state).map((problem) => `CHANGELOG.md: ${problem}`),
    ...['README.md', 'README.en.md'].flatMap((file) => matrixProblems(file, readText(file), RELEASE_VERSION, state)),
  ]
  assert.deepEqual(problems, [], `the release docs must agree on the ${state} state:\n${problems.join('\n')}`)
})

test('V7 · the install checklist cites this repository accurately', () => {
  const checklist = readText('docs/install-verification.md')
  const manifest = readJson('package.json')

  // D2 quotes the enforced peer range verbatim.
  assert.ok(
    checklist.includes(`\`@deepseek-ai/dsh-tools: "${manifest.peerDependencies['@deepseek-ai/dsh-tools']}"\``),
    'the checklist must quote the enforced peer range from package.json',
  )
  assert.equal(manifest.engines.node, '>=22.19.0', 'the Node requirement the docs scope to the CLI paths')

  // D5 lists the twelve tools; they must be the twelve the plugin registers.
  const harness = createHarness()
  const registered = [...harness.tools.keys()].sort()
  assert.equal(registered.length, 12)
  for (const name of registered) {
    assert.ok(checklist.includes(`\`${name}\``), `the checklist must name the registered tool ${name}`)
  }

  // Lane C's default host version is the one the smoke script defaults to.
  const smoke = readText('scripts/profile-smoke.mjs')
  assert.match(smoke, /process\.env\.DSH_VERSION \?\? '0\.2\.0-rc\.2'/, 'the smoke gate default host version')
  assert.ok(checklist.includes('`0.2.0-rc.2`'), 'the checklist must state the default host version it measures')
})

/* ------------------------------------------------------------------ *
 * V8 · the release preflight is a second, fail-fast implementation
 * ------------------------------------------------------------------ */

function stageStubPath(root) {
  const stub = join(root, 'stub')
  mkdirSync(stub, { recursive: true })
  const log = join(root, 'stub-ran.log')
  for (const name of ['npm', 'pnpm']) {
    const path = join(stub, name)
    writeFileSync(path, `#!/bin/sh\necho ${name} >> "$STUB_LOG"\nexit 0\n`, { mode: 0o755 })
  }
  return { stub, log }
}

/** Run the shipped preflight only: npm/pnpm are stubbed, so the exit code is the README guard's. */
function runShippedPreflight(root, stub, log) {
  try {
    const stdout = execFileSync('node', ['scripts/check-release.mjs'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv({ PATH: `${stub}:${process.env.PATH}`, DSH_VERSIONS: '0.2.0-rc.2', STUB_LOG: log }),
    })
    return { code: 0, output: stdout }
  } catch (error) {
    return { code: error.status ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

test('V8 · the release preflight guards the READMEs and fails before the expensive gates', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'dsh-scout-verify-preflight-'))
  try {
    const { stub, log } = stageStubPath(workspace)

    const cleanRoot = stageGuardCopy(join(workspace, 'clean'))
    const clean = runShippedPreflight(cleanRoot, stub, log)
    assert.equal(clean.code, 0, `the frozen tree must pass the preflight:\n${clean.output}`)
    assert.match(
      clean.output,
      /readme release references: \d+ checked \(\d+ inside the success-criteria section\), all pinned to 0\.9\.3/,
      'the preflight must report what it checked, including the section scan',
    )
    assert.ok(existsSync(log), 'the clean run must reach the stubbed npm gate')

    const staleRoot = stageGuardCopy(join(workspace, 'stale'))
    const stalePath = join(staleRoot, 'README.md')
    writeFileSync(stalePath, readFileSync(stalePath, 'utf8').replace('add dsh-scout@0.9.3', 'add dsh-scout@0.9.2'))
    rmSync(log, { force: true })
    const stale = runShippedPreflight(staleRoot, stub, log)
    assert.notEqual(stale.code, 0, 'a stale exact pin must fail the preflight')
    assert.match(stale.output, /README release references are stale/, 'the preflight must name the reason')
    assert.match(stale.output, /README\.md:\d+ pins dsh-scout@0\.9\.2/, 'the preflight must name file:line and the pin')
    assert.ok(!existsSync(log), 'the preflight must refuse before running npm test (fail fast)')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})
