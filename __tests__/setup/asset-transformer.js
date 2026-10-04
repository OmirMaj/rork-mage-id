/**
 * __tests__/setup/asset-transformer.js — image requires, made checkout-independent.
 *
 * Under jest, `require('@/assets/images/brand/mage-mark-on-dark.png')` does not
 * load a picture; a transformer turns it into a small object, and that object
 * is what lands in `source=` on every <Image> a smoke test renders and dumps.
 *
 * THE BUG THIS REPLACES. The stock transformer (react-native/jest/
 * assetFileTransformer.js, wired by the RN preset that jest-expo inherits)
 * emits `{ testUri: path.relative(__dirname, filename) }`, where __dirname is
 * wherever react-native happens to be INSTALLED. That is only a tidy
 * `../../../assets/...` when node_modules is a real folder inside the checkout.
 * In an agent worktree node_modules is a symlink to the main checkout, so the
 * same require became
 *   ../../../../../../../private/tmp/claude-501/login-ui/assets/images/brand/mage-mark-on-dark.png
 * — the absolute path of the worktree that recorded it. The login-ui wave
 * recorded six goldens that way (desktop-page-frame /signup, slick3-front-door
 * a–d, slick3-first-run b); five of them store only a sha256 of the dump, so
 * the path was invisible in review, and every one of them failed on GitHub CI
 * (run 37138504488), where node_modules is real and the path is different.
 *
 * WHAT THIS EMITS. `{ testUri: <id> }`, same shape as before, where <id> names
 * the file by where it lives in the PROJECT, never on the disk:
 *   • a file inside a package       → `<node_modules>/<package path>`
 *                                     (after the LAST /node_modules/, so a
 *                                     hoisted and a nested install agree)
 *   • a file inside the repo        → `<rootDir>/<repo path>`
 *   • anything else                 → `<outside-rootDir>/<basename>`
 * So the dump of a screen is a function of the code alone: the same in the
 * main checkout, in any worktree, under a symlinked or a real node_modules,
 * and on CI. `scripts/validate-snapshot-paths.ts` fails the gate if a machine
 * path ever reaches a stored snapshot again.
 *
 * Only the extensions the RN transformer handled are claimed (it is the same
 * key, so it REPLACES that entry rather than racing it). Fonts, audio, pdf and
 * the rest still go to jest-expo's own transformer, which emits a bare `1` and
 * never carried a path.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Bump when the emitted id changes shape, so no cached transform outlives it.
const SHAPE = 'mageid-asset-id-v1';

/** The checkout-independent id for an asset file. */
function stableAssetId(filename, rootDir) {
  const file = String(filename).replace(/\\/g, '/');
  const nm = file.lastIndexOf('/node_modules/');
  if (nm !== -1) return `<node_modules>/${file.slice(nm + '/node_modules/'.length)}`;
  const root = String(rootDir || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (root && file.startsWith(`${root}/`)) return `<rootDir>/${file.slice(root.length + 1)}`;
  return `<outside-rootDir>/${path.posix.basename(file)}`;
}

const SELF = fs.readFileSync(require.resolve('./asset-transformer.js'));
const rootDirOf = (options) => (options && options.config && options.config.rootDir) || '';

module.exports = {
  process: (_src, filename, options) => ({
    code: `module.exports = { testUri: ${JSON.stringify(stableAssetId(filename, rootDirOf(options)))} };`,
  }),
  // The emitted module is a function of the id alone, so the id (plus this
  // file and SHAPE) is the whole cache key — not the image bytes, and not the
  // absolute path.
  getCacheKey: (_src, filename, options) => crypto.createHash('sha1')
    .update(SELF).update('\0').update(SHAPE).update('\0')
    .update(stableAssetId(filename, rootDirOf(options)))
    .digest('hex'),
  stableAssetId,
};
