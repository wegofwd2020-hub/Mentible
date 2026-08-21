// Typed client for the zero-knowledge sync API (`/api/v1/sync/*`, ADR-014
// increment 1 — see `backend/src/sync/router.py` + `schemas.py`, verified
// exact field names). This module is the ONLY place that talks base64 over
// the wire — every field that carries key/content material comes back out as
// bytes (Uint8Array) so the rest of the sync engine never touches base64.
// `syncEngine.ts` is not a React component, so the caller passes the session
// token in explicitly rather than this module reading a hook.
import { authedFetch, ApiError } from "@/api/client";
import { bytesToBase64, base64ToBytes } from "@/crypto/b64";

// ── Wire shapes (decoded — byte fields are Uint8Array, everything else as-is) ─

export interface Keyset {
  wrappedLmk: Uint8Array;
  lmkNonce: Uint8Array;
  kekSalt: Uint8Array;
}

export interface BookMeta {
  bookId: string;
  clientVersion: string;
  deleted: boolean;
  updatedAt: string | null;
}

export interface BookBlob {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  wrappedDk: Uint8Array;
  dkNonce: Uint8Array;
  clientVersion: string;
}

export interface SyncedBook extends BookMeta, BookBlob {}

// ── Response decoding ──────────────────────────────────────────────────────

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body);
  }
  return res.json() as Promise<T>;
}

interface KeysetWire { wrapped_lmk: string; lmk_nonce: string; kek_salt: string; created_at?: string | null }
function decodeKeyset(w: KeysetWire): Keyset {
  return {
    wrappedLmk: base64ToBytes(w.wrapped_lmk),
    lmkNonce: base64ToBytes(w.lmk_nonce),
    kekSalt: base64ToBytes(w.kek_salt),
  };
}

interface BookMetaWire { book_id: string; client_version: string; deleted: boolean; updated_at: string | null }
function decodeBookMeta(w: BookMetaWire): BookMeta {
  return { bookId: w.book_id, clientVersion: w.client_version, deleted: w.deleted, updatedAt: w.updated_at };
}

interface BookWire extends BookMetaWire { ciphertext: string; nonce: string; wrapped_dk: string; dk_nonce: string }
function decodeBook(w: BookWire): SyncedBook {
  return {
    ...decodeBookMeta(w),
    ciphertext: base64ToBytes(w.ciphertext),
    nonce: base64ToBytes(w.nonce),
    wrappedDk: base64ToBytes(w.wrapped_dk),
    dkNonce: base64ToBytes(w.dk_nonce),
  };
}

// ── Keyset ──────────────────────────────────────────────────────────────────

// 404 (no keyset for this account yet) surfaces as an ApiError — the caller
// (syncEngine.enableSync) decides what that means.
export async function getKeyset(token: string): Promise<Keyset> {
  const res = await authedFetch("/sync/keyset", token);
  return decodeKeyset(await jsonOrThrow<KeysetWire>(res));
}

// 409 (a keyset already exists and force wasn't passed) surfaces as an
// ApiError — syncEngine.enableSync catches it and routes to unlock instead
// of silently clobbering an existing keyset.
export async function putKeyset(
  token: string,
  keyset: Keyset,
  force = false,
): Promise<Keyset> {
  const qs = force ? "?force=true" : "";
  const res = await authedFetch(`/sync/keyset${qs}`, token, {
    method: "PUT",
    body: JSON.stringify({
      wrapped_lmk: bytesToBase64(keyset.wrappedLmk),
      lmk_nonce: bytesToBase64(keyset.lmkNonce),
      kek_salt: bytesToBase64(keyset.kekSalt),
      force,
    }),
  });
  return decodeKeyset(await jsonOrThrow<KeysetWire>(res));
}

// ── Books ───────────────────────────────────────────────────────────────────

export async function listBooks(token: string): Promise<BookMeta[]> {
  const res = await authedFetch("/sync/books", token);
  const rows = await jsonOrThrow<BookMetaWire[]>(res);
  return rows.map(decodeBookMeta);
}

export async function getBook(token: string, bookId: string): Promise<SyncedBook> {
  const res = await authedFetch(`/sync/books/${encodeURIComponent(bookId)}`, token);
  return decodeBook(await jsonOrThrow<BookWire>(res));
}

export async function putBook(token: string, bookId: string, blob: BookBlob): Promise<SyncedBook> {
  const res = await authedFetch(`/sync/books/${encodeURIComponent(bookId)}`, token, {
    method: "PUT",
    body: JSON.stringify({
      ciphertext: bytesToBase64(blob.ciphertext),
      nonce: bytesToBase64(blob.nonce),
      wrapped_dk: bytesToBase64(blob.wrappedDk),
      dk_nonce: bytesToBase64(blob.dkNonce),
      client_version: blob.clientVersion,
    }),
  });
  return decodeBook(await jsonOrThrow<BookWire>(res));
}

export async function deleteBook(token: string, bookId: string): Promise<void> {
  const res = await authedFetch(`/sync/books/${encodeURIComponent(bookId)}`, token, { method: "DELETE" });
  if (!res.ok && res.status !== 204) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body);
  }
}

// ── EPUBs (ADR-014 increment 2) ─────────────────────────────────────────────
// The epub payload (potentially tens of MB) travels as a FRAMED octet-stream
// body — this module does NOT frame/unframe it (see `epubFraming.ts`); it
// only moves already-framed bytes across the wire. Only the small, fixed-size
// crypto params travel as base64 headers (nonce / meta-nonce / wrapped key) —
// `X-Client-Version` is the one exception: the backend reads it via
// `request.headers.get(...)` as a plain string (NOT `_b64_header`, see
// `router.py#put_epub`) and echoes it back unencoded in `get_epub`'s response
// headers (`"X-Client-Version": e.client_version`, no `_b64e`) — so it must
// travel as plaintext here too, unlike the other four headers.

export interface EpubMetaRow {
  epubId: string;
  clientVersion: string;
  deleted: boolean;
  updatedAt: string | null;
  byteSize: number;
}

interface EpubMetaWire {
  epub_id: string;
  client_version: string | null;
  deleted: boolean;
  updated_at: string | null;
  byte_size: number;
}
function decodeEpubMeta(w: EpubMetaWire): EpubMetaRow {
  return {
    epubId: w.epub_id,
    clientVersion: w.client_version ?? "",
    deleted: w.deleted,
    updatedAt: w.updated_at,
    byteSize: w.byte_size,
  };
}

export async function listEpubs(token: string): Promise<EpubMetaRow[]> {
  const res = await authedFetch("/sync/epubs", token);
  const rows = await jsonOrThrow<EpubMetaWire[]>(res);
  return rows.map(decodeEpubMeta);
}

export interface EpubBlobHeaders {
  nonce: Uint8Array;
  metaNonce: Uint8Array;
  wrappedDk: Uint8Array;
  dkNonce: Uint8Array;
  clientVersion: string;
}

function epubRequestHeaders(h: EpubBlobHeaders): Record<string, string> {
  return {
    "Content-Type": "application/octet-stream",
    "X-Nonce": bytesToBase64(h.nonce),
    "X-Meta-Nonce": bytesToBase64(h.metaNonce),
    "X-Wrapped-Dk": bytesToBase64(h.wrappedDk),
    "X-Dk-Nonce": bytesToBase64(h.dkNonce),
    // Plaintext — see note above. NOT base64.
    "X-Client-Version": h.clientVersion,
  };
}

// `framedBody` is already-framed (meta-length-prefix + meta ciphertext + epub
// ciphertext) — callers build it via `packEpubBody`. A 413 (single-file cap or
// per-account soft cap, both raised in `put_epub`) surfaces as `ApiError` with
// `status === 413` so the sync engine can route it to `skipped` rather than
// retrying forever.
export async function putEpub(
  token: string,
  epubId: string,
  framedBody: Uint8Array,
  h: EpubBlobHeaders,
): Promise<void> {
  const res = await authedFetch(`/sync/epubs/${encodeURIComponent(epubId)}`, token, {
    method: "PUT",
    headers: epubRequestHeaders(h),
    body: framedBody,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body);
  }
}

export async function getEpub(
  token: string,
  epubId: string,
): Promise<{ framedBody: Uint8Array; headers: EpubBlobHeaders }> {
  const res = await authedFetch(`/sync/epubs/${encodeURIComponent(epubId)}`, token);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body);
  }
  const buf = await res.arrayBuffer();
  const nonce = res.headers.get("X-Nonce");
  const metaNonce = res.headers.get("X-Meta-Nonce");
  const wrappedDk = res.headers.get("X-Wrapped-Dk");
  const dkNonce = res.headers.get("X-Dk-Nonce");
  const clientVersion = res.headers.get("X-Client-Version");
  if (nonce == null || metaNonce == null || wrappedDk == null || dkNonce == null || clientVersion == null) {
    throw new ApiError(res.status, "missing crypto headers on epub response");
  }
  return {
    framedBody: new Uint8Array(buf),
    headers: {
      nonce: base64ToBytes(nonce),
      metaNonce: base64ToBytes(metaNonce),
      wrappedDk: base64ToBytes(wrappedDk),
      dkNonce: base64ToBytes(dkNonce),
      clientVersion, // plaintext — see note above
    },
  };
}

export async function deleteEpub(token: string, epubId: string): Promise<void> {
  const res = await authedFetch(`/sync/epubs/${encodeURIComponent(epubId)}`, token, { method: "DELETE" });
  if (!res.ok && res.status !== 204) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body);
  }
}

// ── Shelves (ADR-014 increment 2) ───────────────────────────────────────────
// Same JSON+base64 shape as a book blob (single row per account, no id path
// segment).

export interface ShelvesBlob {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  wrappedDk: Uint8Array;
  dkNonce: Uint8Array;
  clientVersion: string;
}

interface ShelvesWire {
  ciphertext: string;
  nonce: string;
  wrapped_dk: string;
  dk_nonce: string;
  client_version: string;
}
function decodeShelves(w: ShelvesWire): ShelvesBlob {
  return {
    ciphertext: base64ToBytes(w.ciphertext),
    nonce: base64ToBytes(w.nonce),
    wrappedDk: base64ToBytes(w.wrapped_dk),
    dkNonce: base64ToBytes(w.dk_nonce),
    clientVersion: w.client_version,
  };
}

// 404 (no shelves synced yet for this account) is a normal, expected outcome
// here (unlike getKeyset/getBook, which let it surface as ApiError) — the
// caller just wants "nothing yet" without a try/catch.
export async function getShelves(token: string): Promise<ShelvesBlob | null> {
  const res = await authedFetch("/sync/shelves", token);
  if (res.status === 404) return null;
  return decodeShelves(await jsonOrThrow<ShelvesWire>(res));
}

export async function putShelves(token: string, blob: ShelvesBlob): Promise<void> {
  const res = await authedFetch("/sync/shelves", token, {
    method: "PUT",
    body: JSON.stringify({
      ciphertext: bytesToBase64(blob.ciphertext),
      nonce: bytesToBase64(blob.nonce),
      wrapped_dk: bytesToBase64(blob.wrappedDk),
      dk_nonce: bytesToBase64(blob.dkNonce),
      client_version: blob.clientVersion,
    }),
  });
  await jsonOrThrow<ShelvesWire>(res);
}
