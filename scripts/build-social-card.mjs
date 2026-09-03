#!/usr/bin/env node
// Renders the social preview card that LinkedIn, Slack and X show for buildit-agentic-review.
//
// The card is generated rather than hand-exported so it can be regenerated from source when the
// wording changes, and so it uses the site's own fonts and navy rather than an approximation of
// them. Scrapers do not render SVG, so the output has to be a PNG.
import { chromium } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The fonts belong to apps/web, so resolution starts there rather than at the repository root.
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "apps/web/public/social-card.png");
const width = 1200;
const height = 630;

async function fontFace(family, packageName, file, weight) {
  const path = join(dirname(require.resolve(`${packageName}/package.json`)), "files", file);
  const data = await readFile(path);
  return `@font-face{font-family:"${family}";font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${data.toString("base64")}) format("woff2");}`;
}

const fonts = [
  await fontFace("Manrope", "@fontsource-variable/manrope", "manrope-latin-wght-normal.woff2", "200 800"),
  await fontFace("JetBrains Mono", "@fontsource-variable/jetbrains-mono", "jetbrains-mono-latin-wght-normal.woff2", "100 800"),
].join("");

const mark = await readFile(join(root, "apps/web/public/mark.svg"), "utf8");

// The three columns are the product's own claims, in its own order: what a finding cites, what the
// verdict can be, and who merges. No invented numbers - a preview card is not a receipt.
const receipt = [
  { label: "Evidence", value: "file · line · commit" },
  { label: "Verdict", value: "advisory or blocking" },
  { label: "Authority", value: "you merge, not the agent" },
];

const document = `<!doctype html><meta charset="utf-8"><style>
${fonts}
*{box-sizing:border-box;margin:0}
body{width:${width}px;height:${height}px;display:flex;flex-direction:column;justify-content:space-between;
  padding:76px 80px 68px;background:#0b315f;color:#f4f7fb;font-family:"Manrope",sans-serif;
  -webkit-font-smoothing:antialiased;overflow:hidden;position:relative}
/* The hairline grid is the evidence table the product is built around, at the threshold of visible. */
body::before{content:"";position:absolute;inset:0;opacity:.5;
  background-image:linear-gradient(#ffffff0f 1px,transparent 1px),linear-gradient(90deg,#ffffff0f 1px,transparent 1px);
  background-size:60px 60px}
body::after{content:"";position:absolute;inset:0;
  background:radial-gradient(1100px 520px at 8% -12%,#1b4f8f66,transparent 62%)}
.layer{position:relative;z-index:1}
.brand{display:flex;align-items:center;gap:18px}
.brand svg{width:60px;height:60px;box-shadow:0 8px 30px #00000040;border-radius:14px}
.name{font-size:31px;font-weight:800;letter-spacing:-.02em}
.rule{width:1px;height:34px;background:#ffffff2e}
.kicker{font-family:"JetBrains Mono",monospace;font-size:12px;font-weight:600;letter-spacing:.19em;
  text-transform:uppercase;color:#9fb8d6}
h1{max-width:13ch;font-size:104px;line-height:1.03;font-weight:800;letter-spacing:-.035em;text-wrap:balance}
h1 em{font-style:normal;color:#8fb6e4}
p{margin-top:28px;max-width:53ch;font-size:26px;line-height:1.42;text-wrap:balance;font-weight:500;color:#c3d4e8}
.receipt{display:flex;gap:56px;padding-top:26px;border-top:1px solid #ffffff24}
.cell{display:flex;flex-direction:column;gap:9px}
.cell dt{font-family:"JetBrains Mono",monospace;font-size:11px;font-weight:700;letter-spacing:.18em;
  text-transform:uppercase;color:#7f9dc2}
.cell dd{font-size:19px;font-weight:650;letter-spacing:-.01em}
.foot{display:flex;align-items:flex-end;justify-content:space-between;gap:40px}
.url{font-family:"JetBrains Mono",monospace;font-size:15px;font-weight:600;color:#9fb8d6;white-space:nowrap}
</style>
<div class="layer brand">${mark}<span class="name">BuildIT</span><span class="rule"></span><span class="kicker">Evidence room</span></div>
<div class="layer">
  <h1>Proof before <em>the merge.</em></h1>
  <p>Autonomous pull request review that shows its work, so a merge decision rests on evidence rather than trust.</p>
</div>
<div class="layer foot">
  <dl class="receipt">${receipt.map(item => `<div class="cell"><dt>${item.label}</dt><dd>${item.value}</dd></div>`).join("")}</dl>
  <span class="url">buildit-agentic-review.vercel.app</span>
</div>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  await page.setContent(document, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, await page.screenshot({ type: "png" }));
} finally {
  await browser.close();
}
console.log(`wrote ${out} at ${width * 2}x${height * 2}`);
