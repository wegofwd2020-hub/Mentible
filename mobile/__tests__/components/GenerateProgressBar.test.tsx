import React from "react";
import { render, screen } from "@testing-library/react-native";
import { AccessibilityInfo, Animated } from "react-native";
import { GenerateProgressBar } from "@/components/GenerateProgressBar";

it("shows a waiting label while queued", () => {
  render(<GenerateProgressBar phase="queued" elapsedMs={5_000} />);
  expect(screen.getByText(/waiting/i)).toBeTruthy();
});

it("shows generating + m:ss + eta while running", () => {
  render(<GenerateProgressBar phase="running" elapsedMs={47_000} etaHint="usually 1–3 min" />);
  expect(screen.getByText(/generating/i)).toBeTruthy();
  expect(screen.getByText(/0:47/)).toBeTruthy();
  expect(screen.getByText(/usually 1–3 min/i)).toBeTruthy();
});

it("formats m:ss with minute rollover and zero-padding", () => {
  const { unmount } = render(<GenerateProgressBar phase="running" elapsedMs={72_000} />);
  expect(screen.getByText(/1:12/)).toBeTruthy();
  unmount();

  render(<GenerateProgressBar phase="running" elapsedMs={0} />);
  expect(screen.getByText(/0:00/)).toBeTruthy();
});

it("exposes a progressbar role for a11y", () => {
  render(<GenerateProgressBar phase="running" elapsedMs={1_000} />);
  expect(screen.getByRole("progressbar")).toBeTruthy();
});

it("renders a static bar (not the sliding fill) when reduce-motion is enabled, and never starts the loop", async () => {
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
  const loopSpy = jest.spyOn(Animated, "loop");
  render(<GenerateProgressBar phase="running" elapsedMs={1_000} />);

  // Static path only: the static-fill node renders, the sliding-fill node
  // (the one the loop would animate) never mounts, and the loop itself is
  // never started for a reduce-motion viewer.
  expect(await screen.findByText(/generating/i)).toBeTruthy();
  expect(await screen.findByTestId("progress-static-fill")).toBeTruthy();
  expect(screen.queryByTestId("progress-sliding-fill")).toBeNull();
  expect(loopSpy).not.toHaveBeenCalled();

  loopSpy.mockRestore();
});
