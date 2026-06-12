import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { PatchError, chooseDefaultPolicy, extractPolicyGroups, patchConfig } from "../src/patch";

const BASE_CONFIG = `
proxies:
  - name: node-a
    type: direct
proxy-groups:
  - name: PROXY
    type: select
    proxies:
      - node-a
  - name: Hong Kong
    type: select
    proxies:
      - node-a
rules:
  - MATCH,DIRECT
`;

describe("patchConfig", () => {
  it("injects Futu/Moomoo rules at the top", () => {
    const output = patchConfig(BASE_CONFIG, {
      brokerPacks: ["futu"],
      targetPolicy: "PROXY",
    });

    const config = parse(output);
    expect(config.rules.slice(0, 4)).toEqual([
      "DOMAIN-SUFFIX,moomoo.com,PROXY",
      "DOMAIN-SUFFIX,futuhn.com,PROXY",
      "DOMAIN-SUFFIX,futustatic.com,PROXY",
      "DOMAIN-SUFFIX,futunn.com,PROXY",
    ]);
    expect(config.rules.at(-1)).toBe("MATCH,DIRECT");
  });

  it("injects Longbridge rules", () => {
    const output = patchConfig(BASE_CONFIG, {
      brokerPacks: ["longbridge"],
      targetPolicy: "Hong Kong",
    });

    const config = parse(output);
    expect(config.rules.slice(0, 4)).toEqual([
      "DOMAIN-SUFFIX,longbridge.com,Hong Kong",
      "DOMAIN-SUFFIX,longbridge.sg,Hong Kong",
      "DOMAIN-SUFFIX,lbctrl.com,Hong Kong",
      "DOMAIN-SUFFIX,lbkrs.com,Hong Kong",
    ]);
  });

  it("merges multiple selected broker packs", () => {
    const output = patchConfig(BASE_CONFIG, {
      brokerPacks: ["futu", "longbridge"],
      targetPolicy: "PROXY",
    });

    const config = parse(output);
    expect(config.rules.slice(0, 8)).toEqual([
      "DOMAIN-SUFFIX,moomoo.com,PROXY",
      "DOMAIN-SUFFIX,futuhn.com,PROXY",
      "DOMAIN-SUFFIX,futustatic.com,PROXY",
      "DOMAIN-SUFFIX,futunn.com,PROXY",
      "DOMAIN-SUFFIX,longbridge.com,PROXY",
      "DOMAIN-SUFFIX,longbridge.sg,PROXY",
      "DOMAIN-SUFFIX,lbctrl.com,PROXY",
      "DOMAIN-SUFFIX,lbkrs.com,PROXY",
    ]);
  });

  it("creates rules when missing", () => {
    const output = patchConfig("proxies: []\n", {
      brokerPacks: ["futu"],
      targetPolicy: "PROXY",
    });

    const config = parse(output);
    expect(config.rules[0]).toBe("DOMAIN-SUFFIX,moomoo.com,PROXY");
  });

  it("does not duplicate an identical injected rule", () => {
    const output = patchConfig(
      `
rules:
  - DOMAIN-SUFFIX,moomoo.com,PROXY
  - MATCH,DIRECT
`,
      {
        brokerPacks: ["futu"],
        targetPolicy: "PROXY",
      },
    );

    const config = parse(output);
    expect(config.rules.filter((rule: string) => rule === "DOMAIN-SUFFIX,moomoo.com,PROXY")).toHaveLength(1);
  });

  it("keeps same-domain rules with different target policies and injects the new one first", () => {
    const output = patchConfig(
      `
rules:
  - DOMAIN-SUFFIX,moomoo.com,DIRECT
  - MATCH,DIRECT
`,
      {
        brokerPacks: ["futu"],
        targetPolicy: "PROXY",
      },
    );

    const config = parse(output);
    expect(config.rules[0]).toBe("DOMAIN-SUFFIX,moomoo.com,PROXY");
    expect(config.rules).toContain("DOMAIN-SUFFIX,moomoo.com,DIRECT");
  });

  it("throws a clear error for invalid YAML", () => {
    expect(() =>
      patchConfig("rules: [", {
        brokerPacks: ["futu"],
        targetPolicy: "PROXY",
      }),
    ).toThrow(PatchError);
  });
});

describe("policy group extraction", () => {
  it("extracts policy groups and prefers PROXY", () => {
    const groups = extractPolicyGroups(BASE_CONFIG);
    expect(groups).toEqual(["PROXY", "Hong Kong"]);
    expect(chooseDefaultPolicy(groups)).toBe("PROXY");
  });

  it("falls back to the first policy group when PROXY is missing", () => {
    expect(chooseDefaultPolicy(["Auto", "Hong Kong"])).toBe("Auto");
  });
});
