import { beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import worker from "../src/index";

const UPSTREAM_URL = "https://example.com/sub.yaml";
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

  beforeEach(() => {
    env = { BROKER_PATCHER_KV: new MemoryKV() as unknown as KVNamespace };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === UPSTREAM_URL) {
          return new Response(UPSTREAM_CONFIG, { status: 200 });
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
