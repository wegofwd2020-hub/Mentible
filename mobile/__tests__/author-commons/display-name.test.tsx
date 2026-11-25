import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));

import { AuthorDisplayName } from "@/components/AuthorDisplayName";

const fetchMock = jest.fn();
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

it("loads the stored name and saves an edit through the API", async () => {
  fetchMock.mockResolvedValueOnce(json({ display_name: "Ada" }));
  render(<AuthorDisplayName />);
  const input = await screen.findByDisplayValue("Ada");
  expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/v1\/account\/display-name$/);

  fetchMock.mockResolvedValueOnce(json({ display_name: "Ada L." }));
  fireEvent.changeText(input, "  Ada L.  ");
  fireEvent.press(screen.getByLabelText("Save author name"));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  const [url, init] = fetchMock.mock.calls[1];
  expect(url).toMatch(/\/api\/v1\/account\/display-name$/);
  expect(init.method).toBe("PUT");
  expect(init.headers.Authorization).toBe("Bearer tok");
  expect(JSON.parse(init.body)).toEqual({ display_name: "Ada L." });
  expect(await screen.findByText("Saved.")).toBeTruthy();
});

it("shows an inline error on 422", async () => {
  fetchMock.mockResolvedValueOnce(json({ display_name: null }));
  render(<AuthorDisplayName />);
  const input = await screen.findByLabelText("Author name shown on Author Commons");
  fetchMock.mockResolvedValueOnce(json({ detail: "bad" }, 422));
  fireEvent.changeText(input, "x");
  fireEvent.press(screen.getByLabelText("Save author name"));
  expect(await screen.findByText(/1.60 characters/)).toBeTruthy();
});

it("keeps Save disabled while the field is blank", async () => {
  fetchMock.mockResolvedValueOnce(json({ display_name: null }));
  render(<AuthorDisplayName />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(screen.getByLabelText("Save author name").props.accessibilityState.disabled).toBe(true);
});
