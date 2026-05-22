const {
  getSentryExpoConfig
} = require("@sentry/react-native/metro");

const config = getSentryExpoConfig(__dirname);

// --- tslib ESM/CJS interop shim (fixes web-dev boot crash) ---------------------
// tslib ships an ESM wrapper at `tslib/modules/index.js` that does
// `import tslib from '../tslib.js'` and then destructures the helper functions
// (`__extends`, `__assign`, ...) off that default import. Because the CommonJS
// `tslib.js` sets `__esModule = true`, Metro/Babel's interop treats it as already
// an ES module and does NOT synthesise a `.default`, so `tslib.default` is
// `undefined` and the wrapper's destructure throws at module-eval time:
//   "Cannot destructure property '__extends' of 'tslib.default' as it is undefined"
// With `unstable_enablePackageExports` on (Expo SDK default), the `exports` map's
// `import` condition routes bare `tslib` imports (e.g. pdf-lib/es, 70x named) to
// that broken wrapper, crashing the web dev bundle at boot. We redirect the bare
// `tslib` specifier straight to tslib's CommonJS build, resolved once to an
// absolute path (require.resolve picks tslib.js via the `default` condition).
// Returning the filePath directly keeps the broken wrapper out of the graph AND
// avoids tripping tslib's deprecated `./` exports subpath (which otherwise emits a
// "not listed in exports" warning on every bundle). Named imports read straight
// off module.exports and work in dev and production. Scoped to the exact `tslib`
// specifier so all other resolution (incl. Sentry's resolveRequest, chained
// below) is untouched.
const tslibCjsPath = require.resolve("tslib");
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "tslib") {
    return { type: "sourceFile", filePath: tslibCjsPath };
  }
  return originalResolveRequest
    ? originalResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;