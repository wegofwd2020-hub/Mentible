import React from "react";
import { render, screen } from "@testing-library/react-native";
import { TrustJourney } from "@/components/TrustJourney";

function detail(over: Partial<any> = {}) {
  return {
    project: { id: "p1", title: "P", topic: null },
    my_role: "owner",
    artifacts: [],
    inputs: [],
    ...over,
  } as any;
}
const withVersion = (is_validated = false) => ({
  artifacts: [{ artifact: { id: "a", title: "G", role: "cornerstone", format: "guide" },
                versions: [{ id: "v", version_no: 1, is_validated, recorded_via: null }] }],
});

it("shows all four phase labels", () => {
  render(<TrustJourney detail={detail()} isOwner />);
  for (const p of ["Capture", "Create", "Validate", "Share"]) expect(screen.getByText(p)).toBeTruthy();
});

it("no sources → Capture is current with the add-a-source next step (owner)", () => {
  render(<TrustJourney detail={detail()} isOwner />);
  expect(screen.getByText(/add a source/i)).toBeTruthy();
});

it("sources but no version → Create current (generate a draft)", () => {
  render(<TrustJourney detail={detail({ inputs: [{ id: "i", kind: "note", title: null, content: "x", source_ref: null, created_at: null }] })} isOwner />);
  expect(screen.getByText(/generate a draft/i)).toBeTruthy();
});

it("a version, none validated → Validate current; owner invites, reviewer reviews", () => {
  const d = detail({ inputs: [{ id: "i", kind: "note", title: null, content: "x", source_ref: null, created_at: null }], ...withVersion(false) });
  const { rerender } = render(<TrustJourney detail={{ ...d, my_role: "owner" }} isOwner />);
  expect(screen.getByText(/invite an expert/i)).toBeTruthy();
  rerender(<TrustJourney detail={{ ...d, my_role: "reviewer" }} isOwner={false} />);
  expect(screen.getByText(/review the latest version/i)).toBeTruthy();
});

it("a validated version → Share step (both roles), never claims validation early", () => {
  const d = detail({ inputs: [{ id: "i", kind: "note", title: null, content: "x", source_ref: null, created_at: null }], ...withVersion(true) });
  render(<TrustJourney detail={d} isOwner />);
  expect(screen.getByText(/Posts tab/i)).toBeTruthy();
});
