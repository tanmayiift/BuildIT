// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ funnel: undefined as unknown }));
vi.mock("convex/react", () => ({ useQuery: () => state.funnel }));
vi.mock("convex/server", () => ({ makeFunctionReference: (name: string) => name }));
import { ActivationPath } from "./activation-path.js";

describe("activation path", () => {
  afterEach(() => cleanup());
  it("shows a source-free loading state", () => { render(<ActivationPath organizationId="org-a" />); expect(screen.getByText("Checking your path to first evidence…")).not.toBeNull(); });
  it("points to the first incomplete, recoverable step", () => {
    state.funnel = { repositoryConnected: true, modelKeyReady: false, pullRequestPreviewed: false, reviewStarted: false, firstEvidenceReady: false };
    render(<ActivationPath organizationId="org-a" />);
    expect(screen.getByText(/Next: Model key protected/)).not.toBeNull();
    expect(screen.getByRole("link", { name: "Model key protected" }).getAttribute("href")).toBe("/setup/model");
    expect(screen.getByRole("link", { name: "Model key protected" }).getAttribute("aria-current")).toBe("step");
  });
  it("names the first evidence moment without claiming safety", () => {
    state.funnel = { repositoryConnected: true, modelKeyReady: true, pullRequestPreviewed: true, reviewStarted: true, firstEvidenceReady: true };
    render(<ActivationPath organizationId="org-a" />);
    expect(screen.getByText("First evidence is ready. Open a result and inspect every claim.")).not.toBeNull();
    expect(document.body.textContent?.toLowerCase()).not.toContain("bug-free");
  });
});
