#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const source = path.resolve(process.argv[2] || path.join(root, '.apollo', 'vendor', 'onlyoffice-browser'));
const target = path.join(root, '.apollo', 'onlyoffice-runtime');
const fontTarget = path.join(root, '.apollo', 'onlyoffice-font-assets');
const curatedFontInput = path.join(root, '.apollo', 'office-font-input');
const defaultFontInput = existsSync(curatedFontInput)
  ? curatedFontInput
  : process.platform === 'darwin' ? '/System/Library/Fonts' : '/usr/share/fonts';
const fontInput = path.resolve(process.argv[3] || process.env.APOLLO_OFFICE_FONT_DIR || defaultFontInput);

if (!existsSync(source)) {
  mkdirSync(path.dirname(source), { recursive: true });
  run('git', ['clone', '--depth', '1', 'https://github.com/agentbridges-ai/onlyoffice-browser.git', source], root);
}

run('pnpm', ['install', '--frozen-lockfile'], source);
run('pnpm', ['build'], source);
rmSync(target, { recursive: true, force: true });
cpSync(path.join(source, 'dist'), target, { recursive: true });
rmSync(path.join(target, 'web-apps', 'apps', 'spreadsheeteditor'), { recursive: true, force: true });
rmSync(path.join(target, 'web-apps', 'apps', 'presentationeditor'), { recursive: true, force: true });
if (!existsSync(path.join(fontTarget, 'onlyoffice-browser-font-assets.json'))) {
  if (!existsSync(fontInput)) throw new Error(`找不到字体目录：${fontInput}`);
  patchFontGenerator(source);
  run('pnpm', ['fonts:generate', '--input', fontInput, '--output', fontTarget], source);
}
run('pnpm', ['fonts:verify', '--input', fontTarget], source);
cpSync(fontTarget, target, { recursive: true });
run(process.execPath, [path.join(root, 'scripts', 'precompress-assets.mjs')], root);
console.log(`OnlyOffice 本地运行时已准备：${target}`);

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

function patchFontGenerator(sourceRoot) {
  const file = path.join(sourceRoot, 'scripts', 'generate-onlyoffice-font-assets.mjs');
  let current = readFileSync(file, 'utf8');
  const marker = "export const GENERATED_FONT_ASSETS_MANIFEST = 'onlyoffice-browser-font-assets.json';";
  if (!current.includes('const GENERATED_FONT_SOURCE_MAP =') && current.includes(marker)) {
    current = current.replace(marker, `${marker}\nconst GENERATED_FONT_SOURCE_MAP = 'onlyoffice-browser-font-source-map.json';`);
  }
  current = current.replace(`used_source_indexes = []
used_source_index_set = set()
cjk_range_info_indexes = {
    web_ranges[index + 2]
    for index in range(0, len(web_ranges), 3)
    if (0x2E80 <= web_ranges[index] <= 0xFAFF or 0x2E80 <= web_ranges[index + 1] <= 0xFAFF or 0x20000 <= web_ranges[index] <= 0x2FA1F or 0x20000 <= web_ranges[index + 1] <= 0x2FA1F)
}
new_infos = []
for info_index, original_info in enumerate(web_infos):`, `used_source_indexes = []
used_source_index_set = set()
new_infos = []
for original_info in web_infos:`);
  current = current.replace(`    info = list(original_info)
    if info_index in cjk_range_info_indexes and not is_cjk_family_name(info[0]):
        info[0] = cjk_fallback_family_name
    keep_actual_font =`, `    info = list(original_info)
    keep_actual_font =`);

  const sourceMapMarker = 'source_index_map = {old_index: new_index for new_index, old_index in enumerate(used_source_indexes)}';
  if (!current.includes('cjk_fallback_info_index = next(') && current.includes(sourceMapMarker)) {
    current = current.replace(sourceMapMarker, `def is_cjk_code_point(value):
    return (
        0x2E80 <= value <= 0x2EFF
        or 0x3000 <= value <= 0x303F
        or 0x3040 <= value <= 0x30FF
        or 0x3100 <= value <= 0x312F
        or 0x31A0 <= value <= 0x31BF
        or 0x31F0 <= value <= 0x31FF
        or 0x3400 <= value <= 0x4DBF
        or 0x4E00 <= value <= 0x9FFF
        or 0xAC00 <= value <= 0xD7AF
        or 0xF900 <= value <= 0xFAFF
        or 0x20000 <= value <= 0x2FA1F
    )

cjk_fallback_info_index = next(
    (index for index, info in enumerate(new_infos) if info and info[0] == cjk_fallback_family_name),
    -1,
)
if cjk_fallback_info_index >= 0:
    for range_index in range(0, len(web_ranges), 3):
        start = web_ranges[range_index]
        end = web_ranges[range_index + 1]
        info_index = web_ranges[range_index + 2]
        if (
            (is_cjk_code_point(start) or is_cjk_code_point(end))
            and 0 <= info_index < len(new_infos)
            and not is_cjk_family_name(new_infos[info_index][0])
        ):
            web_ranges[range_index + 2] = cjk_fallback_info_index

${sourceMapMarker}`);
  }
  writeFileSync(file, current);
}
