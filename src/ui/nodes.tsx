import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Split } from 'lucide-react';
import type { JobNodeData, TriggerNodeData } from './layout';
import { ErrorIcon, ICON_PROPS, iconFor, TriggerIcon } from './icons';

export function JobNode({ data, selected }: NodeProps<Node<JobNodeData, 'job'>>) {
  const { job, errors } = data;
  const Icon = errors.length ? ErrorIcon : iconFor(job.kind);
  const cls = ['wf-node', selected && 'is-selected', errors.length && 'has-error'].filter(Boolean).join(' ');
  return (
    <div className={cls} title={errors.map((e) => e.message).join('\n') || undefined}>
      <Handle type="target" position={Position.Left} />
      <Icon {...ICON_PROPS} className="wf-node-icon" />
      <span className="wf-node-label">{job.name ?? job.id}</span>
      {job.if && (
        <span className="wf-node-if" title={`if: ${job.if}`}>
          <Split {...ICON_PROPS} size={14} />
        </span>
      )}
      {data.hasChildren && <Handle type="source" position={Position.Right} />}
    </div>
  );
}

export function TriggerNode({ data, selected }: NodeProps<Node<TriggerNodeData, 'trigger'>>) {
  return (
    <div className={`wf-node wf-trigger${selected ? ' is-selected' : ''}`}>
      <TriggerIcon {...ICON_PROPS} className="wf-node-icon" />
      <div className="wf-trigger-text">
        <span className="wf-node-label">{data.events.length ? data.events.join(', ') : 'Manual'}</span>
        {data.summary && <span className="wf-trigger-summary">{data.summary}</span>}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export const nodeTypes = { job: JobNode, trigger: TriggerNode };
