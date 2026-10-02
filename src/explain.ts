import Ajv, { type ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import type { Schema } from './core/schemas';

/**
 * eas-cli reports a bad job once for every job type in the schema, so one
 * mistake becomes dozens of lines. This checks each job against the schema
 * entry for its own `type` only, and returns one short line per problem.
 */
export function explainJobErrors(yamlText: string, schema: Schema): string[] {
  let doc: any;
  try {
    doc = parse(yamlText);
  } catch {
    return [];
  }
  const jobs = doc?.jobs;
  if (!jobs || typeof jobs !== 'object') return [];
  const variants: Schema[] = schema.properties?.jobs?.additionalProperties?.anyOf ?? [];
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);

  const lines: string[] = [];
  for (const [id, job] of Object.entries<any>(jobs)) {
    if (!job || typeof job !== 'object') continue;
    const variant = job.type != null
      ? variants.find((v) => v.properties?.type?.const === job.type)
      : job.uses != null
        ? variants.find((v) => !v.properties?.type)
        : variants.find((v) => v.properties?.type?.const === 'custom');
    if (!variant) {
      if (job.type != null) lines.push(`${id}: unknown type "${job.type}"`);
      continue;
    }
    const validate = ajv.compile(variant);
    if (validate(job)) continue;
    for (const e of simplify(validate.errors ?? [])) lines.push(`${id}: ${describe(e, job, variant)}`);
  }
  return [...new Set(lines)];
}

/** Drops the "must match a schema in anyOf" wrappers when a more specific error exists. */
function simplify(errors: ErrorObject[]): ErrorObject[] {
  const specific = errors.filter((e) => e.keyword !== 'anyOf' && e.keyword !== 'oneOf' && e.keyword !== 'not');
  return specific.length ? specific : errors;
}

function describe(e: ErrorObject, job: any, variant: Schema): string {
  const at = e.instancePath ? e.instancePath.slice(1).replace(/\//g, '.') : '';
  const where = at ? `\`${at}\`: ` : '';
  if (e.keyword === 'additionalProperties') {
    const key = (e.params as { additionalProperty: string }).additionalProperty;
    const paramKeys = Object.keys(variant.properties?.params?.properties ?? {});
    const hint = !at && paramKeys.includes(key) && job.params !== undefined ? ` (it belongs under \`params:\`)` : '';
    return `${where}unexpected key \`${key}\`${hint}`;
  }
  if (e.keyword === 'required') return `${where}missing \`${(e.params as { missingProperty: string }).missingProperty}\``;
  if (e.keyword === 'enum') return `${where}must be one of ${(e.params as { allowedValues: unknown[] }).allowedValues.map((v) => JSON.stringify(v)).join(', ')}`;
  return `${where}${e.message}`;
}
