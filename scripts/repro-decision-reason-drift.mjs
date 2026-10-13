#!/usr/bin/env node
// Minimal repro: does a case that was created but never mutated report the same
// decision REASON before and after a cold restart (lazy rehydration)?
//
// Finding: docs/dsh-scout-0.9.2-gate-findings.md (found by the F2 real-host gate).
// This is a diagnostic artifact, not part of the test suite and not part of the
// published package (package.json `files` does not list it). It packs the current
// working tree, so do not run it while another build or pack is in flight.
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const repo = '/Users/maxhou/Desktop/Max 项目-2026/deepseek harness development'
const root = await mkdtemp(join(tmpdir(), 'reason-probe-'))
const home = join(root, 'home')
const scoutDir = join(root, 'scout-data')
const caseId = 'reason-case-001'
const exportDir = join(scoutDir, caseId)
await mkdir(scoutDir, { recursive: true })
const packageJson = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'))
const tarball = join(root, `${packageJson.name}-${packageJson.version}.tgz`)
const verifier = join(root, 'verify.mjs')

await writeFile(verifier, `
export const inject = ['tools']
const emit = (kind, payload) => process.stdout.write('PROBE ' + JSON.stringify(Object.assign({ kind: kind }, payload)) + '\\n')
const CASE_ID = process.env.P_CASE_ID
const EXPORT = process.env.P_EXPORT
const SCENARIO = process.env.P_SCENARIO
let n = 0
const call = async (ctx, name, args) => {
  n += 1
  const r = await ctx.tools.execute({ callId: 'p-' + name + '-' + n, name, arguments: args, signal: new AbortController().signal })
  emit('call', { tool: name, isError: r.isError === true, value: r.value === undefined ? null : r.value, error: r.isError ? r.error : null })
}
export async function apply(ctx) {
  const d = Date.now() + 5000
  while (!ctx.tools.get('scout_report') && Date.now() < d) await new Promise(r => setTimeout(r, 25))
  if (SCENARIO === 'create') {
    await call(ctx, 'scout_start', { caseId: CASE_ID, companyName: 'Reason Probe Co', roleTitle: 'HRBP', location: 'Shanghai' })
    await call(ctx, 'scout_report', { caseId: CASE_ID })
    await call(ctx, 'scout_export', { caseId: CASE_ID, targetDir: EXPORT })
  } else {
    await call(ctx, 'scout_report', { caseId: CASE_ID })
    await call(ctx, 'scout_export', { caseId: CASE_ID, targetDir: EXPORT + '-again' })
  }
  emit('done', {})
  queueMicrotask(() => ctx.appExit(0))
}
`)
await writeFile(join(root, 'p.yml'), `- id: dsh-scout\n  config:\n    scoutDir: ${JSON.stringify(scoutDir)}\n- insert:\n    - id: reason-probe\n      name: ${JSON.stringify(verifier)}\n`)
spawnSync('pnpm', ['pack', '--pack-destination', root], { cwd: repo, stdio: 'ignore' })
const env = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_MODE: 'DISABLED' }
spawnSync('dsh', ['plugin', '--profile', 'reason', 'add', `file:${tarball}`], { cwd: root, env, stdio: 'ignore' })

const boot = scenario => {
  const r = spawnSync('dsh', ['--profile', 'reason', '--patch', join(root, 'p.yml')], {
    cwd: root,
    env: { ...env, P_SCENARIO: scenario, P_CASE_ID: caseId, P_EXPORT: exportDir },
    encoding: 'utf8',
  })
  return r.stdout.split('\n').filter(l => l.startsWith('PROBE ')).map(l => JSON.parse(l.slice(6)))
}
const reason = value => (value?.report ?? '').split('\n').find(line => /^-\s*(理由|Reason)/.test(line)) ?? '(none)'

const first = boot('create')
const second = boot('rehydrate')
const firstReport = first.filter(g => g.kind === 'call' && g.tool === 'scout_report')[0]
const secondReport = second.filter(g => g.kind === 'call' && g.tool === 'scout_report')[0]
const exportedCase = JSON.parse(await readFile(join(exportDir, 'case.json'), 'utf8'))
const reexportedCase = JSON.parse(await readFile(join(exportDir + '-again', 'case.json'), 'utf8'))
console.log('fresh scout_report     :', reason(firstReport.value), '| code:', JSON.stringify(firstReport.value?.decisionReasonCode ?? null))
console.log('exported case.json     :', JSON.stringify(exportedCase.decisionReason), '| code:', JSON.stringify(exportedCase.decisionReasonCode ?? null))
console.log('rehydrated scout_report:', reason(secondReport.value), '| code:', JSON.stringify(secondReport.value?.decisionReasonCode ?? null))
console.log('re-exported case.json  :', JSON.stringify(reexportedCase.decisionReason), '| code:', JSON.stringify(reexportedCase.decisionReasonCode ?? null))
console.log('decision before/after  :', exportedCase.decision, '/', secondReport.value?.decision)
console.log('root:', root)
