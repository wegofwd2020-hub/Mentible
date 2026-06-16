// Typed client for the backend account API (ADR-014 ticket #3a). Every call
// carries the IdP session token as a Bearer header — that token is OUR session
// JWT, never a BYOK/LLM key. The token is passed in (resolved by the auth layer,
// #3b) so this module stays decoupled from Supabase.

import { ApiError, resolveBaseUrl } from "@/api/client";

export type CredentialSource = "device_local" | "synced_e2e" | "managed_vault";
export type CredentialStatus = "valid" | "rejected" | "unverified";

export interface ProviderCredential {
  provider_id: string;
  source: CredentialSource;
  status: CredentialStatus;
  last_verified_at: string | null;
  updated_at: string;
}

export interface AccountView {
  sub: string;
  email: string | null;
  credentials: ProviderCredential[];
}

async function authFetch<T>(path: string, token: string, options?: RequestInit): Promise<T | null> {
  const res = await fetch(`${resolveBaseUrl()}/api/v1/account${path}`, {
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
  // 204 No Content (delete endpoints) has an empty body.
  if (res.status === 204) return null;
  return res.json() as Promise<T>;
}

/** The caller's account + credential set. Lazily provisions the row server-side. */
export async function getAccount(token: string): Promise<AccountView> {
  return (await authFetch<AccountView>("", token)) as AccountView;
}

/** Record/update custody + status for one provider (no key material is sent). */
export async function putCredential(
  token: string,
  providerId: string,
  body: { source: CredentialSource; status?: CredentialStatus },
): Promise<ProviderCredential> {
  return (await authFetch<ProviderCredential>(`/credentials/${encodeURIComponent(providerId)}`, token, {
    method: "PUT",
    body: JSON.stringify(body),
  })) as ProviderCredential;
}

export async function deleteCredential(token: string, providerId: string): Promise<void> {
  await authFetch(`/credentials/${encodeURIComponent(providerId)}`, token, { method: "DELETE" });
}

/** Full account purge (ADR-014 D8). Device-local keys are cleared separately by the client. */
export async function deleteAccount(token: string): Promise<void> {
  await authFetch("", token, { method: "DELETE" });
}
