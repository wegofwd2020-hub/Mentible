// mobile/src/openshelves/__tests__/useSourceCatalog.test.tsx
import { renderHook, act, waitFor } from "@testing-library/react-native";
import { useSourceCatalog } from "../useSourceCatalog";

jest.mock("../feedSourcesStore", () => ({ getSource: jest.fn() }));
jest.mock("../feedEntriesStore", () => ({ getEntries: jest.fn() }));
jest.mock("../feedStore", () => ({ refreshSource: jest.fn() }));
import { getSource } from "../feedSourcesStore";
import { getEntries } from "../feedEntriesStore";
import { refreshSource } from "../feedStore";

const source = { id: "s1", url: "https://ex.org/f", title: "Lib", addedAt: "T0", lastRefreshedAt: null, isStarter: false, entryCount: 2 };
const entry = (id: string) => ({ id, title: id, authors: [], summary: "", coverUrl: null, language: null, categories: [], mediaType: "book", rightsText: null, mature: null, links: [], canonicalUrl: null });

beforeEach(() => jest.clearAllMocks());

test("loads source + entries on mount", async () => {
  (getSource as jest.Mock).mockResolvedValue(source);
  (getEntries as jest.Mock).mockResolvedValue([entry("a"), entry("b")]);
  const { result } = renderHook(() => useSourceCatalog("s1"));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.source?.title).toBe("Lib");
  expect(result.current.entries.map((e) => e.id)).toEqual(["a", "b"]);
});

test("refresh calls refreshSource then reloads", async () => {
  (getSource as jest.Mock).mockResolvedValue(source);
  (getEntries as jest.Mock).mockResolvedValueOnce([entry("a")]).mockResolvedValueOnce([entry("a"), entry("c")]);
  (refreshSource as jest.Mock).mockResolvedValue({ added: 1, updated: 0, removed: 0 });
  const { result } = renderHook(() => useSourceCatalog("s1"));
  await waitFor(() => expect(result.current.entries.length).toBe(1));
  await act(async () => { await result.current.refresh(); });
  expect(refreshSource).toHaveBeenCalledWith("s1");
  expect(result.current.entries.map((e) => e.id)).toEqual(["a", "c"]);
});
