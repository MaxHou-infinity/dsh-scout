import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Distribution-contract tests for dsh-scout.
 *
 * These assert the fields the DSH plugin manager actually reads, not just the
 * fields we happen to publish:
 *   - `engines.dsh` / `dsh.manifestVersion` are the author declarations described
 *     by `@deepseek-ai/dsh-package-manifest` (`engines` is "declarative until a
 *     reader enforces it"; the enforced gate is the `@deepseek-ai/dsh-tools`
 *     peer range, so the two must stay aligned).
 *   - `readPluginMeta()` reads `${name}/locale/en.json` and every sibling
 *     `<lang>.json` through the Node ESM resolver. A locale file that is present
 *     on disk but absent from `exports` fails with ERR_PACKAGE_PATH_NOT_EXPORTED,
 *     which DSH treats as "absent" - and because `dictionariesOf()` resolves
 *     every `.json` in the directory, one unexported dictionary costs the plugin
 *     *all* of its display metadata.
 *   - `iconOf()` accepts a manifest-relative SVG/PNG/JPEG/WebP of at most
 *     256 KiB that stays inside the package directory after realpath resolution.
 *
 * This suite reads package.json, locale/, assets/, and the two READMEs only. It
 * never imports `dist/`, so it is independent of the build.
 */

const testsDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(testsDir, '..')
const manifestPath = join(packageRoot, 'package.json')
const localeDir = join(packageRoot, 'locale')

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

const PACKAGE_NAME = 'dsh-scout'
/**
 * Release checklist anchor: this literal is asserted against `package.json`,
 * so it must be bumped by hand with every release. Do not read it back from the
 * manifest - a tautological assertion would stop catching a forgotten bump.
 */
const RELEASE_VERSION = '0.9.3'
const DSH_RANGE = '>=0.1.0-rc.6 <0.3.0-0'
const NODE_RANGE = '>=22.19.0'
const MAX_ICON_BYTES = 256 * 1024
const ICON_EXTENSIONS = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp'])
/** Mirrors the language-id rule DSH applies to locale filenames. */
const LANGUAGE_ID = /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/
const GLOB_CHARS = /[*?[\]{}]/

const localeNames = readdirSync(localeDir)
  .filter((name) => name.endsWith('.json'))
  .sort()

const localeEntries = (name) => `./locale/${name}`

const slug = (value) => value.replace(/^\.\//, '').replace(/\/+$/, '')

test(`publishes the ${RELEASE_VERSION} package identity`, () => {
  assert.equal(manifest.name, PACKAGE_NAME)
  assert.equal(manifest.version, RELEASE_VERSION)
  assert.equal(manifest.type, 'module')
  assert.equal(manifest.license, 'MIT')
  assert.equal(typeof manifest.description, 'string')
  assert.ok(manifest.description.trim().length > 0, 'description must not be blank')
})

/**
 * README release-reference guard.
 *
 * Neither `scripts/check-release.mjs` nor `.github/workflows/ci.yml` reads the
 * READMEs, so a forgotten version bump there used to be invisible - 0.9.3 nearly
 * shipped with the install chapter still pinning 0.9.2. This guard runs on every
 * `npm test` and in CI and costs milliseconds, which is why it lives here rather
 * than in the four-version release gate (about 2 minutes).
 *
 * Only a *live* reference is guarded, i.e. a version that names the artifact
 * this release produces or installs:
 *   - `dsh-scout-<semver>.tgz` - the file `pnpm pack` writes (any context);
 *   - `dsh-scout@<semver>`     - a pin rather than a mention: the operand of an
 *                                install command (`add`, `install`, `dlx`, `i`),
 *                                a specifier standing alone on its line (the
 *                                value typed into the desktop app's plugin
 *                                field), or a quoted `"package@version"` key
 *                                (`compatibility.json`). A range or comparison
 *                                (`^0.9.2`, `~0.9.2`, `>=0.9.2`, `=0.9.2`) in one
 *                                of those positions is a live reference the guard
 *                                cannot evaluate, so it fails closed and asks for
 *                                an exact version instead of waving it through;
 *   - `dsh-scout...#v<semver>` - a git install ref;
 *   - `· dsh-scout <semver>`   - the `/scout status` banner, whose shape is
 *                                ` · dsh-scout ${PLUGIN_VERSION}` in
 *                                `src/index.ts`. The `·` separator is required:
 *                                without it this would also match prose and
 *                                report titles that merely put the package name
 *                                next to a historical version;
 *   - `本次发布创建 \`v<semver>\`` / `this release creates \`v<semver>\`` - the tag
 *                                this release creates; the phrase is what keeps
 *                                the historical tag list on the same line out of
 *                                the guard. 0.9.3 freezes the rule set here: a
 *                                new version-reference style must be evaluated in
 *                                the change that introduces it, not by widening
 *                                this list indefinitely.
 * Every other version mention is history and passes untouched: the roadmap's
 * completed milestones (`- ✅ v0.9.2: real-host end-to-end gate ...`),
 * "since 0.9.1"-style prose (`### Output contract (since 0.9.1)`), and the
 * version matrix's own notes about earlier runs ("This table previously recorded
 * the 0.9.0 and 0.9.1 candidate tarball results"). Bumping the package must never
 * rewrite those, and this guard must never report them.
 *
 * KNOWN GAP - the verified-version matrix's *live* claims are NOT covered. That
 * section records the run for the release being cut, so its claims must move with
 * the version, yet each sits in a prose or table position the rule set above does
 * not claim:
 *   - the release sentence naming the tested artifact
 *     ("**`dsh-scout@<version>` candidate tarball passed on four exact DSH
 *     versions**");
 *   - that table's version column header ("| ... | <version> (candidate
 *     tarball) |");
 *   - the closing sentence that folds the run into this release ("本版改动 ...
 *     在同样四个精确版本上复跑通过（4/4），故更新为本版本" / "so it is updated
 *     to this version").
 * The consequence is concrete: a forgotten bump there passes green, and the next
 * release ships a stale version matrix while every gate reports success. This is
 * a recorded residual category, not an oversight - the guard is a maintainer aid,
 * not a safety boundary. The matrix must therefore be re-checked with an
 * independent extractor before every release (docs/verification-0.9.3.md lists
 * that recheck as a release condition). Do not read the paragraph above as "the
 * matrix is handled", and do not close this gap by widening the list above on a
 * whim: evaluate that reference style in the change that introduces the
 * declaration, the way every other style here was added.
 */
const README_FILES = ['README.md', 'README.en.md']
/** A version-shaped token; prerelease/build suffixes are admitted like SemVer. */
const SEMVER_SOURCE = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?`
/** `... add dsh-scout@1.2.3` - the specifier is the operand of an install verb. */
const INSTALL_OPERAND = /(?:^|[\s`'"(])(?:add|install|dlx|i)\s+(?:--?[\w-]+(?:=\S+)?\s+)*(?:file:)?$/
const TRAILING_QUOTES = /[`"')\]]+$/

/** `dsh-scout@1.2.3` alone on its line (optionally a list item or in backticks). */
function isStandaloneSpecifier(line, index, text) {
  const before = line.slice(0, index).replace(/^[\s>]*(?:[-*+]\s+)?/, '')
  const after = line.slice(index + text.length).replace(TRAILING_QUOTES, '').trim()
  return before === '' && after === ''
}

/** `"dsh-scout@1.2.3": [...]` - a JSON object key naming one pinned package version. */
function isQuotedPinKey(line, index, text) {
  const before = line.slice(0, index)
  const after = line.slice(index + text.length)
  return /["']$/.test(before) && /^["']\s*:/.test(after)
}

/** An exact specifier: `1.2.3` or `v1.2.3`. */
const EXACT_SPECIFIER = new RegExp(`^v?(${SEMVER_SOURCE})$`)
/**
 * A specifier that names a version *or a range* (`0.9`, `0.9.x`, `^0.9.2`,
 * `>=0.9.2`, `=0.9.2`, `*`, `1.x`). These are live references - node-semver
 * satisfies them against a released version - but this guard carries no range
 * semantics, so waving them through would break its stated contract (F-1). It
 * fails closed instead. Dist-tags (`latest`, `next`) and placeholders
 * (`<version>`) name no version and stay legitimate.
 */
const VERSION_OR_RANGE_SPECIFIER = /^[\^~<>=|\s]*(?:v?\d|\*|x)/i

/** Classify one `dsh-scout@<token>` specifier: exact version, unsupported, or not a version claim. */
function classifySpecifier(token) {
  const exact = EXACT_SPECIFIER.exec(token)
  if (exact !== null) return { version: exact[1] }
  if (VERSION_OR_RANGE_SPECIFIER.test(token)) {
    return {
      problem:
        `uses the unsupported specifier "${token}"; a range or comparison cannot be compared to ` +
        'the released version - write the exact version, or extend RELEASE_REFERENCE_PATTERNS ' +
        'with the semantics of this form',
    }
  }
  return null
}

const RELEASE_REFERENCE_PATTERNS = [
  {
    kind: 'tarball name',
    source: `dsh-scout-(${SEMVER_SOURCE})\\.tgz`,
    classify: (match) => ({ version: match[1] }),
  },
  {
    kind: 'npm install pin',
    // The token charset deliberately excludes sentence punctuation (CJK full
    // stop, backticks, quotes), so `dsh-scout@0.9.3。` still reads as an exact pin
    // while `dsh-scout@^0.9.2` is captured whole and classified.
    source: 'dsh-scout@([0-9A-Za-z.*^~<>=|+-]+)',
    classify: (match, line) => {
      const livePosition =
        INSTALL_OPERAND.test(line.slice(0, match.index).replace(TRAILING_QUOTES, '')) ||
        isStandaloneSpecifier(line, match.index, match[0]) ||
        isQuotedPinKey(line, match.index, match[0])
      return livePosition ? classifySpecifier(match[1]) : null
    },
  },
  {
    kind: 'git install ref',
    source: `dsh-scout(?:\\.git)?#v?(${SEMVER_SOURCE})`,
    classify: (match) => ({ version: match[1] }),
  },
  {
    kind: 'status banner',
    // ` · dsh-scout 1.2.3` - appended to `/scout status` by src/index.ts
    // (` · dsh-scout ${PLUGIN_VERSION}`) and pinned at the runtime boundary by
    // tests/acceptance.test.mjs. The leading separator is part of the contract:
    // it is what keeps the banner from colliding with prose that merely names
    // the package next to a version.
    source: `·\\s*dsh-scout (${SEMVER_SOURCE})`,
    classify: (match) => ({ version: match[1] }),
  },
  {
    kind: 'release tag claim',
    // `本次发布创建 \`v1.2.3\`` / `this release creates \`v1.2.3\`` - the tag this
    // release creates. The surrounding phrase is what makes a bare `v<semver>`
    // safe to guard: the same line also lists historical tags
    // (`v0.3.0` ... `v0.9.2`), which must stay untouched, so a document-wide bare
    // `v<semver>` rule would be a false-positive machine.
    source: `(?:本次发布创建|this release creates)\\s*\`?v?(${SEMVER_SOURCE})\`?`,
    classify: (match) => ({ version: match[1] }),
  },
]

/** Collect every live install/artifact reference in one markdown document. */
function collectReleaseReferences(text, file) {
  const found = []
  text.split('\n').forEach((line, lineIndex) => {
    for (const { kind, source, classify } of RELEASE_REFERENCE_PATTERNS) {
      const pattern = new RegExp(source, 'g')
      let match
      while ((match = pattern.exec(line)) !== null) {
        const verdict = classify(match, line)
        if (verdict === null) continue
        found.push({
          file,
          line: lineIndex + 1,
          column: match.index + 1,
          kind,
          text: match[0],
          version: verdict.version ?? null,
          problem: verdict.problem ?? null,
        })
      }
    }
  })
  return found
}

const readmeReferences = () =>
  README_FILES.flatMap((file) =>
    collectReleaseReferences(readFileSync(join(packageRoot, file), 'utf8'), file),
  )

/**
 * Every guard failure in one document: pattern failures first, then the
 * success-criteria section tokens. Only lines the pattern scan already reported
 * as *offending* are skipped by the section scan (F-3) - a line that also carries
 * a correct reference must still have its stale bare token reported. This
 * function is the single source of the verdict, so the millisecond test and the
 * preflight in scripts/check-release.mjs answer the same question the same way.
 */
function guardFailures(file, text) {
  const failures = []
  const reportedLines = new Set()
  for (const reference of collectReleaseReferences(text, file)) {
    if (reference.problem !== null) {
      failures.push(
        `${reference.file}:${reference.line} ${reference.text} ${reference.problem} (${reference.kind})`,
      )
      reportedLines.add(`${reference.file}:${reference.line}`)
      continue
    }
    if (reference.version !== manifest.version) {
      failures.push(
        `${reference.file}:${reference.line} pins ${reference.text} but package.json is ` +
          `${manifest.version} (${reference.kind})`,
      )
      reportedLines.add(`${reference.file}:${reference.line}`)
    }
  }
  const anchor = SUCCESS_CRITERIA_SECTIONS.find((entry) => entry.file === file)
  if (anchor === undefined) return failures
  const section = locateSection(text, anchor.heading)
  if (section === null) {
    failures.push(`${file}: no heading matches "${anchor.label}" - ${SECTION_ANCHOR_REMEDY}`)
    return failures
  }
  for (const token of collectSectionVersionTokens(text, file, section)) {
    if (reportedLines.has(`${token.file}:${token.line}`)) continue
    if (token.version === manifest.version) continue
    failures.push(
      `${token.file}:${token.line} pins ${token.text} in the success-criteria section but ` +
        `package.json is ${manifest.version}`,
    )
  }
  return failures
}

test(`pins every README install, artifact, and success-criteria reference to ${RELEASE_VERSION}`, () => {
  const offenders = README_FILES.flatMap((file) =>
    guardFailures(file, readFileSync(join(packageRoot, file), 'utf8')),
  )
  assert.deepEqual(
    offenders,
    [],
    [
      `README version references must track package.json (${manifest.version}):`,
      ...offenders.map((line) => `  ${line}`),
      'Historical mentions (verified-version matrix, roadmap, CHANGELOG, "since 0.9.x" prose) are deliberately not guarded.',
      'Ranges and comparisons fail closed on purpose: the guard cannot decide whether they equal the released version.',
    ].join('\n'),
  )
})

test('classifies live install references and historical version mentions apart', () => {
  // Direction 1: every form that pins the artifact being released (8 exact forms,
  // plus two range forms that must fail closed instead of passing silently).
  const live = [
    'pnpm pack                                        # produces dsh-scout-0.9.2.tgz',
    'dsh plugin --profile scout-demo add "file:$PWD/dsh-scout-0.9.2.tgz"',
    'dsh plugin --profile <name> add dsh-scout@0.9.2',
    'dsh plugin --profile scout-demo add github:MaxHou-infinity/dsh-scout#v0.9.2',
    'dsh-scout@0.9.2',
    '  "dsh-scout@0.9.2": ["0.2.0-rc.2"]',
    '[ver] VERIFY · identity needs_verification · sources 0 / claims 0 (verified 0, open 0) · dsh-scout 0.9.2',
    '本次发布创建 `v0.9.2`。',
    'and this release creates `v0.9.2`.',
    'dsh plugin --profile p add dsh-scout@^0.9.2',
    'dsh-scout@>=0.9.2',
  ].join('\n')
  const liveRefs = collectReleaseReferences(live, 'README.fixture.md')
  assert.deepEqual(
    liveRefs.map(
      (reference) => `${reference.line}:${reference.kind}:${reference.problem === null ? reference.version : 'UNSUPPORTED'}`,
    ),
    [
      '1:tarball name:0.9.2',
      '2:tarball name:0.9.2',
      '3:npm install pin:0.9.2',
      '4:git install ref:0.9.2',
      '5:npm install pin:0.9.2',
      '6:npm install pin:0.9.2',
      '7:status banner:0.9.2',
      '8:release tag claim:0.9.2',
      '9:release tag claim:0.9.2',
      '10:npm install pin:UNSUPPORTED',
      '11:npm install pin:UNSUPPORTED',
    ],
    'a stale install/artifact reference must be extracted (with its line) so the guard can flag it',
  )
  assert.match(
    liveRefs[9].problem,
    /unsupported specifier "\^0\.9\.2"/,
    'a range in install position must fail closed, never pass as a mention',
  )

  // Direction 2: history must pass - it is not a claim about the current release.
  const historical = [
    '- **Coverage (new in 0.9.1)**: per-dimension verified / open / untouched counts',
    // A matrix-shaped release statement in a mention position. The guard does not
    // claim this shape - that is the KNOWN GAP documented at the top of this
    // guard, not a statement that the matrix is history. The real matrix's live
    // claims must be re-checked with an independent extractor before a release.
    '**`dsh-scout@0.9.2` passed on four exact DSH versions** (before the 2026-10-13 release)',
    '| DSH version | npm channel (2026-10-12) | 0.9.2 (released) |',
    'This table previously recorded the **0.9.0** and **0.9.1** candidate tarball results',
    '- ✅ v0.9.2: real-host end-to-end gate (closing the U11 blind spot)',
    'A 0.9.0 export has no completion marker and is never auto-rehydrated',
    '- **Explicitly not in 0.9.1 or 0.9.2**: the client panel, custom session events',
    'See the measured results of `dsh-scout@0.9.2` in the table above.',
    // Near-misses for the status banner: the package name next to a version
    // without the `·` separator is a mention, not the banner.
    'dsh-scout profile smoke: PASS (dsh-scout 0.9.2, dsh 0.2.0-rc.2)',
    '# dsh-scout 0.9.1 conformance audit report',
    'Banner format note: the status line ends with dsh-scout 0.9.2 during 0.9.2 verification.',
    // Near-misses for the release-tag claim: the phrase is what pins a bare
    // `v<semver>` to the current release, so other release phrasings and the
    // historical tag list on the same line must not be reported.
    '上一次发布创建 `v0.9.2` 的 tag，本次只做迭代',
    'the previous release created `v0.9.2`',
    '仓库自 `v0.3.0` 起共 10 个 tag（`v0.3.0` … `v0.9.2`；`v0.9.1` 是本地迭代版）',
    // Dist-tags, placeholders and a range quoted in prose name no installed
    // version, so they are mentions rather than references.
    'dsh plugin --profile p add dsh-scout@latest',
    'dsh-scout@<version>',
    '支持范围写法 `dsh-scout@^0.9.2` 吗？见上文说明。',
  ].join('\n')
  assert.deepEqual(
    collectReleaseReferences(historical, 'README.fixture.md'),
    [],
    'historical version mentions must never be reported: the fix is not to rewrite history',
  )
})

test('fails closed on ranges and reports a section token once per line', () => {
  // F-1: a range or comparison in a live position is a version claim this guard
  // cannot evaluate; it must be reported, never waved through as a mention.
  const ranged = [
    '```sh',
    'dsh-scout@^0.9.2',
    'dsh plugin --profile p add dsh-scout@~0.9.2',
    'dsh plugin --profile p add dsh-scout@=0.9.2',
    '```',
  ].join('\n')
  const rangedFailures = guardFailures('README.fixture.md', ranged)
  assert.equal(rangedFailures.length, 3, 'every range/comparison specifier in a live position must fail closed')
  assert.match(rangedFailures[0], /unsupported specifier "\^0\.9\.2"/)

  // F-2: a prose `dsh-scout@<version>` naming the installed version is a section
  // token even though it is not an install operand; the same text outside the
  // section stays history.
  const prose = [
    '### 装上了吗（成功判据）',
    '',
    '安装 `dsh-scout@0.9.2` 后打开详情页。',
    '',
    '### 下一节',
    '`dsh-scout@0.9.2` 在第 6 行的历史段落里。',
  ].join('\n')
  assert.deepEqual(
    guardFailures('README.md', prose),
    ['README.md:3 pins 0.9.2 in the success-criteria section but package.json is 0.9.3'],
    'the section scan must see the `@` token, and the same text outside the section must stay history',
  )

  // F-3: a *correct* live pin on the line must not hide a stale bare token ...
  const correctPinPlusStaleBare = [
    '### 装上了吗（成功判据）',
    '',
    '安装：`i dsh-scout@0.9.3`，标题旁带 `v0.9.2`。',
  ].join('\n')
  assert.deepEqual(
    guardFailures('README.md', correctPinPlusStaleBare),
    ['README.md:3 pins v0.9.2 in the success-criteria section but package.json is 0.9.3'],
    'a line is only skipped by the section scan when the pattern scan already reported it as offending',
  )

  // ... while a stale live pin is reported once, by the pattern scan, and the
  // section scan does not repeat the same line (the dedupe both implementations share).
  const stalePinPlusStaleBare = correctPinPlusStaleBare.replace('`i dsh-scout@0.9.3`', '`i dsh-scout@0.9.2`')
  assert.deepEqual(
    guardFailures('README.md', stalePinPlusStaleBare),
    ['README.md:3 pins dsh-scout@0.9.2 but package.json is 0.9.3 (npm install pin)'],
    'a line the pattern scan already reported is not reported again by the section scan',
  )
})

test('reads a live install reference out of each README', () => {
  // Anti-vacuity, part 2: the extraction above must actually match the real
  // READMEs. If both files stop carrying any versioned install/artifact
  // reference, the guard silently becomes a no-op - that is a documentation
  // regression worth failing on, not a reason to delete the guard.
  const references = readmeReferences()
  for (const file of README_FILES) {
    const hits = references.filter((reference) => reference.file === file)
    assert.ok(
      hits.length > 0,
      `${file} has no versioned install/artifact reference left. Either the install docs lost ` +
        'their version pin (the regression this guard exists to catch) or the documentation now ' +
        'uses a form this guard cannot read - extend RELEASE_REFERENCE_PATTERNS in the same ' +
        'change instead of deleting this assertion.',
    )
  }
  // The release-tag claim is phrase-anchored, so rewording the sentence would
  // silently stop guarding it. Asserted per file: a rule that can no longer match
  // anything is the false green this suite exists to prevent.
  for (const file of README_FILES) {
    assert.ok(
      references.some((reference) => reference.file === file && reference.kind === 'release tag claim'),
      `${file}: no "release tag claim" reference matched. Either the sentence that creates the ` +
        'release tag was reworded (update the phrase in RELEASE_REFERENCE_PATTERNS, and in ' +
        'scripts/check-release.mjs) or it was removed - in that case retire this rule ' +
        'deliberately with the docs owner instead of leaving a guard that cannot fail.',
    )
  }
})

/**
 * Section-scoped guard: the success-criteria section.
 *
 * "Did it install?" tells a user how to confirm that *this* release is the one
 * that loaded, so every version token inside it must be the released version -
 * including bare forms the pattern guard above cannot safely claim: the card tag
 * `` `v0.9.3` `` and `and version `0.9.3`` are not safe document-wide patterns,
 * because a bare `v<semver>` elsewhere is legitimate history (the release-history
 * line lists `v0.3.0` ... `v0.9.2`).
 *
 * The heading anchors are explicit constants, and a heading that no longer matches
 * is a FAILURE, never a skip: silently skipping would let a reworded heading
 * disarm the guard forever, which is the false green this suite exists to prevent.
 * When the heading is legitimately reworded, update SUCCESS_CRITERIA_SECTIONS here
 * and SECTION_ANCHORS in scripts/check-release.mjs in the same change.
 */
const SUCCESS_CRITERIA_SECTIONS = [
  { file: 'README.md', heading: /^(#{2,4})\s*装上了吗（成功判据）$/, label: '装上了吗（成功判据）' },
  {
    file: 'README.en.md',
    heading: /^(#{2,4})\s*Did it install\? \(success criteria\)$/,
    label: 'Did it install? (success criteria)',
  },
]
/**
 * A bare version token (`0.9.3`, `v0.9.3`, `0.9.3-rc.1`) that is not part of a
 * larger identifier. `@` is deliberately *not* excluded: inside this section a
 * prose or table reference such as `` 安装 `dsh-scout@0.9.2` 后 `` names a version
 * that the pattern scan does not claim (it is not in an install position) and the
 * section contract still covers it (F-2). `-` stays excluded so a tarball name
 * (`dsh-scout-0.9.3.tgz`) is left to the pattern scan.
 */
const SECTION_VERSION_TOKEN = /(?<![\w./-])v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?![\w.-])/g
const SECTION_ANCHOR_REMEDY =
  'the success-criteria heading was reworded or moved: update SUCCESS_CRITERIA_SECTIONS in ' +
  'tests/package.test.mjs (and SECTION_ANCHORS in scripts/check-release.mjs) to match. This ' +
  'guard must never be skipped silently - a renamed heading would otherwise disarm it.'

/** Locate a heading-delimited section body; null when the anchor no longer matches. */
function locateSection(text, heading) {
  const lines = text.split('\n')
  let fenced = false
  let start = -1
  let level = 0
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim()
    // Fenced code blocks belong to the section body, so a `# ...` shell comment
    // inside one is not a heading (the section's CLI example starts with one).
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

/** Every bare version token between the section heading and the next same-or-higher heading. */
function collectSectionVersionTokens(text, file, section) {
  const lines = text.split('\n')
  const found = []
  for (let index = section.start; index < section.end; index += 1) {
    const pattern = new RegExp(SECTION_VERSION_TOKEN.source, 'g')
    let match
    while ((match = pattern.exec(lines[index])) !== null) {
      found.push({
        file,
        line: index + 1,
        column: match.index + 1,
        text: match[0],
        version: match[1],
      })
    }
  }
  return found
}

test('finds the success-criteria section in each README', () => {
  const missing = []
  for (const { file, heading, label } of SUCCESS_CRITERIA_SECTIONS) {
    const text = readFileSync(join(packageRoot, file), 'utf8')
    if (locateSection(text, heading) === null) missing.push(`${file}: no heading matches "${label}"`)
  }
  assert.deepEqual(
    missing,
    [],
    `the success-criteria anchor must resolve: ${SECTION_ANCHOR_REMEDY}`,
  )

  // The locator must end the section at the next real heading: a fenced `# ...`
  // shell comment (the section's own CLI example) is body text, not a heading,
  // and a `###` line after the fence must still close the section. A prose
  // `` `dsh-scout@0.9.8` `` is a section token too (F-2: the pattern scan only
  // claims install positions, so the section contract is what covers prose).
  const synthetic = [
    '### Did it install? (success criteria)',
    '',
    '```sh',
    '# a shell comment, not a heading',
    'dsh --profile p --dump-config',
    '```',
    '',
    'still inside the section: v0.9.9',
    '安装 `dsh-scout@0.9.8` 后打开详情页',
    '',
    '### Next section',
    'v0.8.0 is history and must stay outside',
  ].join('\n')
  const section = locateSection(synthetic, SUCCESS_CRITERIA_SECTIONS[1].heading)
  assert.ok(section !== null, 'the synthetic anchor must resolve')
  assert.deepEqual(
    collectSectionVersionTokens(synthetic, 'README.fixture.md', section).map((token) => token.text),
    ['v0.9.9', '0.9.8'],
    'a fenced `#` comment must not end the section, the next `###` heading must, and an `@`-prefixed prose token must be visible',
  )
})

test('keeps the success-criteria section scan non-vacuous', () => {
  // The offence itself is asserted by guardFailures in the test above. This test
  // only proves the section scan still has a subject: if the sections stop
  // carrying any token the pattern scan does not already claim, the section
  // contract silently stops being checked.
  let tokens = 0
  for (const { file, heading, label } of SUCCESS_CRITERIA_SECTIONS) {
    const text = readFileSync(join(packageRoot, file), 'utf8')
    const section = locateSection(text, heading)
    assert.ok(section !== null, `${file}: no heading matches "${label}" - ${SECTION_ANCHOR_REMEDY}`)
    const reportedLines = new Set(
      collectReleaseReferences(text, file)
        .filter((reference) => reference.problem !== null || reference.version !== manifest.version)
        .map((reference) => `${reference.file}:${reference.line}`),
    )
    for (const token of collectSectionVersionTokens(text, file, section)) {
      if (reportedLines.has(`${token.file}:${token.line}`)) continue
      tokens += 1
    }
  }
  assert.ok(
    tokens > 0,
    'the success-criteria sections carry no version token the section scan owns, so it checks ' +
      'nothing. Either the section was hollowed out (a regression worth fixing) or the docs ' +
      'intentionally stopped pinning a version - in that case retire this scan deliberately with ' +
      'the docs owner instead of leaving a guard that cannot fail.',
  )
})

test('declares the DSH compatibility range under engines', () => {
  assert.equal(manifest.engines.node, NODE_RANGE)
  // DSH_RANGE is deliberately spelled with a prerelease-aware upper bound.
  // Under default node-semver rules `0.2.0-rc.2` does NOT satisfy
  // `>=0.1.0-rc.6 <0.3.0-0` - a prerelease only matches when a comparator
  // carries one - so this range admits the 0.2 prerelease line only because
  // DSH evaluates it with `{ includePrerelease: true }`. Do not "simplify" it
  // to an exact version or drop the `-0` suffix: the failure mode is a
  // silently disabled plugin row (`dsh: disabling profile plugin ...`), not an
  // error, and `peerDependencies` gives no second chance.
  assert.equal(manifest.engines.dsh, DSH_RANGE)
})

test('keeps the declared DSH range aligned with the range DSH enforces', () => {
  // evaluatePluginCompatibility() only inspects @deepseek-ai/dsh / dsh-* peers,
  // so the tool peer is what actually enables or disables this plugin.
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-tools'], DSH_RANGE)
  assert.equal(manifest.peerDependencies['@deepseek-ai/cordis'], '>=4.0.2 <5')
  // The validator is a runtime dependency, so it is pinned to the same minor
  // line the DSH host series itself resolves (`~3.18.4`). A caret range would
  // admit 3.19.x and let the plugin validate Config objects with a different
  // build than the host that hands them over. Config identity survives that
  // (recognition goes through the global `Symbol.for('schemastery')`), so the
  // damage would be silent behavioural drift rather than a type error - which
  // is exactly why the range is asserted here instead of left to review.
  assert.equal(manifest.dependencies['@deepseek-ai/schemastery'], '~3.18.4')
  assert.ok(
    manifest.dependencies['@deepseek-ai/schemastery'].startsWith('~'),
    'the schemastery range must stay minor-locked to the host series, not float on a caret',
  )
})

test('keeps dsh.manifestVersion alongside the existing bundle patch', () => {
  assert.equal(manifest.dsh.manifestVersion, 1)
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.ok(
    statSync(resolve(packageRoot, manifest.dsh.bundle.patch)).isFile(),
    'the declared bundle patch must exist',
  )
})

test('exports every locale dictionary through the package exports map', () => {
  assert.ok(localeNames.includes('en.json'), 'locale/en.json is the English fallback anchor')
  for (const name of localeNames) {
    const entry = localeEntries(name)
    assert.equal(
      manifest.exports[entry],
      entry,
      `${entry} must be exported: DSH resolves locales through the ESM resolver and ` +
        'silently treats ERR_PACKAGE_PATH_NOT_EXPORTED as "no metadata"',
    )
    assert.ok(
      statSync(resolve(packageRoot, entry)).isFile(),
      `${entry} must point at a real file`,
    )
  }
})

test('names every dictionary with a valid, unique language id', () => {
  const seen = new Set()
  for (const name of localeNames) {
    const id = name.slice(0, -'.json'.length)
    assert.match(id, LANGUAGE_ID, `${name} must be named after a language id`)
    assert.equal(id, id.toLowerCase(), `${name} must use a lowercase language id`)
    assert.ok(!seen.has(id), `duplicate locale ${id}`)
    seen.add(id)
  }
  assert.ok(seen.has('zh'), 'a Chinese dictionary is expected for the zh-CN audience')
})

test('resolves every locale resource the way the plugin manager does', () => {
  // Self-reference resolution goes through package.json "exports" exactly like
  // resolvePluginResource(`${specifier}/locale/${file}`) does in production.
  for (const name of localeNames) {
    const specifier = `${PACKAGE_NAME}/locale/${name}`
    let url
    try {
      url = import.meta.resolve(specifier)
    } catch (error) {
      assert.fail(
        `${specifier} does not resolve (${error.code ?? error.message}); DSH would drop ` +
          'every display field for this plugin',
      )
    }
    assert.equal(fileURLToPath(url), join(localeDir, name))
  }
})

test('publishes non-empty localized titles and descriptions', () => {
  for (const name of localeNames) {
    const dictionary = JSON.parse(readFileSync(join(localeDir, name), 'utf8'))
    assert.equal(
      typeof dictionary.meta,
      'object',
      `${name}: DSH reads meta.title / meta.description and rejects non-object meta`,
    )
    assert.ok(dictionary.meta !== null && !Array.isArray(dictionary.meta), `${name}: meta must be an object`)
    for (const field of ['title', 'description']) {
      const value = dictionary.meta[field]
      assert.equal(typeof value, 'string', `${name}: meta.${field} must be a string`)
      assert.ok(value.trim().length > 0, `${name}: meta.${field} must not be blank`)
    }
    // Display hygiene: the plugin manager renders these in a single row.
    assert.ok(dictionary.meta.title.length <= 60, `${name}: meta.title is too long for a list row`)
    assert.ok(dictionary.meta.description.length <= 240, `${name}: meta.description is too long`)
  }
})

test('declares an icon that satisfies the reader limits', () => {
  const icon = manifest.icon
  assert.equal(typeof icon, 'string', 'package.json must declare an icon')
  assert.ok(icon.trim().length > 0)
  assert.ok(!isAbsolute(icon), 'icon must be a relative path')
  assert.ok(
    !/^[A-Za-z][A-Za-z\d+.-]*:/u.test(icon),
    'icon must be a file path, not a URL specifier',
  )
  assert.ok(
    ICON_EXTENSIONS.has(extname(icon).toLowerCase()),
    `icon must be SVG, PNG, JPEG, or WebP, got ${extname(icon)}`,
  )

  const root = realpathSync(packageRoot)
  const file = realpathSync(resolve(packageRoot, icon))
  const local = relative(root, file)
  assert.ok(
    local !== '..' && !local.startsWith(`..${sep}`) && !isAbsolute(local),
    'icon must remain inside the package directory after realpath resolution',
  )
  const stat = statSync(file)
  assert.ok(stat.isFile(), 'icon must be a regular file')
  assert.ok(stat.size <= MAX_ICON_BYTES, `icon must be at most 256 KiB, got ${stat.size} bytes`)
  assert.equal(readFileSync(file).length, stat.size)
})

test('ships a standalone SVG icon safe to embed as a data URL', () => {
  const iconPath = resolve(packageRoot, manifest.icon)
  assert.equal(extname(manifest.icon).toLowerCase(), '.svg')
  const bytes = readFileSync(iconPath)
  const text = bytes.toString('utf8')
  assert.ok(!text.startsWith('\uFEFF'), 'the icon must not start with a byte-order mark')
  assert.match(text.trimStart(), /^<svg[\s>]/, 'the icon root element must be <svg>')
  assert.ok(
    text.includes('xmlns="http://www.w3.org/2000/svg"'),
    'a standalone SVG needs the namespace so <img> renders it',
  )
  assert.match(text, /viewBox="0 0 \d+ \d+"/, 'the icon must scale via viewBox')
  assert.match(text, /<\/svg>\s*$/, 'the icon must close its root element')
  // DSH reads the file into a data: URL and renders it as an image, so it must
  // carry no scripting and no external references.
  assert.ok(!/<\s*script/i.test(text), 'the icon must not contain scripting')
  assert.ok(
    !/(?:href|src)\s*=\s*(?:"|')?(?:https?:)?\/\//i.test(text),
    'the icon must not reference external resources',
  )
})

test('lists locale, assets, and this suite in the published file allowlist', () => {
  assert.ok(Array.isArray(manifest.files))
  for (const entry of ['dist', 'cordis.patch.yml', 'locale', 'assets', 'tests/package.test.mjs']) {
    assert.ok(manifest.files.includes(entry), `files must include ${entry}`)
  }
  for (const entry of manifest.files) {
    if (GLOB_CHARS.test(entry)) continue
    assert.ok(existsSync(resolve(packageRoot, entry)), `files entry ${entry} does not exist`)
  }
})

test('covers every reader-visible resource with the files allowlist', () => {
  const entries = manifest.files.map(slug)
  const covered = (relPath) =>
    entries.some((entry) => relPath === entry || relPath.startsWith(`${entry}/`))

  assert.ok(covered(slug(manifest.dsh.bundle.patch)), 'the bundle patch must be published')
  assert.ok(covered(slug(manifest.icon)), 'the icon must be published')
  for (const name of localeNames) {
    assert.ok(covered(`locale/${name}`), `locale/${name} must be published`)
  }
})
