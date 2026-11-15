import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, dirname, join } from 'path';
import { getBytelightConfig } from '../config.js';

export interface IdentityDocument {
  path: string;
  name: string;
  content: string | null;
}

/**
 * Resolve the companion identity document.
 *
 * `claude_md_path` is the historical config key, but the configured document
 * is provider-neutral and may be named AGENTS.md for a Codex home.
 */
export function getIdentityDocumentPath(overridePath?: string): string {
  return overridePath ?? getBytelightConfig().agent.claude_md_path;
}

/** Read the configured identity, with compatible fallbacks for older homes. */
export function readIdentityDocument(overridePath?: string): IdentityDocument {
  const config = overridePath ? null : getBytelightConfig();
  const configuredPath = overridePath ?? config!.agent.claude_md_path;
  const candidates = overridePath
    ? [overridePath]
    : [
        configuredPath,
        join(config!.agent.cwd, 'AGENTS.md'),
        join(config!.agent.cwd, '.claude/CLAUDE.md'),
        join(config!.agent.cwd, 'CLAUDE.md'),
      ];

  const seen = new Set<string>();
  for (const path of candidates) {
    if (seen.has(path)) continue;
    seen.add(path);
    if (existsSync(path)) {
      return { path, name: basename(path), content: readFileSync(path, 'utf8') };
    }
  }

  return { path: configuredPath, name: basename(configuredPath), content: null };
}

/** Write the configured identity and retain the immediately previous version. */
export function writeIdentityDocument(content: string, overridePath?: string): IdentityDocument {
  const path = getIdentityDocumentPath(overridePath);
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) {
    writeFileSync(`${path}.backup`, readFileSync(path, 'utf8'), 'utf8');
  }
  writeFileSync(path, content, 'utf8');
  return { path, name: basename(path), content };
}
