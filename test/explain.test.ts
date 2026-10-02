import { describe, expect, it } from 'vitest';
import { SCHEMA } from './live-schema';
import { explainJobErrors } from '../src/explain';

describe('explainJobErrors', () => {
  it('reports one short line per problem, against the job type only', () => {
    const yaml = `jobs:
  find_build:
    type: get-build
    profile: development
    params:
      fingerprint_hash: abc
  build:
    type: build
    params:
      profile: development
  ok:
    type: fingerprint
`;
    expect(explainJobErrors(yaml, SCHEMA)).toEqual([
      'find_build: unexpected key `profile` (it belongs under `params:`)',
      'build: `params`: missing `platform`',
    ]);
  });

  it('returns nothing for a valid file', () => {
    expect(explainJobErrors('jobs:\n  a:\n    type: fingerprint\n', SCHEMA)).toEqual([]);
  });
});
