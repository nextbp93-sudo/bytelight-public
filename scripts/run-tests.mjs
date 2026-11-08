import { readdirSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[2] || 'src');
const batchSize = Number.parseInt(process.env.BYTELIGHT_TEST_BATCH_SIZE || '20', 10);
const concurrency = Number.parseInt(process.env.BYTELIGHT_TEST_CONCURRENCY || '4', 10);

function findTests(directory) {
  const tests = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) tests.push(...findTests(path));
    else if (entry.isFile() && entry.name.endsWith('.test.ts')) tests.push(path);
  }
  return tests;
}

if (!statSync(root).isDirectory()) throw new Error(`Test root is not a directory: ${root}`);

const tests = findTests(root).sort();
if (tests.length === 0) {
  console.log(`No TypeScript tests found under ${root}`);
  process.exit(0);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const tsxCli = resolve(scriptDir, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');
let failed = false;

for (let index = 0; index < tests.length; index += batchSize) {
  const batch = tests.slice(index, index + batchSize);
  const result = spawnSync(process.execPath, [tsxCli, '--test', `--test-concurrency=${concurrency}`, ...batch], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) failed = true;
}

process.exit(failed ? 1 : 0);
