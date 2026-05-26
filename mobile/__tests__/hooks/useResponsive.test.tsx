import { Dimensions } from "react-native";
import { renderHook } from "@testing-library/react-native";
import { useResponsive } from "../../src/hooks/useResponsive";

// useWindowDimensions seeds its state from Dimensions.get('window') on first
// render, so spying there controls the width a freshly-rendered hook sees.
function mockWidth(width: number) {
  jest
    .spyOn(Dimensions, "get")
    .mockReturnValue({ width, height: 800, scale: 1, fontScale: 1 });
}

afterEach(() => jest.restoreAllMocks());

describe("useResponsive", () => {
  it("treats a phone width as neither tablet nor desktop", () => {
    mockWidth(390);
    const { result } = renderHook(() => useResponsive());
    expect(result.current).toMatchObject({ isTablet: false, isDesktop: false });
  });

  it("treats a tablet width as tablet but not desktop", () => {
    mockWidth(800);
    const { result } = renderHook(() => useResponsive());
    expect(result.current).toMatchObject({ isTablet: true, isDesktop: false });
  });

  it("treats a desktop width as both tablet and desktop", () => {
    mockWidth(1440);
    const { result } = renderHook(() => useResponsive());
    expect(result.current).toMatchObject({ width: 1440, isTablet: true, isDesktop: true });
  });

  it("uses 768/1024 as the exact breakpoints", () => {
    mockWidth(768);
    expect(renderHook(() => useResponsive()).result.current.isTablet).toBe(true);
    mockWidth(767);
    expect(renderHook(() => useResponsive()).result.current.isTablet).toBe(false);
    mockWidth(1024);
    expect(renderHook(() => useResponsive()).result.current.isDesktop).toBe(true);
    mockWidth(1023);
    expect(renderHook(() => useResponsive()).result.current.isDesktop).toBe(false);
  });
});
