// Checks that the latest eas-cli still behaves the way src/cli.ts expects.
// wf-graph reads eas-cli's output, so a change here breaks Validate or Run
// without any other error. Exits 1 if a check fails.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const version = process.argv[2] ?? execFileSync('npm', ['view', 'eas-cli', 'version'], { encoding: 'utf8' }).trim();
const dir = mkdtempSync(join(tmpdir(), 'eas-cli-'));
let failed = false;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`);
  if (!ok) failed = true;
};

try {
  console.log(`eas-cli ${version}\n`);
  execFileSync('npm', ['pack', `eas-cli@${version}`, '--pack-destination', dir, '--silent'], { stdio: 'ignore' });
  execFileSync('tar', ['-xzf', join(dir, `eas-cli-${version}.tgz`), '-C', dir]);
  const src = (f) => readFileSync(join(dir, 'package', 'build', 'commands', 'workflow', f), 'utf8');

  // src/cli.ts treats validation as passed only if the output has this line,
  // because `eas workflow:validate` exits 0 even when validation fails.
  check(src('validate.js').includes('Workflow configuration YAML is valid'), 'workflow:validate prints "Workflow configuration YAML is valid" on success');

  // src/cli.ts passes the workflow path relative to the project and runs eas
  // from the project folder, because eas-cli joins the path onto both.
  const workflowFile = readFileSync(join(dir, 'package', 'build', 'utils', 'workflowFile.js'), 'utf8');
  check(workflowFile.includes('path_1.default.join(process.cwd(), filePath)'), 'workflow file path is resolved from the working directory');

  // src/cli.ts patches the schema for eas-cli issue #4482 through this variable.
  // If eas-cli drops it, Validate crashes again on the current schema.
  const validation = readFileSync(join(dir, 'package', 'build', 'commandUtils', 'workflow', 'validation.js'), 'utf8');
  check(validation.includes('EXPO_TESTING_WORKFLOW_SCHEMA_PATH'), 'workflow:validate still reads EXPO_TESTING_WORKFLOW_SCHEMA_PATH');
  if (!validation.includes('props.properties.type.const')) {
    console.log('note  eas-cli no longer reads `properties.type.const` directly. Issue #4482 may be fixed: the schema patch in src/cli.ts may be removable.');
  }

  // The Run button reads `url` from `workflow:run --json`.
  check(/printJsonOnlyOutput\)\(\{\s*id: workflowRunId,\s*url:/.test(src('run.js')), 'workflow:run --json prints { id, url }');

  const help = (cmd) => execFileSync('npx', ['--yes', `eas-cli@${version}`, cmd, '--help'], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  const runHelp = help('workflow:run');
  for (const flag of ['--ref', '--json', '--non-interactive']) check(runHelp.includes(flag), `workflow:run has ${flag}`);
  check(help('workflow:validate').includes('--non-interactive'), 'workflow:validate has --non-interactive');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failed) {
  console.log('\neas-cli changed. Update src/cli.ts (the /api/eas/ routes) to match, then this script.');
  process.exit(1);
}
