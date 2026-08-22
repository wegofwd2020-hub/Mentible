import { Platform } from "react-native";
import type { useRouter } from "expo-router";
import type { AuthStatus } from "@/auth/AuthProvider";

// Shared auth → nav-bar branch logic, so TopNavBar and SideNav can't drift out
// of sync. signed_out gets the marketing rail (links + Sign in); signed_in
// gets the app tabs + AccountMenu; unavailable (demo) gets the app tabs with
// neither Sign in nor the account menu; loading gets its OWN distinct shape —
// logo + Home only, so a signed-out visitor never sees a flash of the full
// app-tab set (Library/Studio/Projects/Reviews/Publish) before auth resolves.
export interface NavModel {
  mode: "marketing" | "app" | "loading";
  showSignIn: boolean;
  showAccount: boolean;
}

export function navModel(status: AuthStatus): NavModel {
  if (status === "signed_out") return { mode: "marketing", showSignIn: true, showAccount: false };
  if (status === "signed_in") return { mode: "app", showSignIn: false, showAccount: true };
  if (status === "loading") return { mode: "loading", showSignIn: false, showAccount: false };
  return { mode: "app", showSignIn: false, showAccount: false }; // unavailable (demo)
}

// Shared anchor-scroll helper (TopNavBar, SideNav, Hero's "See how it works"):
// on web, smooth-scroll to the in-page section; on native there's no anchor to
// scroll to, so land on Home instead.
export function goToAnchor(anchor: string, router: ReturnType<typeof useRouter>): void {
  if (Platform.OS === "web") {
    document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth" });
  } else {
    router.push("/");
  }
}
