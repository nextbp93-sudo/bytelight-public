import { rmSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';

const requested = process.argv[2];
if (!requested) throw new Error('Usage: node scripts/clean.mjs <relative-path>');
if (isAbsolute(requested)) throw new Error('Refusing to clean an absolute path');

const target = resolve(process.cwd(), requested);
const rel = relative(process.cwd(), target);
if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
  throw new Error(`Refusing to clean outside the current package: ${target}`);
}

rmSync(target, { recursive: true, force: true });
