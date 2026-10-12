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
 * This suite reads package.json, locale/, and assets/ only. It never imports
 * `dist/`, so it is independent of the build.
 */

const testsDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(testsDir, '..')
const manifestPath = join(packageRoot, 'package.json')
const localeDir = join(packageRoot, 'locale')

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

const PACKAGE_NAME = 'dsh-scout'
const RELEASE_VERSION = '0.9.1'
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

test('publishes the 0.9.1 package identity', () => {
  assert.equal(manifest.name, PACKAGE_NAME)
  assert.equal(manifest.version, RELEASE_VERSION)
  assert.equal(manifest.type, 'module')
  assert.equal(manifest.license, 'MIT')
  assert.equal(typeof manifest.description, 'string')
  assert.ok(manifest.description.trim().length > 0, 'description must not be blank')
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
  assert.equal(manifest.dependencies['@deepseek-ai/schemastery'], '^3.18.2')
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
