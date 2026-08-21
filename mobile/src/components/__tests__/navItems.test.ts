import { NAV_TABS, NAV_ORDER, MARKETING_LINKS } from "@/components/navItems";

test("Home is a nav tab and leads the order", () => {
  expect(NAV_TABS.index).toEqual({ label: "Home", active: "home", inactive: "home-outline" });
  expect(NAV_ORDER[0]).toBe("index");
});

test("marketing links map labels to Home-section anchors", () => {
  expect(MARKETING_LINKS.map((l) => l.anchor)).toEqual(["how-it-works", "formats", "trust", "pricing"]);
  expect(MARKETING_LINKS[0].label).toBe("How it works");
});
