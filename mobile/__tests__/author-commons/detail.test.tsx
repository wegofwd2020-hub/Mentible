import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok-9", status: "signed_in" }) }));
const mockSave = jest.fn().mockResolvedValue({});
jest.mock("@/storage/epubLibrary", () => ({ downloadArtifact: (...a: unknown[]) => mockSave(...a) }));
const mockAlert = jest.fn();
jest.mock("@/lib/alert", () => ({ Alert: { alert: (...a: unknown[]) => mockAlert(...a) } }));

import { AuthorCommonsDetail } from "@/components/AuthorCommonsDetail";
import { confirmHideFromCommons } from "@/lib/hideCommons";

const fetchMock = jest.fn();
const detail = {
  book_id: "b1",
  title: "Alpha Book",
  author_name: "Ann Author",
  account_name: "Acme Press",
  version: 3,
  published_at: "2026-11-01T00:00:00Z",
  formats: ["epub", "pdf"],
  language: "en",
  cover_svg: null,
  description: "About alpha",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  jest.clearAllMocks();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

it("detail shows version, publish date and account name", async () => {
  fetchMock.mockResolvedValue(json(detail));
  render(<AuthorCommonsDetail bookId="b1" />);
  expect(await screen.findByText("Version 3")).toBeTruthy();
  expect(screen.getByText("About alpha")).toBeTruthy();
  expect(screen.getByText("Published by Acme Press")).toBeTruthy();
  expect(screen.getByText(/^Published \w{3}/)).toBeTruthy();
  expect(screen.getByLabelText("Download EPUB")).toBeTruthy();
  expect(screen.getByLabelText("Download PDF")).toBeTruthy();
});

it("download uses the Bearer token", async () => {
  fetchMock
    .mockResolvedValueOnce(json(detail))
    .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
  render(<AuthorCommonsDetail bookId="b1" />);
  fireEvent.press(await screen.findByLabelText("Download PDF"));
  await waitFor(() => expect(mockSave).toHaveBeenCalled());
  const [url, init] = fetchMock.mock.calls[1];
  expect(String(url)).toMatch(/\/api\/v1\/library\/b1\/artifacts\/pdf$/);
  expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer tok-9" });
  expect(mockSave.mock.calls[0][1]).toBe("alpha-book.pdf");
});

it("an empty 200 download is not saved and reports failure", async () => {
  fetchMock
    .mockResolvedValueOnce(json(detail))
    .mockResolvedValueOnce(new Response(new Uint8Array([])));
  render(<AuthorCommonsDetail bookId="b1" />);
  fireEvent.press(await screen.findByLabelText("Download PDF"));
  expect(await screen.findByText("Download failed. Try again in a moment.")).toBeTruthy();
  expect(mockSave).not.toHaveBeenCalled();
});

it("a 404 on download says the book is no longer available", async () => {
  fetchMock
    .mockResolvedValueOnce(json(detail))
    .mockResolvedValueOnce(new Response("gone", { status: 404 }));
  render(<AuthorCommonsDetail bookId="b1" />);
  fireEvent.press(await screen.findByLabelText("Download PDF"));
  expect(await screen.findByText("This book is no longer available.")).toBeTruthy();
  expect(mockSave).not.toHaveBeenCalled();
});

it("a 404 on load says the book is no longer available", async () => {
  fetchMock.mockResolvedValueOnce(new Response("gone", { status: 404 }));
  render(<AuthorCommonsDetail bookId="b1" />);
  expect(await screen.findByText("This book is no longer available.")).toBeTruthy();
});

describe("hide", () => {
  const run = () => {
    const onDone = jest.fn();
    const onError = jest.fn();
    confirmHideFromCommons({ token: "tok-9", bookId: "b1", title: "Alpha", onDone, onError });
    return { onDone, onError, buttons: mockAlert.mock.calls[0][2] as { text: string; onPress?: () => void }[] };
  };

  it("hide asks for confirmation and calls the hide route only after confirm", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const { onDone, buttons } = run();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(buttons.map((b) => b.text)).toEqual(["Cancel", "Hide"]);
    buttons[1].onPress?.();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/library\/b1\/hide$/);
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer tok-9" });
  });

  it("Cancel on the hide dialog makes no request", () => {
    const { buttons } = run();
    buttons[0].onPress?.();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a 403 as a short message", async () => {
    fetchMock.mockResolvedValue(new Response("no", { status: 403 }));
    const { onError, buttons } = run();
    buttons[1].onPress?.();
    await waitFor(() => expect(onError).toHaveBeenCalledWith("Only the book's publisher can hide it."));
  });
});
