// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ connection: undefined as unknown, prepare: vi.fn(), start: vi.fn() }));
vi.mock("../live-connections", () => ({ useConnection: () => state.connection }));
vi.mock("convex/server", () => ({ makeFunctionReference: (name: string) => name }));
vi.mock("convex/react", () => ({ useAction: (name: string) => name.endsWith(":prepare") ? state.prepare : state.start, useQuery: (name: string) => name === "runtimeReadiness:current" ? { executionEnabled: true, runtimeConfigured: true } : ["anthropic"] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
const { FirstReviewSetup } = await import("./first-review");
const connection = { state: "connected", organization: { id: "org-a", role: "owner" }, repositories: [{ id: "repo-a", owner: "acme", name: "api" }] };
beforeEach(() => { window.sessionStorage.clear(); state.connection = connection; state.prepare.mockReset().mockResolvedValue({ repository: "acme/api", credentialScopeId: "scope", pull: { number: 42, title: "My change", url: "https://github.com/acme/api/pull/42", headSha: "a".repeat(40), baseSha: "b".repeat(40), changedFiles: 1, additions: 1, deletions: 0, isFork: false }, consent: { reads: ["diff"], runs: ["tests"], writes: ["check"], cannot: ["merge"], model: "test", provider: "anthropic", maximumProviderCostUsd: 2 } }); state.start.mockReset().mockResolvedValue({ reviewId: "review-a" }); });
afterEach(cleanup);
it("accepts one's installed-repository PR and requires preview then a separate capped consent", async () => {
 render(<FirstReviewSetup />);
 fireEvent.change(screen.getByLabelText("Your GitHub pull request URL"), { target: { value: "https://github.com/ACME/api/pull/42" } });
 expect(state.prepare).not.toHaveBeenCalled(); expect(state.start).not.toHaveBeenCalled();
 fireEvent.click(await screen.findByRole("button", { name: "Preview review access" }));
 await screen.findByText(/acme\/api #42/);
 expect(state.prepare).toHaveBeenCalledWith({ repositoryId: "repo-a", prNumber: 42, budgetLimit: 2, provider: "anthropic" });
 expect(state.start).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button", { name: "Consent and start review" }));
 await waitFor(() => expect(state.start).toHaveBeenCalledWith(expect.objectContaining({ consent: true, budgetLimit: 2, expectedHeadSha: "a".repeat(40) })));
});
it("rejects another repository or a lookalike GitHub host before any request", () => {
 render(<FirstReviewSetup />); const input = screen.getByLabelText("Your GitHub pull request URL");
 for (const url of ["https://github.com/other/private/pull/42", "https://github.com.attacker.test/acme/api/pull/42", "https://github.com@attacker.test/acme/api/pull/42"]) {
  fireEvent.change(input, { target: { value: url } }); expect(screen.queryByRole("button", { name: "Preview review access" })).toBeNull();
 }
 expect(state.prepare).not.toHaveBeenCalled(); expect(state.start).not.toHaveBeenCalled();
});
it("resumes the URL after reload but never resumes consent, and isolates workspace drafts", async () => {
 const first = render(<FirstReviewSetup />); fireEvent.change(screen.getByLabelText("Your GitHub pull request URL"), { target: { value: "https://github.com/acme/api/pull/42" } });
 fireEvent.click(await screen.findByRole("button", { name: "Preview review access" })); await screen.findByText(/acme\/api #42/); first.unmount();
 const second = render(<FirstReviewSetup />); expect((screen.getByLabelText("Your GitHub pull request URL") as HTMLInputElement).value).toContain("pull/42"); expect(screen.queryByRole("button", { name: "Consent and start review" })).toBeNull(); second.unmount();
 state.connection = { ...connection, organization: { id: "org-b", role: "owner" } }; render(<FirstReviewSetup />); expect((screen.getByLabelText("Your GitHub pull request URL") as HTMLInputElement).value).toBe(""); expect(state.start).not.toHaveBeenCalled();
});
