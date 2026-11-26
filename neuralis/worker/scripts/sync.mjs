#!/usr/bin/env node

/**
 * Neuralis OS — Conversation Sync Script
 *
 * Reads Claude Code JSONL conversation logs and ingests them into the
 * Neuralis OS Cortex layer via the REST API.
 *
 * Usage:
 *   node scripts/sync.mjs --url https://your-worker.workers.dev --key YOUR_API_KEY
 *   node scripts/sync.mjs --url http://localhost:8787 --key test-key --dry-run
 *
 * Options:
 *   --url       Worker URL (required)
 *   --key       API key for authentication (required)
 *   --path      Claude Code projects dir (default: ~/.claude/projects)
 *   --since     Only sync conversations after this date (YYYY-MM-DD)
 *   --dry-run   Show what would be synced without sending
 *   --verbose   Show detailed output
 */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return null;
  if (name === "dry-run" || name === "verbose") return true;
  return args[idx + 1] || null;
}

const WORKER_URL = getArg("url");
const API_KEY = getArg("key");
const PROJECTS_DIR = getArg("path") || join(homedir(), ".claude", "projects");
const SINCE = getArg("since");
const DRY_RUN = getArg("dry-run");
const VERBOSE = getArg("verbose");

if (!WORKER_URL || !API_KEY) {
  console.error("Usage: node scripts/sync.mjs --url <worker-url> --key <api-key>");
  process.exit(1);
}

// State file tracks last sync per project
const STATE_FILE = join(homedir(), ".claude", ".neuralis-sync-state.json");

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Parse a Claude Code JSONL file into a conversation.
 * Each line is a JSON message with role, content, timestamp, etc.
 */
function parseJSONL(filePath) {
  const content = readFileSync(filePath, "utf8");
  const lines = content.split("\n").filter(Boolean);
  const messages = [];

  for (const line of lines) {
    try {
      const msg = JSON.parse(line);
      // Claude Code JSONL format has various message types
      if (msg.type === "human" || msg.type === "assistant") {
        let text = "";
        if (typeof msg.message?.content === "string") {
          text = msg.message.content;
        } else if (Array.isArray(msg.message?.content)) {
          text = msg.message.content
            .filter((c) => c.type === "text")
            .map((c) => c.text)
            .join("\n");
        }

        if (text.trim()) {
          messages.push({
            role: msg.type === "human" ? "user" : "assistant",
            content: text.trim(),
            timestamp: msg.timestamp || null,
          });
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  return messages;
}

/**
 * Extract a simple title from the first user message.
 */
function extractTitle(messages) {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return "Untitled conversation";
  const text = firstUser.content.slice(0, 120).replace(/\n/g, " ");
  return text.length < firstUser.content.length ? text + "..." : text;
}

/**
 * Derive a domain from the file path (project directory name).
 */
function extractDomain(filePath) {
  // Path format: ~/.claude/projects/-Users-name-project/conversation-id.jsonl
  const parts = filePath.split("/");
  const projectDir = parts.find((p) => p.startsWith("-"));
  if (projectDir) {
    // Convert -Users-name-project-subdir to project/subdir
    const segments = projectDir.split("-").filter(Boolean);
    // Skip common prefixes like Users, home, username
    const meaningful = segments.slice(2); // skip "Users" and username
    return meaningful.join("/") || null;
  }
  return null;
}

/**
 * Send a conversation to the Neuralis OS API.
 */
async function syncConversation(conversation) {
  const response = await fetch(`${WORKER_URL}/api/cortex/conversations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(conversation),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API error ${response.status}: ${text}`);
  }

  return response.json();
}

/**
 * Find all JSONL conversation files.
 */
function findJSONLFiles(dir) {
  const files = [];
  if (!existsSync(dir)) return files;

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...findJSONLFiles(fullPath));
    } else if (entry.endsWith(".jsonl")) {
      files.push({ path: fullPath, mtime: stat.mtime });
    }
  }
  return files;
}

// Main
async function main() {
  console.log(`Neuralis OS Sync`);
  console.log(`Source: ${PROJECTS_DIR}`);
  console.log(`Target: ${WORKER_URL}`);
  if (DRY_RUN) console.log("(DRY RUN — no data will be sent)");
  console.log("");

  const state = loadState();
  const files = findJSONLFiles(PROJECTS_DIR);

  if (!files.length) {
    console.log("No JSONL files found.");
    return;
  }

  console.log(`Found ${files.length} conversation files`);

  let synced = 0;
  let skipped = 0;
  let errors = 0;

  for (const file of files) {
    const convId = file.path.split("/").pop().replace(".jsonl", "");

    // Skip if already synced and file hasn't changed
    if (state[convId] && new Date(state[convId]) >= file.mtime) {
      skipped++;
      continue;
    }

    // Skip if before --since date
    if (SINCE && file.mtime < new Date(SINCE)) {
      skipped++;
      continue;
    }

    try {
      const messages = parseJSONL(file.path);
      if (messages.length < 2) {
        skipped++;
        continue;
      }

      const title = extractTitle(messages);
      const domain = extractDomain(file.path);
      const startedAt =
        messages[0].timestamp || file.mtime.toISOString();
      const endedAt =
        messages[messages.length - 1].timestamp || file.mtime.toISOString();

      const conversation = {
        conversation_id: convId,
        source: "claude-code",
        title,
        summary: `${messages.length} message conversation: ${title}`,
        domain,
        message_count: messages.length,
        started_at: startedAt,
        ended_at: endedAt,
        // Only send messages for shorter conversations to stay within limits
        messages: messages.length <= 50 ? messages.map(({ role, content }) => ({ role, content })) : undefined,
      };

      if (DRY_RUN) {
        console.log(`  [DRY] ${title.slice(0, 80)} (${messages.length} msgs)`);
      } else {
        await syncConversation(conversation);
        state[convId] = new Date().toISOString();
        if (VERBOSE) {
          console.log(`  [OK] ${title.slice(0, 80)} (${messages.length} msgs)`);
        }
      }

      synced++;
    } catch (e) {
      console.error(`  [ERR] ${convId}: ${e.message}`);
      errors++;
    }
  }

  if (!DRY_RUN) {
    saveState(state);
  }

  console.log("");
  console.log(`Done: ${synced} synced, ${skipped} skipped, ${errors} errors`);
}

main().catch(console.error);
