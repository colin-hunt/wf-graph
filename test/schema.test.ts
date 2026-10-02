import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import jsonSchemaLibrary from 'json-schema-library';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { SCHEMA } from './live-schema';
import { jobTypes } from '../src/core/schemas';
import { EAS_JOB_ICONS } from '../src/ui/icons';

// These tests use the live EAS schema. They run on every CI build and in the
// weekly drift job. A failure with no wf-graph change means EAS changed something.

describe('EAS schema vs wf-graph', () => {
  it('has an icon for every job type, and no icon for a removed type', () => {
    // EAS added or removed a job type: update src/ui/icons.tsx.
    expect(Object.keys(EAS_JOB_ICONS).sort()).toEqual(jobTypes(SCHEMA).sort());
  });

  it('still has the keys the parser uses to draw the graph', () => {
    // src/core/parse.ts reads `needs`, `after`, and `if` on every job, and
    // `type`, `steps`, or `uses` to name its kind. If EAS renames one, the graph is wrong.
    const variants: Record<string, any>[] = SCHEMA.properties.jobs.additionalProperties.anyOf;
    for (const v of variants) {
      const keys = Object.keys(v.properties);
      expect(keys, JSON.stringify(v.properties.type)).toEqual(expect.arrayContaining(['needs', 'after', 'if']));
      expect(keys.some((k) => ['type', 'steps', 'uses'].includes(k))).toBe(true);
    }
    expect(Object.keys(SCHEMA.properties)).toEqual(expect.arrayContaining(['name', 'on', 'jobs']));
  });
});

describe('editor errors vs eas-cli errors', () => {
  // The editor (codemirror-json-schema) validates with json-schema-library.
  // `eas workflow:validate` validates with ajv, set up as below (eas-cli
  // build/metadata/utils/ajv.js). The two must agree, or the editor shows
  // errors that eas-cli would not report, or misses ones it would.
  const ajv = new Ajv({ strict: false, verbose: true, allErrors: true });
  addFormats(ajv);
  const { $schema, ...ajvSchema } = SCHEMA;
  const easCli = ajv.compile(ajvSchema);
  const editor = new jsonSchemaLibrary.Draft07(SCHEMA);

  const on = 'on:\n  push:\n    branches: [main]\njobs:\n';
  const fixtures = join(import.meta.dirname, 'fixtures');
  const cases: [name: string, yaml: string, valid: boolean][] = [
    ...readdirSync(fixtures)
      .filter((f) => f.endsWith('.yaml') && f !== 'broken.yaml')
      .map((f) => [f, readFileSync(join(fixtures, f), 'utf8'), true] as [string, string, boolean]),
    ['valid fingerprint', `${on}  a:\n    type: fingerprint\n`, true],
    ['valid repack', `${on}  a:\n    type: repack\n    params:\n      build_id: x\n`, true],
    ['custom job with steps', `${on}  a:\n    steps:\n      - run: echo hi\n`, true],
    ['unknown top-level key', `bogus: 1\n${on}  a:\n    type: fingerprint\n`, true],
    ['unknown key on a job', `${on}  a:\n    type: repack\n    bogus: 1\n    params:\n      build_id: x\n`, false],
    ['runs_on on get-build', `${on}  a:\n    type: get-build\n    runs_on: linux-large\n`, false],
    ['unknown job type', `${on}  a:\n    type: not-a-type\n`, false],
    ['needs as a string', `${on}  a:\n    type: fingerprint\n  b:\n    needs: a\n    type: fingerprint\n`, false],
    ['unknown param', `${on}  a:\n    type: build\n    params:\n      platform: ios\n      nope: 1\n`, false],
    ['bad enum value', `${on}  a:\n    type: build\n    params:\n      platform: ios\n      distribution: nope\n`, false],
    ['if as a number', `${on}  a:\n    type: fingerprint\n    if: 5\n`, false],
    ['on as a string', 'on: push\njobs:\n  a:\n    type: fingerprint\n', false],
  ];

  it.each(cases)('%s', (_name, yaml, valid) => {
    const data = parse(yaml);
    const cli = easCli(data) as boolean;
    const inEditor = editor.validate(data).length === 0;
    expect({ cli, inEditor }).toEqual({ cli: valid, inEditor: valid });
  });
});
