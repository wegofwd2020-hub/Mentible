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

export interface FeedbackRow {
  id: string;
  name: string;
  email: string;
  app: string;
  page: string;
  type: string | null;
  contact_preference: string | null;
  company: string | null;
  role: string | null;
  snippet: string;
  created_at: string;
  archived: boolean;
}

export interface FeedbackDetail extends FeedbackRow {
  text: string;
  payload: Record<string, unknown>;
}

export interface FeedbackListResult {
  rows: FeedbackRow[];
  next_cursor: string | null;
}

export type FeedbackStatus = "active" | "archived" | "all";

export interface FeedbackFilters {
  type?: string;
  contact_preference?: string;
  page?: string;
  app?: string;
  q?: string;
  created_from?: string; // ISO
  created_to?: string;
  status?: FeedbackStatus;
  limit?: number;
  cursor?: string;
}

function feedbackParams(f: FeedbackFilters): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (v != null && v !== "") p.set(k, String(v));
  }
  return p;
}

export async function listFeedback(token: string, f: FeedbackFilters = {}): Promise<FeedbackListResult> {
  const qs = feedbackParams(f).toString();
  return (await adminFetch<FeedbackListResult>(`/feedback${qs ? `?${qs}` : ""}`, token)) as FeedbackListResult;
}

export async function getFeedback(token: string, id: string): Promise<FeedbackDetail> {
  return (await adminFetch<FeedbackDetail>(`/feedback/${encodeURIComponent(id)}`, token)) as FeedbackDetail;
}

// Soft-archive (archived=true → hidden from the default list) or restore. 204.
export async function setFeedbackArchived(
  token: string,
  id: string,
  archived: boolean,
): Promise<void> {
  await adminFetch<null>(`/feedback/${encodeURIComponent(id)}/archive`, token, {
    method: "POST",
    body: JSON.stringify({ archived }),
  });
}

// Hard-delete one feedback row. Irreversible. 204.
export async function deleteFeedback(token: string, id: string): Promise<void> {
  await adminFetch<null>(`/feedback/${encodeURIComponent(id)}`, token, { method: "DELETE" });
}

export interface WelcomeEmailResult {
  sent: boolean;
  detail: string;
}

// Send the Mentible welcome email to a recipient (admin-triggered; the
// recipient need not have an account). `sent:false` carries a `detail` reason
// (e.g. email not configured) — a 200 either way unless the address is invalid.
export async function sendWelcomeEmail(
  token: string,
  email: string,
  name?: string,
): Promise<WelcomeEmailResult> {
  return (await adminFetch<WelcomeEmailResult>("/welcome-email", token, {
    method: "POST",
    body: JSON.stringify({ email, name: name || undefined }),
  })) as WelcomeEmailResult;
}

// The export endpoint returns a file, not JSON — the screen fetches this URL with
// the Bearer token and triggers a browser download (web-first).
export function feedbackExportUrl(f: FeedbackFilters, format: "csv" | "json"): string {
  const p = feedbackParams({ ...f, limit: undefined, cursor: undefined });
  p.set("format", format);
  return `${resolveBaseUrl()}/api/v1/admin/feedback/export?${p.toString()}`;
}
