// Composes the README's product images from the raw captures in docs/screenshots/captures.
// The stage, iPhone frame and captions are HTML/CSS, rendered at 2x by Playwright's Chromium.
// Recapturing is described in docs/screenshots.md.
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const screenshots = join(root, "docs/screenshots");
// The iOS app bundles the web fonts' display cuts, so captions match the app's headings.
const fonts = join(root, "apps/ios/Sources/IndexUI/Resources/Fonts");
const data = (path: string, type: string) =>
  `data:${type};base64,${readFileSync(path).toString("base64")}`;
const capture = (name: string) => data(join(screenshots, "captures", `${name}.png`), "image/png");

const css = `
@font-face{font-family:IndexSerif;src:url(${data(join(fonts, "IndexSerif-Semibold.ttf"), "font/ttf")})}
html,body{margin:0;background:transparent}
.stage{position:relative;width:1200px;background:#0f0f11;border-radius:28px;overflow:hidden}
.phone{position:relative;flex:none;width:calc(426*var(--u));height:calc(898*var(--u))}
.frame{position:absolute;inset:0;border-radius:calc(72*var(--u));background:#0a0a0b;
  box-shadow:0 0 0 calc(1.6*var(--u)) #2b2b2e,0 0 0 calc(3.4*var(--u)) #75757b,0 0 0 calc(4.4*var(--u)) #2b2b2e,
    0 calc(24*var(--u)) calc(60*var(--u)) rgba(0,0,0,.28)}
.screen{position:absolute;inset:calc(12*var(--u));border-radius:calc(60*var(--u));overflow:hidden;background:#000}
.screen img{width:100%;height:100%;display:block}
.island{position:absolute;top:calc(11*var(--u));left:50%;transform:translateX(-50%);
  width:calc(122*var(--u));height:calc(36*var(--u));border-radius:calc(18*var(--u));
  background:radial-gradient(circle at calc(100% - 18*var(--u)) 50%,#26304d 0,#121726 calc(3*var(--u)),#05060a calc(5.5*var(--u)),#000 calc(7*var(--u)));
  box-shadow:inset 0 0 0 calc(1*var(--u)) rgba(255,255,255,.07)}
.button{position:absolute;width:calc(5*var(--u));border-radius:calc(2.5*var(--u));
  background:linear-gradient(90deg,#55555a,#8a8a90,#55555a)}
.row{display:flex;justify-content:space-evenly;padding:44px 0 52px}
.cell{display:flex;flex-direction:column;align-items:center;gap:28px}
.caption{font:30px IndexSerif;letter-spacing:-.01em;color:#f2f2f3}
`;

// An iPhone 18 Pro (402×874 pt screen) drawn at `width` px, with its side buttons and island.
function phone(name: string, width: number, style = "") {
  const button = (side: "left" | "right", top: number, height: number) =>
    `<div class="button" style="${side}:calc(-8*var(--u));top:calc(${top}*var(--u));height:calc(${height}*var(--u))"></div>`;
  return `<div class="phone" style="--u:${width / 426}px;${style}">
    ${button("left", 170, 34)}${button("left", 236, 62)}${button("left", 312, 62)}${button("right", 262, 100)}
    <div class="frame"></div>
    <div class="screen"><img src="${capture(`iphone-${name}`)}"><div class="island"></div></div>
  </div>`;
}

const images: Record<string, string> = {
  // The desktop capture keeps its macOS window shadow, so it is offset by that margin.
  hero: `<div class="stage" style="height:760px">
    <img src="${capture("desktop-home")}" style="position:absolute;width:1000px;left:10px;top:18px">
    ${phone("conversation", 270, "position:absolute;right:46px;bottom:34px")}
  </div>`,
  phones: `<div class="stage row">${(
    [
      ["home", "This week"],
      ["post", "Comments"],
      ["activity", "Activity"],
      ["profile", "Your library"],
    ] as const
  )
    .map(
      ([name, caption]) =>
        `<div class="cell"><div class="caption">${caption}</div>${phone(name, 236)}</div>`,
    )
    .join("")}</div>`,
};

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    deviceScaleFactor: 2,
    viewport: { width: 1200, height: 800 },
  });
  for (const [name, body] of Object.entries(images)) {
    await page.setContent(`<!doctype html><style>${css}</style>${body}`);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.locator(".stage").screenshot({
      path: join(screenshots, `${name}.png`),
      omitBackground: true,
    });
    console.log(`Wrote docs/screenshots/${name}.png`);
  }
} finally {
  await browser.close();
}
