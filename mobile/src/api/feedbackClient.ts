import { ApiError, authedFetch } from "@/api/client";

export type FeedbackType = "bug" | "feature" | "content_quality" | "pricing" | "other";
export type ContactPreference = "email_follow_up" | "feedback_only" | "schedule_call";

export interface FeedbackBody {
  name: string;
  company?: string;
  role?: string;
  type: FeedbackType;
  text: string;
  contact_preference: ContactPreference;
  page: string;
}

// Submit in-app feedback. The backend takes the submitter's email from the
// verified session — we never send it. Returns the created id.
export async function sendFeedback(body: FeedbackBody, token: string): Promise<{ id: string }> {
  const res = await authedFetch("/feedback", token, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(res.status, text);
  }
  return res.json() as Promise<{ id: string }>;
}
