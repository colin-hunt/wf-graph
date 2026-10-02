# Contributing

Bug reports and pull requests are welcome.

## Set up

```sh
npm install        # also builds dist/
npm test           # needs network once, to fetch the live EAS schema
npm run typecheck
npm run dev        # UI with hot reload; run `node dist/cli.js <path> --no-open` beside it
```

## Pull requests

- Keep each pull request to one change.
- Add or update a test when you change parsing, schema handling, or eas-cli calls.
- `npm test` and `npm run typecheck` must pass. CI runs them on Node 20, 22, and 24.
- Test fixtures must be workflows you wrote yourself. Do not copy workflow files from other projects.

## If EAS adds a job type

The schema test fails until `src/ui/icons.tsx` has an icon for the new type. Pick one from [Lucide](https://lucide.dev).

## Security

The server listens on `127.0.0.1` and writes to workflow files. If you find a way for another website or process to read or write files through it, please report it privately through GitHub's **Report a vulnerability** button on the Security tab, not in a public issue.
