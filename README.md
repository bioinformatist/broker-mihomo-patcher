# Broker Mihomo Patcher

A self-hosted Cloudflare Worker that patches a Mihomo/Clash YAML subscription
with broker routing rules and returns a stable subscription URL.

![Supports Futu / Moomoo](https://img.shields.io/badge/supports-Futu%20%2F%20Moomoo-2ea44f)
![Supports Longbridge](https://img.shields.io/badge/supports-Longbridge-2ea44f)

> [!WARNING]
> This tool is only intended to help legal professional investors outside
> mainland China resolve unstable broker app access while temporarily located in
> mainland China. Any misuse by existing mainland China investors is illegal.
> Please do not promote or guide others to use this project for improper
> purposes. If misuse is found, the author will immediately stop maintenance or
> even delete this repository.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/bioinformatist/broker-mihomo-patcher)

Click the button above to create your own copy of this Worker, then finish the
deployment from GitHub Actions:

1. Create a Cloudflare API token:
   `Cloudflare dashboard -> Manage Account -> Account API Tokens -> Create Token`.
   Under `Permission policies`, open `Custom` and choose
   `Edit Cloudflare Workers`. Scope the token to the Cloudflare account where
   this Worker will be deployed. Copy the account ID and token value shown by
   Cloudflare; the token is only shown once.
2. Add the values to GitHub:
   `your new GitHub repository -> Settings -> Secrets and variables -> Actions -> Secrets -> New repository secret`.
   Create exactly these two repository secrets:
   - `CLOUDFLARE_ACCOUNT_ID`: the account ID from step 1.
   - `CLOUDFLARE_API_TOKEN`: the API token from step 1.
3. Deploy:
   `GitHub repository -> Actions -> Deploy Worker -> Run workflow`.

Do not commit the account ID or API token to the repository.

## Who This Is For

This project is useful if you already have a Mihomo/Clash YAML subscription,
already use a compatible client such as CMFA, Clash Verge, or Mihomo, and want
to keep your original subscription URL inside your own Cloudflare account.

It is not a hosted service. It is not meant for people who want to use someone
else's Worker, share subscription links publicly, or bypass the legal limits
that apply to them.

## What It Does

1. You deploy this Worker to your own Cloudflare account.
2. You open the deployed Worker URL.
3. You enter your original Mihomo/Clash subscription URL.
4. You select the supported broker apps you need.
5. The Worker gives you a new subscription URL to import into your client.

The Worker keeps a patched copy of the subscription in your own Cloudflare KV.
Clients normally receive that cached copy. The Worker only refreshes the
original subscription after the cache window expires. The current cache window
is 24 hours. If the refresh fails, the Worker returns the last cached copy so
your client does not immediately break.

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
- broker apps to enable;
- target policy group. Keep the default unless you know which policy group your
  client should use.

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

## Management Link Recovery

If you lose the management link and also clear browser storage, v1 cannot prove
that you are the owner from the web page alone.

To start over, open your Cloudflare dashboard, find the KV namespace bound to
this Worker, delete `profile:v1` and `subscription-cache:v1`, then open the
Worker URL again and configure it from scratch.

## Known Issues

- **A regenerated subscription URL may not take effect everywhere immediately.**
  Cloudflare KV is eventually consistent, so the old URL may continue to work
  briefly in some regions.
- **The first setup page is open until the Worker is configured.** Configure the
  Worker soon after deployment. If someone else configures it first, delete
  `profile:v1` and `subscription-cache:v1` from Cloudflare KV, wait briefly, and
  configure it again.
- **The 24-hour cache is not a perfect global lock.** If multiple clients or
  Cloudflare regions refresh right after the cache expires, the Worker may ask
  the upstream provider more than once.
- **Some clients may only test whether the URL exists.** A successful URL check
  does not prove that the next full subscription refresh can reach the upstream
  provider.
