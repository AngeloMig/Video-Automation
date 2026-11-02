export type PlanId = "starter" | "creator" | "pro" | "agency";

export type Plan = {
  id: PlanId;
  name: string;
  monthlyRenders: number;
  monthlyAiBudgetUsd: number;
  storageGb: number;
  projects: number;
  features: string[];
};

/** Hard limits so no plan means unlimited rendering or AI spend. Stripe prices attach in Phase 4. */
export const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    monthlyRenders: 20,
    monthlyAiBudgetUsd: 5,
    storageGb: 5,
    projects: 1,
    features: ["One workspace", "Basic editing", "Manual publishing"],
  },
  {
    id: "creator",
    name: "Creator",
    monthlyRenders: 100,
    monthlyAiBudgetUsd: 25,
    storageGb: 50,
    projects: 3,
    features: ["Automated discovery", "AI voiceovers", "Scheduling", "Multiple social accounts"],
  },
  {
    id: "pro",
    name: "Pro",
    monthlyRenders: 400,
    monthlyAiBudgetUsd: 100,
    storageGb: 250,
    projects: 15,
    features: ["Advanced automation", "Custom templates", "Enhanced analytics", "Multiple projects"],
  },
  {
    id: "agency",
    name: "Agency",
    monthlyRenders: 1500,
    monthlyAiBudgetUsd: 400,
    storageGb: 1000,
    projects: 100,
    features: ["Client workspaces", "Team collaboration", "Advanced reporting", "Highest limits"],
  },
];

export function getPlan(id: string | null | undefined): Plan {
  return PLANS.find((plan) => plan.id === id) ?? PLANS[0];
}
