import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const DSH_VERSION = '0.1.0-rc.6'
const command = name => process.platform === 'win32' ? `${name}.cmd` : name
const localDsh = join(process.cwd(), 'node_modules', '.bin', command('dsh'))
const dshCommand = process.env.DSH_BIN
  ? { program: process.env.DSH_BIN, prefix: [] }
  : existsSync(localDsh)
    ? { program: localDsh, prefix: [] }
    : { program: 'npx', prefix: ['--yes', `@deepseek-ai/dsh@${DSH_VERSION}`] }

function run(program, args, options = {}) {
  const result = spawnSync(command(program), args, {
    cwd: process.cwd(),
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

try {
  await writeFile(verifierPath, `
export const inject = ['tools']
export async function apply(ctx) {
  await new Promise(resolve => setTimeout(resolve, 25))
  const required = ${JSON.stringify([
    'scout_start',
    'scout_add_source',
    'scout_add_claim',
    'scout_verify_identity',
    'scout_verify_claim',
    'scout_report',
  ])}
  for (const name of required) {
    if (!ctx.tools.get(name)) throw new Error(\`missing dsh-scout tool: \${name}\`)
  }
  if (typeof ctx.appExit !== 'function') throw new Error('missing launcher appExit service')
  process.stdout.write('DSH_SCOUT_LOAD\\n')
  ctx.effect(() => () => process.stdout.write('DSH_SCOUT_UNLOAD\\n'))
  queueMicrotask(() => ctx.appExit(0))
}
`)
  await writeFile(patchPath, `- insert:\n    - id: dsh-scout-smoke-verifier\n      name: ${JSON.stringify(verifierPath)}\n`)
  run('pnpm', ['pack', '--pack-destination', gateRoot])
  run(dshCommand.program, [
    ...dshCommand.prefix,
    'plugin',
    '--profile',
    'scout-smoke',
    'add',
    `file:${tarball}`,
  ], { env: gateEnv })
  const config = run(dshCommand.program, [
    ...dshCommand.prefix,
    '--profile',
    'scout-smoke',
    '--dump-config',
  ], {
    capture: true,
    env: gateEnv,
  })
  assert.match(config, /# == dsh-scout\n- id: dsh-scout\n  name: dsh-scout/)
  const lifecycle = run(dshCommand.program, [
    ...dshCommand.prefix,
    '--profile',
    'scout-smoke',
    '--patch',
    patchPath,
  ], { capture: true, env: gateEnv })
  assert.match(lifecycle, /DSH_SCOUT_LOAD/)
  assert.match(lifecycle, /DSH_SCOUT_UNLOAD/)
  console.log('dsh-scout profile smoke: PASS')
} finally {
  await rm(gateRoot, { recursive: true, force: true })
}
