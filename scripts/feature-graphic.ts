import { join } from "node:path";
import { chromium } from "@playwright/test";

const root = join(import.meta.dir, "..");
const images = join(root, "docs/images");
const shot = `data:image/webp;base64,${Buffer.from(await Bun.file(join(images, "service-dark.webp")).bytes()).toString("base64")}`;

const GROUND = "#0f0c10";
const INK = "#f5f1f4";
const MUTED = "#a89aa5";
const ACCENT = "#e8889f";
const PRIMARY = "#b8284f";
const EMBER = "#d6765e";

/**
 * Homerun's logo, the home plate and its ball, as inline SVG filled with the brand gradient.
 * `id` keeps the gradient and mask ids unique when the logo appears twice on one page.
 */
const logo = (id: string) => `
<svg viewBox="0 0 32 32" aria-hidden="true">
  <defs>
    <linearGradient id="g${id}" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="${PRIMARY}"/><stop offset="1" stop-color="${ACCENT}"/>
    </linearGradient>
    <mask id="m${id}"><rect width="32" height="32" fill="#fff"/><path d="M9.5 21Q12 12 25 8.5" fill="none" stroke="#000" stroke-width="2.8" stroke-linecap="round"/></mask>
  </defs>
  <path d="M4 10.5a1.5 1.5 0 0 1 1.5-1.5h19a1.5 1.5 0 0 1 1.5 1.5V19l-11 9.5L4 19Z" fill="url(#g${id})" stroke="url(#g${id})" stroke-width="1.5" stroke-linejoin="round" mask="url(#m${id})"/>
  <circle cx="27.5" cy="6" r="2.6" fill="url(#g${id})"/>
</svg>`;

const page = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 1024px; height: 500px; overflow: hidden; }
  body {
    position: relative;
    background:
      radial-gradient(620px 420px at 96% 0%, ${PRIMARY}66, transparent 70%),
      radial-gradient(520px 380px at 4% 108%, ${EMBER}33, transparent 70%),
      ${GROUND};
    color: ${INK};
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .mark { position: absolute; left: 560px; top: -120px; width: 560px; opacity: 0.35; transform: rotate(-8deg); }
  .words { position: absolute; left: 64px; top: 0; width: 400px; height: 500px; display: flex; flex-direction: column; justify-content: center; }
  .brand { display: flex; align-items: center; gap: 12px; font-size: 22px; font-weight: 600; letter-spacing: -0.2px; }
  .brand svg { width: 34px; }
  h1 { margin-top: 28px; font-size: 50px; line-height: 1.04; font-weight: 650; letter-spacing: -1.6px; text-wrap: balance; }
  p { margin-top: 18px; max-width: 340px; font-size: 18px; line-height: 1.45; color: ${MUTED}; text-wrap: pretty; }
  .window { position: absolute; left: 470px; top: 96px; width: 760px; overflow: hidden; border-radius: 14px; background: ${GROUND}; box-shadow: 0 30px 80px -20px #000c, 0 0 0 1px #ffffff1f; }
  .window img { display: block; width: 100%; }
  .bar { display: flex; align-items: center; gap: 7px; height: 34px; padding: 0 14px; background: #19151a; border-bottom: 1px solid #ffffff14; }
  .bar i { width: 10px; height: 10px; border-radius: 50%; background: #ffffff2e; }
  .bar span { margin-left: 14px; padding: 4px 14px; border-radius: 8px; background: #ffffff12; color: ${MUTED}; font-size: 11px; }
</style></head><body>
  <div class="mark">${logo("b")}</div>
  <div class="window">
    <div class="bar"><i></i><i></i><i></i><span>homerun.example.com</span></div>
    <img src="${shot}" alt="">
  </div>
  <div class="words">
    <div class="brand">${logo("a")}homerun</div>
    <h1>Point at an image. Hit deploy.</h1>
    <p>A self-hosted PaaS that routes your containers to their own domain, with TLS, on hardware you own.</p>
  </div>
</body></html>`;

const browser = await chromium.launch();
const context = await browser.newContext({
	viewport: { width: 1024, height: 500 },
	deviceScaleFactor: 2,
});
const tab = await context.newPage();
await tab.setContent(page, { waitUntil: "load" });
const png = await tab.screenshot();
await Bun.write(
	join(images, "feature.webp"),
	await new Bun.Image(png).webp({ quality: 92 }).bytes(),
);
await browser.close();
process.stdout.write("docs/images/feature.webp\n");
