import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCHEMA } from './live-schema';
import { parseWorkflow } from '../src/core/parse';
import { jobTypes } from '../src/core/schemas';

const fixtures = join(import.meta.dirname, 'fixtures');
const load = (name: string) => parseWorkflow(readFileSync(join(fixtures, name), 'utf8'));
const errors = (wf: ReturnType<typeof parseWorkflow>) => wf.diagnostics.filter((d) => d.severity === 'error');

describe('EAS workflows', () => {
  it('reads the repack-or-build branches as written', () => {
    const wf = load('branching.yaml');
    expect(wf.name).toBe('Repack or build, then test');
    expect(wf.jobs).toHaveLength(9);
    expect(wf.diagnostics).toEqual([]);

    const byId = Object.fromEntries(wf.jobs.map((j) => [j.id, j]));
    expect(byId.fingerprint.needs).toEqual([]);
    expect(byId.android_repack.needs).toEqual(['android_get_build']);
    expect(byId.android_repack.if).toBe('${{ needs.android_get_build.outputs.build_id }}');
    expect(byId.android_e2e.after).toEqual(['android_repack', 'android_build']);
    expect(byId.android_e2e.kind).toBe('maestro');
    expect(wf.events).toEqual(['push']);
    expect(wf.triggerSummary).toBe('main');
  });

  it('keeps the raw YAML and line range of each job', () => {
    const text = readFileSync(join(fixtures, 'branching.yaml'), 'utf8');
    const job = parseWorkflow(text).jobs.find((j) => j.id === 'fingerprint')!;
    expect(job.raw).toBe('  fingerprint:\n    environment: preview\n    type: fingerprint');
    expect(text.split('\n')[job.startLine - 1]).toBe('  fingerprint:');
  });

  it('marks jobs with steps as custom', () => {
    const lint = load('custom-job.yaml').jobs.find((j) => j.id === 'lint')!;
    expect(lint.kind).toBe('custom');
    expect(lint.name).toBe('Lint the app');
  });

  it('reports missing references, cycles, and unknown types', () => {
    const wf = load('broken.yaml');
    const missing = wf.diagnostics.find((d) => d.message.includes('no job "does_not_exist"'));
    expect(missing?.line).toBe(10);
    expect(wf.diagnostics.some((d) => d.message.startsWith('Dependency cycle'))).toBe(true);
    const unknown = parseWorkflow('on: push\njobs:\n  a:\n    type: not-a-type\n', new Set(jobTypes(SCHEMA)));
    expect(unknown.diagnostics.map((d) => d.message)).toContain('Job "a" has unknown type "not-a-type".');
  });

  it('does not warn about top-level keys, which the schema allows', () => {
    const wf = parseWorkflow('name: x\nrun_name: y\nbogus: 1\non: push\njobs:\n  a:\n    type: build\n');
    expect(wf.diagnostics).toEqual([]);
  });

  it('reports YAML syntax errors with a line number', () => {
    const wf = parseWorkflow('jobs:\n  a:\n    type: build\n   bad: [\n');
    expect(wf.diagnostics[0].severity).toBe('error');
    expect(wf.diagnostics[0].line).toBeGreaterThan(0);
  });

  it('parses every EAS fixture with no errors', () => {
    for (const f of readdirSync(fixtures).filter((f) => f.endsWith('.yaml') && f !== 'broken.yaml')) {
      expect(errors(load(f)), f).toEqual([]);
    }
  });
});
