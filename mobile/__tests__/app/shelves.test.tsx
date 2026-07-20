import { render, fireEvent, screen, waitFor } from "@testing-library/react-native";

const add = jest.fn().mockResolvedValue(true);
const remove = jest.fn();
const refresh = jest.fn();
const refreshAllSources = jest.fn();
let mockHookState: any;
jest.mock("@/openshelves/useOpenShelves", () => ({ useOpenShelves: () => mockHookState }));
jest.mock("@/lib/alert", () => ({ Alert: { alert: jest.fn() } }));
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/storage/pickBookFile", () => ({ pickBookFileOrBundle: jest.fn() }));
jest.mock("@/openshelves/importEpub", () => ({ importEpub: jest.fn() }));
import { Alert } from "@/lib/alert";
import { pickBookFileOrBundle } from "@/storage/pickBookFile";
import { importEpub } from "@/openshelves/importEpub";
import ShelvesScreen from "@/../app/(tabs)/shelves";

const src = (id: string) => ({ id, url: `https://ex.org/${id}`, title: id, addedAt: "T0", lastRefreshedAt: null, isStarter: false, entryCount: 1 });

beforeEach(() => {
  jest.clearAllMocks();
  mockHookState = { sources: [], loading: false, busy: false, error: null, add, remove, refresh, refreshAllSources, reload: jest.fn() };
});

test("empty state when no sources", () => {
  const { getByText } = render(<ShelvesScreen />);
  expect(getByText(/no sources yet/i)).toBeTruthy();
});

test("Downloads is reachable from the Shelves tab, even with no sources", () => {
  const { getByTestId } = render(<ShelvesScreen />);
  fireEvent.press(getByTestId("open-downloads"));
  expect(mockPush).toHaveBeenCalledWith("/shelves/downloads");
});

test("adding a source confirms via Alert before calling add (P0-8)", () => {
  const { getByTestId } = render(<ShelvesScreen />);
  fireEvent.changeText(getByTestId("add-source-input"), "https://ex.org/f");
  fireEvent.press(getByTestId("add-source-submit"));
  // The confirm was raised, and add is NOT called until its button fires.
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  expect(add).not.toHaveBeenCalled();
  // Drive the confirm's "Add" button.
  const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
  const addBtn = buttons.find((b: any) => b.text === "Add");
  addBtn.onPress();
  expect(add).toHaveBeenCalledWith("https://ex.org/f");
});

test("removing a source confirms via Alert before calling remove", () => {
  mockHookState = { ...mockHookState, sources: [src("a")] };
  const { getByTestId } = render(<ShelvesScreen />);
  fireEvent.press(getByTestId("remove-a"));
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  expect(remove).not.toHaveBeenCalled();
  const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
  const removeBtn = buttons.find((b: any) => b.text === "Remove");
  removeBtn.onPress();
  expect(remove).toHaveBeenCalledWith("a");
});

test("renders a row per source and surfaces the hook error", () => {
  mockHookState = { ...mockHookState, sources: [src("a"), src("b")], error: "boom" };
  const { getByTestId, getByText } = render(<ShelvesScreen />);
  expect(getByTestId("remove-a")).toBeTruthy();
  expect(getByTestId("remove-b")).toBeTruthy();
  expect(getByText("boom")).toBeTruthy();
});

test("Import an EPUB picks a zip and navigates to the imported book (web path, D-I5)", async () => {
  (pickBookFileOrBundle as jest.Mock).mockResolvedValueOnce({ kind: "zip", bytes: new ArrayBuffer(4) });
  (importEpub as jest.Mock).mockResolvedValueOnce({ id: "bk-2", title: "Dracula" });
  render(<ShelvesScreen />);
  fireEvent.press(screen.getByLabelText("Import an EPUB"));
  await waitFor(() => expect(importEpub).toHaveBeenCalled());
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("bk-2")));
});

test("Import an EPUB does nothing when the picker is cancelled or a non-zip is chosen", async () => {
  (pickBookFileOrBundle as jest.Mock).mockResolvedValueOnce(null);
  render(<ShelvesScreen />);
  fireEvent.press(screen.getByLabelText("Import an EPUB"));
  await waitFor(() => expect(pickBookFileOrBundle).toHaveBeenCalled());
  expect(importEpub).not.toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
});
