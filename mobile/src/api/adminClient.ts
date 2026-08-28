// Typed client for the super-admin user-management API (ADR-020). Every call
// carries the operator's IdP session token (Bearer) — the backend re-checks the
// allowlist (D2) and 403s a non-operator. Metadata only: no key material.

import { ApiError, resolveBaseUrl } from "@/api/client";
import type { ProviderCredential } from "@/api/accountClient";

export interface AdminUserRow {
  sub: string;
  email: string | null;
  created_at: string;
  suspended: boolean;
  suspended_at: string | null;
  device_count: number;
}

export interface AdminDevice {
  device_id: string;
  label: string | null;
  platform: string | null;
  first_seen: string;
  last_seen: string;
}

export interface AdminUserDetail extends AdminUserRow {
  credentials: ProviderCredential[];
  devices: AdminDevice[];
}

export interface AdminUserList {
  users: AdminUserRow[];
  total: number;
  limit: number;
  offset: number;
}

// Per-user managed token usage (super-admin dashboard). MANAGED path only —
// BYOK generations record nothing (ADR-001), so they never appear here.
export interface AdminUsageRow {
  sub: string | null;
  email: string | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_micros: number;
  events: number;
  providers: string[];
  last_used: string | null;
}

export interface AdminUsageByUser {
  window_days: number;
  rows: AdminUsageRow[];
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_micros: number;
}

async function adminFetch<T>(path: string, token: string, options?: RequestInit): Promise<T | null> {
  const res = await fetch(`${resolveBaseUrl()}/api/v1/admin${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body);
  }
  if (res.status === 204) return null;
  return res.json() as Promise<T>;
}

export async function listUsers(
  token: string,
  opts?: { limit?: number; offset?: number },
): Promise<AdminUserList> {
  const params = new URLSearchParams();
  if (opts?.limit != null) params.set("limit", String(opts.limit));
  if (opts?.offset != null) params.set("offset", String(opts.offset));
  const qs = params.toString();
  return (await adminFetch<AdminUserList>(`/users${qs ? `?${qs}` : ""}`, token)) as AdminUserList;
}

export async function getUsageByUser(token: string, days = 30): Promise<AdminUsageByUser> {
  return (await adminFetch<AdminUsageByUser>(`/usage/by-user?days=${days}`, token)) as AdminUsageByUser;
}

export async function getUser(token: string, sub: string): Promise<AdminUserDetail> {
  return (await adminFetch<AdminUserDetail>(
    `/users/${encodeURIComponent(sub)}`,
    token,
  )) as AdminUserDetail;
}

export async function suspendUser(token: string, sub: string): Promise<AdminUserRow> {
  return (await adminFetch<AdminUserRow>(`/users/${encodeURIComponent(sub)}/suspend`, token, {
    method: "POST",
  })) as AdminUserRow;
}

export async function reactivateUser(token: string, sub: string): Promise<AdminUserRow> {
  return (await adminFetch<AdminUserRow>(`/users/${encodeURIComponent(sub)}/reactivate`, token, {
    method: "POST",
  })) as AdminUserRow;
}

export async function deleteUser(token: string, sub: string): Promise<void> {
  await adminFetch(`/users/${encodeURIComponent(sub)}`, token, { method: "DELETE" });
}

export interface PlanSummary {
  id: string;
  display: string;
  allowance_micros: number;
  managed_providers: string[];
}

export interface EntitlementView {
  plan_id: string;
  status: string;
  period_start: string;
  period_end: string;
}

export async function listPlans(token: string): Promise<PlanSummary[]> {
  return (await adminFetch<PlanSummary[]>(`/plans`, token)) as PlanSummary[];
}

export async function getEntitlement(token: string, sub: string): Promise<EntitlementView | null> {
  return adminFetch<EntitlementView>(`/users/${encodeURIComponent(sub)}/entitlement`, token);
}

export async function grantEntitlement(
  token: string,
  sub: string,
  planId: string,
): Promise<EntitlementView> {
  return (await adminFetch<EntitlementView>(`/users/${encodeURIComponent(sub)}/entitlement`, token, {
    method: "PUT",
    body: JSON.stringify({ plan_id: planId, status: "active" }),
  })) as EntitlementView;
}

export async function revokeEntitlement(
  token: string,
  sub: string,
  planId: string,
): Promise<EntitlementView> {
  return (await adminFetch<EntitlementView>(`/users/${encodeURIComponent(sub)}/entitlement`, token, {
    method: "PUT",
    body: JSON.stringify({ plan_id: planId, status: "canceled" }),
  })) as EntitlementView;
}
