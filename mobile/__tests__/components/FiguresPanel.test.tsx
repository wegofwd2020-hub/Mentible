import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react-native";

jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchImageLibraryAsync: jest.fn(async () => ({
    canceled: false,
    assets: [{ uri: "file:///p.jpg", mimeType: "image/jpeg", width: 4, height: 3, fileSize: 100 }],
  })),
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true })),
  MediaTypeOptions: { Images: "Images" },
}));
const mockAttachImage = jest.fn(async (b) => ({ ...b, __attached: true }));
jest.mock("@/storage/mediaStore", () => ({
  attachImage: (...a: any[]) => (mockAttachImage as any)(...a),
  deleteImage: jest.fn(async (b) => b),
  pruneOrphanMedia: jest.fn(async () => {}),
  resolveFigureDataUrls: jest.fn(async () => new Map()),
  MediaCapError: class MediaCapError extends Error {},
}));
jest.mock("@/storage/bookStore", () => ({ saveBook: jest.fn(async () => {}) }));

import { FiguresPanel } from "@/components/FiguresPanel";

const book: any = {
  id: "b", title: "T", content: { t1: { topicId: "t1", title: "U", lesson: {}, generatedAt: "x", images: [] } },
};

it("adds an image from the library", async () => {
  const onBookChange = jest.fn();
  const { getByText } = render(<FiguresPanel book={book} topicId="t1" onBookChange={onBookChange} />);
  fireEvent.press(getByText(/Add figure/i));
  fireEvent.press(getByText(/Choose from library/i));
  await waitFor(() => expect(mockAttachImage).toHaveBeenCalled());
  await waitFor(() => expect(onBookChange).toHaveBeenCalled());
});
