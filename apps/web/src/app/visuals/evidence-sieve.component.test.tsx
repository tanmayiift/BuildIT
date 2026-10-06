// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EvidenceSieve } from "./evidence-sieve";

afterEach(cleanup);

describe("the homepage illustration", () => {
  it("is decoration a screen reader skips, since the panel says the same in words", () => {
    const svg = render(<EvidenceSieve />).container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
  });

  it("takes every colour from a token, so it follows the colour scheme like the rest of the page", () => {
    const { container } = render(<EvidenceSieve />);
    const colours = [...container.querySelectorAll("[fill], [stroke]")].flatMap(node => [node.getAttribute("fill"), node.getAttribute("stroke")]).filter(value => value && value !== "none");
    expect(colours.length).toBeGreaterThan(5);
    for (const colour of colours) expect(colour).toMatch(/^var\(--[a-z0-9-]+\)$/);
  });
});
