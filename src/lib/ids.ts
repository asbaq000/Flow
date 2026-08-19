import crypto from 'node:crypto';

/**
 * Random opaque identifiers. Lives apart from auth.ts so the store can use it
 * without pulling in the session layer (and its database import) in a cycle.
 */
export function newId(prefix = ''): string {
  return prefix + crypto.randomBytes(12).toString('hex');
}
