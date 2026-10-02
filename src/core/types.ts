export type Severity = 'error' | 'warning';

export interface Diagnostic {
  severity: Severity;
  message: string;
  /** 1-based line in the workflow file, when known. */
  line?: number;
  jobId?: string;
}

export interface Job {
  id: string;
  name?: string;
  /** The `type` value, `custom` for a job with `steps`, or `uses` for a reusable workflow job. */
  kind: string;
  needs: string[];
  after: string[];
  if?: string;
  /** The parsed job mapping, as written. */
  value: Record<string, unknown>;
  /** The job's YAML text, from its key line to its last line. */
  raw: string;
  startLine: number;
  endLine: number;
}

export interface Block {
  raw: string;
  startLine: number;
  endLine: number;
  value: unknown;
}

export interface WorkflowModel {
  name?: string;
  /** Trigger event names, in file order. */
  events: string[];
  /** Short text under the events on the trigger node, e.g. `main`. */
  triggerSummary?: string;
  on?: Block;
  jobs: Job[];
  diagnostics: Diagnostic[];
}
