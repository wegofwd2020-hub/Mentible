/**
 * Security regression test for the web reader.
 *
 * On web, LessonRenderer/TopicRenderer render model- and (via ADR-027 sharing)
 * other-user-authored content into a `blob:` iframe. A `blob:` URL inherits the
 * creating page's origin, so without a `sandbox` attribute that frame is
 * SAME-ORIGIN with the app and can read `localStorage` — where the Supabase
 * session (src/lib/supabase.ts) and the BYOK LLM key (src/secure/keyStore.ts)
 * live on web. A malicious `<img onerror>` in a shared book could therefore
 * exfiltrate the session token and the API key.
 *
 * The fix is `sandbox="allow-scripts"` WITHOUT `allow-same-origin`: scripts still
 * run (KaTeX/Mermaid/marked need that) but the frame gets a null origin and
 * cannot touch the parent's storage. This test locks that in — in particular it
 * fails loudly if anyone ever adds `allow-same-origin`, which would silently
 * re-open the hole (allow-scripts + allow-same-origin lets a frame remove its
 * own sandbox).
 */
import React from "react";
import { Platform } from "react-native";
import { render } from "@testing-library/react-native";

// LessonRenderer does a module-level `require("react-native-webview")` (native
// only) that runs at import — before beforeAll can flip Platform.OS — and the
// native module isn't registered under jsdom. Stub it; the web branch we exercise
// never touches it.
jest.mock("react-native-webview", () => ({ default: () => null }));

// Force the web branch of LessonRenderer (the blob-iframe host). jest-expo
// defaults Platform.OS to "ios"; the field is assignable under jest.
beforeAll(() => {
  Platform.OS = "web";
});
afterAll(() => {
  Platform.OS = "ios";
});

import { LessonRenderer } from "@/components/LessonRenderer";
import type { LessonOutput } from "@/types/lesson";

const LESSON = {
  title: "T",
  sections: [{ heading: "H", body: "b" }],
} as unknown as LessonOutput;

describe("web reader iframe sandbox", () => {
  it("renders the content iframe with sandbox='allow-scripts'", () => {
    const { UNSAFE_root } = render(<LessonRenderer lesson={LESSON} />);
    const iframe = UNSAFE_root.findByType("iframe" as never);
    expect(iframe.props.sandbox).toBe("allow-scripts");
  });

  it("never grants the frame allow-same-origin (that would re-enable token exfiltration)", () => {
    const { UNSAFE_root } = render(<LessonRenderer lesson={LESSON} />);
    const iframe = UNSAFE_root.findByType("iframe" as never);
    expect(String(iframe.props.sandbox)).not.toContain("allow-same-origin");
  });

  it("delivers content via srcDoc, not a blob src (a sandboxed frame can't load a parent-origin blob)", () => {
    const { UNSAFE_root } = render(<LessonRenderer lesson={LESSON} />);
    const iframe = UNSAFE_root.findByType("iframe" as never);
    expect(typeof iframe.props.srcDoc).toBe("string");
    expect(iframe.props.src).toBeUndefined();
  });
});
