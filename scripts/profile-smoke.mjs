#!/usr/bin/env node
/**
 * dsh-scout profile smoke gate — real-invocation edition (0.9.2).
 *
 * WHAT THIS GATE PROVES (every item below is an executable assertion):
 *   1. the packed tarball installs into throw-away DSH profiles and the real
 *      plugin loader mounts it (`--dump-config` shows the `# == dsh-scout` layer);
 *      the profile patch layer's `config:` block is honored too (an absolute
 *      `scoutDir` and the deployment `language`), which is how every step below
 *      gets a deterministic base directory without touching the plugin;
 *   2. all twelve registered tools are mounted in the registry, `ctx.appExit`
 *      (launcher service) and the `fs` seam are available, and the plugin
 *      disposer runs on unload (`DSH_SCOUT_UNLOAD`);
 *   3. REAL TOOL CALLS through the public runtime API
 *      `ctx.tools.execute()` (legacy single call or executor batch), in a SIX-STEP
 *      scenario chain run across up to six real host processes:
 *        STEP 1  create: `scout_start` + `scout_add_source` (E3 registry origin)
 *                + `scout_add_claim` → each `isError === false`; `scout_start`
 *                returns an object `value` echoing the requested case id
 *                (0.9.1 structured-output contract) whose rendered projection
 *                stays under the model-visible token budget;
 *        STEP 2  export: `scout_export { targetDir: <ABSOLUTE dir> }` →
 *                `persisted === true`, `complete === true`, the resolved
 *                `value.targetDir` is the absolute directory that was passed,
 *                all SIX files exist on disk and `export.complete.json` carries
 *                `complete: true`;
 *        STEP 3  cold restart: a second host process with the same DSH_HOME and
 *                profile boots successfully and reports a DIFFERENT pid, so no
 *                in-memory case state can survive into it;
 *        STEP 4  lazy rehydration: in that second process `scout_report` runs
 *                with no prior `scout_import` and still returns the exported
 *                case — same decision as the export, sources/claims intact, and
 *                a follow-up export's `events.jsonl` carries the
 *                `case_rehydrated` event pointing at `<scoutDir>/<caseId>`;
 *        STEP 5  cross-language: a second profile with `language: en` sharing
 *                the same `scoutDir` runs `scout_import` on the zh export →
 *                `complete === true`, the rendered report AND the exported
 *                `report.md` contain ZERO Han characters, `case.json.language`
 *                is `en`, and the ASCII user-authored subject survives verbatim;
 *        STEP 6  uninstall: after `dsh plugin remove dsh-scout` the composed
 *                config has no dsh-scout layer AND a real boot reports all
 *                twelve tools missing — no registry residue;
 *   4. NEGATIVE CONTROLS (each one is what keeps a green run from being vacuous):
 *        - OUTPUT-SCHEMA SENSITIVITY: the verifier registers a throw-away tool
 *          whose declared output schema is an object while its body returns a
 *          string, calls it, and requires the registry to reject the value
 *          (`ToolOutputError` / `INVALID_TOOL_OUTPUT`);
 *        - COMPLETION MARKER, MISSING: with `export.complete.json` deleted, a
 *          cold process must NOT rehydrate — `scout_report` fails with
 *          `Unknown case: …`, so STEP 4 really reads the marker;
 *        - COMPLETION MARKER, FALSE: the marker rewritten as `complete: false`
 *          (payload files still on disk) must be refused the same way, so
 *          existence alone is not being trusted.
 *      The two marker controls only count when their run mounted all twelve
 *      tools (asserted), otherwise they could pass because the plugin failed;
 *   5. DECISION STABILITY ACROSS THE BOUNDARY: the decision captured from the
 *      exported `case.json` equals the decision reported before the restart and
 *      after rehydration and after the cross-language import.
 *
 * RUNTIME NOTE — tool failures arrive as RESULTS on the legacy API (measured on
 * dsh 0.2.0-rc.2): a tool body that violates its declared `output.schema` does
 * not reject `execute()`. The registry converts it to
 * `{ isError: true, error: { message, info: { name: 'ToolOutputError',
 * code: 'INVALID_TOOL_OUTPUT' } } }` (dsh-tools `createSuccessResult` →
 * `toolErrorResult`, `lib/index.js:3541-3544` / `:3616-3622`). An unknown tool
 * name behaves the same way with `ToolNotFoundError` / `UNKNOWN_TOOL`. Assertions
 * must therefore inspect `result.isError` + `result.error.info`, and must not
 * rely on `try`/`catch` around `execute()` to detect a rejected call. Batch
 * infrastructure errors can reject; their bounded cause and partial call IDs are logged.
 *
 * WHAT THIS GATE DOES NOT COVER — read before trusting a green run:
 *   - no LLM and no agent loop: `execute()` runs with `agent` unset, so
 *     agent-scoped tool visibility, approval/authorization policy, model-side
 *     argument generation and streaming are NOT exercised. A tool that is
 *     invisible or denied for a real agent would still pass here;
 *   - no relative-path behavior: with `agent` unset the plugin's `cwd` is
 *     `undefined` (src/index.ts:427), so this gate deliberately passes an
 *     ABSOLUTE `scoutDir` AND an absolute `targetDir`. That is the documented
 *     contract for this host shape; a regression that only shows up with a
 *     relative directory is out of scope by construction;
 *   - the fixture is ASCII-only on purpose: user-authored copy is never
 *     translated (only untouched factory defaults are aligned when the
 *     deployment language differs), so "CJK = 0" can only hold when the whole
 *     artifact is factory prose. The zh `report.md` CJK > 0 control is what
 *     makes STEP 5 non-vacuous — without it an English-only plugin would pass;
 *   - six of the twelve tools are executed (`scout_start`, `scout_add_source`,
 *     `scout_add_claim`, `scout_export`, `scout_report`, `scout_import`); the
 *     other six (`scout_ingest`, `scout_search`, `scout_compare`,
 *     `scout_questions`, `scout_verify_identity`, `scout_verify_claim`) are
 *     registration-only assertions;
 *   - `report.md`/`case.json` are asserted structurally (decision echo, subject,
 *     CJK count, language label), never against a golden artifact, so wording
 *     and layout regressions can pass;
 *   - the token budget covers the *rendered content* projection of
 *     `scout_start`, not the bytes of `value`/`meta`;
 *   - `autoPersist` stays at its default (`false`): `case_rehydrated` and the
 *     completion marker are observed via explicit exports, so "persist after
 *     every mutation" is NOT exercised;
 *   - torn-export behavior (a marker left `complete: false` by an interrupted
 *     write) is only reproduced by rewriting the marker after a clean export,
 *     not by killing a process mid-write;
 *   - `--dump-config` proves the layer is present, not its order relative to the
 *     other profile layers;
 *   - DSH's own exit code is not evidence: every assertion lives in this script,
 *     which exits non-zero on any gate failure.
 *
 * COST AND HOW TO SKIP. This gate is intentionally heavier than its 0.9.1 form:
 * it boots the real host up to six times (create/export, rehydrate, en import,
 * two marker controls, post-uninstall) and installs the tarball into up to two
 * profiles. Measured wall clock: ~16s for a full run on an M-series Mac with a
 * warm pnpm store (the six host boots and the two profile installs dominate; the
 * tool-call chain itself is a few seconds), and more on a cold store or a slow
 * CI box. Escapes:
 *   - DSH_SCOUT_SMOKE_SKIP_CROSS_LANGUAGE=1     → skip STEP 5 (and the second
 *     profile's install); U11's cross-language path loses its gate;
 *   - DSH_SCOUT_SMOKE_SKIP_REHYDRATION_CONTROL=1 → skip both completion-marker
 *     controls; STEP 4 then has no control proving it reads the marker;
 *   - DSH_SCOUT_SMOKE_SKIP_NEGATIVE_CONTROL=1   → downgrade the output-schema
 *     probe to a warning (pre-existing switch).
 * Every skip is reported in the PASS line as degraded coverage — never silent.
 * DSH_SCOUT_SMOKE_VERBOSE=1 echoes each host process's raw stdout (the
 * `DSH_SCOUT_GATE` evidence lines included) without changing any assertion.
 *
 * Isolation: the DSH profile commands run with `cwd` set to this gate's own
 * temporary directory, every case directory lives under that temporary
 * directory, and the temporary DSH home is removed in `finally`.
 */
import assert from 'node:assert/strict'
import { executeSmokeTool, describeSmokeError } from './smoke-tool-call.mjs'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'

const DSH_VERSION = process.env.DSH_VERSION ?? '0.2.0-rc.2'
/** Model-visible byte budget for a mutation-tool result (0.9.1 output contract). */
const TOKEN_BUDGET_BYTES = 1024
/** Set to 1 to downgrade an unavailable negative control to a loud warning. */
const SKIP_NEGATIVE_CONTROL = process.env.DSH_SCOUT_SMOKE_SKIP_NEGATIVE_CONTROL === '1'
/** Set to 1 to skip both completion-marker controls (STEP 4 loses its control). */
const SKIP_REHYDRATION_CONTROL = process.env.DSH_SCOUT_SMOKE_SKIP_REHYDRATION_CONTROL === '1'
/** Set to 1 to skip the cross-language profile (STEP 5). */
const SKIP_CROSS_LANGUAGE = process.env.DSH_SCOUT_SMOKE_SKIP_CROSS_LANGUAGE === '1'
/** Set to 1 to echo each host process's raw stdout (evidence for a red run). */
const VERBOSE = process.env.DSH_SCOUT_SMOKE_VERBOSE === '1'
const GATE_PREFIX = 'DSH_SCOUT_GATE '
const REQUIRED_TOOLS = [
  'scout_start',
  'scout_add_source',
  'scout_add_claim',
  'scout_verify_identity',
  'scout_verify_claim',
  'scout_ingest',
  'scout_search',
  'scout_compare',
  'scout_report',
  'scout_export',
  'scout_import',
  'scout_questions',
]
/** The six-file export: five payload files plus the completion marker. */
const EXPORT_MARKER_FILE = 'export.complete.json'
const EXPORT_FILES = [
  'case.json',
  'sources.json',
  'claims.json',
  'events.jsonl',
  'report.md',
  EXPORT_MARKER_FILE,
]
/**
 * Deliberately ASCII user-authored copy: user-authored strings are never
 * translated (only untouched factory prose is aligned when the deployment
 * language differs), so an ASCII fixture keeps "a Han character leaked into the
 * en artifact" distinguishable from "the user wrote Chinese". Without that, the
 * STEP 5 CJK count could only be asserted against a moving expectation.
 */
const CASE_ARGS = {
  caseId: 'smoke-case-001',
  companyName: 'Sicha Verification Technology Co., Ltd.',
  roleTitle: 'HRBP',
  location: 'Shanghai',
}
const SOURCE_ARGS = [
  {
    sourceId: 'src-registry',
    sourceType: 'company_registry',
    title: 'National Enterprise Credit Information Publicity System record',
    url: 'https://www.gsxt.gov.cn/corp-query-search-1.html',
    evidenceLevel: 'E3',
  },
  {
    sourceId: 'src-posting',
    sourceType: 'job_posting',
    title: 'HRBP job posting',
    url: 'https://www.linkedin.com/jobs/view/4012345678',
    evidenceLevel: 'E2',
  },
]
const CLAIM_ARGS = {
  claimId: 'clm-1',
  text: 'The HRBP role reports to the founder and owns the hiring plan.',
  status: 'reported',
  evidenceLevel: 'E2',
  dimension: 'reporting_line',
  impact: 'material',
  sourceIds: 'src-posting',
  confidenceNote: 'Stated in the posting; not confirmed by the company yet.',
  nextAction: 'Confirm the reporting line in the first interview.',
}
/** Han characters only, matching tests/acceptance.test.mjs. */
const HAN = /[\u4e00-\u9fff]/g
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

/** Han-character count of a string (0 for non-strings). */
function cjkCount(text) {
  return typeof text === 'string' ? (text.match(HAN) ?? []).length : 0
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
    if (result.error?.cause) lines.push(`cause:         ${JSON.stringify(result.error.cause)}`)
    if (result.error?.partial) lines.push(`partial:       ${JSON.stringify(result.error.partial)}`)
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

/** One-line read of a gate entry's result for diagnostics. */
function describeResult(result) {
  if (!result) return 'no result'
  const bits = [`outcome=${result.outcome}`]
  if (result.outcome === 'returned') {
    bits.push(`isError=${result.isError}`)
    if (result.isError) bits.push(`error=${head(result.error, 200)}`)
  } else {
    bits.push(`error=${result.error?.name}: ${result.error?.message}`)
  }
  return bits.join(' ')
}

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const gateRoot = await mkdtemp(join(tmpdir(), 'dsh-scout-profile-gate-'))
const dshHome = join(gateRoot, 'home')
const tarball = join(gateRoot, `${packageJson.name}-${packageJson.version}.tgz`)
const verifierPath = join(gateRoot, 'verify-lifecycle.mjs')
/**
 * One shot of the shared setup: every case lives under this absolute directory
 * and BOTH profiles point their `scoutDir` at it, which is what lets STEP 5
 * import what STEP 2 exported (and lets STEP 4/6 find the case on disk).
 */
const scoutDataDir = join(gateRoot, 'scout-data')
const zhExportDir = join(scoutDataDir, CASE_ARGS.caseId)
const rehydratedExportDir = join(gateRoot, 'rehydrated-export')
const enExportDir = join(gateRoot, 'en-export')
const patchZhPath = join(gateRoot, 'profile-zh.patch.yml')
const patchEnPath = join(gateRoot, 'profile-en.patch.yml')
const patchVerifierOnlyPath = join(gateRoot, 'verifier-only.patch.yml')
const ZH_PROFILE = 'scout-smoke'
const EN_PROFILE = 'scout-smoke-en'
const gateEnv = {
  ...process.env,
  DSH_HOME: dshHome,
  DSH_TELEMETRY_MODE: 'DISABLED',
}

/**
 * The injected verifier plugin. It runs inside the real DSH process with the
 * `tools` service injected, emits one `DSH_SCOUT_GATE <json>` line per observed
 * fact, and always leaves the assertions to this script (single place for
 * expected-vs-actual diagnostics). The scenario (which calls to make) comes from
 * the environment; the plugin never decides whether a fact is correct.
 */
const verifierSource = `
export const inject = ['tools']

const REQUIRED = ${JSON.stringify(REQUIRED_TOOLS)}
const CASE_ARGS = ${JSON.stringify(CASE_ARGS)}
const SOURCES = ${JSON.stringify(SOURCE_ARGS)}
const CLAIM = ${JSON.stringify(CLAIM_ARGS)}
const TOKEN_BUDGET_BYTES = ${TOKEN_BUDGET_BYTES}
const PROBE_NAME = 'scout_smoke_output_probe'
const SCENARIO = process.env.DSH_SCOUT_GATE_SCENARIO ?? 'registry-only'
const CASE_ID = process.env.DSH_SCOUT_GATE_CASE_ID ?? CASE_ARGS.caseId
const ZH_EXPORT_DIR = process.env.DSH_SCOUT_GATE_ZH_EXPORT_DIR
const REHYDRATED_EXPORT_DIR = process.env.DSH_SCOUT_GATE_REHYDRATED_EXPORT_DIR
const EN_EXPORT_DIR = process.env.DSH_SCOUT_GATE_EN_EXPORT_DIR
const WAIT_MS = Number(process.env.DSH_SCOUT_GATE_WAIT_MS ?? '5000')

let callSequence = 0

const emit = (kind, payload) => {
  process.stdout.write('${GATE_PREFIX}' + JSON.stringify(Object.assign({ kind: kind }, payload)) + '\\n')
}

const describeError = ${describeSmokeError.toString()}
const executeSmokeTool = ${executeSmokeTool.toString()}

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
    const result = await executeSmokeTool(
      ctx.tools, callId, name, args, new AbortController().signal,
    )
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
    emit('boot', { pid: process.pid, scenario: SCENARIO, caseId: CASE_ID })
    const deadline = startedAt + WAIT_MS
    const missing = []
    for (const name of REQUIRED) {
      if (!(await waitForTool(ctx, name, deadline))) missing.push(name)
    }
    emit('registry', {
      required: REQUIRED,
      missing: missing,
      appExit: typeof ctx.appExit,
      execute: typeof ctx.tools.execute,
      fs: typeof ctx.get('fs'),
    })

    const runScenario = async () => {
      if (SCENARIO === 'create-export') {
        // STEP 1 — create the case and register a source plus a claim.
        emit('call', { tool: 'scout_start', args: CASE_ARGS, result: await callTool(ctx, 'scout_start', CASE_ARGS) })
        for (const source of SOURCES) {
          emit('call', { tool: 'scout_add_source', args: source, result: await callTool(ctx, 'scout_add_source', Object.assign({ caseId: CASE_ID }, source)) })
        }
        emit('call', { tool: 'scout_add_claim', args: CLAIM, result: await callTool(ctx, 'scout_add_claim', Object.assign({ caseId: CASE_ID }, CLAIM)) })
        // STEP 2 — export to an EXPLICIT absolute directory (never process cwd).
        emit('call', {
          tool: 'scout_export',
          args: { caseId: CASE_ID, targetDir: ZH_EXPORT_DIR },
          result: await callTool(ctx, 'scout_export', { caseId: CASE_ID, targetDir: ZH_EXPORT_DIR }),
        })
        emit('call', { tool: 'scout_report', args: { caseId: CASE_ID }, result: await callTool(ctx, 'scout_report', { caseId: CASE_ID }) })
      } else if (SCENARIO === 'rehydrate') {
        // STEP 4 — no import: the case must come back from <scoutDir>/<caseId>.
        emit('call', { tool: 'scout_report', args: { caseId: CASE_ID }, result: await callTool(ctx, 'scout_report', { caseId: CASE_ID }) })
        // A follow-up export is what puts the in-memory case_rehydrated event on
        // disk; without it the event exists only in the process that read it.
        emit('call', {
          tool: 'scout_export',
          args: { caseId: CASE_ID, targetDir: REHYDRATED_EXPORT_DIR },
          result: await callTool(ctx, 'scout_export', { caseId: CASE_ID, targetDir: REHYDRATED_EXPORT_DIR }),
        })
      } else if (SCENARIO === 'import-en') {
        // STEP 5 — the en deployment imports the zh export from the shared dir.
        emit('call', {
          tool: 'scout_import',
          args: { caseId: CASE_ID, sourceDir: ZH_EXPORT_DIR },
          result: await callTool(ctx, 'scout_import', { caseId: CASE_ID, sourceDir: ZH_EXPORT_DIR }),
        })
        emit('call', { tool: 'scout_report', args: { caseId: CASE_ID }, result: await callTool(ctx, 'scout_report', { caseId: CASE_ID }) })
        emit('call', {
          tool: 'scout_export',
          args: { caseId: CASE_ID, targetDir: EN_EXPORT_DIR },
          result: await callTool(ctx, 'scout_export', { caseId: CASE_ID, targetDir: EN_EXPORT_DIR }),
        })
      } else if (SCENARIO === 'report-only') {
        // Negative controls: the marker is missing or says complete:false, so
        // this call is expected to FAIL — the assertion lives in the host script.
        emit('call', { tool: 'scout_report', args: { caseId: CASE_ID }, result: await callTool(ctx, 'scout_report', { caseId: CASE_ID }) })
      }
    }

    if (missing.length === 0) await runScenario()
    else emit('skipped', { reason: 'required tools are not mounted', missing: missing })

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

/** The per-profile overlay: absolute scoutDir + language + the verifier insert. */
function profilePatch(language) {
  return [
    '- id: dsh-scout',
    '  config:',
    `    scoutDir: ${JSON.stringify(scoutDataDir)}`,
    `    language: ${JSON.stringify(language)}`,
    '- insert:',
    '    - id: dsh-scout-smoke-verifier',
    `      name: ${JSON.stringify(verifierPath)}`,
    '',
  ].join('\n')
}

/** Insert only the verifier, for a boot where dsh-scout has been uninstalled. */
const verifierOnlyPatch = [
  '- insert:',
  '    - id: dsh-scout-smoke-verifier',
  `      name: ${JSON.stringify(verifierPath)}`,
  '',
].join('\n')

/**
 * Boot the real host once and capture its gate lines. `run()` throws on a
 * non-zero exit, so a boot that cannot even start is a hard failure here.
 */
function boot(label, { profile, patch, scenario, env = {} }) {
  const stdout = run(dshCommand.program, [
    ...dshCommand.prefix,
    '--profile',
    profile,
    '--patch',
    patch,
  ], {
    capture: true,
    env: {
      ...gateEnv,
      DSH_SCOUT_GATE_SCENARIO: scenario,
      DSH_SCOUT_GATE_CASE_ID: CASE_ARGS.caseId,
      DSH_SCOUT_GATE_ZH_EXPORT_DIR: zhExportDir,
      DSH_SCOUT_GATE_REHYDRATED_EXPORT_DIR: rehydratedExportDir,
      DSH_SCOUT_GATE_EN_EXPORT_DIR: enExportDir,
      ...env,
    },
    cwd: gateRoot,
  })
  const entry = { label, scenario, profile, stdout, gates: parseGateLines(stdout) }
  entry.find = (kind, tool) => entry.gates.find(gate => gate.kind === kind && (tool === undefined || gate.tool === tool))
  entry.raw = () => [`gate lines captured: ${entry.gates.length}`, `dsh output[0:600]: ${head(entry.stdout, 600)}`]
  // Raw evidence on demand: the assertions only read the parsed gate lines, but
  // a human debugging a red run wants the host's own stdout.
  if (VERBOSE) {
    console.log(`--- ${label} (${scenario}, profile ${profile}) ---`)
    console.log(stdout.trimEnd())
  }
  return entry
}

/** Every boot must load the plugin and dispose it cleanly. */
function assertLifecycle(entry) {
  requireGate(entry.stdout.includes('DSH_SCOUT_LOAD'), [
    `lifecycle assertion (${entry.label}): the verifier plugin never reached its load line`,
    ...entry.raw(),
  ])
  requireGate(entry.stdout.includes('DSH_SCOUT_UNLOAD'), [
    `lifecycle assertion (${entry.label}): the plugin disposer did not run on unload (no DSH_SCOUT_UNLOAD)`,
    ...entry.raw(),
  ])
  requireGate(entry.find('done') !== undefined, [
    `lifecycle assertion (${entry.label}): the verifier plugin never reached its \`done\` line`,
    ...entry.raw(),
  ])
}

/**
 * Registry assertions shared by every boot. `expectMissing` is the exact set of
 * tools that must NOT be mounted (empty for a healthy profile).
 */
function assertRegistry(entry, expectMissing = []) {
  const registry = entry.find('registry')
  requireGate(registry !== undefined, () => [
    `registry assertion (${entry.label}): the verifier plugin emitted no \`registry\` gate line`,
    ...entry.raw(),
  ])
  requireGate(registry.missing.length === expectMissing.length && expectMissing.every(name => registry.missing.includes(name)), [
    `registry assertion (${entry.label}): unexpected mounted-tool set`,
    `expected missing: ${JSON.stringify(expectMissing)}`,
    `actually missing: ${JSON.stringify(registry.missing)}`,
  ])
  requireGate(registry.execute === 'function', [
    `runtime API assertion (${entry.label}): ctx.tools.execute is not a function in this DSH version`,
    `expected: function  actual: ${registry.execute}`,
  ])
  requireGate(registry.appExit === 'function', [
    `launcher assertion (${entry.label}): ctx.appExit is not a function`,
    `expected: function  actual: ${registry.appExit}`,
  ])
  return registry
}

/** The result object of a `call` gate, with a fail-fast assertion when absent. */
function callResult(entry, tool, extra = []) {
  const gate = entry.find('call', tool)
  requireGate(gate?.result !== undefined, () => [
    `tool call assertion (${entry.label}): no result for ${tool}`,
    ...describeCall(gate, entry.raw()),
  ])
  requireGate(gate.result.outcome === 'returned', () => describeCall(gate, [
    'expected: execute() resolves with a ToolExecutionResult',
    'actual:   execute() threw',
    ...extra,
  ]))
  return gate
}

/** A real call that must succeed. */
function requireOkCall(entry, tool, extra = []) {
  const gate = callResult(entry, tool, extra)
  requireGate(gate.result.isError === false, () => describeCall(gate, [
    `expected (${entry.label}): isError === false for ${tool}`,
    `actual:   isError === ${gate.result.isError}`,
    ...extra,
  ]))
  return gate.result
}

/** Read a JSON file into an object (used for the exported artifacts). */
async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

/** Canonical path of an existing file/directory, or null when it does not exist. */
async function realpathOrNull(path) {
  if (typeof path !== 'string' || path === '') return null
  try {
    return await realpath(path)
  } catch {
    return null
  }
}

const stepLines = []
const step = (name, detail) => {
  stepLines.push(`  ${name}: ${detail}`)
}
const warnings = []

try {
  await mkdir(scoutDataDir, { recursive: true })
  await writeFile(verifierPath, verifierSource)
  await writeFile(patchZhPath, profilePatch('zh-CN'))
  await writeFile(patchEnPath, profilePatch('en'))
  await writeFile(patchVerifierOnlyPath, verifierOnlyPatch)

  run('pnpm', ['pack', '--pack-destination', gateRoot])
  const profiles = [ZH_PROFILE]
  if (!SKIP_CROSS_LANGUAGE) profiles.push(EN_PROFILE)
  for (const profile of profiles) {
    run(dshCommand.program, [
      ...dshCommand.prefix,
      'plugin',
      '--profile',
      profile,
      'add',
      `file:${tarball}`,
    ], { env: gateEnv, cwd: gateRoot })
  }

  const config = run(dshCommand.program, [
    ...dshCommand.prefix,
    '--profile',
    ZH_PROFILE,
    '--dump-config',
  ], {
    capture: true,
    env: gateEnv,
    cwd: gateRoot,
  })
  assert.match(config, /# == dsh-scout\n- id: dsh-scout\n  name: dsh-scout/)
  // The overlay's `config:` block must actually reach the plugin: this is what
  // makes the absolute base directory in every step below a verified fact rather
  // than an assumption about the profile layer.
  const patchedConfig = run(dshCommand.program, [
    ...dshCommand.prefix,
    '--profile',
    ZH_PROFILE,
    '--patch',
    patchZhPath,
    '--dump-config',
  ], {
    capture: true,
    env: gateEnv,
    cwd: gateRoot,
  })
  // The dump folds long scalars into YAML block scalars (`scoutDir: >-` + an
  // indented line), so assert on the patched layer block rather than one line.
  const patchedLayer = patchedConfig.split('# == dsh-scout, patched by')[1]?.split('# ==')[0] ?? ''
  requireGate(
    patchedLayer.includes('scoutDir:') && patchedLayer.includes(scoutDataDir),
    [
      'config-injection assertion: the profile patch `config.scoutDir` did not reach the plugin layer',
      `expected to find: scoutDir: ${scoutDataDir}`,
      `patched layer: ${head(patchedLayer, 400)}`,
    ],
  )
  requireGate(
    /language:\s*'?"?zh-CN"?/.test(patchedLayer),
    [
      'config-injection assertion: the profile patch `config.language` did not reach the plugin layer',
      `patched layer: ${head(patchedLayer, 400)}`,
    ],
  )

  // --- STEP 1 + 2: create the case, register, export to an absolute dir -------
  const create = boot('step1-2 zh create+export', { profile: ZH_PROFILE, patch: patchZhPath, scenario: 'create-export' })
  const registry = assertRegistry(create)
  assertLifecycle(create)
  requireGate(registry.fs === 'object', [
    'fs seam assertion: the real host exposed no `fs` service, so the export/import',
    'paths below cannot be exercised at all (do not treat this as a pass).',
    `typeof ctx.get('fs') === ${registry.fs}`,
  ])

  const startGate = callResult(create, 'scout_start')
  const start = requireOkCall(create, 'scout_start')
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

  const sourceGates = create.gates.filter(gate => gate.kind === 'call' && gate.tool === 'scout_add_source')
  requireGate(sourceGates.length === SOURCE_ARGS.length, [
    'tool call assertion: expected one scout_add_source gate line per registered source',
    `expected: ${SOURCE_ARGS.length}  actual: ${sourceGates.length}`,
  ])
  sourceGates.forEach((gate, index) => {
    const sourceId = SOURCE_ARGS[index].sourceId
    requireGate(gate.result?.outcome === 'returned' && gate.result.isError === false, () => describeCall(gate, [
      `expected: scout_add_source(${sourceId}) returns isError === false`,
      `actual:   ${describeResult(gate.result)}`,
    ]))
    // The envelope is the model-visible status summary; its counts must move.
    requireGate(gate.result.value?.counts?.sources === index + 1, () => describeCall(gate, [
      `expected: the envelope count reflects ${index + 1} registered source(s) after ${sourceId}`,
      `actual:   counts=${JSON.stringify(gate.result.value?.counts)}`,
    ]))
  })
  const claim = requireOkCall(create, 'scout_add_claim', ['the exported case must carry a claim'])
  requireGate(claim.value?.counts?.claims === 1, () => describeCall(create.find('call', 'scout_add_claim'), [
    'expected: the envelope count reflects 1 registered claim',
    `actual:   counts=${JSON.stringify(claim.value?.counts)}`,
  ]))

  const firstReport = requireOkCall(create, 'scout_report')
  const firstReportText = renderedText(firstReport.content)
  requireGate(firstReportText.length >= 200, () => describeCall(create.find('call', 'scout_report'), [
    'expected: rendered content carries the report body (>= 200 chars)',
    `actual:   ${firstReportText.length} rendered chars`,
  ]))
  requireGate(firstReportText.includes(CASE_ARGS.companyName), () => describeCall(create.find('call', 'scout_report'), [
    `expected: report body contains the case subject ${JSON.stringify(CASE_ARGS.companyName)}`,
    `actual:   subject not found in ${firstReportText.length} rendered chars`,
  ]))
  const reportHasHeading = /^#\s/m.test(firstReportText)
  if (!reportHasHeading) {
    warnings.push('report body has no Markdown heading; the "report body" assertion only checked length and case subject')
  }
  // Positive control for STEP 5: the zh deployment must really render zh prose,
  // otherwise "CJK = 0 in en" would be satisfied by an English-only plugin.
  requireGate(cjkCount(firstReportText) > 0, () => describeCall(create.find('call', 'scout_report'), [
    'expected: the zh-CN report contains Han characters (positive control for STEP 5)',
    `actual:   ${cjkCount(firstReportText)} Han characters`,
  ]))

  // STEP 2 — the export itself.
  const exportGate = callResult(create, 'scout_export')
  const exported = requireOkCall(create, 'scout_export')
  requireGate(exported.value?.persisted === true, () => describeCall(exportGate, [
    'expected: scout_export value.persisted === true',
    `actual:   ${JSON.stringify(exported.value)}`,
  ]))
  requireGate(exported.value?.complete === true, () => describeCall(exportGate, [
    'expected: scout_export value.complete === true',
    `actual:   ${JSON.stringify(exported.value)}`,
  ]))
  requireGate(
    Array.isArray(exported.value?.files)
      && exported.value.files.length === EXPORT_FILES.length
      && EXPORT_FILES.every(name => exported.value.files.includes(name)),
    () => describeCall(exportGate, [
      `expected: value.files lists the six export files ${JSON.stringify(EXPORT_FILES)}`,
      `actual:   ${JSON.stringify(exported.value?.files)}`,
    ]),
  )
  // Path-basis assertion: the resolved directory must be the absolute directory
  // that was passed. If the plugin had resolved against the DSH process cwd (or
  // any relative base), this equality fails instead of the gate silently writing
  // somewhere the CI job happens to own. Both sides go through `realpath` so a
  // platform that reports the canonical form (`/private/var` for `/var`) is not
  // mistaken for a different directory.
  const reportedTargetDir = exported.value?.targetDir
  const reportedReal = await realpathOrNull(reportedTargetDir)
  const requestedReal = await realpathOrNull(zhExportDir)
  requireGate(
    isAbsolute(reportedTargetDir ?? '') && reportedReal !== null && reportedReal === requestedReal,
    () => describeCall(exportGate, [
      `expected: value.targetDir resolves to ${JSON.stringify(zhExportDir)} (absolute, as passed)`,
      `actual:   ${JSON.stringify(reportedTargetDir)} → ${JSON.stringify(reportedReal)}`,
      `requested: ${JSON.stringify(zhExportDir)} → ${JSON.stringify(requestedReal)}`,
    ]),
  )

  const writtenFiles = (await readdir(zhExportDir)).sort()
  requireGate(
    writtenFiles.length === EXPORT_FILES.length && [...EXPORT_FILES].sort().every(name => writtenFiles.includes(name)),
    [
      'disk assertion: the export directory does not hold exactly the six expected files',
      `expected: ${JSON.stringify([...EXPORT_FILES].sort())}`,
      `actual:   ${JSON.stringify(writtenFiles)}`,
      `directory: ${zhExportDir}`,
    ],
  )
  const zhMarker = await readJson(join(zhExportDir, EXPORT_MARKER_FILE))
  requireGate(zhMarker.complete === true, [
    'marker assertion: export.complete.json does not read complete: true',
    `actual:   ${JSON.stringify(zhMarker)}`,
  ])
  requireGate(zhMarker.caseId === CASE_ARGS.caseId, [
    'marker assertion: export.complete.json names a different case',
    `expected: ${CASE_ARGS.caseId}  actual: ${JSON.stringify(zhMarker.caseId)}`,
  ])
  const zhCase = await readJson(join(zhExportDir, 'case.json'))
  const zhReportFile = await readFile(join(zhExportDir, 'report.md'), 'utf8')
  const zhClaims = await readJson(join(zhExportDir, 'claims.json'))
  requireGate(zhCase.language === 'zh-CN', [
    'artifact assertion: the zh deployment exported a case.json that does not declare zh-CN',
    `actual: ${JSON.stringify(zhCase.language)}`,
  ])
  requireGate(zhClaims.length === 1, [
    'artifact assertion: the exported claims.json does not carry the registered claim',
    `actual: ${JSON.stringify(zhClaims.map(entry => entry.claimId))}`,
  ])
  requireGate(cjkCount(zhReportFile) > 0, [
    'positive control: the exported zh report.md carries no Han characters, so the',
    'STEP 5 "CJK = 0" assertion below would be vacuous.',
    `actual:   ${cjkCount(zhReportFile)} Han characters`,
  ])
  const exportedDecision = zhCase.decision
  requireGate(exportedDecision === firstReport.value?.decision, [
    'decision stability: the decision inside the exported case.json differs from the one reported before the export',
    `case.json: ${JSON.stringify(exportedDecision)}  scout_report: ${JSON.stringify(firstReport.value?.decision)}`,
  ])
  step('step 1 registry+create', `PASS (${REQUIRED_TOOLS.length} tools mounted, fs seam present, scout_start/add_source×2/add_claim isError=false, value=object, scout_start content=${start.contentBytes}B < ${TOKEN_BUDGET_BYTES}, zh report ${cjkCount(firstReportText)} Han chars)`)
  step('step 2 export', `PASS (persisted=true complete=true, targetDir absolute & equal to the requested path, ${writtenFiles.length}/6 files on disk, marker complete=true, decision=${exportedDecision})`)

  // --- STEP 3 + 4: cold restart, then lazy rehydration ------------------------
  const rehydrate = boot('step3-4 zh rehydrate', { profile: ZH_PROFILE, patch: patchZhPath, scenario: 'rehydrate' })
  assertRegistry(rehydrate)
  assertLifecycle(rehydrate)
  const createPid = create.find('boot')?.pid
  const rehydratePid = rehydrate.find('boot')?.pid
  requireGate(typeof createPid === 'number' && typeof rehydratePid === 'number' && createPid !== rehydratePid, [
    'cold-restart assertion: the rehydration step did not run in a different OS process',
    `step1-2 pid: ${createPid}  step3-4 pid: ${rehydratePid}`,
    'a shared pid would mean the in-memory case cache survived, so nothing was rehydrated from disk.',
  ])
  step('step 3 cold restart', `PASS (second boot on the same DSH_HOME/profile, pid ${createPid} → ${rehydratePid})`)

  const rehydratedReport = requireOkCall(rehydrate, 'scout_report')
  const rehydratedText = renderedText(rehydratedReport.content)
  requireGate(rehydratedReport.value?.decision === exportedDecision, () => describeCall(rehydrate.find('call', 'scout_report'), [
    'lazy-rehydration assertion: the decision after a cold start differs from the exported one',
    `exported: ${JSON.stringify(exportedDecision)}  rehydrated: ${JSON.stringify(rehydratedReport.value?.decision)}`,
    `rendered[0:300]: ${head(rehydratedText, 300)}`,
  ]))
  requireGate(rehydratedText.includes(CASE_ARGS.companyName), () => describeCall(rehydrate.find('call', 'scout_report'), [
    `lazy-rehydration assertion: the rehydrated report lost the case subject ${JSON.stringify(CASE_ARGS.companyName)}`,
    `rendered[0:300]: ${head(rehydratedText, 300)}`,
  ]))
  const rehydratedExport = requireOkCall(rehydrate, 'scout_export')
  requireGate(rehydratedExport.value?.persisted === true, () => describeCall(rehydrate.find('call', 'scout_export'), [
    'lazy-rehydration assertion: the follow-up export of the rehydrated case did not persist',
    `actual: ${JSON.stringify(rehydratedExport.value)}`,
  ]))
  const rehydratedEvents = await readFile(join(rehydratedExportDir, 'events.jsonl'), 'utf8')
  const rehydratedCase = await readJson(join(rehydratedExportDir, 'case.json'))
  const rehydratedSources = await readJson(join(rehydratedExportDir, 'sources.json'))
  const rehydratedClaims = await readJson(join(rehydratedExportDir, 'claims.json'))
  requireGate(rehydratedEvents.includes('"case_rehydrated"'), [
    'lazy-rehydration assertion: events.jsonl carries no case_rehydrated event',
    `expected: a case_rehydrated line in ${join(rehydratedExportDir, 'events.jsonl')}`,
    // Never let the diagnostic itself throw on a malformed file.
    `event types seen: ${JSON.stringify(rehydratedEvents.trim().split('\n').filter(Boolean).map(line => {
      try {
        return JSON.parse(line).type
      } catch {
        return '(unparsable line)'
      }
    }))}`,
  ])
  requireGate(rehydratedCase.decision === exportedDecision, [
    'lazy-rehydration assertion: the re-exported case.json carries a different decision than the original export',
    `original: ${JSON.stringify(exportedDecision)}  re-exported: ${JSON.stringify(rehydratedCase.decision)}`,
  ])
  requireGate(rehydratedEvents.includes(zhExportDir), [
    'lazy-rehydration assertion: the case_rehydrated event does not name the directory it restored from',
    `expected to find: ${zhExportDir}`,
    `events[0:400]: ${head(rehydratedEvents, 400)}`,
  ])
  requireGate(rehydratedSources.length === SOURCE_ARGS.length && rehydratedClaims.length === 1, [
    'lazy-rehydration assertion: the restored case lost sources or claims across the process boundary',
    `expected: ${SOURCE_ARGS.length} sources, 1 claim`,
    `actual:   ${rehydratedSources.length} sources, ${rehydratedClaims.length} claims`,
  ])
  step('step 4 lazy rehydrate', `PASS (scout_report with no import returned decision=${rehydratedReport.value?.decision}, ${rehydratedSources.length} sources + ${rehydratedClaims.length} claim restored, case_rehydrated persisted to events.jsonl)`)

  // --- STEP 5: cross-language import into a second profile --------------------
  let enCase = null
  let enReportFile = ''

  if (SKIP_CROSS_LANGUAGE) {
    step('step 5 cross-language', 'SKIPPED (DSH_SCOUT_SMOKE_SKIP_CROSS_LANGUAGE=1 — coverage degraded: the en import path has no real-host gate)')
  } else {
    const importEn = boot('step5 en import', { profile: EN_PROFILE, patch: patchEnPath, scenario: 'import-en' })
    assertRegistry(importEn)
    assertLifecycle(importEn)
    const imported = requireOkCall(importEn, 'scout_import')
    requireGate(imported.value?.complete === true, () => describeCall(importEn.find('call', 'scout_import'), [
      'cross-language assertion: scout_import did not read the completion marker (complete !== true)',
      `actual: ${JSON.stringify(imported.value)}`,
    ]))
    requireGate(imported.value?.caseId === CASE_ARGS.caseId, () => describeCall(importEn.find('call', 'scout_import'), [
      'cross-language assertion: the imported case id does not echo the requested one',
      `actual: ${JSON.stringify(imported.value?.caseId)}`,
    ]))
    const enReport = requireOkCall(importEn, 'scout_report')
    const enText = renderedText(enReport.content)
    requireGate(cjkCount(enText) === 0, () => describeCall(importEn.find('call', 'scout_report'), [
      'cross-language assertion: the en deployment rendered Han characters after importing the zh export',
      `actual:   ${cjkCount(enText)} Han characters`,
      `rendered[0:400]: ${head(enText, 400)}`,
    ]))
    requireGate(enText.includes(CASE_ARGS.companyName), () => describeCall(importEn.find('call', 'scout_report'), [
      `cross-language assertion: the ASCII subject ${JSON.stringify(CASE_ARGS.companyName)} did not survive alignment`,
      `rendered[0:300]: ${head(enText, 300)}`,
    ]))
    requireGate(enReport.value?.decision === exportedDecision, () => describeCall(importEn.find('call', 'scout_report'), [
      'cross-language assertion: importing the zh export into the en deployment changed the decision',
      `exported: ${JSON.stringify(exportedDecision)}  reported en: ${JSON.stringify(enReport.value?.decision)}`,
    ]))
    const enExport = requireOkCall(importEn, 'scout_export')
    requireGate(enExport.value?.persisted === true, () => describeCall(importEn.find('call', 'scout_export'), [
      'cross-language assertion: the en deployment could not export the imported case',
      `actual: ${JSON.stringify(enExport.value)}`,
    ]))
    enCase = await readJson(join(enExportDir, 'case.json'))
    enReportFile = await readFile(join(enExportDir, 'report.md'), 'utf8')

    requireGate(enCase.language === 'en', [
      'cross-language assertion: the exported case.json does not declare language en',
      `actual: ${JSON.stringify(enCase.language)}`,
    ])
    requireGate(cjkCount(enReportFile) === 0, [
      'cross-language assertion: the exported en report.md contains Han characters',
      `actual:   ${cjkCount(enReportFile)} Han characters`,
      `report.md[0:400]: ${head(enReportFile, 400)}`,
    ])
    requireGate(enCase.subject?.name === CASE_ARGS.companyName, [
      'cross-language assertion: user-authored subject data was altered by factory-default alignment',
      `expected: ${JSON.stringify(CASE_ARGS.companyName)}  actual: ${JSON.stringify(enCase.subject?.name)}`,
    ])
    // Evidence, not an assertion: does the en deployment touch the zh export in
    // the shared scoutDir? Today it does not (no autoPersist), and knowing if
    // that ever changes is more useful than a brittle red gate here.
    const zhCaseAfter = await readJson(join(zhExportDir, 'case.json'))
    if (zhCaseAfter.language !== 'zh-CN') {
      warnings.push(`the en deployment rewrote the zh case.json in the shared scoutDir (language=${JSON.stringify(zhCaseAfter.language)})`)
    }
    step('step 5 cross-language', `PASS (en profile imported the zh export: complete=true, render CJK=0, report.md CJK=0 vs zh report.md ${cjkCount(zhReportFile)} Han chars, case.json.language=en, ASCII subject preserved)`)
  }

  // --- STEP 6 + negative controls: marker semantics, then uninstall -----------
  let markerControlSummary = 'completion-marker negative controls SKIPPED (coverage degraded: STEP 4 has no control proving it reads the marker)'
  if (SKIP_REHYDRATION_CONTROL) {
    step('negative control marker', markerControlSummary)
  } else {
    // Control A — the marker file is gone; payload files and the case directory
    // are still there, so only "read the marker" can explain the refusal.
    const markerPath = join(zhExportDir, EXPORT_MARKER_FILE)
    const markerRaw = await readFile(markerPath, 'utf8')
    await rm(markerPath)
    const missingMarker = boot('control marker missing', { profile: ZH_PROFILE, patch: patchZhPath, scenario: 'report-only' })
    assertRegistry(missingMarker)
    assertLifecycle(missingMarker)
    const missingResult = callResult(missingMarker, 'scout_report').result
    requireGate(missingResult.isError === true, () => describeCall(missingMarker.find('call', 'scout_report'), [
      'marker control A: with export.complete.json deleted, scout_report still returned a case',
      'expected: isError === true (no restorable export)',
      `actual:   isError === ${missingResult.isError}`,
      'without this control STEP 4 could pass on a path that never reads the marker.',
    ]))
    requireGate(
      typeof missingResult.error?.message === 'string'
        && missingResult.error.message.includes('Unknown case')
        && missingResult.error.message.includes(CASE_ARGS.caseId),
      () => describeCall(missingMarker.find('call', 'scout_report'), [
        'marker control A: scout_report failed for a reason other than the missing export',
        `expected: an \`Unknown case: ${CASE_ARGS.caseId}\` refusal naming the no-restorable-export directory`,
        `actual:   ${head(missingResult.error?.message ?? '(no message)', 300)}`,
      ]),
    )

    // Control B — the marker exists but says complete:false. Existence must not
    // be enough; the content has to be read.
    const brokenMarker = { ...JSON.parse(markerRaw), complete: false }
    await writeFile(markerPath, `${JSON.stringify(brokenMarker, null, 2)}\n`)
    const falseMarker = boot('control marker complete:false', { profile: ZH_PROFILE, patch: patchZhPath, scenario: 'report-only' })
    assertRegistry(falseMarker)
    assertLifecycle(falseMarker)
    const falseResult = callResult(falseMarker, 'scout_report').result
    requireGate(falseResult.isError === true, () => describeCall(falseMarker.find('call', 'scout_report'), [
      'marker control B: a marker with complete:false was accepted as a finished export',
      'expected: isError === true',
      `actual:   isError === ${falseResult.isError}`,
      `marker on disk: ${JSON.stringify(brokenMarker)}`,
    ]))
    requireGate(
      typeof falseResult.error?.message === 'string' && falseResult.error.message.includes('Unknown case'),
      () => describeCall(falseMarker.find('call', 'scout_report'), [
        'marker control B: scout_report failed for an unexpected reason',
        `expected: an \`Unknown case\` refusal`,
        `actual:   ${head(falseResult.error?.message ?? '(no message)', 300)}`,
      ]),
    )
    const falseMarkerRendered = renderedText(falseResult.content ?? [])
    requireGate(falseResult.value === null && cjkCount(falseMarkerRendered) === 0, [
      'marker control B: the refused call still produced a case body',
      `actual value: ${head(falseResult.value)}`,
    ])
    // Both controls only isolate the marker if the payload files were still
    // there while it was refused — otherwise the refusal would be explained by
    // a missing export directory rather than by the marker.
    const survivingPayload = (await readdir(zhExportDir)).sort()
    requireGate(
      ['case.json', 'claims.json', 'events.jsonl', 'report.md', 'sources.json'].every(name => survivingPayload.includes(name)),
      [
        'marker control: the payload files did not survive the marker controls, so this run does',
        'not isolate the completion marker (a missing export directory would explain the refusal).',
        `directory: ${zhExportDir}`,
        `entries:   ${JSON.stringify(survivingPayload)}`,
      ],
    )
    // Restore the marker so the uninstall step still runs against a complete case.
    await writeFile(markerPath, markerRaw)
    const restoredMarker = await readJson(markerPath)
    requireGate(restoredMarker.complete === true, [
      'marker control cleanup: the completion marker was not restored before the uninstall step',
      `actual: ${JSON.stringify(restoredMarker)}`,
    ])
    markerControlSummary = 'completion-marker negative controls (missing marker AND complete:false both refused rehydration)'
    step('negative control marker', `PASS (marker deleted → isError=true "Unknown case"; marker complete:false → same refusal; payload files untouched both times)`)
  }

  // STEP 6 — uninstall: no layer, no tools, and the post-uninstall boot still
  // proves the verifier itself runs (so "no tools" is not a dead process).
  run(dshCommand.program, [
    ...dshCommand.prefix,
    'plugin',
    '--profile',
    ZH_PROFILE,
    'remove',
    'dsh-scout',
  ], { env: gateEnv, cwd: gateRoot })
  const uninstalledConfig = run(dshCommand.program, [
    ...dshCommand.prefix,
    '--profile',
    ZH_PROFILE,
    '--dump-config',
  ], {
    capture: true,
    env: gateEnv,
    cwd: gateRoot,
  })
  requireGate(!uninstalledConfig.includes('# == dsh-scout'), [
    'uninstall assertion: the dsh-scout layer is still composed into the profile after `dsh plugin remove`',
    `dump-config[0:600]: ${head(uninstalledConfig, 600)}`,
  ])
  const uninstalled = boot('step6 post-uninstall', {
    profile: ZH_PROFILE,
    patch: patchVerifierOnlyPath,
    scenario: 'registry-only',
    // All twelve tools are absent: one shared deadline is enough.
    env: { DSH_SCOUT_GATE_WAIT_MS: '1500' },
  })
  assertRegistry(uninstalled, REQUIRED_TOOLS)
  assertLifecycle(uninstalled)
  step('step 6 uninstall', `PASS (dsh-scout layer gone from --dump-config; post-removal boot mounted 0/${REQUIRED_TOOLS.length} tools and the verifier still ran)`)

  // --- the output-schema negative control (pre-existing; asserted on the boot
  // --- that made the real calls, so it guards STEP 1/2's evidence) -------------
  const negative = create.find('negativeControl')
  requireGate(negative !== undefined, () => [
    'output-schema self-test: no `negativeControl` gate line',
    ...create.raw(),
  ])
  if (negative.status === 'unavailable' && !SKIP_NEGATIVE_CONTROL) {
    throw gateFailure([
      'output-schema self-test: the probe tool could not be registered, so this run does NOT prove',
      'that the real calls above were validated against their declared output schemas.',
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

  const negativeSummary = negative.status === 'ran'
    ? 'output-schema negative control (ToolOutputError observed)'
    : 'output-schema negative control SKIPPED (coverage degraded)'
  console.log(`dsh-scout profile smoke: PASS (dsh-scout ${packageJson.version}, dsh ${DSH_VERSION})`)
  console.log(`  scenario chain: ${stepLines.length} gate lines (6 steps + the completion-marker control)`)
  for (const line of stepLines) console.log(line)
  console.log(`  verified: dump-config layer + patch config injection | ${REQUIRED_TOOLS.length} tools mounted | scout_start(isError=false, value=object with caseId echo, content=${start.contentBytes}B < ${TOKEN_BUDGET_BYTES}) | scout_export(absolute targetDir, 6/6 files, marker complete=true) | cold restart (pid change) | lazy rehydration (decision ${exportedDecision}, case_rehydrated persisted) | ${SKIP_CROSS_LANGUAGE ? 'cross-language SKIPPED' : `cross-language import (case.json.language=en, CJK=0, zh control ${cjkCount(zhReportFile)} Han chars)`} | uninstall (0 tools left) | ${negativeSummary} | ${markerControlSummary}`)
  // Evidence, deliberately NOT an assertion: the frozen 0.9.1 read-tool envelope
  // (`scout_report.value = {caseId, decision, report, coverage}`) is printed so a
  // human can compare it against the contract; only content/report-body presence
  // is enforced above, to avoid over-fitting this gate to one envelope revision.
  console.log(`  observed value keys: scout_start=${JSON.stringify(Object.keys(start.value ?? {}))} scout_report=${JSON.stringify(Object.keys(firstReport.value ?? {}))}${enCase ? ` en case.json keys=${JSON.stringify(Object.keys(enCase))}` : ''}`)
  console.log('  not covered: no agent/LLM/approval path (agent unset ⇒ absolute dirs only), 6/12 tools executed, report asserted structurally, autoPersist stays false, token budget covers rendered content only')
  for (const warning of warnings) console.warn(`  WARNING: ${warning}`)
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
