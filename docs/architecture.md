# Architecture Notes

Broker Mihomo Patcher is a user-owned Cloudflare Worker. Its main boundary is:

```text
subscription client -> Worker custom domain -> upstream subscription provider
```

The custom domain only changes the first hop. The upstream provider still sees
the Worker as the requester when the Worker refreshes the original subscription.

## Runtime Flow

1. The user configures an upstream Mihomo/Clash YAML subscription URL in the
   Worker UI.
2. The Worker stores that upstream URL and rule-pack choices in Cloudflare KV.
3. The generated `/sub/<token>` URL is imported into CMFA, Clash Verge, Mihomo,
   or another compatible client.
4. `GET /sub/<token>` validates the token, fetches the upstream YAML, injects
   broker rules, and returns patched YAML.
5. `HEAD /sub/<token>` validates the token and returns subscription headers
   without fetching the upstream subscription.

The current implementation deliberately keeps the subscription token separate
from the management token. The subscription token is a bearer URL for clients;
the management token is used only by the UI/API to update the stored profile.

## Client Compatibility Findings

CMFA fetches HTTP subscriptions with a `User-Agent` shaped like:

```text
ClashMetaForAndroid/<version>
```

CMFA also reads these response headers when available:

- `subscription-userinfo`: usage and expiry metadata, parsed as fields such as
  `upload`, `download`, `total`, and `expire`.
- `profile-update-interval`: auto-update interval in hours.

Relevant upstream references:

- <https://github.com/MetaCubeX/ClashMetaForAndroid/blob/8a0e818272b92382b3d2ae61b29911653b9801cb/core/src/main/golang/native/config/fetch.go>
- <https://github.com/MetaCubeX/mihomo/blob/Alpha/adapter/provider/subscription_info.go>
- <https://github.com/MetaCubeX/ClashMetaForAndroid/pull/757>

Cloudflare Workers can construct outbound requests with custom headers and can
read/modify response headers:

- <https://developers.cloudflare.com/workers/examples/modify-request-property/>
- <https://developers.cloudflare.com/workers/runtime-apis/request/>

## Design Direction

The primary risk is not YAML patching or custom-domain routing. The more likely
provider-facing risk is repeated upstream refreshes from Cloudflare addresses.

Preferred mitigation order:

1. Cache the patched subscription and refresh upstream on a controlled schedule.
2. Return compatible subscription metadata headers from cached metadata.
3. Use a subscription-client-like `User-Agent` for Worker-to-upstream requests.
4. Support `HEAD /sub/<token>` as a no-upstream-fetch compatibility probe.
5. Add subscription token rotation for leak recovery.

Avoid forwarding arbitrary request or response headers. Only preserve headers
with known subscription-client semantics.
