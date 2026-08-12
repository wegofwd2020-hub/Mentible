import React from "react";
import { render, screen } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";
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

it("exposes a progressbar role for a11y", () => {
  render(<GenerateProgressBar phase="running" elapsedMs={1_000} />);
  expect(screen.getByRole("progressbar")).toBeTruthy();
});

it("renders a static bar when reduce-motion is enabled (no crash, still labelled)", async () => {
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
  render(<GenerateProgressBar phase="running" elapsedMs={1_000} />);
  expect(await screen.findByText(/generating/i)).toBeTruthy();
});
