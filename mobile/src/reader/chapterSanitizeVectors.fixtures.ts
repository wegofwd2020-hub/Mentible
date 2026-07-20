// Shared attack-vector table for the imported-chapter render boundary (Task 6).
//
// Drives BOTH surfaces — `chapterSanitize.test.ts` (web, `sanitizeImportedChapterHtml`)
// and `importedChapter.test.ts` (native, the actual generated WebView document,
// executed for real via jsdom) — so `@/reader/sanitize`'s `makeChapterSanitizeHook`
// and `@/components/contentHtml`'s re-authored `CHAPTER_SANITIZE_HOOK_JS` cannot
// silently drift apart. Add a vector here once; both surfaces pick it up.
//
// NOT a test file itself — deliberately lives OUTSIDE `__tests__/`: jest-expo's
// testMatch collects EVERY file under a `__tests__/` directory as its own suite
// regardless of filename (`**/__tests__/**/*.[jt]s?(x)`, no "test"/"spec.
// required), so a fixture-only file placed there fails with "must contain at
// least one test." Living in `src/reader/` avoids that and reads naturally as
// "a small reusable module `@/reader/*` imports," which is what it is.
//
// The universal bar every vector is checked against: the sanitized output must
// contain no "evil.example". A few vectors add a SHARPER assertion beyond that,
// because "no evil.example" alone can't tell "dropped the whole tag" apart from
// "kept an empty/blanked attribute" — and the brief's amendments specifically
// require the former for an unmapped `<img>` (not "leave the src alone").

export interface ChapterSanitizeVector {
  name: string;
  html: string;
  images?: Record<string, string>;
  /** Extra assertions beyond "no evil.example", run against the sanitized output. */
  extra?: (out: string) => void;
}

function svgDataUri(evilHtml: string): string {
  const b64 =
    typeof Buffer !== "undefined"
      ? Buffer.from(evilHtml, "utf8").toString("base64")
      : btoa(evilHtml);
  return `data:image/svg+xml;base64,${b64}`;
}

export const CHAPTER_SANITIZE_VECTORS: ChapterSanitizeVector[] = [
  {
    name: "data-src decoy (Task 3's Critical #1) — decoy is inert, real src unmapped and dropped",
    html: '<img data-src="ok.png" src="https://evil.example/x">',
    extra: (out) => expect(out).not.toContain("<img"),
  },
  {
    name: "duplicate src (Task 3's Critical #2) — a real parser collapses to the first",
    html: '<img src="ok.png" src="https://evil.example/x">',
    images: { "ok.png": "data:image/png;base64,AAA=" },
    extra: (out) => expect(out).toContain('src="data:image/png;base64,AAA='),
  },
  {
    name: "srcset (Task 3's Critical #3) — invisible to a regex, always stripped here",
    html: '<img src="ok.png" srcset="https://evil.example/x 2x">',
    images: { "ok.png": "data:image/png;base64,AAA=" },
    extra: (out) => {
      expect(out).not.toContain("srcset");
      expect(out).toContain('src="data:image/png;base64,AAA='); // the real image still renders
    },
  },
  {
    name: "quote-blind [^>]* landmine (Task 3's Critical #4) — a real parser isn't fooled by > in alt",
    html: '<img alt="x>" src="https://evil.example/x">',
    extra: (out) => expect(out).not.toContain("<img"),
  },
  {
    name: "picture/source srcset — an entire vector a regex never reached",
    html: '<picture><source srcset="https://evil.example/x.png"><img src="ok.png"></picture>',
    images: { "ok.png": "data:image/png;base64,AAA=" },
    extra: (out) => {
      expect(out).not.toContain("srcset");
      expect(out).toContain('src="data:image/png;base64,AAA=');
    },
  },
  {
    name: "object data",
    html: '<object data="https://evil.example/x.swf"></object>',
    extra: (out) => expect(out).not.toContain("<object"),
  },
  {
    name: "iframe src",
    html: '<iframe src="https://evil.example/x"></iframe>',
    extra: (out) => expect(out).not.toContain("<iframe"),
  },
  {
    name: "video poster",
    html: '<video poster="https://evil.example/x.png"></video>',
    extra: (out) => expect(out).not.toContain("poster"),
  },
  {
    name: "inline style background:url(...) — a fetch/exfil channel, not just XSS",
    html: '<div style="background:url(https://evil.example/x.png)">hi</div>',
    extra: (out) => expect(out).not.toContain("url("),
  },
  {
    name: "img with NO map entry (oversize/unknown-mime) — dropped whole, not left dangling",
    html: '<img src="huge.png">',
    images: {},
    extra: (out) => expect(out).not.toContain("<img"),
  },
  {
    name: "a data: URI can BE A DOCUMENT — nested SVG carries its own remote href + <script>",
    html: `<img src="${svgDataUri(
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x.png"/><script>alert(1)</script></svg>',
    )}">`,
    extra: (out) => {
      const m = /src="(data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+)"/.exec(out);
      expect(m).not.toBeNull();
      const b64 = m![1].split(",")[1];
      const decoded = Buffer.from(b64, "base64").toString("utf8");
      expect(decoded).not.toContain("evil.example");
      expect(decoded).not.toContain("<script");
    },
  },
  {
    name: "<style> element with @import — a raw <style> block's CSS TEXT is never inspected by DOMPurify's default config, unlike the style ATTRIBUTE (Critical #1)",
    html: '<p>Before</p><style>@import url("https://evil.example/x.css");</style><p>After</p>',
    extra: (out) => expect(out).not.toContain("<style"),
  },
  {
    name: "<style> element with background:url(...) — same blind spot as the @import form (Critical #1)",
    html: "<p>Before</p><style>body{background:url(https://evil.example/x.png)}</style><p>After</p>",
    extra: (out) => expect(out).not.toContain("<style"),
  },
  {
    name: "<style>@import inside a nested SVG data: URI — defeats the SVG-recursion fix at any depth (Critical #1, 'worse')",
    html: `<img src="${svgDataUri(
      '<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(https://evil.example/x.css);</style><rect width="1" height="1"/></svg>',
    )}">`,
    extra: (out) => {
      const m = /src="(data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+)"/.exec(out);
      expect(m).not.toBeNull();
      const b64 = m![1].split(",")[1];
      const decoded = Buffer.from(b64, "base64").toString("utf8");
      expect(decoded).not.toContain("evil.example");
      expect(decoded).not.toContain("<style");
    },
  },
  {
    name: "anchor href to a remote URL that merely ENDS in a fragment must still die — only a href starting with # is exempt",
    html: '<a href="https://evil.example/#x">note</a>',
    extra: (out) => expect(out).not.toContain('href="https://evil.example'),
  },
  // The legacy presentational `background` attribute (WHATWG "non-conforming
  // features" — obsolete but still browser-honoured on these elements):
  // Chromium/WebView maps it to CSS `background-image` and FETCHES the URL.
  // DOMPurify's default `html` profile permits `background` on any allowed
  // element (it is not tag-scoped in DOMPurify's own ATTRS list), so a table
  // imported from an EPUB chapter can phone home via `<tr>`/`<td>` alone —
  // neither the `src` swap nor the other URI-attr checks touched it before
  // this attribute was added to the URI-attr list. `<table>`/`<tr>`/`<td>` are
  // the ones an attacker will actually reach for; `<thead>`/`<tbody>`/`<tfoot>`/
  // `<th>` are the rest of the WHATWG-listed set, covered so no sibling
  // element is a leftover blind spot.
  {
    name: "background on <table> — WHATWG legacy presentational attribute, fetched as background-image",
    html: '<table background="https://evil.example/table.png"><tr><td>hi</td></tr></table>',
    extra: (out) => expect(out).not.toContain("background"),
  },
  {
    name: "background on <tr> — same blind spot, one level down",
    html: '<table><tr background="https://evil.example/tr.png"><td>hi</td></tr></table>',
    extra: (out) => expect(out).not.toContain("background"),
  },
  {
    name: "background on <td> — same blind spot, the cell itself",
    html: '<table><tr><td background="https://evil.example/td.png">hi</td></tr></table>',
    extra: (out) => expect(out).not.toContain("background"),
  },
  {
    name: "background on <th>",
    html: '<table><tr><th background="https://evil.example/th.png">hi</th></tr></table>',
    extra: (out) => expect(out).not.toContain("background"),
  },
  {
    name: "background on <thead>",
    html: '<table><thead background="https://evil.example/thead.png"><tr><td>hi</td></tr></thead></table>',
    extra: (out) => expect(out).not.toContain("background"),
  },
  {
    name: "background on <tbody>",
    html: '<table><tbody background="https://evil.example/tbody.png"><tr><td>hi</td></tr></tbody></table>',
    extra: (out) => expect(out).not.toContain("background"),
  },
  {
    name: "background on <tfoot>",
    html: '<table><tfoot background="https://evil.example/tfoot.png"><tr><td>hi</td></tr></tfoot></table>',
    extra: (out) => expect(out).not.toContain("background"),
  },
  // SVG presentation attributes that take a CSS `url(...)` value (Critical #3).
  // DOMPurify's default `svg` profile permits all of these, and its
  // `_isValidAttribute` never screens them: it tests a value against
  // IS_ALLOWED_URI, a regex that only recognises a value as URI-shaped when it
  // starts with a bare `scheme:`. `fill="url(https://…)"` starts with `url(`,
  // so it lands in the regex's "not a URI, therefore inert" branch and passes
  // through verbatim. The `style` attribute has had a bespoke url() screen since
  // day one for exactly this reason; it was simply never extended to the
  // identical CSS-function syntax living under these other attribute names.
  ...(
    ["fill", "stroke", "filter", "mask", "clip-path", "marker-start", "marker-mid", "marker-end"] as const
  ).map((attr) => ({
    name: `${attr}="url(https://…)" — SVG presentation attribute, unscreened by DOMPurify and (before this fix) by the hook`,
    html: `<svg><rect ${attr}="url(https://evil.example/x.svg#a)" width="1" height="1"/></svg>`,
    extra: (out: string) => expect(out).not.toContain(attr + '="url('),
  })),
  {
    name: "fill url() quoted — quotes are legal CSS and must not smuggle the URL past the screen",
    html: '<svg><rect fill="url(\'https://evil.example/x.svg#a\')" width="1" height="1"/></svg>',
  },
  {
    name: "fill url() protocol-relative — inherits the page scheme, still a network destination",
    html: '<svg><rect fill="url(//evil.example/x.svg#a)" width="1" height="1"/></svg>',
  },
  {
    name: "fill paint FALLBACK form — a legit url(#local) followed by an external one; screening only the first url() would miss this",
    html: '<svg><defs><linearGradient id="g"/></defs><rect fill="url(#g) url(https://evil.example/x.svg#a)" width="1" height="1"/></svg>',
  },
  {
    name: "fill url() with leading whitespace + uppercase URL( — CSS is case-insensitive here",
    html: '<svg><rect fill="URL(  https://evil.example/x.svg#a )" width="1" height="1"/></svg>',
  },
  {
    name: "fill url() inside a nested SVG data: URI — the recursion path is the SAME hook, and must screen it at depth too",
    html: `<img src="${svgDataUri(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(https://evil.example/x.svg#a)" width="1" height="1"/></svg>',
    )}">`,
    extra: (out) => {
      const m = /src="(data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+)"/.exec(out);
      expect(m).not.toBeNull();
      const b64 = m![1].split(",")[1];
      const decoded = Buffer.from(b64, "base64").toString("utf8");
      expect(decoded).not.toContain("evil.example");
    },
  },
  // `color-profile` is the ONE url()-taking-by-reputation attribute in
  // DOMPurify's allowed svg set whose grammar is a BARE `<iri>`
  // (`auto | sRGB | <name> | <iri> | inherit`), not a `url(...)`. Screening it
  // with the url() regex would be a guard named for something it cannot check,
  // so it goes on the data:-only list with the other bare-URI attributes.
  {
    name: "color-profile bare <iri> — in DOMPurify's allowed svg set; a url() screen would never fire on it",
    html: '<svg><rect color-profile="https://evil.example/x.icc" width="1" height="1"/></svg>',
    extra: (out) => expect(out).not.toContain("color-profile"),
  },
  {
    name: "cite on <blockquote> — DOMPurify-default-allowed, survives verbatim; inert in today's engines but URI-bearing",
    html: '<blockquote cite="https://evil.example/x">quoted</blockquote>',
    extra: (out) => expect(out).toContain("<blockquote>"),
  },
  {
    name: "cite on <q>/<del>/<ins> — the rest of the cite-bearing set",
    html: '<q cite="https://evil.example/q">a</q><del cite="https://evil.example/d">b</del><ins cite="https://evil.example/i">c</ins>',
    extra: (out) => expect(out).not.toContain("cite"),
  },

  // -------------------------------------------------------------------------
  // ROUND 4 (Critical #4) — CSS is not screenable by a token blocklist.
  //
  // Rounds 1-3 screened CSS by hunting for the `url(` token: the `style`
  // attribute's day-one regex, then fix #3's SVG paint-attribute screen. Round
  // 4 defeated BOTH with three independent mechanisms, every one verified as a
  // REAL fetch in Chromium 150 (hit-logging server + Playwright, with controls
  // proving the harness observes hits):
  //
  //   1. `image-set()` — a fetching CSS function that takes a BARE STRING. No
  //      `url(` token exists in the value at all.
  //   2. CSS escapes — `\75 rl(` IS `url(` to the CSS parser. The token the
  //      blocklist looks for is never literally present.
  //   3. `var()` indirection — the URL lives in a custom property as a plain
  //      quoted string, and the attribute that actually fetches contains NO
  //      fetching token whatsoever.
  //
  // Mechanism 3 is the proof that no token blocklist can EVER be complete:
  // the fetching declaration and the URL are in different attributes, and
  // neither one, read alone, contains anything a blocklist could match on.
  // Adding `image-set` to the pattern would be the same trap a fifth time.
  //
  // Hence the strategy change these vectors pin (see `@/reader/sanitize`):
  //   (a) the `style` attribute is DROPPED ENTIRELY for imported chapters —
  //       there is no CSS surface left to screen. Spec D-I3 already drops the
  //       EPUB's CSS and FORBID_TAGS already kills the <style> ELEMENT; the
  //       surviving `style` ATTRIBUTE was the inconsistency, not a feature.
  //   (b) the eight SVG paint attributes are ALLOWLISTED to a strict safe
  //       grammar (plain colour/keyword/number, or exactly `url(#ident)`),
  //       so the failure mode is over-refusal instead of "leak whatever we
  //       didn't think of".
  //
  // Every vector below leaked on BOTH surfaces before the inversion.

  // Mechanism 1 — `image-set()` takes a bare string: there is no `url(` token
  // to blocklist. Confirmed fetching in Chromium 150 through each of these
  // properties.
  ...(
    [
      "background-image",
      "background",
      "border-image-source",
      "list-style-image",
      "content",
      "mask-image",
      "-webkit-mask-image",
      "shape-outside",
      "cursor",
    ] as const
  ).map((prop) => ({
    name: `image-set() bare string via CSS \`${prop}\` — fetches with NO url( token present anywhere in the value`,
    html: `<div style="${prop}: image-set('https://evil.example/i.png' 1x)">hi</div>`,
    extra: (out: string) => expect(out).not.toContain("style="),
  })),
  {
    name: "image-set() on the SVG `mask` ATTRIBUTE — same bare-string mechanism, this time past fix #3's url() paint screen",
    html: '<svg><rect mask="image-set(\'https://evil.example/m.png\' 1x)" width="1" height="1"/></svg>',
    extra: (out) => expect(out).not.toContain("mask="),
  },

  // Mechanism 2 — CSS escapes. `\75` is the codepoint of `u`, so `\75 rl(` is
  // parsed as `url(`. The blocklisted token is never literally present.
  {
    name: "CSS escape \\75 rl( in style — `\\75 rl(` IS `url(` to the CSS parser; the literal token never appears",
    html: "<div style=\"background-image: \\75 rl('https://evil.example/a.png')\">hi</div>",
    extra: (out) => expect(out).not.toContain("style="),
  },
  {
    name: "CSS escape \\00075 rl( in style — zero-padded to the full 6-digit form, same result",
    html: "<div style=\"background-image: \\00075 rl('https://evil.example/b.png')\">hi</div>",
    extra: (out) => expect(out).not.toContain("style="),
  },
  {
    name: "CSS escape U\\52 L( in style — CSS keywords are case-insensitive, so only the R is escaped",
    html: "<div style=\"background-image: U\\52 L('https://evil.example/c.png')\">hi</div>",
    extra: (out) => expect(out).not.toContain("style="),
  },
  ...(["fill", "mask", "filter", "clip-path"] as const).map((attr) => ({
    name: `CSS escape \\75 rl( on the SVG \`${attr}\` attribute — defeats fix #3's url() paint screen the same way`,
    html: `<svg><rect ${attr}="\\75 rl('https://evil.example/${attr}.svg#a')" width="1" height="1"/></svg>`,
    extra: (out: string) => expect(out).not.toContain(attr + "="),
  })),

  // Mechanism 3 — var() indirection. THE reason this fix cannot be another
  // regex: the URL sits in a custom property as a plain quoted string, and the
  // declaration that fetches it contains no fetching token at all. Neither
  // attribute, read in isolation, is matchable by any token blocklist.
  {
    name: "var() indirection — URL in a custom property, fetching declaration has NO fetching token; unblocklistable in principle",
    html:
      '<div style="--a:\'https://evil.example/v.png\'">' +
      '<div style="background-image:image-set(var(--a) 1x)">hi</div></div>',
    extra: (out) => expect(out).not.toContain("style="),
  },

  // The recursion path: a nested `data:image/svg+xml` payload is decoded and
  // re-sanitized as its own document. Round 4 found `image-set` surviving it
  // intact — the nested sanitize call has its OWN config, so a fix applied only
  // to the top-level config would miss this entirely.
  {
    name: "image-set() in a style attr inside a nested SVG data: URI — the recursion path re-sanitizes with its own config and must drop style too",
    html: `<img src="${svgDataUri(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect style="background-image:image-set(\'https://evil.example/nested.png\' 1x)" width="1" height="1"/></svg>',
    )}">`,
    extra: (out) => {
      const m = /src="(data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+)"/.exec(out);
      expect(m).not.toBeNull();
      const b64 = m![1].split(",")[1];
      const decoded = Buffer.from(b64, "base64").toString("utf8");
      expect(decoded).not.toContain("evil.example");
      expect(decoded).not.toContain("style=");
    },
  },
  {
    name: "CSS escape \\75 rl( on an SVG fill inside a nested SVG data: URI — the paint allowlist must hold at depth too",
    html: `<img src="${svgDataUri(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="\\75 rl(\'https://evil.example/nested.svg#a\')" width="1" height="1"/></svg>',
    )}">`,
    extra: (out) => {
      const m = /src="(data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+)"/.exec(out);
      expect(m).not.toBeNull();
      const b64 = m![1].split(",")[1];
      const decoded = Buffer.from(b64, "base64").toString("utf8");
      expect(decoded).not.toContain("evil.example");
    },
  },

  // The accepted COST of dropping the style attribute, pinned so it is a
  // deliberate, visible decision rather than a silent regression. These two
  // replace the former "benign style survives" KEEP vectors: benign inline CSS
  // no longer survives, and that is the point — there is no safe subset of a
  // surface whose grammar admits var() indirection.
  {
    name: "style attribute is dropped ENTIRELY now (strategy change) — even benign CSS with no url() at all",
    html: '<p style="color:red;font-weight:bold">hi</p>',
    extra: (out) => {
      expect(out).not.toContain("style=");
      expect(out).toContain("hi"); // the ELEMENT and its text still render
    },
  },
  {
    name: "style attribute is dropped even when its url() is a data: URI — the old exemption is gone with the surface",
    html: '<div style="background:url(data:image/png;base64,AAA=)">hi</div>',
    extra: (out) => {
      expect(out).not.toContain("style=");
      expect(out).toContain("hi");
    },
  },

  // (c) `srcset` — an ACCIDENTAL save, now made deliberate. Round 4's
  // attribution probe (hook detached vs attached) proved this value is dropped
  // by DOMPurify's CORE, not by us: IS_ALLOWED_URI fails on the leading `data:`
  // and `srcset` is not `src`/`href` on a DATA_URI_TAG. Our hook would KEEP it,
  // because `isDataUri` is /^\s*data:/i and only inspects the START of the
  // value — but `srcset` is a candidate LIST, so a single-URI test is
  // structurally the wrong shape for it. One `ADD_URI_SAFE_ATTR` /
  // `ADD_DATA_URI_TAGS` config change converts this into a live leak. An
  // imported chapter has no need for srcset: its images resolve from the
  // `images` map via `src`.
  {
    name: "srcset candidate LIST with a leading data: URI — isDataUri() only reads the START, so the hook would KEEP the remote 2x candidate",
    html: '<img src="ok.png" srcset="data:image/png;base64,AAA= 1x, https://evil.example/2x.png 2x">',
    images: { "ok.png": "data:image/png;base64,AAA=" },
    extra: (out) => {
      expect(out).not.toContain("srcset");
      expect(out).toContain('src="data:image/png;base64,AAA='); // the real image still renders
    },
  },
  {
    name: "malicious SVG stored verbatim in the images map — the src-swap re-enters the URI_ATTRS loop, which re-screens the now-data: src as an SVG document",
    html: '<img src="fig.svg">',
    images: { "fig.svg": svgDataUri(
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x.png"/><script>alert(1)</script></svg>',
    ) },
    extra: (out) => {
      const m = /src="(data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+)"/.exec(out);
      expect(m).not.toBeNull();
      const b64 = m![1].split(",")[1];
      const decoded = Buffer.from(b64, "base64").toString("utf8");
      expect(decoded).not.toContain("evil.example");
      expect(decoded).not.toContain("<script");
    },
  },
];

// Vectors that must be PRESERVED (a hook that is too aggressive is also a bug —
// e.g. dropping every style attribute, or refusing every SVG, would "pass" the
// evil.example bar trivially and vacuously).
export interface ChapterKeepVector {
  name: string;
  html: string;
  images?: Record<string, string>;
  mustContain: string[];
  /**
   * Substrings that must survive INSIDE the re-encoded `data:image/svg+xml`
   * payload of the output's `<img src>` — the SVG-recursion path re-sanitizes
   * that payload as its own document, so "what survived" there is invisible to
   * a `mustContain` check against the outer HTML (it is base64 by then).
   */
  decoded?: string[];
}

export const CHAPTER_KEEP_VECTORS: ChapterKeepVector[] = [
  {
    name: "a resolved image renders with its real data: URI",
    html: '<p>Body</p><img src="images/fig1.png">',
    images: { "images/fig1.png": "data:image/png;base64,AAA=" },
    mustContain: ["<p>Body</p>", 'src="data:image/png;base64,AAA='],
  },
  // NOTE (Round 4): the two former `style`-attribute KEEP vectors — "benign
  // inline style survives" and "a data: url() in style survives" — are GONE,
  // deliberately. The `style` attribute is now dropped outright (see the
  // strategy-change block in CHAPTER_SANITIZE_VECTORS above), so both moved
  // there as DROP vectors that pin the accepted cost. Styling an imported
  // chapter is the reader's job (READER_STYLES), not the EPUB's — spec D-I3.
  {
    name: "a #fragment-only href survives unchanged — footnotes must not go inert (product defect fix)",
    html: '<p>See <a href="#footnote1">note</a>.</p>',
    mustContain: ['href="#footnote1"'],
  },
  // The over-refusal side of Critical #3. `url(#id)` is a reference to a
  // paint server / mask / clip path / marker defined in the SAME document's
  // <defs>. It resolves same-document and reaches no network — it is also how
  // essentially every real gradient-bearing SVG is authored. Screening these
  // attributes with the `style` attribute's blanket "any url() that isn't
  // data:" rule would blank every gradient in every imported book: a different
  // bug, not a fix.
  {
    name: "a real gradient still renders — <defs><linearGradient id> + fill=url(#g) is the single most common SVG idiom there is",
    html:
      '<svg><defs><linearGradient id="g"><stop offset="0%" stop-color="red"/>' +
      '<stop offset="100%" stop-color="blue"/></linearGradient></defs>' +
      '<rect fill="url(#g)" width="10" height="10"/></svg>',
    mustContain: ['<linearGradient id="g">', 'fill="url(#g)"', "<stop"],
  },
  {
    name: "same-document url(#id) survives on every screened attribute, not just fill",
    html:
      '<svg><defs><pattern id="p"/><mask id="m"/><clipPath id="c"/><filter id="f"/><marker id="mk"/></defs>' +
      '<rect fill="url(#p)" stroke="url(#p)" filter="url(#f)" mask="url(#m)" clip-path="url(#c)"' +
      ' marker-start="url(#mk)" marker-mid="url(#mk)" marker-end="url(#mk)" width="10" height="10"/></svg>',
    mustContain: [
      'fill="url(#p)"',
      'stroke="url(#p)"',
      'filter="url(#f)"',
      'mask="url(#m)"',
      'clip-path="url(#c)"',
      'marker-start="url(#mk)"',
      'marker-mid="url(#mk)"',
      'marker-end="url(#mk)"',
    ],
  },
  {
    name: "quoted same-document url('#id') survives — quotes are legal CSS on the keep side too",
    html: '<svg><defs><linearGradient id="g"/></defs><rect fill="url(\'#g\')" width="10" height="10"/></svg>',
    mustContain: ["url('#g')"],
  },
  {
    name: "a plain colour fill is not a url() at all and must survive",
    html: '<svg><rect fill="red" stroke="#00ff00" width="10" height="10"/></svg>',
    mustContain: ['fill="red"', 'stroke="#00ff00"'],
  },
  // The keep side of the ALLOWLIST inversion (Round 4). An allowlist's failure
  // mode is over-refusal, so the safe grammar it admits has to be pinned
  // explicitly: a fix that closes the leak by blanking every real SVG is a
  // different bug, not a fix.
  {
    name: "allowlist grammar: keyword `none` and a 3-digit hex both survive — the commonest paint values there are",
    html: '<svg><rect fill="none" stroke="#f00" width="10" height="10"/></svg>',
    mustContain: ['fill="none"', 'stroke="#f00"'],
  },
  {
    name: "allowlist grammar: `currentColor` (a camelCase keyword) and an rgb() colour function survive",
    html: '<svg><rect fill="currentColor" stroke="rgb(255, 0, 0)" width="10" height="10"/></svg>',
    mustContain: ['fill="currentColor"', 'stroke="rgb(255, 0, 0)"'],
  },
  {
    name: "allowlist grammar: a bare number survives — the grammar admits plain numeric values, not just colours",
    html: '<svg><rect fill="0.5" stroke="0" width="10" height="10"/></svg>',
    mustContain: ['fill="0.5"', 'stroke="0"'],
  },
  {
    name: "allowlist grammar: the SVG paint FALLBACK form `url(#g) red` is legal, real markup and must survive",
    html:
      '<svg><defs><linearGradient id="g"/></defs>' +
      '<rect fill="url(#g) red" stroke="url(#g) none" width="10" height="10"/></svg>',
    mustContain: ['fill="url(#g) red"', 'stroke="url(#g) none"'],
  },
  {
    name: "a same-document url(#id) inside a nested SVG data: URI survives the recursion path",
    html: `<img src="${svgDataUri(
      '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"/></defs><rect fill="url(#g)" width="1" height="1"/></svg>',
    )}">`,
    mustContain: ["<img"],
    decoded: ['fill="url(#g)"'],
  },
];
