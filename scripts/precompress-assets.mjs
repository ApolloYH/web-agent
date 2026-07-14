#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';

const officeRoot = path.join(process.cwd(), '.apollo', 'onlyoffice-runtime');
const assets = [
  'wasm/x2t/x2t.wasm',
  'sdkjs/word/sdk-all.js',
  'sdkjs/common/libfont/engine/fonts.wasm',
  'sdkjs/common/spell/spell/spell.wasm',
  'sdkjs/common/zlib/engine/zlib.wasm',
  'web-apps/apps/documenteditor/main/app.js',
  'web-apps/apps/documenteditor/main/code.js',
  'fonts/000.ttf',
  'fonts/001.ttc',
].map((relative) => path.join(officeRoot, relative));
const distAssets = path.join(process.cwd(), 'dist', 'assets');
if (existsSync(distAssets)) {
  assets.push(...readdirSync(distAssets)
    .filter((name) => name.endsWith('.js') || name.endsWith('.css'))
    .map((name) => path.join(distAssets, name)));
}

for (const source of assets) {
  if (!existsSync(source)) continue;
  const output = `${source}.br`;
  if (existsSync(output) && statSync(output).mtimeMs >= statSync(source).mtimeMs) continue;
  const temporary = `${output}.tmp`;
  writeFileSync(temporary, brotliCompressSync(readFileSync(source), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 6 },
  }));
  renameSync(temporary, output);
  console.log(`Brotli: ${path.relative(process.cwd(), source)}`);
}
