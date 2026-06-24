import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

const mockReplace = jest.fn();

// Screen is wrapped in RequireSignIn — present as signed in so the gate passes
// through to the screen under test.
jest.mock("../../src/auth/AuthProvider", () => ({
  useAuth: () => ({ status: "signed_in", session: null, accessToken: null }),
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, back: jest.fn() }),
}));

jest.mock("../../src/api/client", () => ({
  submitStructure: jest.fn(),
  getStructureJob: jest.fn(),
}));

jest.mock("../../src/secure/keyStore", () => ({
  loadApiKey: jest.fn(),
}));

jest.mock("../../src/storage/bookStore", () => ({
  saveBook: jest.fn().mockResolvedValue(undefined),
  ensureTopicIds: (toc: unknown) => toc,
}));

const { submitStructure, getStructureJob } = require("../../src/api/client") as {
  submitStructure: jest.Mock;
  getStructureJob: jest.Mock;
};
const { loadApiKey } = require("../../src/secure/keyStore") as { loadApiKey: jest.Mock };

import NewBookScreen from "../../app/book/new";

const SAMPLE_TOC = {
  subjects: [
    {
      subject_label: "Physics",
      units: [{ title: "Kinematics", subtopics: ["Speed"], prerequisites: [] }],
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  loadApiKey.mockResolvedValue("sk-ant-FAKE_KEY_test_12345");
});

describe("NewBookScreen", () => {
  it("submits the pasted TOC and shows the editable tree when structuring is done", async () => {
    submitStructure.mockResolvedValue({ job_id: "j1", status: "queued" });
    getStructureJob.mockResolvedValue({ job_id: "j1", status: "done", result: SAMPLE_TOC });

    render(<NewBookScreen />);
    fireEvent.changeText(
      screen.getByLabelText("Table of contents input"),
      "Physics\n- Kinematics: speed",
    );
    fireEvent.press(screen.getByLabelText("Structure table of contents"));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Physics")).toBeTruthy();
    });
    expect(screen.getByDisplayValue("Kinematics")).toBeTruthy();
    expect(submitStructure).toHaveBeenCalledWith(
      expect.objectContaining({
        raw_toc: "Physics\n- Kinematics: speed",
        api_key: "sk-ant-FAKE_KEY_test_12345",
      }),
    );
  });

  it("shows an error and a retry affordance when structuring fails", async () => {
    submitStructure.mockResolvedValue({ job_id: "j1", status: "queued" });
    getStructureJob.mockResolvedValue({
      job_id: "j1",
      status: "failed",
      error: "could not structure the table of contents — try rephrasing it",
    });

    render(<NewBookScreen />);
    fireEvent.changeText(screen.getByLabelText("Table of contents input"), "garbled");
    fireEvent.press(screen.getByLabelText("Structure table of contents"));

    await waitFor(() => {
      expect(screen.getByText(/Couldn’t structure that/)).toBeTruthy();
    });
    expect(screen.getByLabelText("Back to editing the table of contents")).toBeTruthy();
  });

  it("blocks submission and warns when no API key is saved", async () => {
    loadApiKey.mockResolvedValue(null);

    render(<NewBookScreen />);
    fireEvent.changeText(screen.getByLabelText("Table of contents input"), "Physics");
    fireEvent.press(screen.getByLabelText("Structure table of contents"));

    await waitFor(() => {
      expect(screen.getByText(/No API key saved/)).toBeTruthy();
    });
    expect(submitStructure).not.toHaveBeenCalled();
  });
});
