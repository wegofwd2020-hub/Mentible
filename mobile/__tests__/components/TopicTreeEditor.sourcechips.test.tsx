import React, { useState } from "react";
import { Text } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { TopicTreeEditor } from "../../src/components/TopicTreeEditor";
import type { StructuredTOC } from "../../src/types/book";

const TOC_WITH_SOURCE_IDS: StructuredTOC = {
  subjects: [
    {
      subject_label: "Physics",
      units: [
        { title: "Kinematics", subtopics: ["Speed"], prerequisites: [], source_ids: ["i1"] },
        { title: "Dynamics", subtopics: [], prerequisites: [] },
      ],
    },
  ],
};

const sourceLabel = (id: string) => (id === "i1" ? "S1" : "S?");

// Stateful harness so edits flow back through onChange and re-render the
// tree, exercising the component exactly as a screen would.
function Harness({
  initial,
  withSourceLabel,
}: {
  initial: StructuredTOC;
  withSourceLabel: boolean;
}) {
  const [toc, setToc] = useState(initial);
  return (
    <>
      <TopicTreeEditor
        toc={toc}
        onChange={setToc}
        sourceLabel={withSourceLabel ? sourceLabel : undefined}
      />
      <Text testID="json">{JSON.stringify(toc)}</Text>
    </>
  );
}

function currentToc(): StructuredTOC {
  return JSON.parse(screen.getByTestId("json").props.children as string);
}

describe("TopicTreeEditor source coverage chips", () => {
  it("renders a read-only source chip via sourceLabel when the unit has source_ids", () => {
    render(<Harness initial={TOC_WITH_SOURCE_IDS} withSourceLabel />);
    expect(screen.getByText("S1")).toBeTruthy();
    expect(screen.getByText("Sources:")).toBeTruthy();
  });

  it("renders nothing new when sourceLabel is not provided (Studio path unaffected)", () => {
    render(<Harness initial={TOC_WITH_SOURCE_IDS} withSourceLabel={false} />);
    expect(screen.queryByText("S1")).toBeNull();
    expect(screen.queryByText("Sources:")).toBeNull();
  });

  it("preserves source_ids through an edit (title change)", () => {
    render(<Harness initial={TOC_WITH_SOURCE_IDS} withSourceLabel />);
    fireEvent.changeText(screen.getByLabelText("Topic 1.1 title"), "Motion");
    expect(currentToc().subjects[0].units[0].source_ids).toEqual(["i1"]);
  });

  it("preserves source_ids through a reorder (move down)", () => {
    render(<Harness initial={TOC_WITH_SOURCE_IDS} withSourceLabel />);
    fireEvent.press(screen.getByLabelText("Move topic 1.1 down"));
    const units = currentToc().subjects[0].units;
    expect(units[1].title).toBe("Kinematics");
    expect(units[1].source_ids).toEqual(["i1"]);
  });
});
