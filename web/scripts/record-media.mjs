// Records the three social clips with Playwright video capture, then converts them to
// MP4 (H.264) and GIF (palette-optimised) with ffmpeg. Expects `npm run preview` on :4173.
//   node scripts/record-media.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "../..");
const outDir = path.join(root, "docs/media");
const tmp = path.join(outDir, ".raw");
fs.mkdirSync(tmp, { recursive: true });
const BASE = process.env.BASE_URL ?? "http://localhost:4173/";
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const W = 1280;
const H = 720;

async function clip(name, fn) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    recordVideo: { dir: tmp, size: { width: W, height: H } },
  });
  const page = await ctx.newPage();
  await fn(page);
  const video = page.video();
  await ctx.close();
  await browser.close();
  const raw = await video.path();
  const mp4 = path.join(outDir, `${name}.mp4`);
  const gif = path.join(outDir, `${name}.gif`);
  // trim the first 1.5s of blank load
  execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-ss", "1.5", "-i", raw, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "24", "-movflags", "+faststart", mp4]);
  execFileSync(FFMPEG, [
    "-y", "-loglevel", "error", "-i", mp4,
    "-vf", "fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4",
    gif,
  ]);
  console.log(`${name}: ${(fs.statSync(mp4).size / 1e6).toFixed(1)} MB mp4, ${(fs.statSync(gif).size / 1e6).toFixed(1)} MB gif`);
}

async function waitGraph(page) {
  await page.getByTestId("graph-explorer").waitFor({ timeout: 30000 });
  await page.waitForTimeout(2500);
}

// 1. Time-slider sweep across the whole graph
await clip("time-slider", async (page) => {
  await page.goto(`${BASE}#/graph?t=1700`);
  await waitGraph(page);
  await page.getByTestId("play").click();
  await page.waitForTimeout(16000);
});

// 2. Family tree of the top founder (by descendant laureates)
await clip("family-tree", async (page) => {
  await page.goto(`${BASE}#/trees`);
  await page.getByTestId("founder-tree").waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Laureates", exact: true }).click();
  await page.waitForTimeout(800);
  await page.locator("ol button").first().click();
  await page.waitForTimeout(2500);
  await page.getByTestId("founder-tree").hover();
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: "Horizontal" }).click();
  await page.waitForTimeout(3000);
});

// 3. Migration arcs 1925 -> 1950
await clip("migration-1925-1950", async (page) => {
  await page.goto(`${BASE}#/migration?t=1925`);
  await page.getByTestId("migration").waitFor({ timeout: 30000 });
  await page.waitForTimeout(2500);
  for (let y = 1925; y <= 1950; y += 1) {
    await page.goto(`${BASE}#/migration?t=${y}`);
    await page.waitForTimeout(420);
  }
  await page.waitForTimeout(1500);
});

fs.rmSync(tmp, { recursive: true, force: true });
