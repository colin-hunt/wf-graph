import dagre from '@dagrejs/dagre';
import type { Edge, Node } from '@xyflow/react';
import type { Diagnostic, Job, WorkflowModel } from '../core/types';

export const TRIGGER_ID = '__trigger__';

export type JobNodeData = { job: Job; errors: Diagnostic[]; hasChildren: boolean };
export type TriggerNodeData = { events: string[]; summary?: string };
export type GraphNode = Node<JobNodeData, 'job'> | Node<TriggerNodeData, 'trigger'>;

// Sizes and gaps measured from the EAS console workflow graph.
const NODE_W = 200;
const NODE_H = 38;
const TRIGGER_H = 56;

export interface Bounds { x: number; y: number; width: number; height: number }

export function buildGraph(model: WorkflowModel, selectedId: string | null) {
  const ids = new Set(model.jobs.map((j) => j.id));
  const nodes: GraphNode[] = [
    {
      id: TRIGGER_ID,
      type: 'trigger',
      position: { x: 0, y: 0 },
      data: { events: model.events, summary: model.triggerSummary },
      width: NODE_W,
      height: model.triggerSummary ? TRIGGER_H : NODE_H,
    },
  ];
  const edges: Edge[] = [];

  for (const job of model.jobs) {
    nodes.push({
      id: job.id,
      type: 'job',
      position: { x: 0, y: 0 },
      data: {
        job,
        errors: model.diagnostics.filter((d) => d.jobId === job.id && d.severity === 'error'),
        hasChildren: model.jobs.some((j) => j.needs.includes(job.id) || j.after.includes(job.id)),
      },
      width: NODE_W,
      height: NODE_H,
    });
    const deps = [...new Set([...job.needs, ...job.after])];
    // A job with no dependencies starts from the trigger. A job whose
    // dependencies are all missing stays unlinked, with its error icon.
    if (deps.length === 0) edges.push(edge(TRIGGER_ID, job, selectedId));
    for (const dep of deps) if (ids.has(dep)) edges.push(edge(dep, job, selectedId));
  }

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 8, ranksep: 48, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: n.width, height: n.height });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);

  for (const n of nodes) {
    const p = g.node(n.id);
    n.position = { x: p.x - n.width! / 2, y: p.y - n.height! / 2 };
    n.selected = n.id === selectedId;
  }
  const { width = 0, height = 0 } = g.graph();
  return { nodes, edges, bounds: { x: 0, y: 0, width, height } as Bounds };
}

/** Edges into a job with `if` are dashed, like a branch the console may skip. */
function edge(source: string, target: Job, selectedId: string | null): Edge {
  const active = selectedId != null && (source === selectedId || target.id === selectedId);
  return {
    id: `${source}->${target.id}`,
    source,
    target: target.id,
    className: [target.if ? 'edge-conditional' : '', active ? 'edge-active' : ''].join(' '),
    zIndex: active ? 1 : 0,
  };
}
