import { renderHook, act, waitFor } from "@testing-library/react-native";
import { useDownloads } from "../useDownloads";
jest.mock("../downloadsStore", () => ({ listDownloads: jest.fn(), totalBytes: (r: any[]) => r.reduce((n, d) => n + d.bytes, 0) }));
jest.mock("../downloadEngine", () => ({ removeDownload: jest.fn() }));
jest.mock("../downloadIO", () => ({ makeIO: () => ({}) }));
import { listDownloads } from "../downloadsStore";
import { removeDownload } from "../downloadEngine";

const rec = (id: string, bytes = 100) => ({ entryId: id, sourceId: "s1", title: id, path: `/x/${id}`, mimeType: "application/epub+zip", bytes, downloadedAt: "T0" });
beforeEach(() => jest.clearAllMocks());

test("loads items + total on mount", async () => {
  (listDownloads as jest.Mock).mockResolvedValue([rec("a", 100), rec("b", 250)]);
  const { result } = renderHook(() => useDownloads());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.items.map((d) => d.entryId)).toEqual(["a", "b"]);
  expect(result.current.total).toBe(350);
});

test("remove calls the engine and reloads", async () => {
  (listDownloads as jest.Mock).mockResolvedValueOnce([rec("a")]).mockResolvedValueOnce([]);
  (removeDownload as jest.Mock).mockResolvedValue(undefined);
  const { result } = renderHook(() => useDownloads());
  await waitFor(() => expect(result.current.items.length).toBe(1));
  await act(async () => { await result.current.remove("a"); });
  expect(removeDownload).toHaveBeenCalledWith("a", expect.anything());
  expect(result.current.items).toEqual([]);
});
