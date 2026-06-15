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

The Worker caches patched YAML in your Cloudflare KV namespace. When your
client refreshes the generated URL, the Worker returns the cached subscription
when it is fresh and only refreshes the upstream subscription after the cache
window expires. The current cache window is 24 hours. If the cache is expired
but the upstream refresh fails, the Worker returns the stale cached subscription
instead of breaking the client refresh.

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
  broker selection, or regenerate the subscription URL if it leaks.

The same browser also stores the management token in `localStorage`.
Browser storage is scoped to the current origin. If you configured the Worker
on `workers.dev` and later open it through a Custom Domain, paste the management
link or management token on the locked page once. Subscription URLs shown by the
UI use the origin you are currently visiting.

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
recovery flow. Open Cloudflare KV, delete `profile:v1` and
`subscription-cache:v1`, then open the Worker URL and configure it again.

## Known Issues

Cloudflare KV is eventually consistent across regions. Regenerating the
subscription URL updates `profile:v1`, but an old subscription URL may continue
to work briefly until the KV update reaches the region serving that request.

The first setup and upstream check are public until `profile:v1` exists.
Configure the Worker soon after deployment. If someone else configures it first,
delete `profile:v1` and `subscription-cache:v1` from Cloudflare KV, wait briefly
for KV propagation, then configure it again.

The 24-hour cache window is not a strict global lock. If multiple regions or
clients refresh right after the cache expires, the Worker may make more than one
upstream request before KV propagation settles.

`HEAD /sub/<token>` is only a token-validity probe. It does not fetch the
upstream subscription, so a successful `HEAD` response does not guarantee that a
later `GET` can refresh the upstream subscription successfully.

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

See [Architecture Notes](docs/architecture.md) for the Worker boundary,
subscription-client compatibility findings, and caching behavior.
