// Test-only Node ESM loader hook: src/*.js uses extensionless relative
// imports ("./id", not "./id.js") because Vite/CRA's bundlers resolve those
// fine — that's the actual, correct consumption path documented in the
// package's HARD BOUNDARY comment. Plain `node --test` doesn't bundle, so
// this shim exists purely to resolve module specifiers for the test run
// itself. Never shipped, never imported by src/, zero effect on consumers.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !specifier.endsWith('.js') && !specifier.endsWith('.mjs')) {
    const candidate = fileURLToPath(new URL(specifier + '.js', context.parentURL));
    if (existsSync(candidate)) {
      return nextResolve(specifier + '.js', context);
    }
  }
  return nextResolve(specifier, context);
}
