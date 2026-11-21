// The environment `npm run desktop:dev` gives Electron (tools/desktop-dev-env.mjs, used by
// tools/desktop-dev.mjs). Runs as part of `npm run lint` (vitest run --root tests/lint), next to the
// self-test of the lint rules: both check the gates' own build tools.
//
// docs/requests/DV2-desktop-dev-env.md: with ELECTRON_RUN_AS_NODE inherited, Electron runs the main
// process as plain Node and desktop:dev stops at once.

import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

type Env = Record<string, string | undefined>;

const modulePath = fileURLToPath(new URL('../../tools/desktop-dev-env.mjs', import.meta.url));
const { electronDevEnv } = (await import(pathToFileURL(modulePath).href)) as {
  electronDevEnv: (base: Env, devServerUrl: string) => Env;
};

describe('electronDevEnv (desktop:dev)', () => {
  it('passes the dev server address and the rest of the environment on', () => {
    const env = electronDevEnv({ PATH: '/bin', HOME: '/home/x' }, 'http://127.0.0.1:5000/');
    expect(env).toEqual({ PATH: '/bin', HOME: '/home/x', EASY68K_DEV_SERVER_URL: 'http://127.0.0.1:5000/' });
  });

  it('drops ELECTRON_RUN_AS_NODE, in any spelling, without changing the parent environment', () => {
    const base: Env = { PATH: '/bin', ELECTRON_RUN_AS_NODE: '1', electron_run_as_node: '1' };
    const env = electronDevEnv(base, 'http://127.0.0.1:5000/');
    expect(Object.keys(env).filter((name) => name.toUpperCase() === 'ELECTRON_RUN_AS_NODE')).toEqual([]);
    expect(base.ELECTRON_RUN_AS_NODE).toBe('1');
  });

  it('replaces an inherited EASY68K_DEV_SERVER_URL', () => {
    const env = electronDevEnv({ EASY68K_DEV_SERVER_URL: 'http://old/' }, 'http://127.0.0.1:5000/');
    expect(env.EASY68K_DEV_SERVER_URL).toBe('http://127.0.0.1:5000/');
  });
});
