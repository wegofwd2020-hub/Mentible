import type { SupabaseClient } from "@supabase/supabase-js";

// Native modules the flow depends on. jest-expo defaults Platform.OS to "ios", so the
// native (system-browser + code-exchange) branch is what runs here — the product target.
jest.mock("expo-web-browser", () => ({
  maybeCompleteAuthSession: jest.fn(),
  openAuthSessionAsync: jest.fn(),
}));
jest.mock("expo-auth-session", () => ({
  makeRedirectUri: jest.fn(() => "studybuddy-q://auth-callback"),
}));

import * as WebBrowser from "expo-web-browser";
import { signInWithGoogle } from "@/auth/googleSignIn";

const openAuthSessionAsync = WebBrowser.openAuthSessionAsync as jest.Mock;

type AuthMocks = {
  signInWithOAuth: jest.Mock;
  exchangeCodeForSession: jest.Mock;
};

function makeClient(over: Partial<AuthMocks> = {}): { client: SupabaseClient; auth: AuthMocks } {
  const auth: AuthMocks = {
    signInWithOAuth: jest
      .fn()
      .mockResolvedValue({ data: { url: "https://idp.example/authorize?x=1" }, error: null }),
    exchangeCodeForSession: jest.fn().mockResolvedValue({ error: null }),
    ...over,
  };
  return { client: { auth } as unknown as SupabaseClient, auth };
}

describe("signInWithGoogle (native)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("exchanges the returned code for a session on success", async () => {
    openAuthSessionAsync.mockResolvedValue({
      type: "success",
      url: "studybuddy-q://auth-callback?code=abc123",
    });
    const { client, auth } = makeClient();

    const res = await signInWithGoogle(client);

    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "studybuddy-q://auth-callback", skipBrowserRedirect: true },
    });
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("abc123");
    expect(res.error).toBeNull();
  });

  it("returns no error and does not exchange when the user cancels", async () => {
    openAuthSessionAsync.mockResolvedValue({ type: "cancel" });
    const { client, auth } = makeClient();

    const res = await signInWithGoogle(client);

    expect(res.error).toBeNull();
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("surfaces an error if Supabase cannot start the OAuth flow", async () => {
    const { client, auth } = makeClient({
      signInWithOAuth: jest.fn().mockResolvedValue({ data: null, error: { message: "provider disabled" } }),
    });

    const res = await signInWithGoogle(client);

    expect(res.error).toBe("provider disabled");
    expect(openAuthSessionAsync).not.toHaveBeenCalled();
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("errors when the callback URL has no code", async () => {
    openAuthSessionAsync.mockResolvedValue({
      type: "success",
      url: "studybuddy-q://auth-callback",
    });
    const { client, auth } = makeClient();

    const res = await signInWithGoogle(client);

    expect(res.error).toMatch(/did not complete/i);
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});
