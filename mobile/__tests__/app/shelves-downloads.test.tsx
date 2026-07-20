import { render, fireEvent } from "@testing-library/react-native";
const remove = jest.fn(); const removeAll = jest.fn();
let mockDl: any;
jest.mock("@/openshelves/useDownloads", () => ({ useDownloads: () => mockDl }));
jest.mock("@/lib/alert", () => ({ Alert: { alert: jest.fn() } }));
import { Alert } from "@/lib/alert";
import DownloadsScreen from "@/../app/shelves/downloads";

const rec = (id: string) => ({ entryId: id, sourceId: "s1", title: id, path: "/x", mimeType: "application/epub+zip", bytes: 1048576, downloadedAt: "T0" });
beforeEach(() => { jest.clearAllMocks(); mockDl = { items: [], total: 0, loading: false, reload: jest.fn(), remove, removeAll }; });

test("empty state", () => {
  const { getByText } = render(<DownloadsScreen />);
  expect(getByText(/no downloads/i)).toBeTruthy();
});

test("lists items and confirms delete", () => {
  mockDl = { ...mockDl, items: [rec("a")], total: 1048576 };
  const { getByTestId } = render(<DownloadsScreen />);
  fireEvent.press(getByTestId("del-a"));
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  expect(remove).not.toHaveBeenCalled();
  const btn = (Alert.alert as jest.Mock).mock.calls[0][2].find((b: any) => b.text === "Delete");
  btn.onPress();
  expect(remove).toHaveBeenCalledWith("a");
});
