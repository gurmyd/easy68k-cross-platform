// Vite plugin: adds the Content Security Policy of ARCHITECTURE.md 7.6 to
// index.html as a <meta http-equiv> tag, in the production build only.
//
// GitHub Pages cannot send response headers, so the policy has to be in the
// page. The development server serves the page without it: the React plugin
// injects an inline script there, which the policy would rightly block.
// The desktop app (DV2) sends the same policy as a response header as well;
// it imports CONTENT_SECURITY_POLICY from this module so there is one source.
//
// After the bundle is written the plugin reads the emitted index.html back
// and fails the build if the tag is missing, so a build that ships without
// the policy cannot happen silently.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** The policy, one directive per entry, exactly as 7.6 states it. */
export const CSP_DIRECTIVES = Object.freeze([
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "media-src 'self' blob:",
  "connect-src 'self' https://api.github.com",
  "worker-src 'self'",
  "frame-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
]);

export const CONTENT_SECURITY_POLICY = CSP_DIRECTIVES.join('; ');

/** The tag as it appears in the built index.html. */
export const META_TAG = `<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`;

/** @returns {import('vite').Plugin} */
export function cspPlugin() {
  /** @type {string | undefined} */
  let outDir;
  return {
    name: 'easy68k-csp',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        // Directly after <meta charset>: a policy delivered in a <meta> tag
        // only governs what comes after it, so it must precede every script
        // and stylesheet, and the charset declaration must stay first.
        const charset = /<meta\s+charset=["']?[\w-]+["']?\s*\/?>/i.exec(html);
        if (!charset) {
          throw new Error('easy68k-csp: index.html has no <meta charset> tag to put the policy after');
        }
        const end = charset.index + charset[0].length;
        return `${html.slice(0, end)}\n    ${META_TAG}${html.slice(end)}`;
      },
    },
    writeBundle() {
      if (!outDir) return;
      const file = join(outDir, 'index.html');
      const html = readFileSync(file, 'utf8');
      const tag = html.indexOf(META_TAG);
      const firstScript = html.search(/<script\b|<link\b/i);
      if (tag < 0) this.error(`easy68k-csp: the Content Security Policy is missing from ${file}`);
      if (firstScript >= 0 && firstScript < tag) {
        this.error(`easy68k-csp: a <script> or <link> precedes the Content Security Policy in ${file}`);
      }
    },
  };
}
