// Typed client for the backend billing API (ADR-005 D6, Phase 5). Carries the IdP
// session token as a Bearer header (OUR session JWT, never a BYOK/LLM key). Used by
// the Usage screen to render the server-sourced managed-plan meter for signed-in users.

import { ApiError, resolveBaseUrl } from "@/api/client";

export type EntitlementStatus = "active" | "past_due" | "canceled";

export interface ManagedEntitlement {
  plan_id: string;
  plan_display: string;
  status: EntitlementStatus;
  period_start: string;
  period_end: string;
}

export interface ManagedUsage {
  cost_micros: number;
  input_tokens: number;
  output_tokens: number;
  events: number;
}

export interface ManagedStatus {
  // null ⇒ no managed plan (the user is on BYOK).
  entitlement: ManagedEntitlement | null;
  usage: ManagedUsage;
  // The plan's cost allowance in micro-USD; null ⇒ no plan, 0 ⇒ unlimited.
  allowance_micros: number | null;
  window_start: string;
  // Provider ids this account can generate on managed right now (server truth,
  // from the same gate the generate path uses). BYOK-only providers are absent;
  // the client adds saved BYOK keys from device storage. Optional for back-compat
  // with an older backend that predates the field.
  managed_providers?: string[];
}

/** The signed-in user's managed-billing status (entitlement + server-side usage). */
export async function getManagedStatus(token: string): Promise<ManagedStatus> {
  const res = await fetch(`${resolveBaseUrl()}/api/v1/billing/managed-status`, {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body);
  }
  return res.json() as Promise<ManagedStatus>;
}

export interface PlanCaps {
  max_projects: number;
  max_generations: number;
  gen_window_days: number;
}

export interface PlanUsage {
  projects: number;
  generations: number;
}

// Free/Pro plan status (T1). Backs the client-side export Pro-wall (T3) — UX
// only, the server (T2) is the real gate on export submission (402 when a
// Free user hits it).
export interface PlanStatus {
  is_pro: boolean;
  caps: PlanCaps;
  usage: PlanUsage;
  at_project_cap: boolean;
  at_generation_cap: boolean;
  // Per-format export entitlements, e.g. ["export_docx", "export_epub",
  // "export_pdf"] for Pro, [] for Free. Backs the client-side per-format
  // download wall (T5) — UX only, the server is the real gate (402).
  features: string[];
}

/** The signed-in user's Free/Pro plan status + usage against caps. */
export async function getPlanStatus(token: string): Promise<PlanStatus> {
  const res = await fetch(`${resolveBaseUrl()}/api/v1/billing/plan-status`, {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body);
  }
  return res.json() as Promise<PlanStatus>;
}
