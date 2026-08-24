// Native marketing-link scroll (tablet bug 2026-08-23): goToAnchor used to
// `router.push("/")` on native — a no-op on Home, so the SideNav/TopNavBar
// marketing links did nothing. It now scrolls the single-page LandingHome to the
// section via the landingScroll registry. jest-expo defaults Platform.OS to
// native, so goToAnchor's native branch runs here without a Platform mock.
import {
  setSectionOffset,
  getSectionOffset,
  setAnchorScroller,
  scrollToAnchor,
} from "@/components/landing/landingScroll";
import { goToAnchor } from "@/components/navState";

afterEach(() => setAnchorScroller(null));

describe("landingScroll registry", () => {
  it("records and returns section offsets (0 for unknown)", () => {
    expect(getSectionOffset("never-set")).toBe(0);
    setSectionOffset("formats", 1234);
    expect(getSectionOffset("formats")).toBe(1234);
  });

  it("scrollToAnchor invokes the registered scroller; no-op when none is registered", () => {
    expect(() => scrollToAnchor("formats")).not.toThrow();
    const fn = jest.fn();
    setAnchorScroller(fn);
    scrollToAnchor("trust");
    expect(fn).toHaveBeenCalledWith("trust");
  });
});

describe("goToAnchor (native)", () => {
  it("scrolls the landing section instead of pushing a route", () => {
    const scroller = jest.fn();
    setAnchorScroller(scroller);
    const router = { push: jest.fn() } as unknown as Parameters<typeof goToAnchor>[1];
    goToAnchor("how-it-works", router);
    expect(scroller).toHaveBeenCalledWith("how-it-works");
    expect((router as unknown as { push: jest.Mock }).push).not.toHaveBeenCalled();
  });
});
