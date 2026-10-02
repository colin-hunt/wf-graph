import { isMap, isScalar, LineCounter, parseDocument, type Node, type Pair } from 'yaml';
import type { Block, Diagnostic, Job, WorkflowModel } from './types';

/**
 * Reads the workflow as written. `jobTypes` is the list of valid job `type`
 * values from the schema; pass null to skip the unknown-type check.
 */
export function parseWorkflow(text: string, jobTypes: ReadonlySet<string> | null = null): WorkflowModel {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, prettyErrors: false });
  const lines = text.split('\n');
  const diagnostics: Diagnostic[] = [];
  const lineOf = (offset: number) => lineCounter.linePos(offset).line;

  for (const err of doc.errors) {
    diagnostics.push({ severity: 'error', message: firstLine(err.message), line: lineOf(err.pos[0]) });
  }
  for (const warn of doc.warnings) {
    diagnostics.push({ severity: 'warning', message: firstLine(warn.message), line: lineOf(warn.pos[0]) });
  }

  const model: WorkflowModel = { events: [], jobs: [], diagnostics };
  if (doc.errors.length > 0) return model;

  const root = doc.contents;
  if (!isMap(root)) {
    diagnostics.push({ severity: 'error', message: 'A workflow file must be a YAML mapping.' });
    return model;
  }

  // The `key: value` pair as a block of whole lines, trimmed to the last non-blank line.
  const block = (pair: Pair): Block => {
    const key = pair.key as Node | null;
    const value = pair.value as Node | null;
    const startLine = lineOf(key?.range?.[0] ?? 0);
    let endLine = lineOf(value?.range?.[1] ?? key?.range?.[1] ?? 0);
    while (endLine > startLine && (lines[endLine - 1] ?? '').trim() === '') endLine--;
    const raw = lines.slice(startLine - 1, endLine).join('\n');
    return { raw, startLine, endLine, value: value?.toJSON?.() ?? value };
  };

  for (const pair of root.items) {
    const key = keyOf(pair);
    const b = block(pair);
    if (key === 'name') model.name = String(b.value);
    if (key === 'on') {
      model.on = b;
      Object.assign(model, summarizeOn(b.value));
    }
    if (key !== 'jobs') continue;
    if (!isMap(pair.value)) {
      diagnostics.push({ severity: 'error', message: '`jobs` must be a mapping of job IDs to jobs.', line: b.startLine });
      continue;
    }
    for (const jobPair of pair.value.items) {
      const id = keyOf(jobPair);
      const jb = block(jobPair);
      if (!jb.value || typeof jb.value !== 'object' || Array.isArray(jb.value)) {
        diagnostics.push({ severity: 'error', message: `Job "${id}" must be a mapping.`, line: jb.startLine, jobId: id });
        continue;
      }
      model.jobs.push(toJob(id, jb, jobTypes, diagnostics));
    }
  }

  if (!root.has('jobs')) diagnostics.push({ severity: 'error', message: 'The workflow has no `jobs` key.' });
  checkReferences(model);
  return model;
}

function toJob(id: string, b: Block, jobTypes: ReadonlySet<string> | null, diagnostics: Diagnostic[]): Job {
  const v = b.value as Record<string, unknown>;
  let kind: string;
  if (v.type != null) {
    kind = String(v.type);
    if (jobTypes && !jobTypes.has(kind)) {
      diagnostics.push({ severity: 'warning', message: `Job "${id}" has unknown type "${kind}".`, line: b.startLine, jobId: id });
    }
  } else if (v.uses != null) {
    kind = 'uses';
  } else {
    kind = 'custom';
    if (!Array.isArray(v.steps) || v.steps.length === 0) {
      diagnostics.push({ severity: 'error', message: `Job "${id}" has no \`type\` and no \`steps\`.`, line: b.startLine, jobId: id });
    }
  }
  return {
    id,
    name: v.name == null ? undefined : String(v.name),
    kind,
    needs: toList(v.needs),
    after: toList(v.after),
    if: v.if == null ? undefined : String(v.if),
    value: v,
    raw: b.raw,
    startLine: b.startLine,
    endLine: b.endLine,
  };
}

function checkReferences(model: WorkflowModel) {
  const byId = new Map(model.jobs.map((j) => [j.id, j]));
  for (const job of model.jobs) {
    for (const [key, refs] of [['needs', job.needs], ['after', job.after]] as const) {
      for (const ref of refs) {
        if (byId.has(ref)) continue;
        const idx = job.raw.split('\n').findIndex((l) => l.includes(ref));
        model.diagnostics.push({
          severity: 'error',
          message: `Job "${job.id}" has \`${key}: ${ref}\`, but no job "${ref}" exists.`,
          line: job.startLine + Math.max(0, idx),
          jobId: job.id,
        });
      }
    }
  }

  // Depth-first search over needs + after to find cycles.
  const state = new Map<string, 'visiting' | 'done'>();
  const reported = new Set<string>();
  const visit = (id: string, path: string[]) => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') {
      const cycle = [...path.slice(path.indexOf(id)), id];
      const key = [...new Set(cycle)].sort().join(',');
      if (!reported.has(key)) {
        reported.add(key);
        model.diagnostics.push({
          severity: 'error',
          message: `Dependency cycle: ${cycle.join(' → ')}.`,
          line: byId.get(id)?.startLine,
          jobId: id,
        });
      }
      return;
    }
    state.set(id, 'visiting');
    const job = byId.get(id)!;
    for (const dep of [...job.needs, ...job.after]) if (byId.has(dep)) visit(dep, [...path, id]);
    state.set(id, 'done');
  };
  for (const job of model.jobs) visit(job.id, []);
}

/** Event names, plus the branches (or labels, or cron) of the first event that has them. */
function summarizeOn(on: unknown): Pick<WorkflowModel, 'events' | 'triggerSummary'> {
  if (typeof on === 'string') return { events: [on] };
  if (Array.isArray(on)) return { events: on.map(String) };
  if (!on || typeof on !== 'object') return { events: [] };
  const entries = Object.entries(on as Record<string, unknown>);
  let triggerSummary: string | undefined;
  for (const [, cfg] of entries) {
    if (triggerSummary) break;
    if (Array.isArray(cfg)) {
      const cron = cfg.map((c) => (c && typeof c === 'object' ? (c as Record<string, unknown>).cron : undefined)).filter(Boolean);
      if (cron.length) triggerSummary = cron.join(', ');
    } else if (cfg && typeof cfg === 'object') {
      const c = cfg as Record<string, unknown>;
      const list = c.branches ?? c.labels ?? c.tags ?? c.types;
      if (list != null) triggerSummary = toList(list).join(', ');
    }
  }
  return { events: entries.map(([k]) => k), triggerSummary };
}

function keyOf(pair: Pair) {
  return isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
}

function toList(v: unknown): string[] {
  if (v == null) return [];
  return Array.isArray(v) ? v.map(String) : [String(v)];
}

function firstLine(s: string) {
  return s.split('\n')[0];
}
