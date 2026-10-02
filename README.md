# wf-graph

A local, live-reloading graph and editor for EAS workflow files (`.eas/workflows`). The graph uses the same visual style as the workflow graph on expo.dev.

> Early release (0.1). Not an official Expo product. The **Run workflow** button starts real EAS jobs, which can use your EAS build credits. It has not yet been tested end to end on a real project.

## Install

Needs Node.js 20.19 or later.

```sh
npx wf-graph                     # after the first npm release
```

From source:

```sh
git clone https://github.com/colin-hunt/wf-graph.git
cd wf-graph
npm install   # also builds dist/
npm link      # adds the `wf-graph` command
```

## Run

```sh
cd any/folder/in/your/project
wf-graph                         # finds the nearest .eas/workflows, from this folder up
wf-graph path/to/workflow.yml    # one file, or pass a folder
wf-graph --port 5000 --no-open   # default port 4321
```

## Features

- **Graph.** One node per job, left to right from the trigger. Solid edge: `needs` / `after`. Dashed edge and branch icon: the job has `if:` (hover the icon for the condition). Red icon: a problem (missing job, cycle, unknown `type`), also listed above the graph.
- **Live reload.** Save the file in any editor and the graph updates. A YAML syntax error keeps the last valid graph on screen.
- **Job panel.** Click a job: its YAML exactly as written, in an editor. Save (⌘S) writes back only that job's lines. Click the trigger to edit `on:`.
- **Workflow file tab.** Edit the whole file.
- **Schema help.** Autocomplete, hover docs, and error underlines from the EAS workflow schema, fetched live from `api.expo.dev/v2/workflows/schema` when wf-graph starts (the same one `eas workflow:validate` uses). wf-graph keeps the last copy in your cache folder (`~/Library/Caches/wf-graph` on macOS, `$XDG_CACHE_HOME/wf-graph` or `~/.cache/wf-graph` on Linux) and uses it when offline. With no network and no saved copy, the graph and editors still work, without schema help. Suggestions follow the job `type`.
- **Validate (EAS).** Runs `eas workflow:validate <file>` in the project and shows the result and the eas-cli version. On failure it shows one line per problem per job (eas-cli repeats each problem once per job type), with eas-cli's full output one click away. This sends the file to EAS and needs `eas login`. Uses `eas` on your `PATH`, else `npx eas-cli`. Works around [eas-cli#4482](https://github.com/expo/eas-cli/issues/4482), which makes plain `eas workflow:validate` crash on every file with the current schema.
- **Run workflow (EAS).** Runs `eas workflow:run <file>` after a confirmation dialog, then links to the run on expo.dev. Default: the committed version on the current branch (`--ref`, nothing uploaded). It warns about uncommitted changes to the file and unpushed commits. Other choice: the local folder, which uploads the project folder.
- **Safe saves.** A save is refused if the file changed on disk after you started editing.
- **Local only.** The server listens on `127.0.0.1` and only answers `localhost`. It reads and writes only the workflow files it found, and it refuses writes that come from other websites.

## Develop

```sh
npm test               # vitest; needs network once, to fetch the live EAS schema
npm run typecheck
npm run build          # UI -> dist/ui (Vite), CLI -> dist/cli.js (tsup)
npm run check-eas-cli  # check the latest eas-cli still has the output and flags wf-graph uses
```

| Path | What |
| --- | --- |
| `src/cli.ts` | Folder discovery, HTTP server, file watcher, Server-Sent Events, saves, eas-cli calls |
| `src/core/parse.ts` | YAML to jobs with raw text, line ranges, and diagnostics |
| `src/core/live-schema.ts` | Fetches the EAS schema, with an offline cache |
| `src/ui/` | React + React Flow + CodeMirror. `icons.tsx` maps each EAS job type to an icon |

Release: `npm version patch && git push --follow-tags`. The first publish is manual (`npm publish --access public`). After it, add the repo as a trusted publisher on npmjs.com.

## Drift guards

| What could change | Guard |
| --- | --- |
| EAS schema (fields, job types, options) | Fetched live at start-up. The tests also use the live schema, on every CI build and weekly in `drift.yml`. |
| New or removed job type | Test fails until `src/ui/icons.tsx` matches. A new type shows a generic icon meanwhile. |
| Keys the graph uses (`needs`, `after`, `if`, `type`/`steps`/`uses`) | Test on the schema. |
| Editor validator vs eas-cli's (json-schema-library vs ajv) | Test: both must agree on 16 valid and invalid cases. |
| eas-cli output, flags, and path handling (validate success line, `run --json` `url`, `--ref`, project-relative paths, the #4482 workaround) | `npm run check-eas-cli`, weekly in `drift.yml`. A failed scheduled run emails you. It also says when #4482 looks fixed. |

## Credits

Theme tokens: `@expo/styleguide` (MIT), vendored in `src/ui/vendor/`. Colors: Radix Colors (MIT). Icons: Lucide (ISC); Expo's icon package is not open source, so it is not used. Font: Inter (OFL).

wf-graph is not an official Expo product and Expo does not endorse it. "Expo" and "EAS" name the Expo products that wf-graph works with.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). License: [MIT](LICENSE).
