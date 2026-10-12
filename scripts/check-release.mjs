import { spawnSync } from 'node:child_process'

const command = name => process.platform === 'win32' ? `${name}.cmd` : name
const verifiedDshVersions = [
  '0.1.0-rc.6',
  '0.1.2-rc.1',
  '0.2.0-rc.2',
  '0.2.1-alpha.2',
]

function run(program, args, env = process.env) {
  const result = spawnSync(command(program), args, { env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${program} ${args.join(' ')} failed with exit code ${result.status}`)
  }
}

run('npm', ['test'])
for (const version of verifiedDshVersions) {
  run('npm', ['run', 'test:profile'], { ...process.env, DSH_VERSION: version })
}
run('pnpm', ['pack', '--dry-run'])
