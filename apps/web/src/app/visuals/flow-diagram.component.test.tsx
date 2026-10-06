// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FlowDiagram, modelKeyFlow, repositoryAccessFlow } from "./flow-diagram";

afterEach(cleanup);

describe("a setup step's hand-over, drawn", () => {
  it("is an ordered list a screen reader reads in sequence, with the decorative numbers hidden", () => {
    render(<FlowDiagram label="Where your model key goes" steps={modelKeyFlow} />);
    const figure = screen.getByRole("figure", { name: "Where your model key goes" });
    expect(figure.querySelectorAll("ol > li")).toHaveLength(4);
    expect(figure.querySelector(".flow-step-index")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("states what never happens when it is told, and nothing when it is not", () => {
    const { container, rerender } = render(<FlowDiagram label="Access" steps={repositoryAccessFlow} never="merge." />);
    expect(container.querySelector("figcaption")?.textContent).toBe("Never: merge.");
    rerender(<FlowDiagram label="Access" steps={repositoryAccessFlow} />);
    expect(container.querySelector("figcaption")).toBeNull();
  });
});
