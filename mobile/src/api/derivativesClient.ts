import { ApiError, resolveBaseUrl } from "./client";
import { IS_DEMO } from "@/constants/demo";

export type Platform = "linkedin" | "x";

export interface PostVariant {
  hook: string;
  body: string;
  hashtags: string[];
  cta?: string | null;
}

export interface MakePostRequest {
  source_text: string;
  platform: Platform;
  tone?: string;
  image?: { media_type: string; data: string }; // optional reference (FR-1b) — transient, never stored
  // Omit entirely (never send "") for a keyless managed-plan request — the
  // backend resolves the vendor key from the caller's entitlement instead.
  // Present = BYOK, passed through per-request (never logged/stored).
  api_key?: string;
  provider_id?: string; // default "anthropic"; omit → server default
  model?: string;
}

export interface MakePostResponse {
  platform: string;
  variants: PostVariant[]; // exactly 3 (server-enforced)
  provenance: string; // "ai-generated"
}

// Turn source text into platform-scoped social posts. Synchronous endpoint —
// the variants come back in the response body (no job/poll). Key-free client
// shape (no JWT): the caller populates api_key in the request; this module
// never reads or stores it. Mirrors trustClient's own fetch wrapper.
export async function makePost(req: MakePostRequest): Promise<MakePostResponse> {
  // A demo build has no backend; the Posts tab is hidden there, but never let a
  // request leave the device regardless (mirrors submitGenerate).
  if (IS_DEMO) throw new Error("Making a post is disabled in this demo build.");
  const res = await fetch(`${resolveBaseUrl()}/api/v1/derivatives/post`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider_id: "anthropic", ...req }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body);
  }
  return res.json() as Promise<MakePostResponse>;
}

export type CardSize = "square" | "linkedin" | "story";

export interface MakeCardResponse {
  card: { headline: string; subtext: string; source_label: string | null };
  size: CardSize;
  image_png_base64: string;
  provenance: string;
}

export interface MakeCardRequest {
  // Exactly one of source_text / topic_version_id — the caller (the Publish
  // screen's card mode) enforces that, this module just forwards it.
  source_text?: string;
  topic_version_id?: string;
  size: CardSize;
  tone?: string;
  // Omit entirely (never send "") for a keyless managed-plan request — the
  // backend resolves the vendor key from the caller's entitlement instead.
  // Present = BYOK, passed through per-request (never logged/stored).
  api_key?: string;
  provider_id?: string; // default "anthropic"; omit → server default
  model?: string;
}

// Turn source text (or a validated topic-version's content) into a branded,
// shareable image card. Synchronous endpoint, mirrors makePost. Key-free
// client shape (no JWT) — the caller populates api_key in the request; this
// module never reads or stores it.
export async function makeCard(req: MakeCardRequest): Promise<MakeCardResponse> {
  // A demo build has no backend; the Publish tab is hidden there, but never
  // let a request leave the device regardless (mirrors makePost).
  if (IS_DEMO) throw new Error("Making a card is disabled in this demo build.");
  const res = await fetch(`${resolveBaseUrl()}/api/v1/derivatives/card`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider_id: "anthropic", ...req }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body);
  }
  return res.json() as Promise<MakeCardResponse>;
}

export interface CarouselFrame {
  card: { headline: string; subtext: string; source_label: string | null };
  image_png_base64: string;
}

export interface MakeCarouselResponse {
  frames: CarouselFrame[];
  provenance: string;
}

export interface MakeCarouselRequest {
  // Exactly one of source_text / topic_version_id — the caller (the Publish
  // screen's carousel mode) enforces that, this module just forwards it.
  source_text?: string;
  topic_version_id?: string;
  tone?: string;
  // Omit entirely (never send "") for a keyless managed-plan request — the
  // backend resolves the vendor key from the caller's entitlement instead.
  // Present = BYOK, passed through per-request (never logged/stored).
  api_key?: string;
  provider_id?: string; // default "anthropic"; omit → server default
  model?: string;
}

// Turn source text (or a validated topic-version's content) into a branded,
// multi-frame (4-8) image carousel. Synchronous endpoint, mirrors makeCard.
// Key-free client shape (no JWT) — the caller populates api_key in the
// request; this module never reads or stores it.
export async function makeCarousel(req: MakeCarouselRequest): Promise<MakeCarouselResponse> {
  // A demo build has no backend; the Publish tab is hidden there, but never
  // let a request leave the device regardless (mirrors makeCard).
  if (IS_DEMO) throw new Error("Making a carousel is disabled in this demo build.");
  const res = await fetch(`${resolveBaseUrl()}/api/v1/derivatives/carousel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider_id: "anthropic", ...req }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body);
  }
  return res.json() as Promise<MakeCarouselResponse>;
}
