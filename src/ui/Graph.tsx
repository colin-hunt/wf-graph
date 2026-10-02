import {
  applyNodeChanges,
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  getViewportForBounds,
  useStoreApi,
  useReactFlow,
  type NodeChange,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkflowModel } from '../core/types';
import { buildGraph, type GraphNode } from './layout';
import { nodeTypes } from './nodes';

interface Props {
  model: WorkflowModel;
  /** Changes when the graph should re-fit: a new file or a new set of jobs. */
  fitKey: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

function Inner({ model, fitKey, selectedId, onSelect }: Props) {
  const built = useMemo(() => buildGraph(model, selectedId), [model, selectedId]);
  const [nodes, setNodes] = useState<GraphNode[]>(built.nodes);
  const flow = useReactFlow();

  // React Flow reports measured sizes through onNodesChange. Carry them over to
  // each rebuilt node so a click or a reload does not reset the measurement.
  useEffect(() => {
    setNodes((prev) => {
      const measured = new Map(prev.map((n) => [n.id, n.measured]));
      return built.nodes.map((n) => ({ ...n, measured: measured.get(n.id) })) as GraphNode[];
    });
  }, [built]);

  const onNodesChange = useCallback(
    (changes: NodeChange<GraphNode>[]) => setNodes((ns) => applyNodeChanges(changes, ns)),
    [],
  );

  // Fit to the layout bounds on a new file or a new set of jobs. The layout
  // knows every node size, so this does not wait for DOM measurement.
  const bounds = built.bounds;
  const store = useStoreApi();
  const fit = useCallback(() => {
    // Read the size from the DOM: React Flow's stored size lags a panel toggle.
    const rect = store.getState().domNode?.getBoundingClientRect();
    if (!rect) return;
    const { width, height } = rect;
    // Cap the zoom at 1 so a small workflow does not render huge.
    flow.setViewport(getViewportForBounds(bounds, width, height, 0.2, 1, 0.1));
  }, [flow, store, bounds]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (ready) fit();
    // Re-fit only when fitKey changes, not on every selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, ready]);

  // Re-fit when the canvas changes size: the side panel opens, a result box
  // appears above the graph, or the window is resized.
  const fitRef = useRef(fit);
  fitRef.current = fit;
  useEffect(() => {
    const el = store.getState().domNode;
    if (!ready || !el) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => fitRef.current(), 60);
    });
    ro.observe(el);
    return () => {
      clearTimeout(t);
      ro.disconnect();
    };
  }, [ready, store]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={built.edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onInit={() => setReady(true)}
      onNodeClick={(_, n) => onSelect(n.id)}
      onPaneClick={() => onSelect(null)}
      nodesDraggable={false}
      nodesConnectable={false}
      edgesFocusable={false}
      minZoom={0.2}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={16} size={1} color="var(--wf-grid)" />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

export function Graph(props: Props) {
  return (
    <ReactFlowProvider>
      <Inner {...props} />
    </ReactFlowProvider>
  );
}
