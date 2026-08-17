import React from "react";
import { render, screen } from "@testing-library/react-native";
import { QualityCard } from "@/components/QualityCard";
import type { QualityReport } from "@/api/trustClient";

// QualityCard surfaces the quality report (coverage + readability + grounding
// summary) on the trust version screens — see task-6-brief.md. Fail-open: a
// missing/null quality (older backend) renders nothing. NO color-literal
// asserts (useThemedStyles) — text/presence only.

const baseQuality: QualityReport = {
  coverage: { sections_total: 10, sections_cited: 8, uncited_section_indexes: [2, 5], dangling: [], source_refs: 9 },
  readability: { flesch_reading_ease: 45.3, grade_level: 11.2, words: 500, sentences: 30 },
  grounding: null,
};

describe("QualityCard", () => {
  it("renders nothing when quality is null (fail-open for an older backend)", () => {
    const { toJSON } = render(
      <QualityCard quality={null} isOwner busy={false} onRunGrounding={jest.fn()} />,
    );
    expect(toJSON()).toBeNull();
  });

  it("renders nothing when quality is undefined", () => {
    const { toJSON } = render(
      <QualityCard quality={undefined} isOwner busy={false} onRunGrounding={jest.fn()} />,
    );
    expect(toJSON()).toBeNull();
  });

  it("renders the coverage and readability summary from the quality prop", () => {
    render(<QualityCard quality={baseQuality} isOwner busy={false} onRunGrounding={jest.fn()} />);
    expect(screen.getByText("8/10 sections cite a source")).toBeTruthy();
    expect(screen.getByText(/Grade 11.2/)).toBeTruthy();
  });

  it("shows an uncited/dangling sub-note when coverage has gaps", () => {
    render(<QualityCard quality={baseQuality} isOwner busy={false} onRunGrounding={jest.fn()} />);
    expect(screen.getByText(/uncited: 2/)).toBeTruthy();
    expect(screen.getByText(/dangling: 0/)).toBeTruthy();
  });

  it("owner sees the Run grounding check button when grounding is null", () => {
    render(<QualityCard quality={baseQuality} isOwner busy={false} onRunGrounding={jest.fn()} />);
    expect(screen.getByLabelText("Run grounding check")).toBeTruthy();
  });

  it("non-owner does not see the Run grounding check button", () => {
    render(<QualityCard quality={baseQuality} isOwner={false} busy={false} onRunGrounding={jest.fn()} />);
    expect(screen.queryByLabelText("Run grounding check")).toBeNull();
  });

  it("shows the button as busy while a check is running", () => {
    render(<QualityCard quality={baseQuality} isOwner busy onRunGrounding={jest.fn()} />);
    const btn = screen.getByLabelText("Run grounding check");
    expect(btn.props.accessibilityState?.busy).toBe(true);
  });

  it("renders the claims-supported summary and hides the run button once grounding exists", () => {
    const withGrounding: QualityReport = {
      ...baseQuality,
      grounding: {
        claims_total: 47, supported: 41, partial: 4, unsupported: 2,
        by_section: [], model: "claude-sonnet-4-6", checked_at: "2026-08-16T12:00:00Z", stale: false,
      },
    };
    render(<QualityCard quality={withGrounding} isOwner busy={false} onRunGrounding={jest.fn()} />);
    expect(screen.getByText("41/47 claims supported")).toBeTruthy();
    expect(screen.queryByLabelText("Run grounding check")).toBeNull();
    expect(screen.queryByText(/inputs changed/)).toBeNull();
  });

  it("shows a stale re-run note when the grounding check is stale", () => {
    const stale: QualityReport = {
      ...baseQuality,
      grounding: {
        claims_total: 47, supported: 41, partial: 4, unsupported: 2,
        by_section: [], model: "claude-sonnet-4-6", checked_at: "2026-08-16T12:00:00Z", stale: true,
      },
    };
    render(<QualityCard quality={stale} isOwner busy={false} onRunGrounding={jest.fn()} />);
    expect(screen.getByText(/inputs changed/i)).toBeTruthy();
  });
});
