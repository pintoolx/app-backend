/**
 * Week 6.1 — IDL alignment.
 *
 * Reads the freshly built IDL artifact from `programs/target/idl/<name>.json`
 * and writes it to `backend/src/onchain/anchor/<name>.json`.
 *
 * Modes:
 *   - `npm run idl:sync`  → overwrite the backend copy.
 *   - `npm run idl:check` → exit non-zero if the two files differ (CI guard).
 *
 * Keeping IDL drift to zero is critical because the AnchorOnchainAdapter
 * binds typed accounts/instructions to the structure of this JSON; a stale
 * copy would silently mis-decode account data on devnet.
 */
import { promises as fs } from 'fs';
import * as path from 'path';

interface SyncTarget {
  name: string;
  source: string;
  destination: string;
}

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const TARGETS: SyncTarget[] = [
  {
    name: 'strategy_runtime',
    source: path.join(REPO_ROOT, 'programs', 'target', 'idl', 'strategy_runtime.json'),
    destination: path.join(
      REPO_ROOT,
      'backend',
      'src',
      'onchain',
      'anchor',
      'strategy_runtime.json',
    ),
  },
];

const MODE = (process.argv[2] ?? 'sync').trim();

async function readIfExists(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, 'utf8');
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return null;
    throw err;
  }
}

function normalize(json: string): string {
  return JSON.stringify(JSON.parse(json), null, 2) + '\n';
}

async function run() {
  let drifted = 0;
  for (const target of TARGETS) {
    const sourceRaw = await readIfExists(target.source);
    if (sourceRaw === null) {
      console.error(`[idl:${MODE}] missing source IDL: ${target.source}`);
      console.error(`  hint: run \`anchor build\` inside programs/ first.`);
      process.exit(2);
    }
    const sourceNormalized = normalize(sourceRaw);
    const existingRaw = await readIfExists(target.destination);
    const existingNormalized = existingRaw ? normalize(existingRaw) : null;

    if (MODE === 'check') {
      if (existingNormalized !== sourceNormalized) {
        console.error(
          `[idl:check] DRIFT detected for ${target.name}:\n  source:      ${target.source}\n  destination: ${target.destination}`,
        );
        drifted++;
      } else {
        console.log(`[idl:check] ${target.name} in sync.`);
      }
      continue;
    }

    if (existingNormalized === sourceNormalized) {
      console.log(`[idl:sync] ${target.name} already up to date.`);
      continue;
    }
    await fs.mkdir(path.dirname(target.destination), { recursive: true });
    await fs.writeFile(target.destination, sourceNormalized, 'utf8');
    console.log(`[idl:sync] wrote ${target.destination}`);
  }

  if (MODE === 'check' && drifted > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(`[idl:${MODE}] failed:`, err);
  process.exit(1);
});
