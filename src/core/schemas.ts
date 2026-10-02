// Helpers over an EAS workflow JSON schema. The schema itself comes from the
// server (live from api.expo.dev, or the last copy cached; see ./live-schema.ts).

export type Schema = Record<string, any>;

/** Job `type` values in the schema, e.g. `build`, `get-build`, `repack`. */
export function jobTypes(schema: Schema): string[] {
  const variants: Schema[] = schema.properties?.jobs?.additionalProperties?.anyOf ?? [];
  return variants.map((v) => v.properties?.type?.const).filter((t): t is string => typeof t === 'string');
}

/** A schema for a mapping of job IDs to jobs, for the job editor, which edits one `id: {...}` entry. */
export function jobsSchema(schema: Schema): Schema {
  return { $schema: schema.$schema, ...schema.properties.jobs };
}

/** A schema with only the `on` key, for the trigger editor. */
export function onSchema(schema: Schema): Schema {
  return { ...schema, required: undefined, properties: { on: schema.properties.on } };
}
