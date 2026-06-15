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
