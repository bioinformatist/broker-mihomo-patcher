import { parseDocument, stringify } from "yaml";
import { type BrokerPackId, getDomainsForBrokerPacks } from "./rules";

export class PatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatchError";
  }
}

export interface PatchOptions {
  brokerPacks: BrokerPackId[];
  targetPolicy: string;
}

type MihomoConfig = Record<string, unknown>;

export function patchConfig(yamlText: string, options: PatchOptions): string {
  const config = parseConfig(yamlText);
  const generatedRules = buildBrokerRules(options);

  const existingRules = config.rules;
  if (existingRules !== undefined && !Array.isArray(existingRules)) {
    throw new PatchError("The upstream config has a non-array rules field.");
  }

  const currentRules = Array.isArray(existingRules) ? existingRules : [];
  const existingRuleSet = new Set(
    currentRules
      .filter((rule): rule is string => typeof rule === "string")
      .map((rule) => rule.trim()),
  );

  const newRules = generatedRules.filter((rule) => !existingRuleSet.has(rule));
  config.rules = [...newRules, ...currentRules];

  return stringify(config, { lineWidth: 0 });
}

export function extractPolicyGroups(yamlText: string): string[] {
  const config = parseConfig(yamlText);
  const proxyGroups = config["proxy-groups"];

  if (!Array.isArray(proxyGroups)) {
    return [];
  }

  const seen = new Set<string>();
  const names: string[] = [];

  for (const group of proxyGroups) {
    if (!isRecord(group) || typeof group.name !== "string") {
      continue;
    }

    const name = group.name.trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }

  return names;
}

export function chooseDefaultPolicy(policyGroups: string[]): string {
  return policyGroups.includes("PROXY") ? "PROXY" : policyGroups[0] ?? "PROXY";
}

export function buildBrokerRules(options: PatchOptions): string[] {
  const targetPolicy = options.targetPolicy.trim();
  if (!targetPolicy) {
    throw new PatchError("Target policy is required.");
  }

  if (/[\r\n,]/.test(targetPolicy)) {
    throw new PatchError("Target policy cannot contain commas or line breaks.");
  }

  return getDomainsForBrokerPacks(options.brokerPacks).map(
    (domain) => `DOMAIN-SUFFIX,${domain},${targetPolicy}`,
  );
}

function parseConfig(yamlText: string): MihomoConfig {
  const document = parseDocument(yamlText, { prettyErrors: false });
  if (document.errors.length > 0) {
    throw new PatchError("The upstream subscription is not valid YAML.");
  }

  const value = document.toJS();
  if (!isRecord(value)) {
    throw new PatchError("The upstream subscription must be a YAML object.");
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
