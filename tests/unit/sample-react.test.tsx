import { render, screen } from "@testing-library/react";

function Greeting({ name }: { name: string }) {
  return <h1>Hello, {name}!</h1>;
}

describe("React Testing Library setup", () => {
  it("renders a React component", () => {
    render(<Greeting name="Takatsu" />);
    expect(screen.getByRole("heading", { name: /Hello, Takatsu!/i })).toBeInTheDocument();
  });
});
