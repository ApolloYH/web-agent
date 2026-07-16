import fs from 'node:fs/promises';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
if (!args.snapshot || !args.target || !args.confirm) {
  throw new Error('Usage: node scripts/restore-production.mjs --snapshot <path> --target <shared-data-root> --confirm');
}

const snapshot = path.resolve(args.snapshot);
const target = path.resolve(args.target);
const manifest = JSON.parse(await fs.readFile(path.join(snapshot, 'manifest.json'), 'utf8'));
if (manifest.format !== 1) throw new Error('Unsupported backup format');
await fs.access(path.join(snapshot, '.apollo', 'web-agent.sqlite'));
if (args.restoreEnv) await fs.access(path.join(snapshot, '.env'));

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const staged = path.join(target, `.apollo.restore-${timestamp}`);
const current = path.join(target, '.apollo');
const previous = path.join(target, `.apollo.pre-restore-${timestamp}`);
await fs.cp(path.join(snapshot, '.apollo'), staged, { recursive: true });
try {
  await fs.rename(current, previous);
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
try {
  await fs.rename(staged, current);
} catch (error) {
  await fs.rename(previous, current).catch(() => undefined);
  throw error;
}
if (args.restoreEnv) await fs.copyFile(path.join(snapshot, '.env'), path.join(target, '.env'));
console.info(`Backup restored. Previous data kept at: ${previous}`);

function parseArgs(values) {
  const result = { confirm: false, restoreEnv: false };
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (key === '--confirm') result.confirm = true;
    else if (key === '--restore-env') result.restoreEnv = true;
    else if (key === '--snapshot' && values[index + 1]) result.snapshot = values[++index];
    else if (key === '--target' && values[index + 1]) result.target = values[++index];
  }
  return result;
}
