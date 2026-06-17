import { buildTopicPrompt, buildTopicInstructions } from "@/hooks/topicPrompt";

describe("buildTopicPrompt", () => {
  it("folds short LABELS into the topic line (object subtopics)", () => {
    const topic = buildTopicPrompt("Agentic loops", [
      { label: "Loop lifecycle", detail: "A very long description of the loop lifecycle…" },
      { label: "Tool results", detail: "How results are appended to history…" },
    ]);
    expect(topic).toBe("Agentic loops — covering: Loop lifecycle, Tool results");
  });

  it("still works with legacy string subtopics", () => {
    expect(buildTopicPrompt("Kinematics", ["Speed", "Velocity"])).toBe(
      "Kinematics — covering: Speed, Velocity",
    );
  });

  it("returns the bare title when there are no subtopics", () => {
    expect(buildTopicPrompt("Standalone", [])).toBe("Standalone");
  });

  it("caps the folded topic at 500 chars", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ label: `Label number ${i}` }));
    expect(buildTopicPrompt("T", many).length).toBeLessThanOrEqual(500);
  });
});

describe("buildTopicInstructions", () => {
  it("carries subtopic detail as generation guidance", () => {
    const instr = buildTopicInstructions([
      { label: "Loop lifecycle", detail: "Send request, inspect stop_reason, execute tools." },
      { label: "Tool results", detail: "Append results to conversation history." },
    ]);
    expect(instr).toContain("Make sure to cover these subtopics:");
    expect(instr).toContain("- Loop lifecycle: Send request, inspect stop_reason, execute tools.");
    expect(instr).toContain("- Tool results: Append results to conversation history.");
  });

  it("appends author enhancement after the subtopic detail", () => {
    const instr = buildTopicInstructions(
      [{ label: "Loop lifecycle", detail: "Send request…" }],
      "Add a worked example.",
    );
    expect(instr).toContain("Send request…");
    expect(instr).toContain("Add a worked example.");
  });

  it("returns just the enhancement when subtopics have no detail (legacy strings)", () => {
    expect(buildTopicInstructions(["Speed", "Velocity"], "Add a diagram.")).toBe("Add a diagram.");
  });

  it("returns undefined when there is nothing to add", () => {
    expect(buildTopicInstructions(["Speed", "Velocity"])).toBeUndefined();
    expect(buildTopicInstructions([])).toBeUndefined();
  });
});
