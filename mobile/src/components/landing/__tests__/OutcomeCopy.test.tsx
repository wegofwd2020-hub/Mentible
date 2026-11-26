import { render } from "@testing-library/react-native";
import { Phases, PHASES, PHASES_HEADING } from "@/components/landing/Phases";
import { FORMATS } from "@/components/landing/Formats";

// Mock data: the copy constants are the fixture. Tests pin the approved outcome copy
// (see docs/openspec/changes/landing-outcome-copy/) so drift is caught in CI.

test("How it works heading and four steps with 'You get' lines", () => {
  expect(PHASES_HEADING).toBe(
    "From your material to a published book, with every claim traceable.",
  );
  expect(PHASES.map((p) => p.name)).toEqual(["Capture", "Create", "Validate", "Publish"]);
  PHASES.forEach((p) => expect(p.youGet.length).toBeGreaterThan(0));
});

test("each step renders its 'You get' label on the rendered page", () => {
  const { getAllByText } = render(<Phases />);
  expect(getAllByText(/You get:/)).toHaveLength(4);
});

test("illustrative example block is removed", () => {
  const { queryByText } = render(<Phases />);
  expect(queryByText(/Illustrative example/)).toBeNull();
  expect(queryByText(/40-page guide/)).toBeNull();
});

test("'Eleven formats' stat matches the Formats list (claim verification)", () => {
  expect(FORMATS).toHaveLength(11);
});

test("step 02 describes the grounding check that the backend implements", () => {
  const create = PHASES.find((p) => p.name === "Create");
  expect(create?.body).toMatch(/grounding check flags any sentence the sources do not support/);
});
