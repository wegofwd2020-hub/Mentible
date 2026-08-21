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
test("loading: app nav, no sign-in, no account (Home only until resolved)", () => {
  expect(navModel("loading")).toEqual({ mode: "app", showSignIn: false, showAccount: false });
});
