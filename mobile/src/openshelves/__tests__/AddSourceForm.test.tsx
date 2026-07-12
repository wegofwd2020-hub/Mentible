// mobile/src/openshelves/__tests__/AddSourceForm.test.tsx
import { render, fireEvent } from "@testing-library/react-native";
import { AddSourceForm } from "../AddSourceForm";

test("submits the trimmed url", () => {
  const onSubmit = jest.fn();
  const { getByTestId } = render(<AddSourceForm onSubmit={onSubmit} />);
  fireEvent.changeText(getByTestId("add-source-input"), "  https://ex.org/f  ");
  fireEvent.press(getByTestId("add-source-submit"));
  expect(onSubmit).toHaveBeenCalledWith("https://ex.org/f");
});

test("does not submit an empty url", () => {
  const onSubmit = jest.fn();
  const { getByTestId } = render(<AddSourceForm onSubmit={onSubmit} />);
  fireEvent.press(getByTestId("add-source-submit"));
  expect(onSubmit).not.toHaveBeenCalled();
});

test("shows the error line when error is set", () => {
  const { getByTestId } = render(<AddSourceForm onSubmit={jest.fn()} error="nope" />);
  expect(getByTestId("add-source-error").props.children).toBe("nope");
});

test("shows the neutral-conduit responsibility warning", () => {
  const { getByText } = render(<AddSourceForm onSubmit={jest.fn()} />);
  expect(getByText(/your responsibility/i)).toBeTruthy();
});
