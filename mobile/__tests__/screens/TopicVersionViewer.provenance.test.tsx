import React from "react";
import { render, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "tv1", projectId: "p1" }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));
jest.mock("@/hooks/useTrustProject", () => ({
  useTrustProject: () => ({ project: { my_role: "reviewer" }, approveTopic: jest.fn(), withdrawTopic: jest.fn() }),
}));
jest.mock("@/api/trustClient", () => ({
  getTopicVersion: jest.fn(async () => ({
    id: "tv1", topic_id: "t1", title: "Reading music",
    content: { sections: [{ heading: "Staff", body: "5 lines", source_ids: [] }] },
    version_no: 1, created_at: null, is_validated: false, recorded_via: null, generation_meta: null,
  })),
}));

// Section bodies render through TopicRenderer (visuals T2), which on native
// goes through a react-native-webview host — stub it so the module loads
// under jest. Unlike TopicVersionViewer.test.tsx, this stub does NOT surface
// the built html as text: that html carries incidental "source"-substring
// matches (e.g. font/CSS strings) that would let the provenance assertion
// below pass for the wrong reason (mirrors TrustVersion.read.test.tsx's
// `default: () => null` stub for the same reason).
jest.mock("react-native-webview", () => ({ default: () => null }));

import { getTopicVersion } from "@/api/trustClient";
import TopicVersionViewer from "@/../app/trust/topic-version/[id]";

it("renders a provenance line from generation_meta's source count", async () => {
  (getTopicVersion as jest.Mock).mockResolvedValueOnce({
    id: "tv1", topic_id: "t1", title: "Reading music",
    content: { sections: [{ heading: "Staff", body: "5 lines", source_ids: [] }] },
    version_no: 1, created_at: null, is_validated: false, recorded_via: null,
    generation_meta: { source_input_ids: ["a", "b"] },
  });
  const { getByText } = render(<TopicVersionViewer />);
  await waitFor(() => expect(getByText(/source/)).toBeTruthy());
});

it("still renders a provenance fallback when generation_meta is null (no crash)", async () => {
  const { getByText } = render(<TopicVersionViewer />);
  await waitFor(() => expect(getByText("Reading music")).toBeTruthy());
  expect(getByText("Generated draft")).toBeTruthy();
});
