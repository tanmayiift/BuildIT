// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CheckOutput } from "./check-output";
import { CodeExcerpt } from "./code-excerpt";

afterEach(cleanup);

describe("the lines a finding cites", () => {
  const lines = [
    { number: 3, text: "function total(items) {", cited: false },
    { number: 4, text: "  return items.length - 1;", cited: true },
    { number: 5, text: "}", cited: false },
  ];

  it("names the file and the cited range, and marks cited lines without relying on colour", () => {
    const { container } = render(<CodeExcerpt path="src/total.js" lines={lines} clipped={false} />);
    expect(screen.getByText("src/total.js").tagName).toBe("CODE");
    expect(container.querySelector("figcaption")?.textContent).toBe("src/total.js · lines 4 cited");
    const cited = container.querySelectorAll(".code-line.cited");
    expect(cited).toHaveLength(1);
    expect(cited[0]!.querySelector(".code-line-mark")?.textContent).toBe("›");
    // Read aloud, the cited line says so; the line numbers and markers are not read at all.
    expect(screen.getByText("(cited line 4)", { exact: false }).className).toBe("sr-only");
    expect(container.querySelector(".code-line-number")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("says when a long range was cut short", () => {
    const { container } = render(<CodeExcerpt path="a.js" lines={lines} clipped />);
    expect(container.querySelector("figcaption")?.textContent).toContain("first 40 lines shown");
  });

  it("shows source as text, never as markup", () => {
    const { container } = render(<CodeExcerpt path="a.js" lines={[{ number: 1, text: "<img src=x onerror=alert(1)>", cited: true }]} clipped={false} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});

describe("the output of a failed check", () => {
  it("says whether it is the whole output or only its end", () => {
    const { container, rerender } = render(<CheckOutput name="test" lines={["1 failing", "AssertionError: expected 2"]} truncated />);
    expect(container.querySelector("figcaption")?.textContent).toBe("Last 2 lines of test");
    expect(container.querySelector("pre")?.textContent).toBe("1 failing\nAssertionError: expected 2");
    rerender(<CheckOutput name="test" lines={["ok"]} truncated={false} />);
    expect(container.querySelector("figcaption")?.textContent).toBe("Output of test");
  });
});
