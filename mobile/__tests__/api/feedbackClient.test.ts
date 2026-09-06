import { sendFeedback } from "@/api/feedbackClient";

jest.mock("@/api/client", () => ({
  authedFetch: jest.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, body: string) { super(body); this.status = status; }
  },
}));
import { authedFetch } from "@/api/client";

const body = {
  name: "Jane", type: "bug" as const, text: "broke", contact_preference: "email_follow_up" as const, page: "/x",
};

it("POSTs the feedback and returns the id", async () => {
  (authedFetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ id: "f1" }) });
  const out = await sendFeedback(body, "tok");
  expect(out).toEqual({ id: "f1" });
  const [path, token, init] = (authedFetch as jest.Mock).mock.calls[0];
  expect(path).toBe("/feedback");
  expect(token).toBe("tok");
  expect(init.method).toBe("POST");
  expect(JSON.parse(init.body)).toMatchObject({ type: "bug", page: "/x" });
});

it("throws ApiError on non-ok", async () => {
  (authedFetch as jest.Mock).mockResolvedValue({ ok: false, status: 429, text: async () => "slow" });
  await expect(sendFeedback(body, "tok")).rejects.toMatchObject({ status: 429 });
});
