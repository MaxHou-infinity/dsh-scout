#!/usr/bin/env node
/**
 * dsh-scout profile smoke gate — real-invocation edition (0.9.1).
 *
 * WHAT THIS GATE PROVES (every item below is an executable assertion):
 *   1. the packed tarball installs into a throw-away DSH profile and the real
 *      plugin loader mounts it (`--dump-config` shows the `# == dsh-scout` layer);
 *   2. all six required tools are mounted in the registry;
 *   3. `ctx.appExit` (launcher service) is available and the plugin disposer runs
 *      on unload (`DSH_SCOUT_UNLOAD`);
 *   4. REAL TOOL CALLS through the public runtime API
 *      `ctx.tools.execute({ callId, name, arguments, signal })`:
 *        - `scout_start`  → `isError === false`, `typeof value === 'object'`
 *          (0.9.1 structured-output contract), `value.caseId` echoing the
 *          requested case, and
 *          `Buffer.byteLength(JSON.stringify(content)) < 1024`
 *          (model-visible token budget);
 *        - `scout_report` → `isError === false` and the rendered `content` carries
 *          the report body (>= 200 rendered chars including the case subject);
 *   5. OUTPUT-SCHEMA SENSITIVITY (negative control): the verifier registers a
 *      throw-away tool whose declared output schema is an object while its body
 *      returns a string, calls it, and requires the registry to reject the value
 *      (`ToolOutputError` / `INVALID_TOOL_OUTPUT`). Without this control, step 4
 *      could pass on a registry that never validates output at all.
 *
 * RUNTIME NOTE — failures arrive as RESULTS, not thrown errors (measured on
 * dsh 0.2.0-rc.2): a tool body that violates its declared `output.schema` does
 * not reject `execute()`. The registry converts it to
 * `{ isError: true, error: { message, info: { name: 'ToolOutputError',
 * code: 'INVALID_TOOL_OUTPUT' } } }` (dsh-tools `createSuccessResult` →
 * `toolErrorResult`, `lib/index.js:3541-3544` / `:3616-3622`). An unknown tool
 * name behaves the same way with `ToolNotFoundError` / `UNKNOWN_TOOL`. Assertions
 * must therefore inspect `result.isError` + `result.error.info`, and must not
 * rely on `try`/`catch` around `execute()` to detect a rejected call.
 *
 * WHAT THIS GATE DOES NOT COVER — read before trusting a green run:
 *   - no LLM and no agent loop: `execute()` runs with `agent` unset, so
 *     agent-scoped tool visibility, approval/authorization policy, model-side
 *     argument generation and streaming are NOT exercised. A tool that is
 *     invisible or denied for a real agent would still pass here;
 *   - only `scout_start` and `scout_report` are executed; the other four tools
 *     are registration-only assertions;
 *   - `scout_report` is asserted structurally (rendered length + case subject),
 *     not against a golden report, so wording/format regressions can pass;
 *   - the token budget covers the *rendered content* projection of
 *     `scout_start`, not the bytes of `value`/`meta`;
 *   - `--dump-config` proves the layer is present, not its order relative to the
 *     other profile layers;
 *   - DSH's own exit code is not evidence: every assertion lives in this script,
 *     which exits non-zero on any gate failure.
 *
 * Isolation: the DSH profile commands run with `cwd` set to this gate's own
 * temporary directory, so a case that auto-persists can never write into the
 * repository, and the temporary DSH home is removed in `finally`.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DSH_VERSION = process.env.DSH_VERSION ?? '0.2.0-rc.2'
/** Model-visible byte budget for a mutation-tool result (0.9.1 output contract). */
const TOKEN_BUDGET_BYTES = 1024
/** Set to 1 to downgrade an unavailable negative control to a loud warning. */
const SKIP_NEGATIVE_CONTROL = process.env.DSH_SCOUT_SMOKE_SKIP_NEGATIVE_CONTROL === '1'
const GATE_PREFIX = 'DSH_SCOUT_GATE '
const REQUIRED_TOOLS = [
  'scout_start',
  'scout_add_source',
  'scout_add_claim',
  'scout_verify_identity',
  'scout_verify_claim',
  'scout_report',
]
const CASE_ARGS = {
  caseId: 'smoke-case-001',
  companyName: '司察验证科技有限公司',
  roleTitle: 'HRBP',
  location: '上海',
}
const command = name => process.platform === 'win32' ? `${name}.cmd` : name
const dshCommand = process.env.DSH_BIN
  ? { program: process.env.DSH_BIN, prefix: [] }
  : { program: 'npx', prefix: ['--yes', `@deepseek-ai/dsh@${DSH_VERSION}`] }

function run(program, args, options = {}) {
  const result = spawnSync(command(program), args, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    throw new Error([
      `${program} ${args.join(' ')} failed with exit code ${result.status}`,
      details,
    ].filter(Boolean).join('\n'))
  }
  return result.stdout ?? ''
}

/** First 200 chars of a value, for "expected vs actual" diagnostics. */
function head(value, max = 200) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  if (text === undefined) return 'undefined'
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function gateFailure(lines) {
  const error = new Error(['dsh-scout profile smoke gate FAILED', ...lines.map(line => `  ${line}`)].join('\n'))
  error.gateFailure = true
  return error
}

function requireGate(condition, diagnostic) {
  if (condition) return
  const lines = typeof diagnostic === 'function' ? diagnostic() : diagnostic
  throw gateFailure(Array.isArray(lines) ? lines : [lines])
}

function parseGateLines(stdout) {
  const entries = []
  for (const line of stdout.split('\n')) {
    if (!line.startsWith(GATE_PREFIX)) continue
    try {
      entries.push(JSON.parse(line.slice(GATE_PREFIX.length)))
    } catch (error) {
      entries.push({ kind: 'unparsable', raw: head(line, 400), parseError: error.message })
    }
  }
  return entries
}

/** Rendered text carried by a `ContentBlock[]` projection. */
function renderedText(content) {
  if (!Array.isArray(content)) return ''
  return content
    .map(block => block && typeof block.text === 'string' ? block.text : '')
    .filter(Boolean)
    .join('\n')
}

function describeCall(entry, extra = []) {
  const result = entry?.result
  const lines = [
    `tool:          ${entry?.tool ?? '(no gate line emitted)'}`,
    `outcome:       ${result?.outcome ?? 'no result (call skipped or plugin failed)'}`,
    `callId:        ${result?.callId ?? 'n/a'}`,
  ]
  if (entry?.skipped) lines.push(`skipped:       ${entry.skipped}`)
  if (result?.outcome === 'threw') {
    lines.push(`threw:         ${result.error?.name ?? 'Error'}: ${result.error?.message ?? '(no message)'}`)
    if (result.error?.violations) lines.push(`violations:    ${JSON.stringify(result.error.violations)}`)
    if (result.error?.code) lines.push(`code:          ${result.error.code}`)
  } else if (result) {
    lines.push(`isError:       ${result.isError}`)
    lines.push(`value type:    ${result.valueType ?? typeof result.value}`)
    lines.push(`contentBytes:  ${result.contentBytes}`)
    if (result.isError) lines.push(`error:         ${head(result.error, 300)}`)
  }
  lines.push(`content[0:200]: ${head(result?.content)}`)
  return [...lines, ...extra]
}

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const gateRoot = await mkdtemp(join(tmpdir(), 'dsh-scout-profile-gate-'))
const dshHome = join(gateRoot, 'home')
const tarball = join(gateRoot, `${packageJson.name}-${packageJson.version}.tgz`)
const verifierPath = join(gateRoot, 'verify-lifecycle.mjs')
const patchPath = join(gateRoot, 'verify-lifecycle.patch.yml')
const gateEnv = {
  ...process.env,
  DSH_HOME: dshHome,
  DSH_TELEMETRY_MODE: 'DISABLED',
}

/**
 * The injected verifier plugin. It runs inside the real DSH process with the
 * `tools` service injected, emits one `DSH_SCOUT_GATE <json>` line per observed
 * fact, and always leaves the assertions to this script (single place for
 * expected-vs-actual diagnostics).
 */
const verifierSource = `
export const inject = ['tools']

const REQUIRED = ${JSON.stringify(REQUIRED_TOOLS)}
const CASE_ARGS = ${JSON.stringify(CASE_ARGS)}
const TOKEN_BUDGET_BYTES = ${TOKEN_BUDGET_BYTES}
const PROBE_NAME = 'scout_smoke_output_probe'

let callSequence = 0

const emit = (kind, payload) => {
  process.stdout.write('${GATE_PREFIX}' + JSON.stringify(Object.assign({ kind: kind }, payload)) + '\\n')
}

const describeError = error => ({
  name: error && error.name ? error.name : typeof error,
  message: error && error.message ? error.message : String(error),
  code: error && error.code ? error.code : null,
  violations: error && Array.isArray(error.violations) ? error.violations : null,
})

const waitForTool = async (ctx, name, deadline) => {
  for (;;) {
    if (ctx.tools.get(name)) return true
    if (Date.now() >= deadline) return false
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

const callTool = async (ctx, name, args) => {
  callSequence += 1
  const callId = 'smoke-' + name + '-' + callSequence
  try {
    const result = await ctx.tools.execute({
      callId: callId,
      name: name,
      arguments: args,
      signal: new AbortController().signal,
    })
    const content = result.content === undefined ? null : result.content
    return {
      outcome: 'returned',
      callId: callId,
      isError: result.isError === true,
      hasValue: Object.prototype.hasOwnProperty.call(result, 'value'),
      value: result.value === undefined ? null : result.value,
      valueType: Array.isArray(result.value) ? 'array' : typeof result.value,
      content: content,
      contentBytes: Buffer.byteLength(JSON.stringify(content)),
      meta: result.meta === undefined ? null : result.meta,
      error: result.isError === true ? result.error : null,
    }
  } catch (error) {
    return { outcome: 'threw', callId: callId, error: describeError(error) }
  }
}

export async function apply(ctx) {
  const startedAt = Date.now()
  try {
    const deadline = startedAt + 5000
    const missing = []
    for (const name of REQUIRED) {
      if (!(await waitForTool(ctx, name, deadline))) missing.push(name)
    }
    emit('registry', {
      required: REQUIRED,
      missing: missing,
      appExit: typeof ctx.appExit,
      execute: typeof ctx.tools.execute,
    })

    if (missing.length === 0) {
      const startResult = await callTool(ctx, 'scout_start', CASE_ARGS)
      emit('call', { tool: 'scout_start', args: CASE_ARGS, result: startResult })
      if (startResult.outcome === 'returned' && startResult.isError === false) {
        emit('call', { tool: 'scout_report', result: await callTool(ctx, 'scout_report', { caseId: CASE_ARGS.caseId }) })
      } else {
        emit('call', { tool: 'scout_report', skipped: 'scout_start did not succeed' })
      }
    }

    // Negative control: the declared output schema is an object, the body returns
    // a string, so a registry that enforces output schemas must reject the value.
    try {
      const dispose = ctx.tools.register({
        name: PROBE_NAME,
        description: 'Gate self-test: declares an object output schema and deliberately returns a string.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        output: {
          schema: { type: 'object', properties: { ok: { type: 'string' } }, additionalProperties: false },
          render: () => [{ type: 'text', text: 'output-schema probe' }],
        },
        execute: async () => 'deliberately-not-an-object',
      })
      try {
        emit('negativeControl', { status: 'ran', tool: PROBE_NAME, result: await callTool(ctx, PROBE_NAME, {}) })
      } finally {
        dispose()
      }
    } catch (error) {
      emit('negativeControl', { status: 'unavailable', tool: PROBE_NAME, error: describeError(error) })
    }

    process.stdout.write('DSH_SCOUT_LOAD\\n')
    ctx.effect(() => () => process.stdout.write('DSH_SCOUT_UNLOAD\\n'))
    emit('done', { elapsedMs: Date.now() - startedAt })
    queueMicrotask(() => ctx.appExit(0))
  } catch (error) {
    emit('fatal', { error: describeError(error) })
    queueMicrotask(() => ctx.appExit(1))
  }
}
`

try {
  await writeFile(verifierPath, verifierSource)
  await writeFile(patchPath, `- insert:\n    - id: dsh-scout-smoke-verifier\n      name: ${JSON.stringify(verifierPath)}\n`)
  run('pnpm', ['pack', '--pack-destination', gateRoot])
  run(dshCommand.program, [
    ...dshCommand.prefix,
    'plugin',
    '--profile',
    'scout-smoke',
    'add',
    `file:${tarball}`,
  ], { env: gateEnv, cwd: gateRoot })
  const config = run(dshCommand.program, [
    ...dshCommand.prefix,
    '--profile',
    'scout-smoke',
    '--dump-config',
  ], {
    capture: true,
    env: gateEnv,
    cwd: gateRoot,
  })
  assert.match(config, /# == dsh-scout\n- id: dsh-scout\n  name: dsh-scout/)
  const lifecycle = run(dshCommand.program, [
    ...dshCommand.prefix,
    '--profile',
    'scout-smoke',
    '--patch',
    patchPath,
  ], { capture: true, env: gateEnv, cwd: gateRoot })
  assert.match(lifecycle, /DSH_SCOUT_LOAD/)
  assert.match(lifecycle, /DSH_SCOUT_UNLOAD/)

  const gates = parseGateLines(lifecycle)
  const findGate = (kind, tool) => gates.find(entry => entry.kind === kind && (tool === undefined || entry.tool === tool))
  const rawOutput = () => [`gate lines captured: ${gates.length}`, `dsh output[0:600]: ${head(lifecycle, 600)}`]

  // --- 1. registry: required tools, launcher service, real-call API -----------
  const registry = findGate('registry')
  requireGate(registry !== undefined, () => [
    'registry assertion: the verifier plugin emitted no `registry` gate line',
    ...rawOutput(),
  ])
  requireGate(registry.missing.length === 0, [
    'registry assertion: required dsh-scout tools are not mounted',
    `expected mounted:  ${JSON.stringify(REQUIRED_TOOLS)}`,
    `actually missing:  ${JSON.stringify(registry.missing)}`,
  ])
  requireGate(registry.execute === 'function', [
    'runtime API assertion: ctx.tools.execute is not a function in this DSH version',
    `expected: function  actual: ${registry.execute}`,
  ])
  requireGate(registry.appExit === 'function', [
    'launcher assertion: ctx.appExit is not a function',
    `expected: function  actual: ${registry.appExit}`,
  ])

  // --- 2. scout_start: real call, structured value, token budget -------------
  const startGate = findGate('call', 'scout_start')
  requireGate(startGate?.result !== undefined, () => [
    'tool call assertion: no result for scout_start',
    ...describeCall(startGate, rawOutput()),
  ])
  const start = startGate.result
  requireGate(start.outcome === 'returned', () => describeCall(startGate, [
    'expected: execute() resolves with a ToolExecutionResult',
    'actual:   execute() threw',
  ]))
  requireGate(start.isError === false, () => describeCall(startGate, [
    'expected: isError === false',
    `actual:   isError === ${start.isError}`,
  ]))
  requireGate(start.hasValue === true && start.value !== null && typeof start.value === 'object', () => describeCall(startGate, [
    "expected: typeof result.value === 'object'  (0.9.1 structured-output contract)",
    `actual:   hasValue=${start.hasValue} valueType=${start.valueType}`,
  ]))
  // Contract-level shape check from the frozen 0.9.1 envelope: the mutation value
  // must echo the requested case id (a stray `{}` or an unrelated object fails).
  requireGate(start.value.caseId === CASE_ARGS.caseId, () => describeCall(startGate, [
    `expected: result.value.caseId === ${JSON.stringify(CASE_ARGS.caseId)} (mutation envelope echoes the case)`,
    `actual:   caseId=${JSON.stringify(start.value.caseId)}`,
    `value keys: ${JSON.stringify(Object.keys(start.value ?? {}))}`,
  ]))
  requireGate(start.contentBytes === Buffer.byteLength(JSON.stringify(start.content)), () => describeCall(startGate, [
    'emission fidelity: the JSON-encoded content does not round-trip to the same byte size',
    `plugin-side bytes: ${start.contentBytes}`,
    `script-side bytes: ${Buffer.byteLength(JSON.stringify(start.content))}`,
  ]))
  requireGate(start.contentBytes < TOKEN_BUDGET_BYTES, () => describeCall(startGate, [
    `expected: Buffer.byteLength(JSON.stringify(result.content)) < ${TOKEN_BUDGET_BYTES}`,
    `actual:   ${start.contentBytes} bytes (budget exceeded by ${start.contentBytes - TOKEN_BUDGET_BYTES})`,
  ]))

  // --- 3. scout_report: real call, report body in rendered content -----------
  const reportGate = findGate('call', 'scout_report')
  requireGate(reportGate?.result !== undefined, () => [
    'tool call assertion: no result for scout_report',
    ...describeCall(reportGate, rawOutput()),
  ])
  const report = reportGate.result
  requireGate(report.outcome === 'returned' && report.isError === false, () => describeCall(reportGate, [
    'expected: execute() resolves with isError === false',
    `actual:   outcome=${report.outcome} isError=${report.isError}`,
  ]))
  const reportText = renderedText(report.content)
  requireGate(reportText.length >= 200, () => describeCall(reportGate, [
    'expected: rendered content carries the report body (>= 200 chars)',
    `actual:   ${reportText.length} rendered chars`,
  ]))
  requireGate(reportText.includes(CASE_ARGS.companyName), () => describeCall(reportGate, [
    `expected: report body contains the case subject ${JSON.stringify(CASE_ARGS.companyName)}`,
    `actual:   subject not found in ${reportText.length} rendered chars`,
  ]))
  const reportHasHeading = /^#\s/m.test(reportText)
  if (!reportHasHeading) {
    console.warn('dsh-scout profile smoke: WARNING — report body has no Markdown heading; the "report body" assertion only checked length and case subject')
  }

  // --- 4. negative control: the output-schema gate is actually enforced -----
  const negative = findGate('negativeControl')
  requireGate(negative !== undefined, () => [
    'output-schema self-test: no `negativeControl` gate line',
    ...rawOutput(),
  ])
  if (negative.status === 'unavailable' && !SKIP_NEGATIVE_CONTROL) {
    throw gateFailure([
      'output-schema self-test: the probe tool could not be registered, so this run does NOT prove',
      'that the two real calls above were validated against their declared output schemas.',
      `probe registration error: ${negative.error?.name}: ${negative.error?.message}`,
      're-run with DSH_SCOUT_SMOKE_SKIP_NEGATIVE_CONTROL=1 only if you accept that reduced coverage.',
    ])
  }
  if (negative.status === 'ran') {
    const probe = negative.result
    const detected = probe.outcome === 'threw'
      ? probe.error?.name === 'ToolOutputError' || probe.error?.code === 'INVALID_TOOL_OUTPUT'
      : probe.isError === true && (probe.error?.info?.name === 'ToolOutputError' || probe.error?.info?.code === 'INVALID_TOOL_OUTPUT')
    requireGate(detected, () => describeCall({ tool: negative.tool, result: probe }, [
      'expected: the registry rejects a string value against a declared object output schema',
      '          (ToolOutputError / INVALID_TOOL_OUTPUT)',
      'actual:   the invalid value was accepted, so the real-call assertions above are NOT schema gates',
    ]))
  }

  const done = findGate('done')
  requireGate(done !== undefined, () => [
    'lifecycle assertion: the verifier plugin never reached its `done` line',
    ...rawOutput(),
  ])

  const negativeSummary = negative.status === 'ran'
    ? 'output-schema negative control (ToolOutputError observed)'
    : 'output-schema negative control SKIPPED (coverage degraded)'
  console.log(`dsh-scout profile smoke: PASS (dsh ${DSH_VERSION})`)
  console.log(`  verified: dump-config layer | ${REQUIRED_TOOLS.length} tools mounted | scout_start(isError=false, value=object with caseId echo, content=${start.contentBytes}B < ${TOKEN_BUDGET_BYTES}) | scout_report(isError=false, rendered=${reportText.length} chars, subject present) | appExit | DSH_SCOUT_UNLOAD | ${negativeSummary}`)
  // Evidence, deliberately NOT an assertion: the frozen 0.9.1 read-tool envelope
  // (`scout_report.value = {caseId, decision, report, coverage}`) is printed so a
  // human can compare it against the contract; only content/report-body presence
  // is enforced above, to avoid over-fitting this gate to one envelope revision.
  console.log(`  observed value keys: scout_start=${JSON.stringify(Object.keys(start.value ?? {}))} scout_report=${JSON.stringify(Object.keys(report.value ?? {}))}`)
  console.log('  not covered: no agent/LLM/approval path (agent unset), only scout_start+scout_report executed, report asserted structurally, token budget covers rendered content only')
} catch (error) {
  if (error?.gateFailure) {
    console.error(error.message)
    process.exitCode = 1
  } else {
    throw error
  }
} finally {
  await rm(gateRoot, { recursive: true, force: true })
}
