import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

const args = parseArgs(process.argv.slice(2));
const source = path.resolve(args.source || process.cwd());
const destination = path.resolve(args.destination || path.join(source, 'backups'));
const retentionDays = positiveNumber(args.retentionDays, Number(process.env.WEB_BACKUP_RETENTION_DAYS || 14));
const dataRoot = path.join(source, '.apollo');
const databasePath = path.join(dataRoot, 'web-agent.sqlite');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const temporary = path.join(destination, `.tmp-${timestamp}-${randomUUID()}`);
const snapshot = path.join(destination, timestamp);

await fs.access(databasePath);
await fs.mkdir(temporary, { recursive: true, mode: 0o700 });
try {
  await fs.cp(dataRoot, path.join(temporary, '.apollo'), {
    recursive: true,
    filter: (sourcePath) => shouldCopyData(sourcePath, dataRoot),
  });
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    await backup(database, path.join(temporary, '.apollo', 'web-agent.sqlite'));
  } finally {
    database.close();
  }
  await fs.copyFile(path.join(source, '.env'), path.join(temporary, '.env')).catch(() => undefined);
  await fs.writeFile(path.join(temporary, 'manifest.json'), `${JSON.stringify({
    format: 1,
    createdAt: new Date().toISOString(),
    source,
    includes: ['.apollo', '.env (when present)'],
  }, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, snapshot);
  await pruneSnapshots(destination, retentionDays);
  console.info(`Backup created: ${snapshot}`);
} catch (error) {
  await fs.rm(temporary, { recursive: true, force: true });
  throw error;
}

function shouldCopyData(sourcePath, root) {
  const relative = path.relative(root, sourcePath);
  if (!relative) return true;
  if (relative === 'onlyoffice-runtime' || relative.startsWith(`onlyoffice-runtime${path.sep}`)) return false;
  return !path.basename(sourcePath).startsWith('web-agent.sqlite');
}

async function pruneSnapshots(root, days) {
  const cutoff = Date.now() - days * 24 * 60 * 60_000;
  const entries = await fs.readdir(root, { withFileTypes: true });
  await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    const target = path.join(root, entry.name);
    const manifest = await fs.stat(path.join(target, 'manifest.json')).catch(() => null);
    const temporary = entry.name.startsWith('.tmp-') && (await fs.stat(target)).mtimeMs < cutoff;
    if ((manifest && manifest.mtimeMs < cutoff) || temporary) await fs.rm(target, { recursive: true, force: true });
  }));
}

function positiveNumber(value, fallback) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 14;
}

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    const value = values[index + 1];
    if (key === '--source' && value) result.source = value;
    if (key === '--destination' && value) result.destination = value;
    if (key === '--retention-days' && value) result.retentionDays = value;
    if (key?.startsWith('--') && value) index += 1;
  }
  return result;
}
