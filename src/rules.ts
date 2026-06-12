export type BrokerPackId = "futu" | "longbridge";

export interface BrokerPack {
  id: BrokerPackId;
  label: string;
  domains: string[];
}

export const BROKER_PACKS: BrokerPack[] = [
  {
    id: "futu",
    label: "Futu / Moomoo",
    domains: ["moomoo.com", "futuhn.com", "futustatic.com", "futunn.com"],
  },
  {
    id: "longbridge",
    label: "Longbridge",
    domains: ["longbridge.com", "longbridge.sg", "lbctrl.com", "lbkrs.com"],
  },
];

const BROKER_PACK_IDS = new Set(BROKER_PACKS.map((pack) => pack.id));

export function isBrokerPackId(value: string): value is BrokerPackId {
  return BROKER_PACK_IDS.has(value as BrokerPackId);
}

export function getDomainsForBrokerPacks(packIds: BrokerPackId[]): string[] {
  const seen = new Set<string>();
  const domains: string[] = [];

  for (const packId of packIds) {
    const pack = BROKER_PACKS.find((candidate) => candidate.id === packId);
    if (!pack) {
      continue;
    }

    for (const domain of pack.domains) {
      if (!seen.has(domain)) {
        seen.add(domain);
        domains.push(domain);
      }
    }
  }

  return domains;
}
