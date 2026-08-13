import React from "react";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react-native";
import { Text, Pressable } from "react-native";
import { useTrustProject } from "@/hooks/useTrustProject";

jest.mock("@/api/trustClient", () => ({ getProject: jest.fn(), approveVersion: jest.fn() }));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));
jest.mock("@/secure/keyStore", () => ({ loadApiKey: jest.fn() }));
jest.mock("@/hooks/useBillingPlan", () => ({ useBillingPlan: jest.fn() }));
jest.mock("@/hooks/useGenerateVersionJob", () => ({ useGenerateVersionJob: jest.fn() }));
jest.mock("@/hooks/useSuggestTocJob", () => ({ useSuggestTocJob: jest.fn() }));
jest.mock("@/hooks/useGenerateTopicJob", () => ({ useGenerateTopicJob: jest.fn() }));
import * as tc from "@/api/trustClient";
import { loadApiKey } from "@/secure/keyStore";
import { useBillingPlan } from "@/hooks/useBillingPlan";
import { useGenerateVersionJob } from "@/hooks/useGenerateVersionJob";
import { useSuggestTocJob } from "@/hooks/useSuggestTocJob";
import { useGenerateTopicJob } from "@/hooks/useGenerateTopicJob";

function Probe() {
  const { project, approve } = useTrustProject("p1");
  return (
    <>
      <Text>{project ? project.project.title : "…"}</Text>
      <Pressable accessibilityLabel="approve" onPress={() => approve("v2")}><Text>go</Text></Pressable>
    </>
  );
}

// The hook now calls useBillingPlan() unconditionally on every render, so
// even tests that don't exercise a generator need a harmless default —
// null plan, not loading — so the generator wiring below is the only place
// that cares about a specific Pro/Free value.
beforeEach(() => {
  jest.clearAllMocks();
  (useBillingPlan as jest.Mock).mockReturnValue({ plan: null, loading: false });
  (useGenerateVersionJob as jest.Mock).mockReturnValue({ run: jest.fn() });
  (useSuggestTocJob as jest.Mock).mockReturnValue({ run: jest.fn() });
  (useGenerateTopicJob as jest.Mock).mockReturnValue({ run: jest.fn() });
});

it("loads the project and approve() calls the client then refreshes", async () => {
  (tc.getProject as jest.Mock).mockResolvedValue({ project: { id: "p1", title: "P" }, my_role: "reviewer", artifacts: [] });
  (tc.approveVersion as jest.Mock).mockResolvedValue({ id: "ap", version_id: "v2", recorded_via: "expert_self", expert_name: "e", approved_at: "t" });
  render(<Probe />);
  await waitFor(() => expect(screen.getByText("P")).toBeTruthy());
  fireEvent.press(screen.getByLabelText("approve"));
  await waitFor(() => expect(tc.approveVersion).toHaveBeenCalledWith("v2", expect.objectContaining({ approved_at: expect.any(String) }), "tok"));
  await waitFor(() => expect((tc.getProject as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2)); // refresh
});

// Keyless (managed) generation for Pro users with no saved BYOK key (Task 2).
// Decision: saved key => BYOK (unchanged); no key + Pro => keyless (apiKey
// undefined, never ""); no key + not-Pro (incl. plan: null) => the existing
// "No API key saved" throw.
describe("keyless-when-Pro wiring", () => {
  beforeEach(() => {
    (tc.getProject as jest.Mock).mockResolvedValue({ project: { id: "p1", title: "P" }, my_role: "owner", artifacts: [] });
  });

  it("suggestToc: no saved key + Pro resolves and calls the runner with apiKey: undefined", async () => {
    (loadApiKey as jest.Mock).mockResolvedValue(null);
    (useBillingPlan as jest.Mock).mockReturnValue({ plan: { is_pro: true }, loading: false });
    const runSuggest = jest.fn().mockResolvedValue({ subjects: [] });
    (useSuggestTocJob as jest.Mock).mockReturnValue({ run: runSuggest });

    const { result } = renderHook(() => useTrustProject("p1"));
    await waitFor(() => expect(tc.getProject).toHaveBeenCalledTimes(1));

    await act(async () => {
      await expect(result.current.suggestToc()).resolves.toEqual({ subjects: [] });
    });
    expect(runSuggest).toHaveBeenCalledTimes(1);
    expect(runSuggest.mock.calls[0][0].apiKey).toBeUndefined();
  });

  it("suggestToc: no saved key + not-Pro rejects with the add-a-key message", async () => {
    (loadApiKey as jest.Mock).mockResolvedValue(null);
    (useBillingPlan as jest.Mock).mockReturnValue({ plan: { is_pro: false }, loading: false });
    const runSuggest = jest.fn();
    (useSuggestTocJob as jest.Mock).mockReturnValue({ run: runSuggest });

    const { result } = renderHook(() => useTrustProject("p1"));
    await waitFor(() => expect(tc.getProject).toHaveBeenCalledTimes(1));

    await expect(result.current.suggestToc()).rejects.toThrow("No API key saved");
    expect(runSuggest).not.toHaveBeenCalled();
  });

  it("suggestToc: no saved key + plan: null rejects with the add-a-key message", async () => {
    (loadApiKey as jest.Mock).mockResolvedValue(null);
    (useBillingPlan as jest.Mock).mockReturnValue({ plan: null, loading: false });
    const runSuggest = jest.fn();
    (useSuggestTocJob as jest.Mock).mockReturnValue({ run: runSuggest });

    const { result } = renderHook(() => useTrustProject("p1"));
    await waitFor(() => expect(tc.getProject).toHaveBeenCalledTimes(1));

    await expect(result.current.suggestToc()).rejects.toThrow("No API key saved");
    expect(runSuggest).not.toHaveBeenCalled();
  });

  it("generateTopic: a saved key is always sent as BYOK, regardless of plan", async () => {
    const savedKey = "sk-ant-" + "x".repeat(20);
    (loadApiKey as jest.Mock).mockResolvedValue(savedKey);
    (useBillingPlan as jest.Mock).mockReturnValue({ plan: { is_pro: false }, loading: false });
    const runTopic = jest.fn().mockResolvedValue({ version_id: "tv1", topic_id: "t1", version_no: 1 });
    (useGenerateTopicJob as jest.Mock).mockReturnValue({ run: runTopic });

    const { result } = renderHook(() => useTrustProject("p1"));
    await waitFor(() => expect(tc.getProject).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.generateTopic("t1");
    });
    expect(runTopic).toHaveBeenCalledTimes(1);
    expect(runTopic.mock.calls[0][0].apiKey).toBe(savedKey);
  });

  it("generateTopic: no saved key + Pro resolves and calls the runner with apiKey: undefined", async () => {
    (loadApiKey as jest.Mock).mockResolvedValue(null);
    (useBillingPlan as jest.Mock).mockReturnValue({ plan: { is_pro: true }, loading: false });
    const runTopic = jest.fn().mockResolvedValue({ version_id: "tv1", topic_id: "t1", version_no: 1 });
    (useGenerateTopicJob as jest.Mock).mockReturnValue({ run: runTopic });

    const { result } = renderHook(() => useTrustProject("p1"));
    await waitFor(() => expect(tc.getProject).toHaveBeenCalledTimes(1));

    await act(async () => {
      await expect(result.current.generateTopic("t1")).resolves.toEqual({
        id: "tv1", topic_id: "t1", version_no: 1, created_at: null,
      });
    });
    expect(runTopic).toHaveBeenCalledTimes(1);
    expect(runTopic.mock.calls[0][0].apiKey).toBeUndefined();
  });

  it("generateTopic: no saved key + not-Pro rejects with the add-a-key message", async () => {
    (loadApiKey as jest.Mock).mockResolvedValue(null);
    (useBillingPlan as jest.Mock).mockReturnValue({ plan: { is_pro: false }, loading: false });
    const runTopic = jest.fn();
    (useGenerateTopicJob as jest.Mock).mockReturnValue({ run: runTopic });

    const { result } = renderHook(() => useTrustProject("p1"));
    await waitFor(() => expect(tc.getProject).toHaveBeenCalledTimes(1));

    await expect(result.current.generateTopic("t1")).rejects.toThrow("No API key saved");
    expect(runTopic).not.toHaveBeenCalled();
  });
});
