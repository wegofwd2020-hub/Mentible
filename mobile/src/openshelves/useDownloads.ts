import { useCallback, useEffect, useState } from "react";
import { listDownloads, totalBytes, type DownloadRecord } from "./downloadsStore";
import { removeDownload } from "./downloadEngine";
import { makeIO } from "./downloadIO";

export function useDownloads() {
  const [items, setItems] = useState<DownloadRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const all = await listDownloads();
    setItems(all);
    setTotal(totalBytes(all));
    setLoading(false);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const remove = useCallback(async (entryId: string) => {
    await removeDownload(entryId, makeIO());
    await reload();
  }, [reload]);

  const removeAll = useCallback(async () => {
    for (const d of await listDownloads()) await removeDownload(d.entryId, makeIO());
    await reload();
  }, [reload]);

  return { items, total, loading, reload, remove, removeAll };
}
