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
