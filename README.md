# Broker Mihomo Patcher

A self-hosted Cloudflare Worker that patches a Mihomo/Clash YAML subscription
with broker routing rules and returns a stable subscription URL.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/bioinformatist/broker-mihomo-patcher)

## What It Does

1. You deploy this Worker to your own Cloudflare account.
2. You open the deployed Worker URL.
3. You enter your original Mihomo/Clash subscription URL.
4. You select broker rule packs, currently Futu/Moomoo and Longbridge.
5. The Worker gives you a new subscription URL to import into your client.

When your client refreshes the generated URL, the Worker fetches your upstream
subscription, injects broker `DOMAIN-SUFFIX` rules, and returns patched YAML.

## Privacy Boundary

Your original subscription URL is stored in your own Cloudflare KV namespace and
does not appear in the generated subscription URL.

The Worker must still read the upstream subscription URL at runtime in order to
patch it. If you do not want any third-party service to see that URL, deploy this
project to your own Cloudflare account rather than using someone else's Worker.

## Usage

After deployment, open your Worker URL, for example:

```text
https://broker-mihomo-patcher.<your-subdomain>.workers.dev
```

The first page asks for:

- upstream Mihomo/Clash YAML subscription URL;
- broker rule packs to enable;
- target policy group, defaulting to `PROXY` when available.

Save the generated links:

- subscription URL: import this into CMFA, Clash Verge, Mihomo, or another
  compatible client;
- management link: use this private link later to change the upstream URL or
  broker selection.

The same browser also stores the management token in `localStorage`.

## GitHub Actions Deployment

This repo includes two workflows:

- `Check`: runs tests, typecheck, and a Wrangler dry-run on pushes and pull
  requests.
- `Deploy Worker`: manually deploys the Worker from GitHub Actions.

Before running `Deploy Worker`, add these repository secrets in GitHub:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

Create the API token in Cloudflare with permission to edit Workers. Do not commit
the token to this repository.

## Management Link Recovery

If you lose the management link and clear browser storage, v1 has no password
recovery flow. Open Cloudflare KV, delete the `profile:v1` key, then open the
Worker URL and configure it again.

## Rule Packs

Futu/Moomoo:

- `moomoo.com`
- `futuhn.com`
- `futustatic.com`
- `futunn.com`

Longbridge:

- `longbridge.com`
- `longbridge.sg`
- `lbctrl.com`
- `lbkrs.com`

Rules are injected at the top of the YAML `rules` list:

```text
DOMAIN-SUFFIX,<domain>,<targetPolicy>
```

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
