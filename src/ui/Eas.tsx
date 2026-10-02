import { ChevronDown, ChevronRight, CircleCheck, CircleX, ExternalLink, LoaderCircle, Play, ShieldCheck, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ICON_PROPS } from './icons';

interface GitInfo {
  isRepo: boolean;
  branch?: string;
  head?: string;
  fileChanged?: boolean;
  upstream?: string | null;
  ahead?: number | null;
}

export interface EasResult {
  action: 'validate' | 'run';
  ok: boolean;
  command: string;
  output: string;
  url?: string;
  /** For example `eas-cli/24.7.0`. */
  version?: string;
  /** One line per problem, per job. Empty when wf-graph could not narrow it down. */
  summary?: string[];
}

const post = async (action: string, file: string, body?: object): Promise<EasResult> => {
  const res = await fetch(`/api/eas/${action}?name=${encodeURIComponent(file)}`, {
    method: 'POST',
    headers: { 'x-wf-graph': '1', 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) return { action: action as EasResult['action'], ok: false, command: `eas workflow:${action}`, output: await res.text() };
  const data = await res.json();
  return { action: action as EasResult['action'], ok: data.ok, command: data.command, output: data.output, url: data.result?.url, version: data.version, summary: data.summary };
};

/** Validate and Run buttons for an EAS workflow file. */
export function EasActions({ file, onResult }: { file: string; onResult: (r: EasResult | 'busy' | null) => void }) {
  const [busy, setBusy] = useState<'validate' | 'run' | null>(null);
  const [dialog, setDialog] = useState(false);

  const act = async (action: 'validate' | 'run', body?: object) => {
    setBusy(action);
    onResult('busy');
    try {
      onResult(await post(action, file, body));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="wf-header-actions">
      <button className="wf-button wf-button-lg" disabled={!!busy} onClick={() => act('validate')} title="Runs eas workflow:validate. Sends the file to EAS.">
        {busy === 'validate' ? <LoaderCircle {...ICON_PROPS} className="wf-spin" /> : <ShieldCheck {...ICON_PROPS} />} Validate
      </button>
      <button className="wf-button wf-button-lg" disabled={!!busy} onClick={() => setDialog(true)}>
        {busy === 'run' ? <LoaderCircle {...ICON_PROPS} className="wf-spin" /> : <Play {...ICON_PROPS} />} Run workflow
      </button>
      {dialog && (
        <RunDialog
          file={file}
          onCancel={() => setDialog(false)}
          onRun={(ref) => {
            setDialog(false);
            act('run', ref ? { ref } : {});
          }}
        />
      )}
    </div>
  );
}

function RunDialog({ file, onCancel, onRun }: { file: string; onCancel: () => void; onRun: (ref: string | null) => void }) {
  const [info, setInfo] = useState<{ projectDir: string; git: GitInfo } | null>(null);
  const [mode, setMode] = useState<'ref' | 'local'>('ref');

  useEffect(() => {
    fetch(`/api/eas/info?name=${encodeURIComponent(file)}`)
      .then((r) => r.json())
      .then((d) => {
        setInfo(d);
        if (!d.git.isRepo) setMode('local');
      });
  }, [file]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onCancel]);

  const git = info?.git;
  const warnings: string[] = [];
  if (git?.isRepo && mode === 'ref') {
    if (git.fileChanged) warnings.push('This file has changes that are not committed. The run uses the committed version.');
    if (!git.upstream) warnings.push(`Branch ${git.branch} has no upstream. EAS may not find this commit.`);
    else if (git.ahead) warnings.push(`${git.ahead} commit${git.ahead === 1 ? ' is' : 's are'} not pushed to ${git.upstream}. EAS may not find this commit.`);
  }

  return (
    <div className="wf-overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="wf-dialog" role="dialog" aria-modal="true" aria-labelledby="run-title">
        <header className="wf-dialog-header">
          <h2 id="run-title">Run workflow</h2>
          <button className="wf-icon-button" onClick={onCancel} aria-label="Close"><X {...ICON_PROPS} /></button>
        </header>
        <p className="wf-dialog-file">{file}</p>
        {!info ? (
          <p className="wf-muted">Checking git status…</p>
        ) : (
          <div className="wf-options">
            {git?.isRepo && (
              <label className={`wf-option${mode === 'ref' ? ' is-active' : ''}`}>
                <input type="radio" name="mode" checked={mode === 'ref'} onChange={() => setMode('ref')} />
                <div>
                  <div className="wf-option-title">Committed version on <code>{git.branch}</code> <span className="wf-muted">({git.head})</span></div>
                  <div className="wf-muted">Runs <code>--ref {git.branch}</code>. Nothing is uploaded from your machine.</div>
                </div>
              </label>
            )}
            <label className={`wf-option${mode === 'local' ? ' is-active' : ''}`}>
              <input type="radio" name="mode" checked={mode === 'local'} onChange={() => setMode('local')} />
              <div>
                <div className="wf-option-title">Local folder, as it is on disk</div>
                <div className="wf-muted">Packages and uploads <code>{info.projectDir}</code> to EAS, including uncommitted files.</div>
              </div>
            </label>
            {warnings.map((w) => <p key={w} className="wf-warning">{w}</p>)}
          </div>
        )}
        <footer className="wf-dialog-footer">
          <span className="wf-muted">Starts a real run on EAS. It uses your <code>eas login</code>.</span>
          <button className="wf-button wf-button-lg" onClick={onCancel}>Cancel</button>
          <button className="wf-button wf-button-lg wf-button-primary" disabled={!info} onClick={() => onRun(mode === 'ref' ? git!.branch! : null)}>
            Run workflow
          </button>
        </footer>
      </div>
    </div>
  );
}

/** The last eas command and its output. */
export function EasResultBox({ result, onClose }: { result: EasResult | 'busy'; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  // Show eas-cli's full output by default only when there is no short summary.
  useEffect(() => setOpen(result !== 'busy' && !result.ok && !result.summary?.length), [result]);
  if (result === 'busy') {
    return (
      <div className="wf-result">
        <LoaderCircle {...ICON_PROPS} className="wf-spin wf-icon-secondary" />
        <span>Running eas…</span>
      </div>
    );
  }
  const title = result.action === 'validate'
    ? (result.ok ? 'Workflow is valid' : 'Validation failed')
    : (result.ok ? 'Workflow run started' : 'Run failed');
  return (
    <div className={`wf-result${result.ok ? '' : ' is-error'}`}>
      <div className="wf-result-row">
        {result.ok ? <CircleCheck {...ICON_PROPS} className="wf-text-success" /> : <CircleX {...ICON_PROPS} className="wf-text-danger" />}
        <span className="wf-result-title">{title}</span>
        {result.version && <span className="wf-muted">{result.version}</span>}
        {result.url && (
          <a className="wf-link" href={result.url} target="_blank" rel="noreferrer">
            Open on expo.dev <ExternalLink {...ICON_PROPS} size={14} />
          </a>
        )}
        <button className="wf-disclosure" onClick={() => setOpen(!open)}>
          {open ? <ChevronDown {...ICON_PROPS} size={14} /> : <ChevronRight {...ICON_PROPS} size={14} />}
          <code>{result.command}</code>
        </button>
        <button className="wf-icon-button" onClick={onClose} aria-label="Dismiss"><X {...ICON_PROPS} /></button>
      </div>
      {!result.ok && !!result.summary?.length && (
        <ul className="wf-result-summary">
          {result.summary.map((line) => <li key={line}><Code text={line} /></li>)}
        </ul>
      )}
      {open && <pre className="wf-code wf-result-output">{result.output || '(no output)'}</pre>}
    </div>
  );
}

/** Renders `backticked` parts of a line as code. */
function Code({ text }: { text: string }) {
  return <>{text.split(/(`[^`]+`)/).map((part, i) => (part.startsWith('`') ? <code key={i}>{part.slice(1, -1)}</code> : part))}</>;
}
