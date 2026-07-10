/**
 * @jest-environment jsdom
 */
import { sanitizeFragment } from "@/reader/sanitize";

// Matches an opening tag exactly, so `<animate>` does not match `<animateMotion>`.
const hasTag = (html: string, tag: string) =>
  new RegExp(`<${tag}[\\s/>]`, "i").test(html);

describe("sanitizeFragment — strips executable content", () => {
  it.each([
    ["script tag", "<p>hi</p><script>alert(1)</script>"],
    ["svg script", "<svg><script>alert(1)</script></svg>"],
    ["img onerror", '<img src="x" onerror="alert(1)">'],
    ["svg onload", '<svg onload="alert(1)"><rect onclick="x()"/></svg>'],
    ["javascript: href", '<a href="javascript:alert(1)">x</a>'],
    ["iframe", '<iframe src="https://evil.test"></iframe>'],
    ["object", '<object data="x"></object>'],
    ["embed", '<embed src="x">'],
    ["form", '<form action="https://evil.test"><input name="a"></form>'],
    ["foreignObject", '<svg><foreignObject><img src=x onerror=alert(1)></foreignObject></svg>'],
  ])("removes %s", (_label, payload) => {
    const out = sanitizeFragment(payload);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/\son\w+\s*=/i);
    expect(out).not.toMatch(/javascript:/i);
    expect(out).not.toMatch(/<iframe|<object|<embed|<form|<foreignobject/i);
  });
});

describe("sanitizeFragment — keeps content the reader needs", () => {
  it("keeps ordinary prose markup", () => {
    const out = sanitizeFragment("<h2>Title</h2><p><em>a</em> <code>b</code></p><table><tr><td>c</td></tr></table>");
    expect(out).toContain("<h2>Title</h2>");
    expect(out).toContain("<code>b</code>");
    expect(out).toContain("<td>c</td>");
  });

  it("keeps math delimiters as literal text for the KaTeX post-pass", () => {
    expect(sanitizeFragment("<p>$$x^2 + y^2$$</p>")).toContain("$$x^2 + y^2$$");
  });

  // Spec D7. DOMPurify's svg profile strips these three by default; the bundled
  // book `claude-certified-architect-foundations` has 26 animated-SVG figures
  // that depend on them.
  it.each(["animate", "animateTransform", "set"])(
    "keeps <%s> (allowlisted per spec D7)",
    (tag) => {
      const out = sanitizeFragment(
        `<svg><circle><${tag} attributeName="cx" values="0;10" dur="2s"/></circle></svg>`,
      );
      expect(hasTag(out, tag)).toBe(true);
    },
  );

  it("keeps <animateMotion> and <style> inside svg", () => {
    const out = sanitizeFragment(
      '<svg><style>@keyframes k{from{opacity:0}}</style><path><animateMotion dur="3s"/></path></svg>',
    );
    expect(hasTag(out, "animateMotion")).toBe(true);
    expect(out).toContain("@keyframes");
  });
});

// The D7 allowlist would normally reopen the classic SVG-animation XSS
// (`<animate attributeName="href" values="javascript:...">`). DOMPurify 3.4.11
// drops href-targeting animation attributes even for allowlisted tags. These
// tests pin that behaviour so a dependency downgrade cannot silently reopen it.
describe("sanitizeFragment — animation allowlist does not reopen the href vector", () => {
  it.each([
    ["animate/href", '<svg><a><animate attributeName="href" values="javascript:alert(1)"/></a></svg>'],
    ["set/xlink:href", '<svg><a><set attributeName="xlink:href" to="javascript:alert(1)"/></a></svg>'],
    ["animateTransform/href", '<svg><a><animateTransform attributeName="href" to="javascript:alert(1)"/></a></svg>'],
  ])("neutralises %s", (_label, payload) => {
    const out = sanitizeFragment(payload);
    expect(out).not.toMatch(/javascript:/i);
    expect(out).not.toMatch(/attributeName\s*=\s*"?(xlink:)?href/i);
  });
});
