import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Mp3UploadSheet } from "@/components/trust/Mp3UploadSheet";
import { pickAudioFile } from "@/storage/pickAudioFile";

jest.mock("@/storage/pickAudioFile", () => ({ pickAudioFile: jest.fn() }));
jest.mock("@/lib/alert", () => ({ Alert: { alert: jest.fn() } }));

const asset = { uri: "file:///a.mp3", name: "a.mp3", mimeType: "audio/mpeg", size: 2 * 1024 * 1024 };

describe("Mp3UploadSheet", () => {
  beforeEach(() => jest.clearAllMocks());

  it("picks a file then submits it with the default Tamil language", async () => {
    (pickAudioFile as jest.Mock).mockResolvedValue(asset);
    const onSubmit = jest.fn();
    render(<Mp3UploadSheet visible busy={false} onClose={jest.fn()} onSubmit={onSubmit} />);

    fireEvent.press(screen.getByLabelText("Choose an audio file"));
    // Picker button now shows the chosen file name.
    await waitFor(() => expect(screen.getByText(/a\.mp3/)).toBeTruthy());

    fireEvent.changeText(screen.getByLabelText("Transcript title"), "  Interview 1  ");
    fireEvent.press(screen.getByLabelText("Transcribe audio"));

    expect(onSubmit).toHaveBeenCalledWith(asset, { title: "Interview 1", language: "ta" });
  });

  it("does not submit before a file is chosen", () => {
    const onSubmit = jest.fn();
    render(<Mp3UploadSheet visible busy={false} onClose={jest.fn()} onSubmit={onSubmit} />);
    fireEvent.press(screen.getByLabelText("Transcribe audio"));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
