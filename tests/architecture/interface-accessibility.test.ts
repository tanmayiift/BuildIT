import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("apps/web/src/app/globals.css", "utf8") + readFileSync("apps/web/src/app/flows.css", "utf8") + readFileSync("apps/web/src/app/mobile.css", "utf8");
const rgb = (hex: string) => [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
const luminance = (hex: string) => rgb(hex).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index]!, 0);
const contrast = (foreground: string, background: string) => { const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a); return (values[0]! + .05) / (values[1]! + .05); };

describe("B2B interface accessibility contract", () => {
  it("keeps production text and action token pairs at WCAG AA contrast", () => {
    for (const [foreground, background] of [["#151a22", "#ffffff"], ["#3f4856", "#ffffff"], ["#5f6978", "#ffffff"], ["#5f6978", "#eef1f4"], ["#626d7c", "#f6f7f9"], ["#ffffff", "#0b315f"], ["#b42318", "#ffffff"], ["#18733d", "#ffffff"], ["#875100", "#ffffff"]]) expect(contrast(foreground!, background!)).toBeGreaterThanOrEqual(4.5);
  });
  it("pins the font roles, control size, focus and reduced-motion boundaries", () => {
    expect(css).toMatch(/font-family:\s*"Manrope Variable"/);
    expect(css).toMatch(/code, \.mono, time\s*\{[^}]*"JetBrains Mono Variable"/s);
    expect(css).toMatch(/\.button,.action\s*\{[^}]*min-height:\s*44px/s);
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:/s);
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(css).not.toMatch(/transition:\s*all\b/);
  });
});
