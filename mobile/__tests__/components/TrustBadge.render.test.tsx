import React from "react";
import { render, screen } from "@testing-library/react-native";
import { TrustBadge } from "@/components/TrustBadge";
import type { TrustManifest } from "@/types/trust";

// Rendering checks for ADR-016 D6/D7: the LLM identity and content version are
// ALWAYS visible (collapsed), the detail rows are not, and the staleness hint
// shows only when the host flags it.

const m: TrustManifest = {
  trust_manifest_version: 1,
  provenance: {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    model_verified: true,
    integration_version: 1,
    contract_version: 1,
    generated_at: "2026-06-14T12:00:00Z",
  },
  validation: { schema_validated: true, repair_attempts: 0 },
};

describe("<TrustBadge> (collapsed, D7 always-visible)", () => {
  it("shows headline + LLM identity + content version without expanding", () => {
    render(<TrustBadge manifest={m} revisionCount={2} />);
    expect(screen.getByText("Quality-checked")).toBeTruthy();
    expect(screen.getByText("Anthropic (Claude) · Claude Sonnet 4.6")).toBeTruthy();
    expect(screen.getByText("2026-06-14 · rev 2")).toBeTruthy();
  });

  it("keeps the detail rows behind the expand toggle", () => {
    render(<TrustBadge manifest={m} />);
    expect(screen.queryByText("Structure check")).toBeNull();
  });

  it("reveals detail rows when defaultExpanded", () => {
    render(<TrustBadge manifest={m} defaultExpanded />);
    expect(screen.getByText("Structure check")).toBeTruthy();
  });

  it("shows the staleness hint only when the host flags it", () => {
    const { rerender } = render(<TrustBadge manifest={m} />);
    expect(screen.queryByText(/older model/)).toBeNull();
    rerender(<TrustBadge manifest={m} isStale />);
    expect(screen.getByText("Made with an older model — regenerate?")).toBeTruthy();
  });

  it("never claims provider endorsement in the headline (D7 trust-claim discipline)", () => {
    render(<TrustBadge manifest={m} />);
    expect(screen.queryByText(/Verified/)).toBeNull();
  });
});
