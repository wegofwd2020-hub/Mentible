import { navModel } from "@/components/navState";

test("marketing nav + Sign in when signed out", () => {
  expect(navModel("signed_out")).toEqual({ mode: "marketing", showSignIn: true, showAccount: false });
});
test("app nav + account when signed in", () => {
  expect(navModel("signed_in")).toEqual({ mode: "app", showSignIn: false, showAccount: true });
});
test("demo (unavailable): app nav, no sign-in, no account", () => {
  expect(navModel("unavailable")).toEqual({ mode: "app", showSignIn: false, showAccount: false });
});
test("loading: distinct mode (Home only), no sign-in, no account — no flash of the app-tab set", () => {
  expect(navModel("loading")).toEqual({ mode: "loading", showSignIn: false, showAccount: false });
});
