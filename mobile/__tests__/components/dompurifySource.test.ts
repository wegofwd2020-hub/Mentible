import fs from "fs";
import path from "path";
import { DOMPURIFY_SRC, DOMPURIFY_VERSION } from "@/components/dompurifySource";

// `DOMPURIFY_SRC` is a generated copy of the installed `dompurify` package's
// minified build, inlined into the WebView document so an imported book can
// open offline (see `@/components/contentHtml`, spec D-I6). A generated copy
// can drift from the real dependency — a `package.json` bump without
// re-running `scripts/gen-dompurify-source.js` would silently ship a STALE
// sanitizer while `npm ls dompurify` reports the new version. This test makes
// that drift fail CI instead of shipping unnoticed.
describe("DOMPURIFY_SRC — stays byte-identical to the installed dependency", () => {
  it("matches node_modules/dompurify/dist/purify.min.js exactly", () => {
    const installed = fs.readFileSync(
      path.join(__dirname, "..", "..", "node_modules", "dompurify", "dist", "purify.min.js"),
      "utf8",
    );
    expect(DOMPURIFY_SRC).toBe(installed);
  });

  it("matches the installed package.json version", () => {
    const installedVersion = require("../../node_modules/dompurify/package.json").version;
    expect(DOMPURIFY_VERSION).toBe(installedVersion);
  });

  it("contains no literal </script> — it is embedded raw, not JSON-escaped", () => {
    // contentHtml.ts embeds this verbatim inside a <script> tag (it is OUR
    // trusted build output, not chapter content, so it isn't run through
    // jsonForScriptBlock). If the library ever contained this literal
    // substring, embedding it verbatim would truncate the script early — the
    // generator script itself refuses to write the file in that case; this
    // pins the same invariant on the checked-in output.
    expect(DOMPURIFY_SRC).not.toContain("</script");
  });
});
