// Pure helpers for the plan name and the explicit "you've reached a limit" messages.
// No I/O: the caller passes the server's plan status and managed status in, so the
// same rules are unit-testable and the banner never disagrees with the numbers.
//
// Limits covered: Free generations, Free projects, Free stored audio, and the managed
// token allowance. Fail open: a null plan or status means "unknown", so no limit
// message is shown (the server still enforces every limit with a 402).

import type { ManagedStatus, PlanStatus } from "@/api/billingClient";

export type LimitKey = "generations" | "projects" | "storage" | "tokens";

export interface LimitHit {
  key: LimitKey;
  message: string;
}

const MB = 1024 * 1024;

/** The plan name shown under the usage meter. */
export function planLabel(plan: PlanStatus | null): string | null {
  if (!plan) return null;
  if (plan.plan_name) return plan.plan_name;
  return plan.is_pro ? "Pro" : "Free";
}

/** Every limit the user has reached right now, in display order. */
export function limitHits(
  plan: PlanStatus | null,
  managed: ManagedStatus | null,
): LimitHit[] {
  const hits: LimitHit[] = [];

  if (plan && !plan.is_pro) {
    if (plan.at_generation_cap) {
      hits.push({
        key: "generations",
        message: `Free limit reached: ${plan.usage.generations} of ${plan.caps.max_generations} generations used in the last ${plan.caps.gen_window_days} days. Upgrade to Pro to keep generating.`,
      });
    }
    if (plan.at_project_cap) {
      hits.push({
        key: "projects",
        message: `Free limit reached: ${plan.usage.projects} of ${plan.caps.max_projects} projects. Delete a project or upgrade to Pro.`,
      });
    }
    if (plan.at_storage_cap) {
      const capMb = Math.floor((plan.caps.max_storage_bytes ?? 0) / MB);
      const usedMb = Math.floor((plan.usage.storage_bytes ?? 0) / MB);
      hits.push({
        key: "storage",
        message: `Free storage full: ${usedMb} of ${capMb} MB of uploaded audio used. Delete an upload or upgrade to Pro.`,
      });
    }
  }

  // Managed token allowance: 0 means unlimited, null means no managed plan.
  if (managed && managed.entitlement && managed.allowance_micros && managed.allowance_micros > 0) {
    if (managed.usage.cost_micros >= managed.allowance_micros) {
      const renews = managed.entitlement.period_end
        ? ` It renews on ${new Date(managed.entitlement.period_end).toLocaleDateString()}.`
        : "";
      hits.push({
        key: "tokens",
        message: `Your ${managed.entitlement.plan_display} token allowance for this period is used up.${renews} You can still generate with your own API key in Settings.`,
      });
    }
  }

  return hits;
}
