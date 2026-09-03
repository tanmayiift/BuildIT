import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { publicAssets } from "../../apps/web/src/public-assets";
import { known } from "../../apps/web/src/route-map";
import { join } from "node:path";

// A link to BuildIT previewed as whatever heading the scraper found first, because the app declared
// no preview image at all. A scraper never runs the page, so the tags below and the file they point
// at are the entire preview - and the file has to be a raster, since no scraper renders SVG.
const root = join(import.meta.dirname, "../..");
const layout = readFileSync(join(root, "apps/web/src/app/layout.tsx"), "utf8");
const card = join(root, "apps/web/public/social-card.png");

function pngSize(path: string) {
  const header = readFileSync(path).subarray(0, 33);
  return { signature: header.subarray(0, 8).toString("hex"), width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}


describe("social preview", () => {
  it("declares an OpenGraph and Twitter card pointing at a file that exists", () => {
    expect(layout).toMatch(/openGraph:/);
    expect(layout).toMatch(/card: "summary_large_image"/);
    const referenced = [...layout.matchAll(/"(\/[a-z0-9-]+\.png)"/g)].map(match => match[1]!);
    expect(referenced.length).toBeGreaterThan(0);
    for (const path of referenced) expect(existsSync(join(root, "apps/web/public", path))).toBe(true);
  });

  it("ships a 1.91:1 raster large enough for a retina timeline", () => {
    const { signature, width, height } = pngSize(card);
    expect(signature).toBe("89504e470d0a1a0a");
    // Below 1200x630 LinkedIn and Slack fall back to the small square card.
    expect(width).toBeGreaterThanOrEqual(1200);
    expect(height).toBeGreaterThanOrEqual(630);
    expect(width / height).toBeCloseTo(1200 / 630, 2);
    // The declared dimensions must match the file, or X crops against the wrong box.
    expect(layout).toContain(`width: ${width}, height: ${height}`);
  });

  it("resolves relative image paths against an absolute site URL", () => {
    // Without metadataBase Next emits a relative og:image, which every scraper drops.
    expect(layout).toMatch(/metadataBase: new URL\(site\)/);
    expect(layout).toMatch(/https:\/\/buildit-agentic-review\.vercel\.app/);
  });

  it("keeps the sidebar mark and the card the same drawing", () => {
    const shell = readFileSync(join(root, "apps/web/src/app/app-shell.tsx"), "utf8");
    const mark = readFileSync(join(root, "apps/web/public/mark.svg"), "utf8");
    for (const stroke of ["M24 18h-6v28h6", "M40 18h6v28h-6", "M25.5 32.5 30.5 38 38.5 26"]) {
      expect(shell).toContain(stroke);
      expect(mark).toContain(stroke);
    }
  });
});

// The card was declared in the metadata and 404ed in production: the Edge proxy answers a real 404
// for any path it does not recognise, and it recognised routes only. The preview was broken by the
// one thing neither the metadata test nor the image test could see.
describe("public assets reach the browser", () => {
  it("lists exactly what apps/web/public ships", () => {
    const shipped = readdirSync(join(root, "apps/web/public")).sort().map(name => `/${name}`);
    expect([...publicAssets].sort()).toEqual(shipped);
  });

  it("lets the proxy through for every one of them", () => {
    for (const asset of publicAssets) expect(known(asset)).toBe(true);
  });

  it("still refuses a path that only looks like an asset", () => {
    expect(known("/not-shipped.png")).toBe(false);
  });
});
