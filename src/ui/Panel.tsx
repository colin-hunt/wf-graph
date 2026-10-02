import { X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { jobsSchema, onSchema, type Schema } from '../core/schemas';
import type { Block, WorkflowModel } from '../core/types';
import { dedent } from './blocks';
import { ICON_PROPS, iconFor, TriggerIcon } from './icons';
import { TRIGGER_ID } from './layout';
import { YamlEditor } from './YamlEditor';

interface Props {
  model: WorkflowModel;
  /** Undefined until the server returns it; the editor waits for it. */
  schema?: Schema | null;
  selectedId: string;
  onSelect: (id: string | null) => void;
  /** Writes the block back into the file. Resolves to an error message, or null. */
  onSaveBlock: (block: Block, text: string) => Promise<string | null>;
}

export function Panel({ model, schema, selectedId, onSelect, onSaveBlock }: Props) {
  const isTrigger = selectedId === TRIGGER_ID;
  const job = isTrigger ? undefined : model.jobs.find((j) => j.id === selectedId);
  // Stable per schema: the editor rebuilds itself (and drops unsaved edits) when its schema changes.
  const editorSchema = useMemo(() => schema && (isTrigger ? onSchema(schema) : jobsSchema(schema)), [schema, isTrigger]);
  if (!isTrigger && !job) return null;

  const block = isTrigger ? model.on : job;
  const Icon = isTrigger ? TriggerIcon : iconFor(job!.kind);
  const title = isTrigger ? 'Trigger' : (job!.name ?? job!.id);
  const subtitle = isTrigger ? 'on' : [job!.name ? job!.id : null, job!.kind].filter(Boolean).join(' · ');

  return (
    <aside className="wf-panel">
      <header className="wf-panel-header">
        <Icon {...ICON_PROPS} className="wf-icon-secondary" />
        <div className="wf-panel-title">
          <h2>{title}</h2>
          <span>{subtitle}</span>
        </div>
        <button className="wf-icon-button" onClick={() => onSelect(null)} aria-label="Close">
          <X {...ICON_PROPS} />
        </button>
      </header>
      {block ? (
        <BlockEditor key={selectedId} block={block} schema={editorSchema ?? undefined} onSave={onSaveBlock} />
      ) : (
        <p className="wf-muted wf-pad">This workflow has no <code>on</code> key. It runs only when started by hand.</p>
      )}
    </aside>
  );
}

function BlockEditor({ block, schema, onSave }: { block: Block; schema?: object; onSave: Props['onSaveBlock'] }) {
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const [getText, setGetText] = useState<() => string>(() => () => dedent(block.raw));

  const save = async (text: string) => {
    const err = await onSave(block, text);
    setStatus(err ? { kind: 'error', text: err } : { kind: 'ok', text: 'Saved' });
  };

  return (
    <section className="wf-section">
      <div className="wf-section-head">
        <h3>YAML</h3>
        <span className="wf-muted">Lines {block.startLine}–{block.endLine}</span>
        <div className="wf-actions">
          {status && <span className={status.kind === 'error' ? 'wf-text-danger' : 'wf-muted'}>{status.text}</span>}
          <button className="wf-button" disabled={!dirty} onClick={() => { setRevision((r) => r + 1); setStatus(null); }}>
            Revert
          </button>
          <button className="wf-button wf-button-primary" disabled={!dirty} onClick={() => save(getText())}>
            Save
          </button>
        </div>
      </div>
      <YamlEditor
        key={revision}
        value={dedent(block.raw)}
        schema={schema}
        wrap
        onDirtyChange={(d) => { setDirty(d); if (d) setStatus(null); }}
        onSave={save}
        bindGetText={(get) => setGetText(() => get)}
      />
    </section>
  );
}
