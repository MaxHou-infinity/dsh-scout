#!/usr/bin/env node
/**
 * dsh-scout release gate.
 *
 * Runs the unit tests, the real-invocation profile smoke against every DSH
 * version in the verified matrix, and the packaging dry run.
 *
 * DSH 0.9.1 addition — declared-range classification. `engines.dsh` in
 * package.json is the declared compatibility window; `DSH compatibility is
 * declarative until a reader enforces it` (dsh-package-manifest), so this gate
 * is where the declaration is actually checked. Each matrix failure is now
 * classified:
 *   - a failure INSIDE `engines.dsh` is a REGRESSION (the plugin used to work
 *     and the code or the host changed);
 *   - a failure OUTSIDE `engines.dsh` is reported with the `OUT OF DECLARED
 *     RANGE` prefix: it is expected drift when DSH publishes a new major line
 *     (for example `0.3.0-alpha.1` against `<0.3.0-0`), not a code regression.
 * Set `DSH_ALLOW_OUT_OF_RANGE=1` to keep an out-of-range channel job green while
 * still printing the distinct prefix.
 *
 * Environment:
 *   DSH_VERSIONS            override the verified version matrix
 *                           (comma- or whitespace-separated, e.g.
 *                           `DSH_VERSIONS=0.2.0-rc.2 node scripts/check-release.mjs`)
 *   DSH_ALLOW_OUT_OF_RANGE  `1` downgrades out-of-range failures to warnings
 *
 * SemVer semantics (do NOT "fix" this matcher): this script has no runtime
 * dependency, so it carries a small comparator-set matcher that mirrors
 * node-semver's `{ includePrerelease: true }` mode — the exact mode DSH uses to
 * evaluate plugin compatibility (`semver.satisfies(runtimeVersion, requirement,
 * { includePrerelease: true })`, `@deepseek-ai/dsh-app-boot/lib/index.js:300`).
 * In plain node-semver mode a prerelease version only satisfies a comparator set
 * when some comparator shares its [major, minor, patch] tuple, which would
 * reject the entire verified 0.2 prerelease line. Measured with semver 7.8.5
 * against `engines.dsh = ">=0.1.0-rc.6 <0.3.0-0"`:
 *
 *   version        plain   includePrerelease
 *   0.1.0-rc.6     true    true
 *   0.1.2-rc.1     false   true
 *   0.2.0-rc.2     false   true
 *   0.2.1-alpha.2  false   true
 *   0.2.9          true    true
 *   0.3.0-alpha.1  false   false
 *   0.3.0          false   false
 *
 * This matcher was differentially tested against semver 7.8.5 with
 * `{ includePrerelease: true }` and agrees on every case above plus
 * 0.1.0-rc.5 / 0.1.0 / 0.1.1 / 0.2.0-alpha.0 / 0.3.0-0 / 0.2.1 / 1.0.0 / 0.0.9.
 * Unsupported range syntax (for example `1.x`, `*`, `latest`) is reported as
 * UNKNOWN instead of being guessed.
 * Note: `engines.dsh` itself is declarative in DSH 0.2.0-rc.2 (`dsh-package-manifest`:
 * "DSH compatibility is declarative until a reader enforces it"); the range DSH
 * actually enforces is the `peerDependencies` one at the call site above, so this
 * gate is where the `engines.dsh` declaration is really checked.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const DEFAULT_VERIFIED_DSH_VERSIONS = [
  '0.1.0-rc.6',
  '0.1.2-rc.1',
  '0.2.0-rc.2',
  '0.2.1-alpha.2',
]
const ALLOW_OUT_OF_RANGE = process.env.DSH_ALLOW_OUT_OF_RANGE === '1'
const command = name => process.platform === 'win32' ? `${name}.cmd` : name

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const declaredRange = typeof packageJson.engines?.dsh === 'string' ? packageJson.engines.dsh.trim() : ''

function resolveVersions() {
  const override = (process.env.DSH_VERSIONS ?? '').trim()
  if (!override) return { versions: DEFAULT_VERIFIED_DSH_VERSIONS, source: 'default matrix' }
  const versions = override.split(/[,\s]+/).filter(Boolean)
  if (versions.length === 0) throw new Error(`DSH_VERSIONS is set but names no version: ${JSON.stringify(process.env.DSH_VERSIONS)}`)
  return { versions, source: 'DSH_VERSIONS override' }
}

// --- minimal SemVer comparator support (see the module doc for the deviation) --

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

function parseVersion(text) {
  const match = VERSION_PATTERN.exec(String(text).trim())
  if (match === null) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  }
}

function compareIdentifiers(a, b) {
  const numeric = /^\d+$/
  const aNumeric = numeric.test(a)
  const bNumeric = numeric.test(b)
  if (aNumeric && bNumeric) return Number(a) === Number(b) ? 0 : Number(a) < Number(b) ? -1 : 1
  if (aNumeric) return -1
  if (bNumeric) return 1
  return a === b ? 0 : a < b ? -1 : 1
}

function comparePrerelease(a, b) {
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0) return 1
  if (b.length === 0) return -1
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    if (a[index] === undefined) return -1
    if (b[index] === undefined) return 1
    const order = compareIdentifiers(a[index], b[index])
    if (order !== 0) return order
  }
  return 0
}

function compareVersions(a, b) {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1
  return comparePrerelease(a.prerelease, b.prerelease)
}

function parseRange(text) {
  const orSets = String(text).trim().split('||').map(part => part.trim()).filter(Boolean)
  if (orSets.length === 0) return { sets: null, unsupported: String(text) }
  const sets = []
  for (const part of orSets) {
    const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(part)
    const tokens = hyphen === null ? part.split(/\s+/).filter(Boolean) : [`>=${hyphen[1]}`, `<=${hyphen[2]}`]
    const comparators = []
    for (const token of tokens) {
      const match = /^(>=|<=|>|<|=|\^|~)?(.*)$/.exec(token)
      const operator = match[1] === undefined ? '=' : match[1]
      const version = parseVersion(match[2])
      if (version === null) return { sets: null, unsupported: token }
      if (operator === '^' || operator === '~') {
        comparators.push({ operator: '>=', version })
        comparators.push({
          operator: '<',
          version: operator === '^'
            ? { major: version.major + 1, minor: 0, patch: 0, prerelease: ['0'] }
            : { major: version.major, minor: version.minor + 1, patch: 0, prerelease: ['0'] },
        })
      } else {
        comparators.push({ operator, version })
      }
    }
    sets.push(comparators)
  }
  return { sets, unsupported: null }
}

function satisfiesSet(version, comparators) {
  return comparators.every(comparator => {
    const order = compareVersions(version, comparator.version)
    switch (comparator.operator) {
      case '>=': return order >= 0
      case '>': return order > 0
      case '<=': return order <= 0
      case '<': return order < 0
      case '=': return order === 0
      default: return false
    }
  })
}

/** Classify one DSH version against `engines.dsh`. */
function classifyVersion(version) {
  if (declaredRange === '') return { status: 'unknown', reason: 'package.json declares no engines.dsh' }
  const parsedVersion = parseVersion(version)
  if (parsedVersion === null) return { status: 'unknown', reason: `not a SemVer version: ${version}` }
  const range = parseRange(declaredRange)
  if (range.sets === null) return { status: 'unknown', reason: `unsupported engines.dsh syntax near "${range.unsupported}"` }
  const satisfied = range.sets.some(set => satisfiesSet(parsedVersion, set))
  return satisfied
    ? { status: 'in-range', reason: `satisfies engines.dsh "${declaredRange}"` }
    : { status: 'out-of-range', reason: `outside engines.dsh "${declaredRange}"` }
}

// --- gate ---------------------------------------------------------------------

function run(program, args, env = process.env) {
  const result = spawnSync(command(program), args, { env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${program} ${args.join(' ')} failed with exit code ${result.status}`)
  }
}

const { versions, source } = resolveVersions()
console.log('dsh-scout release gate')
console.log(`  declared engines.dsh: ${declaredRange === '' ? '(none declared — failures cannot be classified)' : declaredRange}`)
console.log('  range semantics: node-semver includePrerelease:true (mirrors dsh-app-boot evaluatePluginCompatibility:300)')
console.log(`  profile matrix: ${versions.join(', ')} (${source})`)
console.log(`  out-of-range failures: ${ALLOW_OUT_OF_RANGE ? 'warn only (DSH_ALLOW_OUT_OF_RANGE=1)' : 'fatal, reported as OUT OF DECLARED RANGE'}`)

run('npm', ['test'])

const regressions = []
const outOfRangeFailures = []
const unknownRangeFailures = []
for (const version of versions) {
  const classification = classifyVersion(version)
  try {
    run('npm', ['run', 'test:profile'], { ...process.env, DSH_VERSION: version })
    console.log(`[ok] dsh ${version} — profile smoke passed (${classification.reason})`)
  } catch (error) {
    if (classification.status === 'out-of-range') {
      console.error(`[expected drift] OUT OF DECLARED RANGE dsh ${version} — profile smoke failed ${classification.reason}`)
      outOfRangeFailures.push({ version, reason: classification.reason })
    } else if (classification.status === 'unknown') {
      console.error(`[regression] dsh ${version} — profile smoke failed and the version cannot be classified (${classification.reason})`)
      unknownRangeFailures.push({ version, reason: classification.reason })
    } else {
      console.error(`[regression] dsh ${version} — profile smoke failed inside the declared range`)
      regressions.push({ version, reason: classification.reason })
    }
  }
}

run('pnpm', ['pack', '--dry-run'])

const fatal = regressions.length > 0 || unknownRangeFailures.length > 0 || (outOfRangeFailures.length > 0 && !ALLOW_OUT_OF_RANGE)
if (regressions.length > 0 || outOfRangeFailures.length > 0 || unknownRangeFailures.length > 0) {
  console.error('')
  console.error(`dsh-scout release gate: ${fatal ? 'FAIL' : 'PASS (with expected out-of-range drift)'}`)
  for (const failure of regressions) console.error(`  REGRESSION (declared range): dsh ${failure.version} — ${failure.reason}`)
  for (const failure of unknownRangeFailures) console.error(`  RANGE UNKNOWN (cannot classify): dsh ${failure.version} — ${failure.reason}`)
  for (const failure of outOfRangeFailures) {
    const kind = ALLOW_OUT_OF_RANGE ? 'OUT OF DECLARED RANGE (warn only)' : 'OUT OF DECLARED RANGE'
    console.error(`  ${kind}: dsh ${failure.version} — ${failure.reason}; widen engines.dsh only after verifying the new line`)
  }
  if (regressions.length > 0 || unknownRangeFailures.length > 0 || !ALLOW_OUT_OF_RANGE) process.exitCode = 1
} else {
  console.log(`dsh-scout release gate: PASS (${versions.length} DSH versions, ${declaredRange || 'no declared range'})`)
}
