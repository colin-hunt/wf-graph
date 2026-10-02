import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSchema } from '../src/core/live-schema';

const schema = { properties: { jobs: {} } };
const respond = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe('loadSchema', () => {
  afterEach(() => vi.unstubAllGlobals());
  const cacheFile = () => join(mkdtempSync(join(tmpdir(), 'wf-graph-test-')), 'sub', 'eas-schema.json');

  it('uses the live schema and caches it, then falls back to the cache offline', async () => {
    const file = cacheFile();
    vi.stubGlobal('fetch', respond({ data: schema }));
    expect(await loadSchema(file)).toEqual({ schema, source: 'live' });

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await loadSchema(file)).toMatchObject({ schema, source: 'cached', error: 'offline' });
  });

  it('returns no schema when offline with no cache', async () => {
    vi.stubGlobal('fetch', respond({}, 503));
    expect(await loadSchema(cacheFile())).toEqual({ schema: null, source: 'none', error: 'HTTP 503' });
  });

  it('rejects a response that is not a workflow schema, and does not cache it', async () => {
    const file = cacheFile();
    vi.stubGlobal('fetch', respond({ data: { nope: 1 } }));
    expect(await loadSchema(file)).toMatchObject({ schema: null, source: 'none', error: 'unexpected response' });
  });
});
