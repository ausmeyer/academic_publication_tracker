import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const browser = await chromium.launch({ channel: process.env.APT_CHROME_CHANNEL || undefined });
try {
  const page = await browser.newPage({
    viewport: { width: 1024, height: 1024 },
    deviceScaleFactor: 1,
  });
  const svg = await readFile(new URL('../public/icon.svg', import.meta.url), 'utf8');
  await page.setContent(
    `<style>html,body{margin:0;width:1024px;height:1024px;background:transparent}svg{width:1024px;height:1024px}</style>${svg}`,
  );
  await page.screenshot({ path: 'build/icon.png', omitBackground: true });
} finally {
  await browser.close();
}
