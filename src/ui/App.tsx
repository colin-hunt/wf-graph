import { FileText, Workflow } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseWorkflow } from '../core/parse';
import { jobTypes, type Schema } from '../core/schemas';
import type { Block, WorkflowModel } from '../core/types';
import { spliceBlock } from './blocks';
import { EasActions, EasResultBox, type EasResult } from './Eas';
import { Graph } from './Graph';
import { ICON_PROPS } from './icons';
import { TRIGGER_ID } from './layout';
import { Panel } from './Panel';
import { YamlEditor } from './YamlEditor';

interface FilesInfo {
  root: string;
  files: string[];
  /** False when the files are not in an Expo project, so Validate and Run cannot work. */
  canRun: boolean;
}

interface Loaded {
  name: string;
  text: string;
  etag: string;
}

export interface SchemaInfo {
  schema: Schema | null;
  source: 'live' | 'cached' | 'none';
  fetchedAt?: string;
}

type Tab = 'graph' | 'file';

export function App() {
  const [info, setInfo] = useState<FilesInfo | null>(null);
  const [file, setFile] = useState<string | null>(new URLSearchParams(location.search).get('file'));
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [lastGood, setLastGood] = useState<WorkflowModel | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('graph');
  const [connected, setConnected] = useState(true);
  const [easResult, setEasResult] = useState<EasResult | 'busy' | null>(null);
  const [schema, setSchema] = useState<SchemaInfo | null>(null);

  useEffect(() => {
    fetch('/api/schema').then((r) => r.json()).then(setSchema);
  }, []);
  const fileRef = useRef(file);
  fileRef.current = file;

  const loadFiles = useCallback(async () => {
    const next: FilesInfo = await (await fetch('/api/files')).json();
    setInfo(next);
    setFile((cur) => cur ?? next.files[0] ?? null);
  }, []);

  const apply = useCallback((name: string, text: string, etag: string) => setLoaded({ name, text, etag }), []);

  const types = useMemo(() => (schema?.schema ? new Set(jobTypes(schema.schema)) : null), [schema]);
  const model = useMemo(() => (loaded ? parseWorkflow(loaded.text, types) : null), [loaded, types]);

  // A YAML syntax error leaves no jobs. Keep the last good graph on screen.
  useEffect(() => {
    if (model && (model.jobs.length > 0 || !model.diagnostics.some((d) => d.severity === 'error'))) setLastGood(model);
  }, [model]);

  const loadFile = useCallback(async (name: string) => {
    const res = await fetch(`/api/file?name=${encodeURIComponent(name)}`);
    if (fileRef.current !== name) return;
    if (!res.ok) {
      setLoadError(`${name} is not available. It may have been deleted or renamed.`);
      setLoaded(null);
      return;
    }
    setLoadError(null);
    apply(name, await res.text(), res.headers.get('etag') ?? '');
  }, [apply]);

  const saveFile = useCallback(async (text: string): Promise<string | null> => {
    if (!loaded) return 'Nothing to save.';
    const res = await fetch(`/api/file?name=${encodeURIComponent(loaded.name)}`, {
      method: 'PUT',
      headers: { 'x-wf-graph': '1', 'if-match': loaded.etag, 'content-type': 'text/plain' },
      body: text,
    });
    if (res.status === 409) {
      loadFile(loaded.name);
      return 'The file changed on disk. Your edit was not saved.';
    }
    if (!res.ok) return `Save failed: ${await res.text()}`;
    apply(loaded.name, text, res.headers.get('etag') ?? '');
    return null;
  }, [loaded, apply, loadFile]);

  const saveBlock = useCallback(
    (block: Block, edited: string) => (loaded ? saveFile(spliceBlock(loaded.text, block, edited)) : Promise.resolve('Nothing to save.')),
    [loaded, saveFile],
  );

  useEffect(() => { loadFiles(); }, [loadFiles]);

  useEffect(() => {
    if (!file) return;
    setLastGood(null);
    setSelectedId(null);
    setEasResult(null);
    loadFile(file);
    const url = new URL(location.href);
    url.searchParams.set('file', file);
    history.replaceState(null, '', url);
  }, [file, loadFile]);

  useEffect(() => {
    const es = new EventSource('/events');
    es.addEventListener('open', () => {
      setConnected(true);
      loadFiles();
      if (fileRef.current) loadFile(fileRef.current);
    });
    es.addEventListener('error', () => setConnected(false));
    es.addEventListener('files', (e) => {
      const files: string[] = JSON.parse((e as MessageEvent).data);
      setInfo((cur) => (cur ? { ...cur, files } : cur));
    });
    es.addEventListener('change', (e) => {
      const { name } = JSON.parse((e as MessageEvent).data);
      if (name === fileRef.current) loadFile(name);
    });
    return () => es.close();
  }, [loadFile, loadFiles]);

  const shown = model && model.jobs.length === 0 && lastGood ? lastGood : model;

  useEffect(() => {
    if (shown && selectedId && selectedId !== TRIGGER_ID && !shown.jobs.some((j) => j.id === selectedId)) setSelectedId(null);
  }, [shown, selectedId]);

  const fitKey = useMemo(() => `${file}|${shown?.jobs.map((j) => j.id).join(',')}`, [file, shown]);
  const groups = useMemo(() => groupFiles(info?.files ?? []), [info]);
  const diagnostics = model?.diagnostics ?? [];
  const selectedLine = selectedId === TRIGGER_ID ? shown?.on?.startLine : shown?.jobs.find((j) => j.id === selectedId)?.startLine;

  return (
    <div className="wf-app">
      <nav className="wf-sidebar">
        <div className="wf-brand">wf-graph</div>
        {groups.map(([dir, names]) => (
          <div key={dir} className="wf-file-group">
            <div className="wf-file-group-title">{dir}</div>
            {names.map((n) => {
              const full = dir ? `${dir}/${n}` : n;
              return (
                <button key={full} className={`wf-file${full === file ? ' is-active' : ''}`} onClick={() => setFile(full)}>
                  {n}
                </button>
              );
            })}
          </div>
        ))}
        <div className="wf-sidebar-foot">
          <span className={`wf-dot${connected ? '' : ' is-down'}`} />
          {connected ? 'Watching for changes' : 'Disconnected'}
        </div>
      </nav>

      <main className="wf-main">
        <header className="wf-header">
          <div>
            <h1>{shown?.name ?? file ?? 'wf-graph'}</h1>
            {file && <p>{file}</p>}
          </div>
          {file && info?.canRun && (
            <EasActions file={file} onResult={setEasResult} />
          )}
        </header>

        {easResult && <EasResultBox result={easResult} onClose={() => setEasResult(null)} />}

        {(diagnostics.length > 0 || loadError) && (
          <div className="wf-problems">
            {loadError && <div className="wf-problem is-error">{loadError}</div>}
            {shown !== model && <div className="wf-problem is-error">Showing the last valid version of the graph.</div>}
            {diagnostics.map((d, i) => (
              <div key={i} className={`wf-problem is-${d.severity}`}>
                {d.line != null && <code>Line {d.line}</code>}
                <span>{d.message}</span>
                {d.jobId && shown?.jobs.some((j) => j.id === d.jobId) && (
                  <button className="wf-id-link" onClick={() => setSelectedId(d.jobId!)}>{d.jobId}</button>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="wf-card">
          <div className="wf-tabs" role="tablist">
            <button role="tab" className={`wf-tab${tab === 'graph' ? ' is-active' : ''}`} onClick={() => setTab('graph')}>
              <Workflow {...ICON_PROPS} /> Workflow graph
            </button>
            <button role="tab" className={`wf-tab${tab === 'file' ? ' is-active' : ''}`} onClick={() => setTab('file')}>
              <FileText {...ICON_PROPS} /> Workflow file
            </button>
          </div>

          <div className="wf-card-body">
            {tab === 'graph' && (
              <>
                <div className="wf-canvas">
                  {shown ? (
                    <Graph model={shown} fitKey={fitKey} selectedId={selectedId} onSelect={setSelectedId} />
                  ) : (
                    <div className="wf-empty">{info && info.files.length === 0 ? 'No workflow files found.' : loadError ? '' : 'Loading…'}</div>
                  )}
                </div>
                {shown && selectedId && (
                  <Panel model={shown} schema={schema?.schema} selectedId={selectedId} onSelect={setSelectedId} onSaveBlock={saveBlock} />
                )}
              </>
            )}
            {tab === 'file' && loaded && schema && (
              <FileEditor
                key={loaded.name}
                text={loaded.text}
                schema={schema}
                focusLine={selectedLine}
                onSave={saveFile}
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function FileEditor({ text, schema, focusLine, onSave }: {
  text: string; schema: SchemaInfo; focusLine?: number; onSave: (text: string) => Promise<string | null>;
}) {
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [getText, setGetText] = useState<() => string>(() => () => text);
  const save = async (t: string) => setStatus((await onSave(t)) ?? 'Saved');
  return (
    <div className="wf-file-editor">
      <div className="wf-file-editor-bar">
        <span className="wf-muted">
          {status ?? (dirty ? 'Unsaved changes' : `${schemaNote(schema)} ⌘S saves.`)}
        </span>
        <button className="wf-button wf-button-primary" disabled={!dirty} onClick={() => save(getText())}>Save</button>
      </div>
      <YamlEditor
        value={text}
        schema={schema.schema ?? undefined}
        focusLine={focusLine}
        onDirtyChange={(d) => { setDirty(d); if (d) setStatus(null); }}
        onSave={save}
        bindGetText={(get) => setGetText(() => get)}
      />
    </div>
  );
}

function schemaNote({ source, fetchedAt }: SchemaInfo): string {
  if (source === 'live') return 'Autocomplete and hover docs use the live EAS schema.';
  if (source === 'cached') return `Offline: autocomplete uses the EAS schema saved on ${new Date(fetchedAt!).toLocaleDateString()}, which may be out of date.`;
  return 'Offline: autocomplete and schema errors are off until wf-graph can fetch the EAS schema.';
}

/** Groups `a/b/c.yml` names by folder, in a stable order. */
function groupFiles(files: string[]): [string, string[]][] {
  const map = new Map<string, string[]>();
  for (const f of files) {
    const i = f.lastIndexOf('/');
    const dir = i >= 0 ? f.slice(0, i) : '';
    map.set(dir, [...(map.get(dir) ?? []), f.slice(i + 1)]);
  }
  return [...map.entries()];
}
