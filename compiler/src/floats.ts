// Per-chapter figure/table numbering shared by the PDF and EPUB builders.
//
// Floats (our inline <figure class="diagram"> and Markdown <table>) are numbered
// "Figure C.N — caption" / "Table C.N — caption" with a stable id, computed in
// the compiler (not via CSS counters) so the in-body labels always agree with
// the front-matter List of Figures / List of Tables, in both targets.

export interface FloatRef {
  num: string; // chapter.serial, e.g. "7.1"
  caption: string;
  id: string; // anchor target, e.g. "fig-7-1"
}

export function numberFloats(
  html: string,
  ch: number,
  figs: FloatRef[],
  tbls: FloatRef[],
  tableCaps: string[] = [],
): string {
  let f = 0;
  let t = 0;
  html = html.replace(
    /<figure class="diagram">([\s\S]*?)<figcaption>([\s\S]*?)<\/figcaption><\/figure>/g,
    (_m, inner: string, cap: string) => {
      f += 1;
      const num = `${ch}.${f}`;
      const id = `fig-${ch}-${f}`;
      const c = cap.trim();
      figs.push({ num, caption: c, id });
      const label = c
        ? `<span class="fnum">Figure ${num}</span> — ${c}`
        : `<span class="fnum">Figure ${num}</span>`;
      return `<figure class="diagram" id="${id}">${inner}<figcaption>${label}</figcaption></figure>`;
    },
  );
  html = html.replace(/<table>\n<caption>([\s\S]*?)<\/caption>/g, (_m, cap: string) => {
    t += 1;
    const num = `${ch}.${t}`;
    const id = `tbl-${ch}-${t}`;
    const c = cap.trim() || (tableCaps[t - 1] ?? "").trim();
    tbls.push({ num, caption: c, id });
    const label = c
      ? `<span class="fnum">Table ${num}</span> — ${c}`
      : `<span class="fnum">Table ${num}</span>`;
    return `<table id="${id}">\n<caption>${label}</caption>`;
  });
  return html;
}
