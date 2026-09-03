// Renders icon.svg to the PNG sizes Chrome wants.
//
//   node <browser-automation>/browser.mjs about:blank --script tools/make-icons.mjs
//
// Chrome will not take an SVG for a toolbar icon, so the source drawing lives in
// icon.svg and this produces the raster set beside it.
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SIZES = [16, 32, 48, 128];

export default async function run(page) {
  const svg = readFileSync(join(root, 'icon.svg'), 'utf8');
  mkdirSync(join(root, 'icons'), { recursive: true });
  const written = [];

  for (const size of SIZES) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<!doctype html><meta charset="utf-8">
       <style>html,body{margin:0;padding:0;width:${size}px;height:${size}px;overflow:hidden}
              svg{display:block;width:${size}px;height:${size}px}</style>
       ${svg}`
    );
    const buf = await page.screenshot({ clip: { x: 0, y: 0, width: size, height: size } });
    const file = join(root, 'icons', `icon${size}.png`);
    writeFileSync(file, buf);
    written.push(`icon${size}.png ${buf.length}b`);
  }
  return written;
}
