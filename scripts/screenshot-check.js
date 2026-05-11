const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseUrl = process.env.SCREENSHOT_URL || "http://127.0.0.1:8000";
const outputDir = path.join(process.cwd(), "screenshots");
const viewports = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "laptop-1280", width: 1280, height: 800 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "mobile-390", width: 390, height: 844 },
];

function isIgnorableRequest(url) {
  return (
    url.includes("/user/api/profile") ||
    url.includes("/user/api/announcement") ||
    url.includes("/api/site-mode") ||
    url.includes("favicon")
  );
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const results = [];
  let hasFailure = false;

  for (const viewport of viewports) {
    const page = await browser.newPage({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
    });

    const consoleErrors = [];
    const failedRequests = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const text = msg.text();
        if (!text.includes("401") && !text.includes("/user/api/profile")) {
          consoleErrors.push(text);
        }
      }
    });

    page.on("requestfailed", (request) => {
      const url = request.url();
      if (!isIgnorableRequest(url)) {
        failedRequests.push(`${request.method()} ${url} ${request.failure()?.errorText || ""}`.trim());
      }
    });

    const url = `${baseUrl}/`;
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });

    const checks = await page.evaluate(() => {
      const doc = document.documentElement;
      const body = document.body;
      const title = document.querySelector("h1");
      const primaryButtons = Array.from(document.querySelectorAll(".btn-primary"));
      const cards = document.querySelectorAll(".feature-card, .card");
      const maxScrollWidth = Math.max(doc.scrollWidth, body.scrollWidth);
      const isVisible = (el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      return {
        titleVisible: !!title && title.getBoundingClientRect().width > 0 && title.getBoundingClientRect().height > 0,
        primaryVisible: primaryButtons.some(isVisible),
        cardsVisible: cards.length > 0,
        horizontalScroll: maxScrollWidth > window.innerWidth + 1,
        scrollWidth: maxScrollWidth,
        innerWidth: window.innerWidth,
      };
    });

    const file = path.join(outputDir, `${viewport.name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    await page.close();

    const failures = [];
    if (!checks.titleVisible) failures.push("主要标题不可见");
    if (!checks.primaryVisible) failures.push("主按钮不可见");
    if (!checks.cardsVisible) failures.push("卡片区域不可见");
    if (checks.horizontalScroll) failures.push(`存在横向滚动 ${checks.scrollWidth}/${checks.innerWidth}`);
    if (consoleErrors.length) failures.push(`控制台错误 ${consoleErrors.length} 条`);
    if (failedRequests.length) failures.push(`网络失败 ${failedRequests.length} 条`);

    const ok = failures.length === 0;
    hasFailure = hasFailure || !ok;
    results.push({
      viewport: viewport.name,
      ok,
      file,
      failures,
      consoleErrors,
      failedRequests,
    });
  }

  await browser.close();

  for (const result of results) {
    console.log(`${result.viewport}: ${result.ok ? "PASS" : "FAIL"} -> ${path.relative(process.cwd(), result.file)}`);
    for (const failure of result.failures) console.log(`  - ${failure}`);
    for (const error of result.consoleErrors.slice(0, 5)) console.log(`  console: ${error}`);
    for (const req of result.failedRequests.slice(0, 5)) console.log(`  request: ${req}`);
  }

  if (hasFailure) process.exit(1);
})();
