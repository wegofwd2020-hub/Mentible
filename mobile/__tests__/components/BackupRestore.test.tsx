import { render, fireEvent, waitFor } from "@testing-library/react-native";
import { BackupRestore } from "@/components/BackupRestore";

// Variables referenced inside jest.mock() factories must be prefixed with
// "mock" (case-insensitive) — babel-plugin-jest-hoist's hoist-safety check
// (see FiguresPanel.test.tsx for the same convention in this repo).
const mockBuild = jest.fn(async () => ({ bytes: new Uint8Array([1]), filename: "x.mentible-backup", counts: { books: 2, epubs: 1 } }));
const mockRestore = jest.fn(async (..._a: any[]) => ({ books: 2, epubs: 1, overwritten: 0, warnings: [] as string[] }));
jest.mock("@/storage/backupRestore", () => ({ buildBackup: () => mockBuild(), restoreBackup: (b: any) => mockRestore(b) }));
const mockSave = jest.fn(async (..._a: any[]) => ({})); const mockPick = jest.fn(async () => new Uint8Array([1]));
jest.mock("@/lib/backupFile", () => ({ saveBackupFile: (...a: any) => mockSave(...a), pickBackupFile: () => mockPick() }));
const mockAlertSpy = jest.fn();
jest.mock("@/lib/alert", () => ({ Alert: { alert: (...a: any) => mockAlertSpy(...a) } }));

beforeEach(() => { mockBuild.mockClear(); mockRestore.mockClear(); mockSave.mockClear(); mockPick.mockClear(); mockAlertSpy.mockClear(); });

it("Export builds + saves the file", async () => {
  const { getByText } = render(<BackupRestore />);
  fireEvent.press(getByText(/export library/i));
  await waitFor(() => expect(mockBuild).toHaveBeenCalled());
  expect(mockSave).toHaveBeenCalled();
});

it("Restore picks a file, confirms, then imports + reports", async () => {
  const { getByText } = render(<BackupRestore />);
  fireEvent.press(getByText(/restore from backup/i));
  await waitFor(() => expect(mockPick).toHaveBeenCalled());
  // confirm dialog fires (Alert with buttons) — simulate the confirm callback
  const confirmBtn = mockAlertSpy.mock.calls.find(c => Array.isArray(c[2]))?.[2]?.find((b: any) => /import|restore|continue/i.test(b.text));
  await confirmBtn.onPress();
  await waitFor(() => expect(mockRestore).toHaveBeenCalled());
});

it("a non-backup file surfaces an error and does not import", async () => {
  mockRestore.mockRejectedValueOnce(new Error("not a backup"));
  mockPick.mockResolvedValueOnce(new Uint8Array([9]));
  const { getByText } = render(<BackupRestore />);
  fireEvent.press(getByText(/restore from backup/i));
  await waitFor(() => expect(mockPick).toHaveBeenCalled());
  const confirmBtn = mockAlertSpy.mock.calls.find(c => Array.isArray(c[2]))?.[2]?.find((b: any) => /import|restore|continue/i.test(b.text));
  await confirmBtn.onPress();
  await waitFor(() => expect(mockAlertSpy).toHaveBeenCalledWith(expect.stringMatching(/couldn.t|error|failed/i), expect.anything()));
});
