import { rasterizeDiagramPngs, PrerenderedRasterDiagramRenderer } from "../src/diagramRaster";

jest.mock("../src/rasterize", () => ({
  rasterizeManyToPngResilient: jest.fn(async (svgs: string[]) => svgs.map((_, i) => Buffer.from(`png-${i}`))),
}));

describe("rasterizeDiagramPngs", () => {
  it("batches every SVG and keys the result by the ORIGINAL mermaid source", async () => {
    const svgBySource = new Map([
      ["graph TD; A-->B;", "<svg>A</svg>"],
      ["sequenceDiagram; X->>Y: hi;", "<svg>B</svg>"],
    ]);
    const map = await rasterizeDiagramPngs(svgBySource);
    expect(map.size).toBe(2);
    expect(map.get("graph TD; A-->B;")).toMatch(/^data:image\/png;base64,/);
  });

  it("returns an empty map without rasterizing when there are no diagrams", async () => {
    const { rasterizeManyToPngResilient } = require("../src/rasterize");
    (rasterizeManyToPngResilient as jest.Mock).mockClear();
    const map = await rasterizeDiagramPngs(new Map());
    expect(map.size).toBe(0);
    expect(rasterizeManyToPngResilient).not.toHaveBeenCalled();
  });

  it("omits a diagram from the map (never rejects) when the resilient rasterizer reports it null — a single bad diagram can't fail the whole batch", async () => {
    const { rasterizeManyToPngResilient } = require("../src/rasterize");
    (rasterizeManyToPngResilient as jest.Mock).mockImplementationOnce(async (svgs: string[]) =>
      svgs.map((_, i) => (i === 1 ? null : Buffer.from(`png-${i}`))),
    );
    const svgBySource = new Map([
      ["graph TD; A-->B;", "<svg>A</svg>"],
      ["sequenceDiagram; X->>Y: hi;", "<svg>B</svg>"],
    ]);
    const map = await rasterizeDiagramPngs(svgBySource);
    expect(map.size).toBe(1);
    expect(map.has("graph TD; A-->B;")).toBe(true);
    expect(map.has("sequenceDiagram; X->>Y: hi;")).toBe(false); // this one "failed to rasterize"
  });

  it("warns on stderr with the dropped count when fewer diagrams rasterize than requested", async () => {
    const { rasterizeManyToPngResilient } = require("../src/rasterize");
    (rasterizeManyToPngResilient as jest.Mock).mockImplementationOnce(async (svgs: string[]) =>
      svgs.map((_, i) => (i === 1 ? null : Buffer.from(`png-${i}`))),
    );
    const svgBySource = new Map([
      ["graph TD; A-->B;", "<svg>A</svg>"],
      ["sequenceDiagram; X->>Y: hi;", "<svg>B</svg>"],
    ]);
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    await rasterizeDiagramPngs(svgBySource);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("1 of 2 diagrams could not be rasterized"));
    errorSpy.mockRestore();
  });

  it("does not warn when every diagram rasterizes successfully", async () => {
    const svgBySource = new Map([
      ["graph TD; A-->B;", "<svg>A</svg>"],
      ["sequenceDiagram; X->>Y: hi;", "<svg>B</svg>"],
    ]);
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    await rasterizeDiagramPngs(svgBySource);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("PrerenderedRasterDiagramRenderer", () => {
  it("emits an <img>-based figure for a rasterized source", () => {
    const renderer = new PrerenderedRasterDiagramRenderer(new Map([["src", "data:image/png;base64,AA=="]]));
    const html = renderer.render("src");
    expect(html).toContain('<figure class="diagram">');
    expect(html).toContain('<img src="data:image/png;base64,AA=="');
    expect(html).not.toContain("<svg");
  });

  it("falls back to the text placeholder for a raster miss", () => {
    const renderer = new PrerenderedRasterDiagramRenderer(new Map());
    expect(renderer.render("missing")).toContain("diagram--placeholder");
  });
});
