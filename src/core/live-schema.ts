import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Schema } from './schemas';

/** Published by Expo. `eas workflow:validate` uses the same endpoint. */
export const SCHEMA_URL = 'https://api.expo.dev/v2/workflows/schema';

export interface SchemaResult {
  /** Null when the schema could not be fetched and there is no cached copy. */
  schema: Schema | null;
  /** `cached`: the last schema fetched on this computer, from `fetchedAt`. */
  source: 'live' | 'cached' | 'none';
  fetchedAt?: string;
  error?: string;
}

/** The per-user cache folder: XDG on Linux, Library/Caches on macOS, LOCALAPPDATA on Windows. */
export function defaultCacheFile(): string {
  const base = process.env.XDG_CACHE_HOME
    ?? (process.platform === 'darwin' ? join(homedir(), 'Library', 'Caches')
      : process.platform === 'win32' ? (process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'))
        : join(homedir(), '.cache'));
  return join(base, 'wf-graph', 'eas-schema.json');
}

/**
 * Fetches the live EAS schema and saves a copy in `cacheFile`. When the fetch
 * fails, uses the last saved copy. The request carries no project data.
 */
export async function loadSchema(cacheFile = defaultCacheFile(), timeoutMs = 5000): Promise<SchemaResult> {
  try {
    const res = await fetch(SCHEMA_URL, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const schema = (await res.json()).data;
    if (!schema?.properties?.jobs) throw new Error('unexpected response');
    try {
      mkdirSync(dirname(cacheFile), { recursive: true });
      writeFileSync(cacheFile, JSON.stringify(schema));
    } catch {
      // A read-only cache folder only costs the offline fallback.
    }
    return { schema, source: 'live' };
  } catch (err) {
    const error = String((err as Error).message ?? err);
    try {
      const schema = JSON.parse(readFileSync(cacheFile, 'utf8'));
      return { schema, source: 'cached', fetchedAt: statSync(cacheFile).mtime.toISOString(), error };
    } catch {
      return { schema: null, source: 'none', error };
    }
  }
}
