// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { sampleReviews } from "../sample-data";
import { HeroReviewCard } from "./hero-review-card";

afterEach(cleanup);

// The homepage's first picture is a claim: "this is what BuildIT hands you". It may only draw a
// review BuildIT actually ran, so every value comes from the transcribed review in sample-data.ts,
// and the card can neither fetch nor make anything up at render time.
const review = sampleReviews.find(item => item.finding)!;
const finding = review.finding!;

describe("the homepage review card", () => {
  it("draws the transcribed review: its commit, finding, cited line, failing check and fix", () => {
    const { container } = render(<HeroReviewCard />);
    const text = container.textContent ?? "";
    for (const value of [finding.source.label, finding.commit.slice(0, 7), review.status, finding.severity, finding.verdict, finding.title, finding.path, finding.stackedPr.label])
      expect(text, value).toContain(value);
    expect(container.querySelector(".code-line.cited")?.textContent).toContain(finding.excerpt.split("\n")[Number(finding.lines) - 1]!);
    for (const line of finding.checkOutput.split("\n")) expect(container.querySelector(".check-output pre")?.textContent).toContain(line);
    expect([...container.querySelectorAll(".diff-line.del, .diff-line.add")].map(line => line.querySelector(".diff-mark")?.textContent)).toEqual(["−", "+"]);
    expect(container.querySelector(`a[href="${finding.stackedPr.href}"]`)).not.toBeNull();
    // Every box that can scroll sideways can be reached and scrolled from a keyboard.
    for (const box of container.querySelectorAll("pre")) expect(box.tabIndex, box.className).toBe(0);
  });

  it("holds no state and reads nothing at render time", () => {
    const source = readFileSync("apps/web/src/app/visuals/hero-review-card.tsx", "utf8");
    expect(source).not.toMatch(/use client|useState|useEffect|fetch\(|Date\.now|new Date|Math\.random/);
    expect(source).toMatch(/from "\.\.\/sample-data"/);
  });
});
