import React, { useState } from "react";
import { Text } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { TopicTreeEditor } from "../../src/components/TopicTreeEditor";
import type { StructuredTOC } from "../../src/types/book";

const INITIAL: StructuredTOC = {
  subjects: [
    {
      subject_label: "Physics",
      units: [
        { title: "Kinematics", subtopics: ["Speed"], prerequisites: [] },
        { title: "Dynamics", subtopics: [], prerequisites: ["Kinematics"] },
      ],
    },
  ],
};

// Stateful harness so edits flow back through onChange and re-render the tree,
// exercising the component exactly as a screen would.
function Harness({ initial }: { initial: StructuredTOC }) {
  const [toc, setToc] = useState(initial);
  return (
    <>
      <TopicTreeEditor toc={toc} onChange={setToc} />
      <Text testID="json">{JSON.stringify(toc)}</Text>
    </>
  );
}

function currentToc(): StructuredTOC {
  return JSON.parse(screen.getByTestId("json").props.children as string);
}

describe("TopicTreeEditor", () => {
  it("renders subjects, units, and subtopics", () => {
    render(<Harness initial={INITIAL} />);
    expect(screen.getByDisplayValue("Physics")).toBeTruthy();
    expect(screen.getByDisplayValue("Kinematics")).toBeTruthy();
    expect(screen.getByDisplayValue("Speed")).toBeTruthy();
  });

  it("shows prerequisites as read-only chips", () => {
    render(<Harness initial={INITIAL} />);
    expect(screen.getByText("Requires:")).toBeTruthy();
  });

  it("edits a topic title", () => {
    render(<Harness initial={INITIAL} />);
    fireEvent.changeText(screen.getByLabelText("Topic 1.1 title"), "Motion");
    expect(currentToc().subjects[0].units[0].title).toBe("Motion");
  });

  it("adds a topic to a subject", () => {
    render(<Harness initial={INITIAL} />);
    fireEvent.press(screen.getByLabelText("Add topic to subject 1"));
    expect(currentToc().subjects[0].units).toHaveLength(3);
  });

  it("removes a topic", () => {
    render(<Harness initial={INITIAL} />);
    fireEvent.press(screen.getByLabelText("Remove topic 1.1"));
    const units = currentToc().subjects[0].units;
    expect(units).toHaveLength(1);
    expect(units[0].title).toBe("Dynamics");
  });

  it("reorders topics with move-down", () => {
    render(<Harness initial={INITIAL} />);
    fireEvent.press(screen.getByLabelText("Move topic 1.1 down"));
    const titles = currentToc().subjects[0].units.map((u) => u.title);
    expect(titles).toEqual(["Dynamics", "Kinematics"]);
  });

  it("adds and edits a subtopic", () => {
    render(<Harness initial={INITIAL} />);
    fireEvent.press(screen.getByLabelText("Add subtopic to topic 1.1"));
    expect(currentToc().subjects[0].units[0].subtopics).toHaveLength(2);
    fireEvent.changeText(screen.getByLabelText("Subtopic 1.1.2"), "Velocity");
    expect(currentToc().subjects[0].units[0].subtopics[1]).toBe("Velocity");
  });

  it("adds a subject", () => {
    render(<Harness initial={INITIAL} />);
    fireEvent.press(screen.getByLabelText("Add subject"));
    expect(currentToc().subjects).toHaveLength(2);
  });
});
