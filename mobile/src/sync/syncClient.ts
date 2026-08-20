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
