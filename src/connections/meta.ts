import { ConnectionInputError, type ConnectionProvider } from './errors';

// provider_meta whitelist (ERD 4.17): non-secret identity only. Anything else
// is rejected, not stripped - a caller that tries to store a token-like key has
// a bug that should be loud. The DB's top-level key CHECK is only a backstop.
const ALLOWED_META_KEYS: Record<ConnectionProvider, readonly string[]> = {
  github: ['login'],
  jira: ['cloudId', 'siteUrl', 'siteName'],
  stitch: ['label'],
};

export function validateProviderMeta(
  provider: ConnectionProvider,
  meta: unknown,
): Record<string, string> {
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) {
    throw new ConnectionInputError('providerMeta must be a plain object.');
  }
  const allowed = ALLOWED_META_KEYS[provider];
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (!allowed.includes(key)) {
      // Names the key (a code identifier) but never the value.
      throw new ConnectionInputError(`providerMeta key "${key}" is not allowed for ${provider}.`);
    }
    if (typeof value !== 'string') {
      throw new ConnectionInputError(`providerMeta key "${key}" must be a string.`);
    }
    out[key] = value;
  }
  return out;
}
