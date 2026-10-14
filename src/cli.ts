import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { delimiter, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { watch } from 'chokidar';
import open from 'open';
import { loadSchema } from './core/live-schema';
import { explainJobErrors } from './explain';
import type { Schema } from './core/schemas';

const HELP = `Usage: wf-graph [path] [options]

Shows a live-reloading graph of EAS workflow files in your browser.

  path            A workflow .yml/.yaml file, or a folder of them.
                  Default: the nearest .eas/workflows, from this folder up.

Options:
  -p, --port <n>  Port to use (default 4321)
      --no-open   Do not open the browser
  -h, --help      Show this help
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: 'string', short: 'p', default: '4321' },
    'no-open': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  process.stdout.write(HELP);
  process.exit(0);
}

const isWorkflowFile = (p: string) => /\.ya?ml$/i.test(p);
const isDir = (p: string) => existsSync(p) && statSync(p).isDirectory();

/** Walks up from `start` to the first `.eas/workflows` folder. */
function findWorkflowsDir(start: string): string | null {
  for (let dir = start; ; dir = dirname(dir)) {
    const candidate = join(dir, '.eas', 'workflows');
    if (isDir(candidate)) return candidate;
    if (dirname(dir) === dir) return null;
  }
}

const found = positionals[0] ? resolve(positionals[0]) : findWorkflowsDir(process.cwd());
if (!found) {
  console.error(`No .eas/workflows folder found in ${process.cwd()} or any parent folder.`);
  console.error('Run this inside an Expo project, or pass a path: `wf-graph path/to/workflow.yml`.');
  process.exit(1);
}
if (!existsSync(found)) {
  console.error(`Not found: ${found}`);
  process.exit(1);
}
/** A workflow file, or a folder of them. */
const target = found;
/** File names in the UI are relative to this folder. */
const baseDir = isDir(target) ? target : dirname(target);
const toName = (abs: string) => relative(baseDir, abs).split(sep).join('/');

function listFiles(): string[] {
  if (!isDir(target)) return [toName(target)];
  return readdirSync(target, { recursive: true, encoding: 'utf8' })
    .filter((f) => isWorkflowFile(f) && !f.split(sep).includes('node_modules'))
    .map((f) => toName(join(target, f)))
    .sort();
}

/** The Expo project folder: the parent of `.eas`. Validate and Run need it. */
function easProjectDir(abs: string): string | null {
  const parts = abs.split(sep);
  const i = parts.lastIndexOf('.eas');
  return i > 0 ? parts.slice(0, i).join(sep) : null;
}
const projectDir = easProjectDir(baseDir);

/**
 * The live EAS schema, so autocomplete matches what EAS accepts today. Offline,
 * the last copy fetched on this computer. Without either, the graph still works.
 */
const schemaPromise = loadSchema();

const etag = (text: string) => `"${createHash('sha1').update(text).digest('hex')}"`;

const uiDir = join(dirname(fileURLToPath(import.meta.url)), 'ui');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

const clients = new Set<ServerResponse>();
function broadcast(event: string, data: unknown) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

function send(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(body);
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        fail(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
    req.on('error', fail);
  });
}


/** Checks a request that changes something (save, validate, run). Returns an error, or null. */
function refuseWrite(req: IncomingMessage, host: string): string | null {
  // A custom header forces a CORS preflight, which this server never approves,
  // so other websites cannot send this request from your browser.
  if (req.headers['x-wf-graph'] !== '1') return 'Missing X-WF-Graph header';
  const origin = req.headers.origin;
  const bare = (h: string) => h.replace(/^\[|\]$/g, '');
  if (origin && bare(new URL(origin).hostname) !== bare(host)) return 'Cross-origin request refused';
  return null;
}

/** The eas-cli command: `eas` on PATH, else npx. */
function easCommand(): string[] {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir && existsSync(join(dir, 'eas'))) return [join(dir, 'eas')];
  }
  return ['npx', '--yes', 'eas-cli@latest'];
}

let easBusy = false;

/**
 * Workaround for https://github.com/expo/eas-cli/issues/4482: `eas workflow:validate`
 * reads `properties.type.const` on every job entry in the schema and crashes on the
 * `uses:` entry, which has no `type`. That entry forbids extra keys, so adding
 * `type: { not: {} }` accepts exactly the same files. eas-cli loads a schema file
 * from EXPO_TESTING_WORKFLOW_SCHEMA_PATH. Returns null when no patch is needed.
 */
let patchedSchemaPath: Promise<string | null> | undefined;
function getPatchedSchemaPath() {
  patchedSchemaPath ??= schemaPromise.then(({ schema }) => {
    if (!schema) return null;
    const variants: Schema[] = schema.properties?.jobs?.additionalProperties?.anyOf ?? [];
    if (variants.every((v) => v.properties?.type)) return null;
    const patched = structuredClone(schema);
    for (const v of patched.properties.jobs.additionalProperties.anyOf) {
      if (!v.properties.type) v.properties.type = { not: {} };
    }
    const file = join(mkdtempSync(join(tmpdir(), 'wf-graph-')), 'schema.json');
    writeFileSync(file, JSON.stringify({ data: patched }));
    return file;
  });
  return patchedSchemaPath;
}
let easVersion: Promise<string> | undefined;
/** For example `eas-cli/24.7.0`. Shown next to each result, since behaviour differs across versions. */
function getEasVersion(cwd: string) {
  easVersion ??= runEas(['--version'], cwd, 60_000).then((o) => o.stdout.trim().split(' ')[0] || 'unknown');
  return easVersion;
}

function runEas(args: string[], cwd: string, timeoutMs: number, env: Record<string, string> = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  const [cmd, ...pre] = easCommand();
  return new Promise((ok) => {
    // stdin must be closed: `eas workflow:run` reads inputs from stdin until it ends
    // when stdin is not a TTY, so an open pipe makes it wait until the timeout.
    const child = spawn(cmd, [...pre, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      ok({ code: 1, stdout, stderr: `${stderr}${err.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const clean = (t: string) => t.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '');
      ok({ code: code ?? 1, stdout: clean(stdout), stderr: clean(stderr) });
    });
  });
}

function git(args: string[], cwd: string): Promise<string | null> {
  return new Promise((ok) => execFile('git', args, { cwd }, (err, out) => ok(err ? null : out.trim())));
}

/** What the Run dialog needs to know about the file and the branch. */
async function gitInfo(abs: string, projectDir: string) {
  const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], projectDir);
  if (branch == null) return { isRepo: false };
  const [head, fileStatus, upstream] = await Promise.all([
    git(['rev-parse', '--short', 'HEAD'], projectDir),
    git(['status', '--porcelain', '--', abs], projectDir),
    git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], projectDir),
  ]);
  const ahead = upstream ? Number(await git(['rev-list', '--count', '@{upstream}..HEAD'], projectDir)) : null;
  return { isRepo: true, branch, head, fileChanged: !!fileStatus, upstream, ahead };
}

function json(res: ServerResponse, status: number, body: unknown) {
  send(res, status, JSON.stringify(body), { 'content-type': 'application/json' });
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  // Only answer requests addressed to localhost. This blocks DNS-rebinding
  // pages from reading or writing your workflow files through this server.
  const host = (req.headers.host ?? '').replace(/:\d+$/, '');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return send(res, 403, 'Forbidden');

  const url = new URL(req.url ?? '/', 'http://localhost');

  if (url.pathname === '/api/schema') {
    return json(res, 200, await schemaPromise);
  }

  if (url.pathname === '/api/files') {
    const body = JSON.stringify({ root: baseDir, files: listFiles(), canRun: projectDir != null });
    return send(res, 200, body, { 'content-type': 'application/json' });
  }

  if (url.pathname === '/api/file') {
    const name = url.searchParams.get('name') ?? '';
    // Only names that listFiles() returns, so no path outside the target is reachable.
    if (!listFiles().includes(name)) return send(res, 404, 'Unknown workflow file');
    const abs = join(baseDir, name);

    if (req.method === 'GET') {
      const text = readFileSync(abs, 'utf8');
      return send(res, 200, text, { etag: etag(text) });
    }

    if (req.method === 'PUT') {
      const refused = refuseWrite(req, host);
      if (refused) return send(res, 403, refused);
      const current = readFileSync(abs, 'utf8');
      if (req.headers['if-match'] !== etag(current)) {
        return send(res, 409, 'The file changed on disk since you opened it.', { etag: etag(current) });
      }
      let text: string;
      try {
        text = await readBody(req, 1024 * 1024);
      } catch {
        return send(res, 413, 'File too large');
      }
      writeFileSync(abs, text);
      return send(res, 200, 'Saved', { etag: etag(text) });
    }
    return send(res, 405, 'Method not allowed');
  }


  if (url.pathname.startsWith('/api/eas/')) {
    const name = url.searchParams.get('name') ?? '';
    if (!listFiles().includes(name)) return send(res, 404, 'Unknown workflow file');
    const abs = join(baseDir, name);
    if (!projectDir) return send(res, 400, 'Validate and Run need a file inside an Expo project (in .eas/workflows).');
    const action = url.pathname.slice('/api/eas/'.length);

    if (action === 'info' && req.method === 'GET') {
      return json(res, 200, { projectDir: relative(baseDir, projectDir) || '.', git: await gitInfo(abs, projectDir) });
    }
    if (req.method !== 'POST' || (action !== 'validate' && action !== 'run')) return send(res, 404, 'Not found');
    const refused = refuseWrite(req, host);
    if (refused) return send(res, 403, refused);
    if (easBusy) return send(res, 409, 'Another eas command is still running.');

    // eas-cli joins the path onto the project folder and onto the working
    // directory, even when it is absolute. So pass it relative to the project,
    // and run eas from the project folder. scripts/check-eas-cli.mjs checks this.
    const file = relative(projectDir, abs).split(sep).join('/');
    let args: string[];
    if (action === 'validate') {
      args = ['workflow:validate', file, '--non-interactive'];
    } else {
      let body: { ref?: string };
      try {
        body = JSON.parse((await readBody(req, 4096)) || '{}');
      } catch {
        return send(res, 400, 'Bad request body');
      }
      args = ['workflow:run', file, '--non-interactive', '--json'];
      if (body.ref != null) {
        // A branch, tag, or commit. Never a flag.
        if (!/^[\w][\w./@{}^~-]*$/.test(body.ref)) return send(res, 400, 'Invalid git ref');
        args.push('--ref', body.ref);
      }
    }
    easBusy = true;
    try {
      const schemaPath = action === 'validate' ? await getPatchedSchemaPath() : null;
      const env: Record<string, string> = schemaPath ? { EXPO_TESTING_WORKFLOW_SCHEMA_PATH: schemaPath } : {};
      const out = await runEas(args, projectDir, action === 'validate' ? 120_000 : 600_000, env);
      let result: unknown;
      if (action === 'run') {
        try {
          result = JSON.parse(out.stdout.slice(out.stdout.indexOf('{')));
        } catch {
          result = undefined;
        }
      }
      const output = `${out.stdout}${out.stderr}`.trim();
      // eas workflow:validate can exit 0 on failure, so also require its success line.
      // scripts/check-eas-cli.mjs checks in CI that eas-cli still prints it, and that --json still gives `url`.
      const ok = out.code === 0 && (action === 'run' ? result != null : /Workflow configuration YAML is valid/.test(output));
      // Short per-job summary of a failed validation; eas-cli's own output repeats each problem per job type.
      const { schema } = await schemaPromise;
      const summary = action === 'validate' && !ok && schema && /\/jobs\//.test(output)
        ? explainJobErrors(readFileSync(abs, 'utf8'), schema)
        : [];
      return json(res, 200, { ok, version: await getEasVersion(projectDir), command: `eas ${args.join(' ')}`, output, summary, result });
    } finally {
      easBusy = false;
    }
  }

  if (url.pathname === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write('retry: 1000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  const file = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const full = resolve(uiDir, file);
  if (!full.startsWith(uiDir + sep) || !existsSync(full) || !statSync(full).isFile()) return send(res, 404, 'Not found');
  res.writeHead(200, { 'content-type': MIME[extname(full)] ?? 'application/octet-stream' });
  createReadStream(full).pipe(res);
}

const watcher = watch(target, {
  ignoreInitial: true,
  ignored: (p) => p.includes(`${sep}node_modules`),
  awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 20 },
});
watcher.on('all', (event, path) => {
  if (!isWorkflowFile(path)) return;
  if (event === 'add' || event === 'unlink') broadcast('files', listFiles());
  broadcast('change', { name: toName(path), event });
});

// Keep SSE connections open through idle timeouts.
setInterval(() => broadcast('ping', {}), 25_000).unref();

const server = createServer((req, res) => {
  handle(req, res).catch((err) => send(res, 500, String(err)));
});
const port = Number(values.port);
server.on('error', (err: NodeJS.ErrnoException) => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${port} is in use. Pass another one with --port.` : err.message);
  process.exit(1);
});
server.on('listening', () => {
  const files = listFiles();
  const link = `http://localhost:${port}/${files.length === 1 ? `?file=${encodeURIComponent(files[0])}` : ''}`;
  console.log(`wf-graph: watching ${relative(process.cwd(), target) || '.'}`);
  console.log(`Open ${link}  (Ctrl+C to stop)`);
  schemaPromise.then((s) => {
    if (s.source === 'cached') console.log(`Could not fetch the live EAS schema (${s.error}). Using the copy from ${s.fetchedAt}.`);
    if (s.source === 'none') console.log(`Could not fetch the live EAS schema (${s.error}). Autocomplete and schema errors are off.`);
  });
  if (!values['no-open']) open(link).catch(() => {});
});
server.listen(port, '127.0.0.1');
