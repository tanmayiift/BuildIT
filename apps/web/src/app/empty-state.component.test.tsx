// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EmptyState } from "./empty-state";

afterEach(cleanup);

// Fourteen hand-written copies of this panel had drifted: most let a screen reader announce the
// decorative mark ("GH", "ER") before the heading, and one put its action outside the button row.
describe("an empty or failed panel", () => {
  it("hides its mark from assistive technology and leads with the heading", () => {
    render(<EmptyState mark="GH" title="Connect a repository" detail="Nothing is connected yet." />);
    expect(screen.getByText("GH").getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByRole("heading", { level: 2, name: "Connect a repository" })).toBeTruthy();
    expect(screen.getByText("Nothing is connected yet.").tagName).toBe("P");
  });

  it("puts every action in the button row, which wraps", () => {
    const { container } = render(<EmptyState mark="ID" title="Sign in" actions={<a className="button" href="/sign-in">Sign in</a>} />);
    expect(container.querySelector(".button-row > a[href='/sign-in']")).not.toBeNull();
  });

  it("is an alert with a page heading when it stands for the whole page", () => {
    render(<EmptyState alert level={1} mark="ER" title="We could not load this workspace" />);
    expect(screen.getByRole("alert").contains(screen.getByRole("heading", { level: 1 }))).toBe(true);
  });

  it("renders no empty paragraph or row when there is nothing to say or do", () => {
    const { container } = render(<EmptyState mark="0" title="Nothing waiting" />);
    expect(container.querySelector("p, .button-row")).toBeNull();
  });
});
