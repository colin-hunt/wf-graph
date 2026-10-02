import { join } from 'node:path';
import { loadSchema } from '../src/core/live-schema';
import type { Schema } from '../src/core/schemas';

// The tests check wf-graph against the schema EAS serves today, so a change on
// the EAS side fails CI. The last copy is kept in node_modules/.cache for
// offline runs.
const result = await loadSchema(join(import.meta.dirname, '..', 'node_modules', '.cache', 'wf-graph', 'eas-schema.json'), 15_000);
if (!result.schema) throw new Error(`The tests need the live EAS schema, and the fetch failed: ${result.error}`);
if (result.source === 'cached') console.warn(`Offline: testing against the EAS schema cached on ${result.fetchedAt}.`);

export const SCHEMA: Schema = result.schema;
