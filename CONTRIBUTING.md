# Contributing

## Development

Install dependencies:

```sh
npm install
```

Run checks:

```sh
npm test
npm run typecheck
```

Start a local Worker:

```sh
npm run dev
```

The repository also includes these GitHub Actions workflows:

- `Check`: runs tests, typecheck, and a Wrangler dry-run on pushes and pull
  requests.
- `Deploy Worker`: manually deploys the Worker from GitHub Actions.

## Contribution License

By submitting a contribution, you agree to license your contribution under the
project license and grant the maintainer the right to relicense it for
commercial use.
