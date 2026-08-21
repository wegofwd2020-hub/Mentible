import type { AuthStatus } from "@/auth/AuthProvider";

// Shared auth → nav-bar branch logic, so TopNavBar and SideNav can't drift out
// of sync. signed_out gets the marketing rail (links + Sign in); signed_in
// gets the app tabs + AccountMenu; loading/unavailable render the app tabs
// (Home only, until status resolves) with neither Sign in nor the account menu.
export interface NavModel {
  mode: "marketing" | "app";
  showSignIn: boolean;
  showAccount: boolean;
}

export function navModel(status: AuthStatus): NavModel {
  if (status === "signed_out") return { mode: "marketing", showSignIn: true, showAccount: false };
  if (status === "signed_in") return { mode: "app", showSignIn: false, showAccount: true };
  return { mode: "app", showSignIn: false, showAccount: false }; // unavailable | loading
}
