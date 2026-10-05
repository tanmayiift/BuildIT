import { expect, test } from "@playwright/test";
import { renderableRoutes } from "./routes";

// The layout faults a person sees and no other test looked for. A refusal panel shipped with its
// button flush against a ~190-character line of text, on a site whose axe sweep, snapshots and
// touch-target checks all passed - none of them measures spacing, line length or clipping. This
// runs on every renderable route in both the desktop and the mobile project.
type Fault = { kind: "touching" | "measure" | "overflow" | "clipped"; detail: string };

async function layoutFaults(page: import("@playwright/test").Page): Promise<Fault[]> {
  return page.evaluate(() => {
    const faults: Array<{ kind: "touching" | "measure" | "overflow" | "clipped"; detail: string }> = [];
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth + 1) faults.push({ kind: "overflow", detail: `page is ${root.scrollWidth}px wide in a ${root.clientWidth}px viewport` });
    // checkVisibility, not a box test: content inside a closed <details> still has layout boxes in
    // Chrome, and an audit that counted it reported buttons "overlapping" text nobody can see.
    const visible = (element: Element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0 && element.checkVisibility({ visibilityProperty: true, opacityProperty: true, contentVisibilityAuto: true }); };
    const label = (element: Element) => (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
    // A button stacked above or below text must not touch it: under 4px reads as one block.
    const buttons = [...document.querySelectorAll("a.button, button")].filter(visible);
    const text = [...document.querySelectorAll("p, h1, h2, h3, h4, li, dd, dt, label")].filter(visible);
    for (const button of buttons) {
      const a = button.getBoundingClientRect();
      for (const block of text) {
        if (block.contains(button) || button.contains(block)) continue;
        const b = block.getBoundingClientRect(), shared = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        if (shared <= 8) continue;
        const gap = Math.max(a.top - b.bottom, b.top - a.bottom);
        if (gap < 4) { faults.push({ kind: "touching", detail: `"${label(button)}" is ${Math.round(gap)}px from "${label(block)}"` }); break; }
      }
    }
    // Running text past ~100 characters a line is hard to read. Measured, not estimated: the
    // paragraph's characters over the lines it actually wraps to.
    for (const paragraph of [...document.querySelectorAll("p")].filter(visible)) {
      const style = getComputedStyle(paragraph), size = parseFloat(style.fontSize), box = paragraph.getBoundingClientRect();
      const lines = Math.round(box.height / (parseFloat(style.lineHeight) || size * 1.5));
      const perLine = (paragraph.textContent ?? "").replace(/\s+/g, " ").trim().length / Math.max(1, lines);
      if (lines >= 2 && perLine > 100) faults.push({ kind: "measure", detail: `${Math.round(perLine)} characters a line: "${label(paragraph)}"` });
    }
    for (const element of [...document.querySelectorAll("a, button, span, strong, p, h1, h2, h3, td, th, dd, small, label")].filter(visible)) {
      const style = getComputedStyle(element);
      if ((style.overflowX === "hidden" || style.overflowX === "clip") && element.scrollWidth > element.clientWidth + 2 && style.textOverflow !== "ellipsis")
        faults.push({ kind: "clipped", detail: `"${label(element)}" is cut off` });
    }
    return faults;
  });
}

for (const route of renderableRoutes) test(`lays out cleanly: ${route}`, async ({ page }) => {
  await page.goto(route);
  await expect(page.locator("h1").first()).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => undefined);
  expect(await layoutFaults(page)).toEqual([]);
});
