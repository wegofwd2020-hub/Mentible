import React from "react";
import { render, screen } from "@testing-library/react-native";
import NewProjectScreen from "@/../app/trust/new";
jest.mock("expo-router", () => ({ useRouter: () => ({ replace: jest.fn() }) }));
jest.mock("@/auth/RequireSignIn", () => ({ RequireSignIn: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
jest.mock("@/hooks/useOwnedProjects", () => ({ useOwnedProjects: () => ({ create: jest.fn() }) }));

it("shows a subhead and a non-empty Title placeholder", () => {
  render(<NewProjectScreen />);
  expect(screen.getByText("Give your studio a topic to work on. You can refine any of this later.")).toBeTruthy();
  const titleInput = screen.getByLabelText("Title");
  expect(titleInput.props.placeholder).toBeTruthy();
});
