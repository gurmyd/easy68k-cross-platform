// The environment `npm run desktop:dev` (tools/desktop-dev.mjs) gives Electron.
//
// Kept apart from desktop-dev.mjs, which starts a server when it is imported, so that
// tests/lint/desktop-dev-env.test.ts can check it.
//
// ELECTRON_RUN_AS_NODE is removed: when the shell that starts desktop:dev has it set (some tool
// hosts and editor terminals do), Electron would run desktop/dist/main.js as plain Node and stop at
// once with "Cannot read properties of undefined (reading 'registerSchemesAsPrivileged')".
// tests/desktop/dev/harness.ts removes it for the same reason (docs/requests/DV2-desktop-dev-env.md).

/**
 * @param {Record<string, string | undefined>} base the parent's environment (process.env)
 * @param {string} devServerUrl the address of the Vite dev server
 * @returns {Record<string, string | undefined>} a new object; `base` is not changed
 */
export function electronDevEnv(base, devServerUrl) {
  const env = { ...base, EASY68K_DEV_SERVER_URL: devServerUrl };
  // Any spelling: names of environment variables do not depend on case on Windows.
  for (const name of Object.keys(env)) {
    if (name.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete env[name];
  }
  return env;
}
