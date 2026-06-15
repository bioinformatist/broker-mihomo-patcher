import { beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import worker from "../src/index";

const UPSTREAM_URL = "https://example.com/sub.yaml";
const PROFILE_KEY = "profile:v1";
const SUBSCRIPTION_CACHE_KEY = "subscription-cache:v1";
const UPSTREAM_CONFIG = `
proxies:
  - name: node-a
    type: direct
proxy-groups:
  - name: PROXY
    type: select
    proxies:
      - node-a
rules:
  - MATCH,DIRECT
`;

class MemoryKV {
  private readonly data = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }
}

interface TestEnv {
  BROKER_PATCHER_KV: KVNamespace;
}

describe("worker routes", () => {
  let env: TestEnv;
  let upstreamConfig: string;
  let upstreamError: Error | null;
  let upstreamHeaders: HeadersInit;
  let upstreamStatus: number;

  beforeEach(() => {
    upstreamConfig = UPSTREAM_CONFIG;
    upstreamError = null;
    upstreamHeaders = {
      "profile-update-interval": "1",
      "subscription-userinfo": "upload=1; download=2; total=3; expire=4",
    };
    upstreamStatus = 200;
    env = { BROKER_PATCHER_KV: new MemoryKV() as unknown as KVNamespace };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === UPSTREAM_URL) {
          if (upstreamError) {
            throw upstreamError;
          }

          return new Response(upstreamConfig, {
            status: upstreamStatus,
            headers: upstreamHeaders,
          });
        }

        return new Response("not found", { status: 404 });
      }),
    );
  });

  it("sets up a profile and serves a patched subscription", async () => {
    const setupResponse = await callWorker(
      "/setup",
      {
        method: "POST",
        body: JSON.stringify({
          upstreamUrl: UPSTREAM_URL,
          brokerPacks: ["futu", "longbridge"],
          targetPolicy: "PROXY",
        }),
      },
      env,
    );
    const setupBody = await setupResponse.json() as {
      adminToken: string;
      subscriptionUrl: string;
    };

    expect(setupResponse.status).toBe(200);
    expect(setupBody.adminToken).toBeTruthy();
    expect(setupBody.subscriptionUrl).toMatch(/^https:\/\/worker.test\/sub\//);
    expect(requestHeader(vi.mocked(fetch).mock.calls[0], "user-agent")).toBe("ClashMetaForAndroid/2.11.30");

    const profileResponse = await callWorker(
      "/profile",
      {
        headers: { authorization: `Bearer ${setupBody.adminToken}` },
      },
      env,
    );
    expect(profileResponse.status).toBe(200);

    const subscriptionPath = new URL(setupBody.subscriptionUrl).pathname;
    const subscriptionResponse = await callWorker(subscriptionPath, {}, env);
    const patched = parse(await subscriptionResponse.text());

    expect(subscriptionResponse.status).toBe(200);
    expect(patched.rules.slice(0, 2)).toEqual([
      "DOMAIN-SUFFIX,moomoo.com,PROXY",
      "DOMAIN-SUFFIX,futuhn.com,PROXY",
    ]);
  });

  it("serves cached subscription metadata without refetching upstream", async () => {
    const setupResponse = await callWorker(
      "/setup",
      {
        method: "POST",
        body: JSON.stringify({
          upstreamUrl: UPSTREAM_URL,
          brokerPacks: ["futu"],
          targetPolicy: "PROXY",
        }),
      },
      env,
    );
    const setupBody = await setupResponse.json() as {
      subscriptionUrl: string;
    };
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();

    const subscriptionPath = new URL(setupBody.subscriptionUrl).pathname;
    const response = await callWorker(subscriptionPath, {}, env);

    expect(response.status).toBe(200);
    expect(response.headers.get("profile-update-interval")).toBe("24");
    expect(response.headers.get("subscription-userinfo")).toBe("upload=1; download=2; total=3; expire=4");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes an expired cache without rewriting the stored profile", async () => {
    const setupResponse = await callWorker(
      "/setup",
      {
        method: "POST",
        body: JSON.stringify({
          upstreamUrl: UPSTREAM_URL,
          brokerPacks: ["futu"],
          targetPolicy: "PROXY",
        }),
      },
      env,
    );
    const setupBody = await setupResponse.json() as {
      subscriptionUrl: string;
    };
    await expireSubscriptionCache(env);
    const profileBefore = await env.BROKER_PATCHER_KV.get(PROFILE_KEY);
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();

    const subscriptionPath = new URL(setupBody.subscriptionUrl).pathname;
    const response = await callWorker(
      subscriptionPath,
      { headers: { "user-agent": "ClashMetaForAndroid/test" } },
      env,
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestHeader(fetchMock.mock.calls[0], "user-agent")).toBe("ClashMetaForAndroid/test");
    expect(await env.BROKER_PATCHER_KV.get(PROFILE_KEY)).toBe(profileBefore);
  });

  it("serves stale cache when an expired cache cannot refresh upstream", async () => {
    const setupResponse = await callWorker(
      "/setup",
      {
        method: "POST",
        body: JSON.stringify({
          upstreamUrl: UPSTREAM_URL,
          brokerPacks: ["futu"],
          targetPolicy: "PROXY",
        }),
      },
      env,
    );
    const setupBody = await setupResponse.json() as {
      subscriptionUrl: string;
    };
    await expireSubscriptionCache(env);
    upstreamError = new Error("network down");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();

    const subscriptionPath = new URL(setupBody.subscriptionUrl).pathname;
    const response = await callWorker(subscriptionPath, {}, env);
    const patched = parse(await response.text());

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(patched.rules[0]).toBe("DOMAIN-SUFFIX,moomoo.com,PROXY");
  });

  it("rebuilds a corrupted subscription cache", async () => {
    const setupResponse = await callWorker(
      "/setup",
      {
        method: "POST",
        body: JSON.stringify({
          upstreamUrl: UPSTREAM_URL,
          brokerPacks: ["futu"],
          targetPolicy: "PROXY",
        }),
      },
      env,
    );
    const setupBody = await setupResponse.json() as {
      subscriptionUrl: string;
    };
    await env.BROKER_PATCHER_KV.put(SUBSCRIPTION_CACHE_KEY, "{");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();

    const subscriptionPath = new URL(setupBody.subscriptionUrl).pathname;
    const response = await callWorker(subscriptionPath, {}, env);
    const patched = parse(await response.text());

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(patched.rules[0]).toBe("DOMAIN-SUFFIX,moomoo.com,PROXY");
  });

  it("rebuilds a malformed subscription cache", async () => {
    const setupResponse = await callWorker(
      "/setup",
      {
        method: "POST",
        body: JSON.stringify({
          upstreamUrl: UPSTREAM_URL,
          brokerPacks: ["futu"],
          targetPolicy: "PROXY",
        }),
      },
      env,
    );
    const setupBody = await setupResponse.json() as {
      subscriptionUrl: string;
    };
    await env.BROKER_PATCHER_KV.put(SUBSCRIPTION_CACHE_KEY, JSON.stringify({ yaml: "" }));
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();

    const subscriptionPath = new URL(setupBody.subscriptionUrl).pathname;
    const response = await callWorker(subscriptionPath, {}, env);
    const patched = parse(await response.text());

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(patched.rules[0]).toBe("DOMAIN-SUFFIX,moomoo.com,PROXY");
  });

  it("requires management authorization for inspect after setup", async () => {
    const setupResponse = await callWorker(
      "/setup",
      {
        method: "POST",
        body: JSON.stringify({
          upstreamUrl: UPSTREAM_URL,
          brokerPacks: ["futu"],
          targetPolicy: "PROXY",
        }),
      },
      env,
    );
    const setupBody = await setupResponse.json() as {
      adminToken: string;
    };

    const anonymousResponse = await callWorker(
      "/inspect",
      {
        method: "POST",
        body: JSON.stringify({ upstreamUrl: UPSTREAM_URL }),
      },
      env,
    );
    const authorizedResponse = await callWorker(
      "/inspect",
      {
        method: "POST",
        headers: { authorization: `Bearer ${setupBody.adminToken}` },
        body: JSON.stringify({ upstreamUrl: UPSTREAM_URL }),
      },
      env,
    );

    expect(anonymousResponse.status).toBe(401);
    expect(authorizedResponse.status).toBe(200);
  });

  it("answers subscription HEAD probes without fetching upstream", async () => {
    const setupResponse = await callWorker(
      "/setup",
      {
        method: "POST",
        body: JSON.stringify({
          upstreamUrl: UPSTREAM_URL,
          brokerPacks: ["futu"],
          targetPolicy: "PROXY",
        }),
      },
      env,
    );
    const setupBody = await setupResponse.json() as {
      subscriptionUrl: string;
    };
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();

    const subscriptionPath = new URL(setupBody.subscriptionUrl).pathname;
    const response = await callWorker(subscriptionPath, { method: "HEAD" }, env);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/yaml; charset=utf-8");
    expect(await response.text()).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rotates the subscription token while keeping management access", async () => {
    const setupResponse = await callWorker(
      "/setup",
      {
        method: "POST",
        body: JSON.stringify({
          upstreamUrl: UPSTREAM_URL,
          brokerPacks: ["futu"],
          targetPolicy: "PROXY",
        }),
      },
      env,
    );
    const setupBody = await setupResponse.json() as {
      adminToken: string;
      subscriptionUrl: string;
    };

    const rotateResponse = await callWorker(
      "/subscription-token",
      {
        method: "POST",
        headers: { authorization: `Bearer ${setupBody.adminToken}` },
      },
      env,
    );
    const rotateBody = await rotateResponse.json() as {
      subscriptionUrl: string;
    };

    expect(rotateResponse.status).toBe(200);
    expect(rotateBody.subscriptionUrl).not.toBe(setupBody.subscriptionUrl);
    expect((await callWorker(new URL(setupBody.subscriptionUrl).pathname, {}, env)).status).toBe(404);
    expect((await callWorker(new URL(rotateBody.subscriptionUrl).pathname, {}, env)).status).toBe(200);
  });

  it("does not expose the profile without the management token", async () => {
    await callWorker(
      "/setup",
      {
        method: "POST",
        body: JSON.stringify({
          upstreamUrl: UPSTREAM_URL,
          brokerPacks: ["futu"],
          targetPolicy: "PROXY",
        }),
      },
      env,
    );

    const response = await callWorker("/profile", {}, env);
    expect(response.status).toBe(401);
  });
});

async function expireSubscriptionCache(env: TestEnv): Promise<void> {
  const raw = await env.BROKER_PATCHER_KV.get(SUBSCRIPTION_CACHE_KEY);
  if (!raw) {
    throw new Error("Expected subscription cache to exist.");
  }

  const cache = JSON.parse(raw) as { fetchedAt: string };
  cache.fetchedAt = "2000-01-01T00:00:00.000Z";
  await env.BROKER_PATCHER_KV.put(SUBSCRIPTION_CACHE_KEY, JSON.stringify(cache));
}

function requestHeader(call: unknown[] | undefined, name: string): string | null {
  const init = call?.[1] as RequestInit | undefined;
  return new Headers(init?.headers).get(name);
}

function callWorker(path: string, init: RequestInit, env: TestEnv): Promise<Response> {
  const request = new Request(`https://worker.test${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
  return worker.fetch(request, env);
}
