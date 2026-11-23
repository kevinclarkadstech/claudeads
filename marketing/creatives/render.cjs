/**
 * Renders the Meta ad creatives (1080x1350, 4:5 feed) from HTML.
 * Usage: node marketing/creatives/render.cjs   (needs Playwright + Chromium installed)
 */
const path = require("path");
const { chromium } = require("playwright");

const css = `
* { box-sizing: border-box; margin: 0; }
body { width: 1080px; height: 1350px; font-family: Inter, "Helvetica Neue", Arial, system-ui, sans-serif; background: #f4f4f6; color: #18181b; display: flex; flex-direction: column; padding: 84px 80px 72px; }
.eyebrow { font-size: 30px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #4f46e5; margin-bottom: 26px; }
h1 { font-size: 100px; line-height: 1.02; letter-spacing: -0.035em; font-weight: 800; margin-bottom: 30px; }
.sub { font-size: 36px; line-height: 1.4; color: #52525b; margin-bottom: 54px; }
.card { background: #fff; border: 2px solid #e4e4e7; border-left: 12px solid #c81e1e; border-radius: 28px; padding: 40px 44px; box-shadow: 0 18px 50px rgba(0,0,0,.08); position: relative; }
.card.warn { border-left-color: #b45309; }
.top { display: flex; align-items: center; gap: 16px; margin-bottom: 18px; font-size: 28px; font-weight: 700; }
.sev { color: #c81e1e; } .warn .sev { color: #b45309; }
.chip { font-size: 25px; font-weight: 600; border: 2px solid #e4e4e7; border-radius: 999px; padding: 4px 16px; color: #18181b; }
.ai { font-size: 25px; font-weight: 700; color: #6250d6; border: 2px solid #c4bdf2; background: #f3f1fd; border-radius: 10px; padding: 4px 14px; }
.card h2 { font-size: 50px; line-height: 1.2; letter-spacing: -0.01em; margin-bottom: 16px; }
.card p { font-size: 34px; line-height: 1.45; color: #52525b; }
.sample { position: absolute; top: 22px; right: 28px; font-size: 21px; color: #a1a1aa; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
.list { list-style: none; padding: 0; display: grid; gap: 16px; margin-top: 8px; }
.list li { background: #fff; border: 2px solid #e4e4e7; border-radius: 22px; padding: 18px 30px; font-size: 34px; font-weight: 700; display: flex; gap: 22px; align-items: center; }
.list li span { color: #52525b; font-weight: 500; font-size: 27px; display: block; margin-top: 2px; }
.tick { flex: none; width: 48px; height: 48px; border-radius: 50%; background: #4f46e5; color: #fff; display: grid; place-items: center; font-size: 30px; }
.more { margin-top: 26px; font-size: 30px; font-weight: 600; color: #52525b; padding-left: 8px; }
.more b { color: #4f46e5; }
.foot { margin-top: auto; display: flex; align-items: center; justify-content: space-between; }
.logo { font-size: 52px; font-weight: 800; letter-spacing: -0.02em; } .logo b { color: #4f46e5; }
.cta { background: #4f46e5; color: #fff; font-size: 34px; font-weight: 700; padding: 22px 36px; border-radius: 18px; }
`;

const footer = `<div class="foot"><div class="logo">Astute<b>Ads</b></div><div class="cta">Try the free demo →</div></div>`;

const creatives = {
  "leak-card": `
    <div class="eyebrow">For Meta &amp; Google advertisers</div>
    <h1>Is your ad budget leaking?</h1>
    <div class="sub">AstuteAds checks every ad, every day, and tells you exactly where the money goes.</div>
    <div class="card">
      <div class="sample">Sample data</div>
      <div class="top"><span class="sev">● Critical</span><span class="chip">Save ~$921/wk</span></div>
      <h2>“Interests: Hiking” spent $920.92 with no conversions</h2>
      <p>That's 36.5× your account's typical cost per conversion. Pause it or move its budget to better performers.</p>
    </div>
    <div class="more"><b>+3 more issues</b> found in this sample account</div>
    ${footer}`,
  "ai-move": `
    <div class="eyebrow">Your weekly ad check-up</div>
    <h1>Know your next best move.</h1>
    <div class="sub">An AI analyst reviews your whole account and ranks what to fix first, with the numbers behind it.</div>
    <div class="card warn">
      <div class="sample">Sample data</div>
      <div class="top"><span class="sev">▲ Warning</span><span class="ai">AI</span></div>
      <h2>Move ~$130/day from “Interests: Hiking” to “Lookalike — Purchasers 1%”</h2>
      <p>The lookalike campaign returns 6.81× and is capped by its budget. Shift budget in two steps a few days apart.</p>
    </div>
    <div class="more"><b>+2 more actions</b>, ranked by impact</div>
    ${footer}`,
  "checklist": `
    <div class="eyebrow">Meta &amp; Google Ads</div>
    <h1>6 budget leaks, checked daily.</h1>
    <ul class="list">
      <li><div class="tick">✓</div><div>Wasted spend<span>Ads spending with zero conversions</span></div></li>
      <li><div class="tick">✓</div><div>Cost spikes<span>And whether clicks or your page is to blame</span></div></li>
      <li><div class="tick">✓</div><div>Tired creative<span>Ads your audience has stopped clicking</span></div></li>
      <li><div class="tick">✓</div><div>Budget-capped winners<span>Great campaigns held back by budget</span></div></li>
      <li><div class="tick">✓</div><div>Weak ads<span>Click-through far below your other ads</span></div></li>
      <li><div class="tick">✓</div><div>Broken tracking<span>Clicks continue, conversions vanish</span></div></li>
    </ul>
    ${footer}`,
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
  for (const [name, body] of Object.entries(creatives)) {
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`);
    const file = path.join(__dirname, `${name}.png`);
    await page.screenshot({ path: file });
    console.log("wrote", file);
  }
  await browser.close();
})();
