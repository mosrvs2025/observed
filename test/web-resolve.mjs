// Lets Node tests import browser modules that reference the web path "/shared/…".
import { pathToFileURL, fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../public/shared/', import.meta.url));
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('/shared/')) return next(pathToFileURL(root + specifier.slice('/shared/'.length)).href, context);
  return next(specifier, context);
}
