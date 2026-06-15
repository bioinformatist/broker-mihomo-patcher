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
2. The Worker stores that upstream URL and rule-pack choices in `profile:v1`.
3. The generated `/sub/<token>` URL is imported into CMFA, Clash Verge, Mihomo,
   or another compatible client.
4. Setup and profile updates fetch the upstream YAML, inject broker rules, and
   cache the patched YAML plus subscription metadata headers in
   `subscription-cache:v1`.
5. `GET /sub/<token>` validates the token and returns fresh cached YAML. If the
   cache is expired, it refreshes the upstream subscription and updates the
   cache key before responding. It does not rewrite `profile:v1`.
6. If an expired cache exists and upstream refresh fails, the Worker returns the
   stale cache instead of breaking the client refresh.
7. `HEAD /sub/<token>` validates the token and returns subscription headers
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

The Worker currently normalizes `profile-update-interval` to at least 24 hours
and uses the same 24-hour window for its upstream refresh cache. This is a cache
freshness window, not a strict global lock across Cloudflare regions.

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

Implemented mitigation order:

1. Cache the patched subscription and refresh upstream after a 24-hour cache window.
2. Return compatible subscription metadata headers from cached metadata.
3. Use a subscription-client-like `User-Agent` for Worker-to-upstream requests.
4. Support `HEAD /sub/<token>` as a no-upstream-fetch compatibility probe.
5. Add subscription token rotation for leak recovery.

Avoid forwarding arbitrary request or response headers. Only preserve headers
with known subscription-client semantics.
