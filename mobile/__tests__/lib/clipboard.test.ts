import { copyText } from "@/lib/clipboard";
import * as Clipboard from "expo-clipboard";

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn().mockResolvedValue(true) }));

it("writes the given text to the clipboard", async () => {
  await copyText("hello world");
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith("hello world");
});
