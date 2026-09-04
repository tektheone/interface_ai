export type Member = {
  id: string;
  name: string;
  status: "active" | "restricted";
  savingsBalance: string;
  checkingBalance: string;
  lastUpdated: string;
  flags: string[];
};

export const members: Record<string, Member> = {
  "12345": {
    id: "12345",
    name: "Jordan Rivera",
    status: "active",
    savingsBalance: "$8,421.17",
    checkingBalance: "$1,204.88",
    lastUpdated: "2026-09-01 14:22 ET",
    flags: []
  },
  "22222": {
    id: "22222",
    name: "Morgan Chen",
    status: "restricted",
    savingsBalance: "$10,055.43",
    checkingBalance: "$49.20",
    lastUpdated: "2026-09-02 09:10 ET",
    flags: ["Enhanced review required before viewing full account details"]
  },
  "55555": {
    id: "55555",
    name: "Avery Patel",
    status: "active",
    savingsBalance: "$304.05",
    checkingBalance: "$2,016.33",
    lastUpdated: "2026-08-29 16:45 ET",
    flags: ["Simulated slow profile load"]
  }
};

export function findMember(memberId: string): Member | undefined {
  return members[memberId];
}
