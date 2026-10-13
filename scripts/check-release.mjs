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
 * README preflight (P2-4): the READMEs pin the released version in their install
 * commands and artifact names, and nothing used to check them. The primary guard
 * lives in `tests/package.test.mjs` (it runs on every `npm test` and in CI, in
 * milliseconds); this gate repeats the check as an independent second
 * implementation so a stale README fails in milliseconds instead of after the
 * whole unit suite and the ~2 minute four-version profile matrix below.
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

// --- README release-reference preflight (see the module doc) ------------------
//
// Deliberately a second, simpler implementation of the guard in
// tests/package.test.mjs rather than a shared import: tests are not a library, and
// this one has to fail before the expensive work below. Same rule as that guard -
// only install/artifact references are checked: `dsh-scout-<v>.tgz`, the
// `dsh-scout@<v>` pin in its three live forms (install operand, alone on its
// line, or a quoted version key), the ` · dsh-scout <v>` status banner, a
// `#v<v>` git ref, and the phrase-anchored `本次发布创建 \`v<v>\`` /
// `this release creates \`v<v>\`` tag claim. Historical mentions in the
// verified-version matrix, the roadmap, and release prose are left alone.
// 0.9.3 freezes this rule set: a new version-reference style is evaluated in the
// change that introduces it, not by widening this list indefinitely.
const README_FILES = ['README.md', 'README.en.md']
const README_SEMVER = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?`
/** An exact specifier: `1.2.3` or `v1.2.3`. */
const README_EXACT_SPECIFIER = new RegExp(`^v?(${README_SEMVER})$`)
/**
 * A specifier naming a version *or a range* (`0.9`, `0.9.x`, `^0.9.2`, `>=0.9.2`,
 * `=0.9.2`, `*`). Ranges are live references node-semver satisfies, but this
 * preflight carries no range semantics, so it fails closed rather than waving
 * them through (F-1). Dist-tags and placeholders name no version and stay valid.
 */
const README_VERSION_OR_RANGE = /^[\^~<>=|\s]*(?:v?\d|\*|x)/i
/** Exact version, unsupported specifier, or not a version claim at all. */
const classifySpecifier = token => {
  const exact = README_EXACT_SPECIFIER.exec(token)
  if (exact !== null) return { version: exact[1] }
  if (README_VERSION_OR_RANGE.test(token)) {
    return {
      problem:
        `uses the unsupported specifier "${token}"; a range or comparison cannot be compared to ` +
        'the released version - write the exact version, or extend README_REFERENCE_PATTERNS ' +
        'with the semantics of this form',
    }
  }
  return null
}
const README_REFERENCE_PATTERNS = [
  {
    kind: 'tarball name',
    pattern: new RegExp(`dsh-scout-(${README_SEMVER})\\.tgz`, 'g'),
    classify: match => ({ version: match[1] }),
  },
  {
    kind: 'npm install pin',
    // Token charset excludes sentence punctuation, so `dsh-scout@0.9.3。` still
    // reads as an exact pin while `dsh-scout@^0.9.2` is captured whole.
    pattern: new RegExp('dsh-scout@([0-9A-Za-z.*^~<>=|+-]+)', 'g'),
    classify: (match, line) => {
      const before = line.slice(0, match.index)
      const after = line.slice(match.index + match[0].length)
      // the operand of an install verb ...
      const livePosition =
        /(?:^|[\s`'"(])(?:add|install|dlx|i)\s+(?:--?[\w-]+(?:=\S+)?\s+)*(?:file:)?$/.test(before.replace(/[`"')\]]+$/, '')) ||
        // ... a specifier alone on its line (the desktop app's plugin field) ...
        (before.replace(/^[\s>]*(?:[-*+]\s+)?/, '') === '' && after.replace(/[`"')\]]+$/, '').trim() === '') ||
        // ... or a quoted `"package@version"` key (compatibility.json).
        (/["']$/.test(before) && /^["']\s*:/.test(after))
      return livePosition ? classifySpecifier(match[1]) : null
    },
  },
  {
    kind: 'git install ref',
    pattern: new RegExp(`dsh-scout(?:\\.git)?#v?(${README_SEMVER})`, 'g'),
    classify: match => ({ version: match[1] }),
  },
  {
    // ` · dsh-scout <v>` - the /scout status banner (src/index.ts appends
    // ` · dsh-scout ${PLUGIN_VERSION}`); the separator is required so that prose
    // and report titles naming the package next to a version are not pins.
    kind: 'status banner',
    pattern: new RegExp(`·\\s*dsh-scout (${README_SEMVER})`, 'g'),
    classify: match => ({ version: match[1] }),
  },
  {
    // `本次发布创建 \`v<v>\`` / `this release creates \`v<v>\`` - the tag this
    // release creates. The phrase is what makes a bare `v<semver>` safe to guard
    // here: the same line also lists historical tags (`v0.3.0` ... `v0.9.2`).
    kind: 'release tag claim',
    pattern: new RegExp(`(?:本次发布创建|this release creates)\\s*\`?v?(${README_SEMVER})\`?`, 'g'),
    classify: match => ({ version: match[1] }),
  },
]
const expectedVersion = packageJson.version
const staleReferences = []
const reportedLines = new Set()
const anchorFailures = []
const releaseTagClaimFiles = new Set()
let readmeReferenceCount = 0
for (const file of README_FILES) {
  const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  text.split('\n').forEach((line, lineIndex) => {
    for (const { kind, pattern, classify } of README_REFERENCE_PATTERNS) {
      pattern.lastIndex = 0
      let match
      while ((match = pattern.exec(line)) !== null) {
        const verdict = classify(match, line)
        if (verdict === null) continue
        if (kind === 'release tag claim') releaseTagClaimFiles.add(file)
        readmeReferenceCount += 1
        if (verdict.problem !== undefined) {
          staleReferences.push(`${file}:${lineIndex + 1} ${match[0]} ${verdict.problem} (${kind})`)
          // Only *offending* lines are deduped, so the section scan below still
          // sees a stale bare token on a line that also carries a correct pin
          // (F-3): this matches guardFailures() in tests/package.test.mjs.
          reportedLines.add(`${file}:${lineIndex + 1}`)
        } else if (verdict.version !== expectedVersion) {
          staleReferences.push(
            `${file}:${lineIndex + 1} pins ${match[0]} but package.json is ${expectedVersion} (${kind})`,
          )
          reportedLines.add(`${file}:${lineIndex + 1}`)
        }
      }
    }
  })
}

// The release-tag claim is phrase-anchored, so rewording the sentence would stop
// guarding it silently. Asserted per file: a rule that can no longer match
// anything is the false green this preflight exists to prevent.
for (const file of README_FILES) {
  if (!releaseTagClaimFiles.has(file)) {
    anchorFailures.push(
      `${file}: no "release tag claim" reference matched - either the sentence that creates the ` +
        'release tag was reworded (update the phrase in README_REFERENCE_PATTERNS here and in ' +
        'tests/package.test.mjs) or it was removed (retire this rule deliberately with the docs owner)',
    )
  }
}

// --- success-criteria section scan (T-G) --------------------------------------
//
// The success-criteria section says how to confirm that *this* release is the one
// that loaded, so every version token inside it must be the released version -
// including the bare forms the pattern scan above cannot claim safely (the card's
// `v0.9.3` tag, `and version `0.9.3``), because a bare `v<semver>` elsewhere is
// legitimate history (the release-history line lists `v0.3.0` ... `v0.9.2`).
//
// The anchors are explicit and a miss is a FAILURE, never a skip: a silently
// skipped section would let a reworded heading disarm the guard, which is exactly
// the false green this preflight exists to prevent.
const SECTION_ANCHORS = [
  { file: 'README.md', heading: /^(#{2,4})\s*装上了吗（成功判据）$/, label: '装上了吗（成功判据）' },
  { file: 'README.en.md', heading: /^(#{2,4})\s*Did it install\? \(success criteria\)$/, label: 'Did it install? (success criteria)' },
]
// `@` is deliberately not excluded: a prose reference inside the section such as
// `` 安装 `dsh-scout@0.9.2` 后 `` names a version the pattern scan does not claim
// (it is not in an install position) and the section contract still covers it
// (F-2). `-` stays excluded so a tarball name is left to the pattern scan.
const SECTION_VERSION_TOKEN = /(?<![\w./-])v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?![\w.-])/g
const SECTION_ANCHOR_REMEDY =
  'the success-criteria heading was reworded or moved: update SECTION_ANCHORS here and ' +
  'SUCCESS_CRITERIA_SECTIONS in tests/package.test.mjs. This preflight must never skip it silently.'
let sectionTokenCount = 0
/** Section body bounds for one heading anchor; null when the anchor no longer matches. */
const sectionBounds = (lines, heading) => {
  let fenced = false
  let start = -1
  let level = 0
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim()
    // A `# ...` shell comment inside the section's fenced CLI example is body
    // text, not a heading, so fences are tracked while looking for the end.
    if (/^(?:```|~~~)/.test(trimmed)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    const marker = /^(#{1,6})\s/.exec(trimmed)
    if (start === -1) {
      if (heading.test(trimmed)) {
        start = index
        level = /^#+/.exec(trimmed)[0].length
      }
      continue
    }
    if (marker !== null && marker[1].length <= level) return { start, end: index }
  }
  return start === -1 ? null : { start, end: lines.length }
}
for (const { file, heading, label } of SECTION_ANCHORS) {
  const lines = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').split('\n')
  const section = sectionBounds(lines, heading)
  if (section === null) {
    anchorFailures.push(`${file}: no heading matches "${label}" - ${SECTION_ANCHOR_REMEDY}`)
    continue
  }
  for (let index = section.start + 1; index < section.end; index += 1) {
    const line = lines[index]
    if (reportedLines.has(`${file}:${index + 1}`)) continue
    SECTION_VERSION_TOKEN.lastIndex = 0
    let match
    while ((match = SECTION_VERSION_TOKEN.exec(line)) !== null) {
      sectionTokenCount += 1
      readmeReferenceCount += 1
      if (match[1] !== expectedVersion) {
        staleReferences.push(
          `${file}:${index + 1} pins ${match[0]} in the success-criteria section but package.json is ${expectedVersion}`,
        )
      }
    }
  }
}

if (staleReferences.length > 0 || anchorFailures.length > 0) {
  console.error('')
  if (staleReferences.length > 0) {
    console.error(`README release references are stale (package.json is ${expectedVersion}):`)
    for (const reference of staleReferences) console.error(`  ${reference}`)
  }
  if (anchorFailures.length > 0) {
    console.error('README guard anchors/phrases no longer resolve:')
    for (const failure of anchorFailures) console.error(`  ${failure}`)
  }
  console.error(`dsh-scout release gate: FAIL - bump the install/artifact references before releasing`)
  console.error('(the same rule is asserted on every `npm test` in tests/package.test.mjs)')
  process.exit(1)
}
console.log(`  readme release references: ${readmeReferenceCount} checked (${sectionTokenCount} inside the success-criteria section), all pinned to ${expectedVersion}`)

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
