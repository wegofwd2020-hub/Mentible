import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

// Walks mobile/src and mobile/app and checks only user-visible text:
// string literals, template literals and JSX text. Comments are never
// visited by the AST walk, so code comments may keep "Open Library".

const ROOT = path.resolve(__dirname, "../..");
const SCAN_DIRS = ["src", "app"].map((d) => path.join(ROOT, d));
const PATTERN = /Open Library/;

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts"))
      out.push(full);
  }
  return out;
}

function userVisibleHits(file: string): string[] {
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const hits: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isJsxText(node)
    ) {
      if (PATTERN.test(node.getText(sf))) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        hits.push(`${path.relative(ROOT, file)}:${line + 1}`);
      }
    }
    if (ts.isTemplateExpression(node)) {
      // Check the static head/middle/tail parts of template expressions.
      const parts = [node.head, ...node.templateSpans.map((s) => s.literal)];
      for (const part of parts) {
        if (PATTERN.test(part.text)) {
          const { line } = sf.getLineAndCharacterOfPosition(part.getStart(sf));
          hits.push(`${path.relative(ROOT, file)}:${line + 1}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

describe("copy: Open Library renamed to Author Commons", () => {
  it("no user-facing copy says 'Open Library'", () => {
    const files = SCAN_DIRS.flatMap(listSourceFiles);
    expect(files.length).toBeGreaterThan(0);
    const hits = files.flatMap(userVisibleHits);
    expect(hits).toEqual([]);
  });
});
