import { createDatabase } from './db/index.js';
import { collectOnce, RANGE_WINDOWS } from './collector/index.js';

const DEFAULT_DB_PATH = '/var/lib/ipcheck/ipcheck.db';

interface CliOptions {
  dryRun: boolean;
  dbPath: string;
  tailLines?: number;
}

const options = parseArgs(process.argv.slice(2));
const db = createDatabase(options.dryRun ? ':memory:' : options.dbPath);

try {
  const result = await collectOnce(db, {
    dryRun: options.dryRun,
    tailLines: options.tailLines,
    windows: Object.values(RANGE_WINDOWS),
  });

  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.errors.length > 0 ? 1 : 0;
} finally {
  db.close();
}

function parseArgs(args: string[]): CliOptions {
  args = args.filter((arg) => arg !== '--');
  let dryRun = false;
  let dbPath = process.env.IPCHECK_DB_PATH ?? DEFAULT_DB_PATH;
  let tailLines: number | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (arg === '--db') {
      dbPath = readValue(args, index, '--db');
      index += 1;
      continue;
    }

    if (arg === '--tail-lines') {
      tailLines = Number.parseInt(readValue(args, index, '--tail-lines'), 10);
      if (!Number.isFinite(tailLines) || tailLines <= 0) {
        throw new Error('--tail-lines must be a positive number');
      }
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { dryRun, dbPath, tailLines };
}

function readValue(args: string[], index: number, name: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}
