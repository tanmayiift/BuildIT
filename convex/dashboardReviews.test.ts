import { describe, expect, it } from "vitest";
import { modelRouteDescription, previewFailureCode, previewTelemetryFailure } from "./dashboardReviews";

describe("dashboard preview failure codes", () => {
  it("turns GitHub failures into source-free, actionable categories", () => {
    expect(previewFailureCode(new Error("github_timeout"))).toBe("github_timeout");
    expect(previewFailureCode(new Error("github_token_401"))).toBe("github_app_access_unavailable");
    expect(previewFailureCode(new Error("repository_or_installation_unavailable"))).toBe("github_app_access_unavailable");
    expect(previewFailureCode(new Error("github_pull_request_422"))).toBe("pull_request_unavailable");
    expect(previewFailureCode(new Error("unexpected_failure"))).toBe("github_preview_failed");
  });

  it("keeps telemetry categories bounded and source-free", () => {
    expect(previewTelemetryFailure("github_timeout")).toBe("timeout");
    expect(previewTelemetryFailure("github_app_access_unavailable")).toBe("configuration_missing");
    expect(previewTelemetryFailure("pull_request_unavailable")).toBe("upstream_unavailable");
    expect(previewTelemetryFailure("github_preview_failed")).toBe("UnknownError");
  });
});

describe("dashboard model route disclosure", () => {
  it("names the stronger findings model when the validated OpenAI key exposes it", () => {
    expect(modelRouteDescription({ provider: "openai", model: "gpt-5.4-mini", availableModels: ["gpt-5.4-mini", "gpt-5.4"] })).toContain("gpt-5.4 for code findings");
  });

  it("does not claim a secondary model that the key did not validate", () => {
    expect(modelRouteDescription({ provider: "openai", model: "gpt-5.4-mini", availableModels: ["gpt-5.4-mini"] })).toBe("openai · gpt-5.4-mini");
  });
});
