// OAuth redirect route (tablet bug 2026-08-23): `mentible://auth-callback` had no
// route, so the deep link landed on expo-router's "Unmatched route" / NOT FOUND.
// The route now finishes the PKCE code exchange (idempotent) and redirects Home.
import React from "react";
import { render, waitFor } from "@testing-library/react-native";

const mockExchange = jest.fn().mockResolvedValue({ error: null });
jest.mock("@/lib/supabase", () => ({
  supabase: { auth: { exchangeCodeForSession: (...a: unknown[]) => mockExchange(...a) } },
}));

let mockRedirectHref: string | null = null;
let mockSearchParams: Record<string, string | undefined> = { code: "abc123" };
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockSearchParams,
  Redirect: ({ href }: { href: string }) => {
    mockRedirectHref = href;
    return null;
  },
}));
jest.mock("expo-web-browser", () => ({ maybeCompleteAuthSession: jest.fn() }));

import AuthCallback from "../../app/auth-callback";

beforeEach(() => {
  mockExchange.mockClear();
  mockRedirectHref = null;
});

it("exchanges the OAuth code, then redirects Home", async () => {
  mockSearchParams = { code: "abc123" };
  render(<AuthCallback />);
  await waitFor(() => expect(mockExchange).toHaveBeenCalledWith("abc123"));
  await waitFor(() => expect(mockRedirectHref).toBe("/"));
});

it("still redirects Home when there is no code (nothing to exchange)", async () => {
  mockSearchParams = {};
  render(<AuthCallback />);
  await waitFor(() => expect(mockRedirectHref).toBe("/"));
  expect(mockExchange).not.toHaveBeenCalled();
});
