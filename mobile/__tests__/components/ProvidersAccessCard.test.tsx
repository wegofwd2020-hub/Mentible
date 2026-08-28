import React from "react";
import { render, screen } from "@testing-library/react-native";
import { ProvidersAccessCard } from "@/components/ProvidersAccessCard";
import type { ModelUsage } from "@/storage/usageStore";

function model(over: Partial<ModelUsage>): ModelUsage {
  return {
    provider: "groq",
    model: "qwen/qwen3.8-27b",
    generations: 1,
    inputTokens: 0,
    outputTokens: 0,
    estCostUsd: 0,
    anyEstimated: false,
    ...over,
  };
}

it("shows a Managed badge for a plan-covered provider", () => {
  render(<ProvidersAccessCard managedProviders={["groq"]} savedProviders={[]} byModel={[]} />);
  expect(screen.getByText("Managed")).toBeTruthy();
});

it("shows a Your key badge for a device-saved BYOK provider", () => {
  render(
    <ProvidersAccessCard managedProviders={[]} savedProviders={["anthropic"]} byModel={[]} />,
  );
  expect(screen.getByText("Your key")).toBeTruthy();
});

it("marks providers with neither access as Not set up", () => {
  render(<ProvidersAccessCard managedProviders={[]} savedProviders={[]} byModel={[]} />);
  // 5 providers in the registry, none set up.
  expect(screen.getAllByText("Not set up").length).toBeGreaterThanOrEqual(1);
});

it("can show both Managed and Your key for the same provider", () => {
  render(
    <ProvidersAccessCard managedProviders={["groq"]} savedProviders={["groq"]} byModel={[]} />,
  );
  expect(screen.getByText("Managed")).toBeTruthy();
  expect(screen.getByText("Your key")).toBeTruthy();
});

it("aggregates this-device generation counts per provider", () => {
  render(
    <ProvidersAccessCard
      managedProviders={["groq"]}
      savedProviders={[]}
      byModel={[model({ generations: 2 }), model({ model: "llama", generations: 3 })]}
    />,
  );
  // 2 + 3 groq generations aggregated across two models.
  expect(screen.getByText("5 generations on this device")).toBeTruthy();
});

it("singularizes a single generation", () => {
  render(
    <ProvidersAccessCard
      managedProviders={["groq"]}
      savedProviders={[]}
      byModel={[model({ generations: 1 })]}
    />,
  );
  expect(screen.getByText("1 generation on this device")).toBeTruthy();
});
