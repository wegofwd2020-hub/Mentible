import React from "react";
import { render, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "tv1" }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));
const mockUseAuth = jest.fn((): { accessToken: string | null; status: string } => ({ accessToken: "tok", status: "signed_in" }));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => mockUseAuth() }));
jest.mock("@/api/trustClient", () => ({
  getTopicVersion: jest.fn(async () => ({
    id: "tv1", topic_id: "t1", title: "Reading music",
    content: { sections: [{ heading: "Staff", body: "5 lines", source_ids: [] }] },
    version_no: 1, created_at: null, is_validated: true, recorded_via: "operator",
  })),
}));

import { getTopicVersion } from "@/api/trustClient";
import TopicVersionViewer from "@/../app/trust/topic-version/[id]";

it("renders the topic title, section content, and a validated indicator", async () => {
  const { getByText } = render(<TopicVersionViewer />);
  await waitFor(() => expect(getByText("Reading music")).toBeTruthy());
  expect(getByText("Staff")).toBeTruthy();
  expect(getByText("5 lines")).toBeTruthy();
  expect(getByText(/Validated/i)).toBeTruthy();
  expect(getByText(/operator/i)).toBeTruthy();
});

it("does not crash when there is no auth token", () => {
  mockUseAuth.mockReturnValueOnce({ accessToken: null, status: "signed_out" });
  const callsBefore = (getTopicVersion as jest.Mock).mock.calls.length;
  expect(() => render(<TopicVersionViewer />)).not.toThrow();
  expect((getTopicVersion as jest.Mock).mock.calls.length).toBe(callsBefore);
});
