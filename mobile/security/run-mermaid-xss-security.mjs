// Mermaid-XSS security regression test (real headless Chrome).
//
// WHY THIS EXISTS: the native web reader has no iframe, so a hostile ```mermaid source
// that escaped Mermaid's internal sanitizer would execute with access to the app's
// localStorage secrets. Mermaid renders after our DOMPurify pass, so our sanitizer never
// sees its output — the guarantee rests solely on `securityLevel:"strict"`. jsdom cannot
// run Mermaid (needs SVG layout), so this drives real Chrome over the real reader pipeline.
//
// The test FAILS (exit 1) if any payload executes, or if an `onerror=`/`javascript:` URL
// survives in the rendered SVG. Proven non-vacuous: weakening enhance.ts's securityLevel
// to "loose" makes the img/onerror and click-callback payloads execute and this test go red.
//
// Run: npm run test:mermaid-security   (needs Chrome; set CHROME_PATH to override discovery)
import * as esbuild from "esbuild";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { WebSocket } from "ws";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOBILE = path.resolve(HERE, "..");
const PORT = 39230;
const CDP_PORT = 39231;

// Every payload sets window.__xssExecuted if it runs. `expectExecuteWeakened` documents
// what a downgrade to securityLevel:"loose" would let through — the non-vacuity anchor.
const PAYLOADS = [
  { id: "img-onerror", src: 'graph TD\n  A["<img src=x onerror=window.__xssExecuted.push(\'img-onerror\')>"] --> B' },
  { id: "script-tag", src: 'graph TD\n  A["<script>window.__xssExecuted.push(\'script-tag\')</scr' + 'ipt>"] --> B' },
  { id: "anchor-js-url", src: `graph TD\n  A["<a href='javascript:window.__xssExecuted.push(1)'>x</a>"] --> B` },
  { id: "click-href", src: 'graph TD\n  A --> B\n  click A href "javascript:window.__xssExecuted.push(\'click-href\')"' },
  { id: "click-callback", src: 'graph TD\n  A --> B\n  click A call evilCallback()' },
  { id: "faux-tag-break", src: 'graph TD\n  A["</text><img src=x onerror=window.__xssExecuted.push(\'faux-tag-break\')>"] --> B' },
  { id: "flowchart-node-img", src: 'flowchart TD\n  A["<img src=1 onerror=window.__xssExecuted.push(\'flowchart-node-img\')>"]' },
  { id: "markdown-string-label", src: 'flowchart TD\n  A["`<img src=x onerror=window.__xssExecuted.push(\'markdown-string-label\')>`"]' },
  { id: "iframe-label", src: 'graph TD\n  A["<iframe src=javascript:window.__xssExecuted.push(\'iframe-label\')>"] --> B' },
];

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const names = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];
  const absolute = [
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const p of [...absolute, ...names.flatMap((n) => dirs.map((d) => path.join(d, n)))]) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("No Chrome/Chromium found. Install it or set CHROME_PATH.");
}

async function main() {
  // 1. Bundle the harness (+ real pipeline + real Mermaid) into one browser IIFE.
  const bundle = await esbuild.build({
    entryPoints: [path.join(HERE, "mermaid-xss.harness.ts")],
    bundle: true,
    format: "iife",
    platform: "browser",
    write: false,
    tsconfig: path.join(MOBILE, "tsconfig.json"),
    loader: { ".css": "empty" }, // the test needs no styles
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "error",
  });
  const js = bundle.outputFiles[0].text;

  // 2. Serve a page that loads it.
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><meta charset="utf-8"><body><script>${js}</script></body>`);
  });
  await new Promise((r) => server.listen(PORT, r));

  // 3. Launch headless Chrome, attach over CDP.
  const chromePath = findChrome();
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "mermaid-xss-"));
  const chrome = spawn(chromePath, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run",
    `--user-data-dir=${userDir}`, `--remote-debugging-port=${CDP_PORT}`, "about:blank",
  ], { stdio: "ignore" });

  let ws, cleanup = () => {};
  try {
    const wsUrl = await waitForCdp();
    ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("CDP websocket failed")); });

    let msgId = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    const send = (method, params = {}, sessionId) =>
      new Promise((res) => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params, sessionId })); });

    const { result: { targetId } } = await send("Target.createTarget", { url: "about:blank" });
    const { result: { sessionId } } = await send("Target.attachToTarget", { targetId, flatten: true });
    const evaluate = async (expression) => {
      const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (r.result?.exceptionDetails) throw new Error("page eval threw: " + r.result.exceptionDetails.text);
      return r.result?.result?.value;
    };

    await send("Page.enable", {}, sessionId);
    await send("Runtime.enable", {}, sessionId);
    await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` }, sessionId);
    for (let i = 0; i < 150; i++) {
      if (await evaluate("typeof window.__runMermaidPayload === 'function'").catch(() => false) === true) break;
      await delay(200);
      if (i === 149) throw new Error("harness never installed (bundle failed to load?)");
    }

    // 4. Run every payload; collect failures.
    const failures = [];
    let rendered = 0;
    for (const { id, src } of PAYLOADS) {
      const out = await evaluate(`window.__runMermaidPayload(${JSON.stringify(src)}, ${JSON.stringify(id)})`);
      if (out.ran) rendered++;
      const executed = (out.executed ?? []).length > 0;
      if (executed) failures.push(`${id}: PAYLOAD EXECUTED (window.__xssExecuted = ${JSON.stringify(out.executed)})`);
      if (out.onerrorInHtml) failures.push(`${id}: an "onerror=" handler survived in the rendered SVG`);
      if (out.javascriptUrlInHtml) failures.push(`${id}: a "javascript:" URL survived in the rendered SVG`);
      const mark = executed || out.onerrorInHtml || out.javascriptUrlInHtml ? "🔴" : "🟢";
      console.log(`  ${mark} ${id.padEnd(22)} ran=${out.ran} executed=${JSON.stringify(out.executed)}`);
    }

    cleanup = () => { try { ws?.close(); } catch {} chrome.kill(); server.close(); try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {} };

    // 5. Guard against a vacuous pass: if Mermaid rendered nothing, the test proved nothing.
    if (rendered === 0) {
      throw new Error("Mermaid rendered 0 diagrams — the harness is broken, not the defence. Refusing to pass vacuously.");
    }
    if (failures.length) {
      console.error(`\n❌ Mermaid-XSS defence BREACHED (${failures.length}):`);
      for (const f of failures) console.error("   - " + f);
      cleanup();
      process.exit(1);
    }
    console.log(`\n✅ Mermaid-XSS defence holds: ${PAYLOADS.length} hostile sources, ${rendered} rendered, 0 executed.`);
    cleanup();
    process.exit(0);
  } finally {
    cleanup();
  }
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitForCdp() {
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json();
      return j.webSocketDebuggerUrl;
    } catch { await delay(250); }
  }
  throw new Error("Chrome DevTools endpoint never came up");
}

main().catch((e) => { console.error("\n❌ " + (e?.stack ?? e)); process.exit(1); });
