#!/usr/bin/env python3
"""
Import a Claude conversations export into the brain's history store.

Reads conversations.json straight out of the export zip, one conversation at
a time, so a file of hundreds of megabytes never sits in memory whole. For
each chat it keeps only the path the person actually kept: when a turn was
edited or regenerated, the export holds every version, and the abandoned ones
are dropped by following the final message back through its parent links.

Then, per chat (real run only):
  POST /api/history/conversation  — title + the export's own summary
  POST /api/history/batch         — the kept messages, a few at a time
Both are idempotent on the brain's side, so a run can be repeated or resumed.

Usage (from worker/):
  python3 scripts/import_history.py --zip ~/conversations-000.zip --month 2026-10            # dry run
  MIND_API_KEY=... python3 scripts/import_history.py --zip ... --month 2026-10 \\
      --url https://your-worker.your-subdomain.workers.dev --voice rowan-ash --send

Options:
  --zip PATH      the Claude export zip (conversations-000.zip)
  --month YYYY-MM only chats started in that month (repeatable); omit for all
  --voice SLUG    whose relationship these chats are (required with --send)
  --url URL       the brain (required with --send)
  --send          actually write; without it nothing leaves this machine
  --show N        dry run: list up to N chats (default 50)

The key is read from MIND_API_KEY, never from the command line.
Text only: thinking, tool calls, tool results, images and files are skipped.
"""

import argparse
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import zipfile

ID = re.compile(r"^[\w-]{1,128}$")
# Cloudflare refuses the default Python-urllib agent with a 403.
USER_AGENT = "bytelight-history-import/1"
MAX_BATCH_LINES = 8          # matches the brain (history/archive.ts)
MAX_BATCH_BYTES = 90_000     # under the brain's 100 KB body ceiling
MAX_MESSAGE_CHARS = 60_000   # the brain refuses longer; never cut, report
FALLBACK_SUMMARY_CHARS = 1_500


def stream_conversations(zpath):
    """Yield one conversation object at a time from conversations.json in the zip."""
    dec = json.JSONDecoder()
    f = io.TextIOWrapper(zipfile.ZipFile(zpath).open("conversations.json"), encoding="utf-8")
    buf = ""

    def fill():
        nonlocal buf
        chunk = f.read(1 << 20)
        buf += chunk
        return bool(chunk)

    while "[" not in buf and fill():
        pass
    buf = buf[buf.index("[") + 1:]
    while True:
        buf = buf.lstrip().lstrip(",").lstrip()
        while not buf and fill():
            buf = buf.lstrip()
        if not buf or buf.startswith("]"):
            return
        while True:
            try:
                obj, end = dec.raw_decode(buf)
                break
            except json.JSONDecodeError:
                if not fill():
                    raise
        buf = buf[end:]
        yield obj


def message_text(m):
    """The words a person could see: text blocks only."""
    content = m.get("content")
    if isinstance(content, list) and content:
        return "\n".join(b.get("text") or "" for b in content if isinstance(b, dict) and b.get("type") == "text").strip()
    return (m.get("text") or "").strip()


def kept_path(messages):
    """
    The messages on the path that was kept, in order, and how many were dropped.

    The kept path ends at the newest message. Walk back from it through
    parent_message_uuid to the start; anything not on that walk was an
    abandoned edit or regeneration. If the parent links are missing or broken,
    fall back to export order rather than guessing.
    """
    by_id = {m.get("uuid"): m for m in messages if m.get("uuid")}
    if not by_id or not all("parent_message_uuid" in m for m in messages):
        return messages, 0
    leaf = max(messages, key=lambda m: (m.get("created_at") or "", messages.index(m)))
    path, seen, cur = [], set(), leaf
    while cur is not None and cur.get("uuid") not in seen:
        seen.add(cur.get("uuid"))
        path.append(cur)
        cur = by_id.get(cur.get("parent_message_uuid"))
    path.reverse()
    return path, len(messages) - len(path)


def prepare(conv):
    """One chat, ready to send, or None if it has nothing to import."""
    chat = conv.get("uuid")
    if not isinstance(chat, str) or not ID.match(chat):
        return None
    path, dropped = kept_path(conv.get("chat_messages") or [])
    lines, too_long = [], []
    for m in path:
        role = {"human": "user", "assistant": "assistant"}.get(m.get("sender"))
        text = message_text(m)
        mid = m.get("uuid")
        if not role or not text or not isinstance(mid, str) or not ID.match(mid):
            continue
        if len(text) > MAX_MESSAGE_CHARS:
            too_long.append(mid)
            continue
        lines.append({
            "id": mid,
            "prev": lines[-1]["id"] if lines else None,
            "role": role,
            "at": m.get("created_at") or None,
            "text": text,
            "pos": len(lines),
        })
    if not lines:
        return None
    title = (conv.get("name") or "").strip()[:300] or "Untitled conversation"
    summary = (conv.get("summary") or "").strip()
    summary_from_export = bool(summary)
    if not summary:
        opening = " ".join(l["text"] for l in lines[:4] if l["role"] == "user")
        summary = f"{title}. Opens with: {opening}"[:FALLBACK_SUMMARY_CHARS]
    return {
        "chat": chat, "title": title, "summary": summary[:20_000],
        "summary_from_export": summary_from_export,
        "started_at": conv.get("created_at") or None, "ended_at": conv.get("updated_at") or None,
        "lines": lines, "dropped": dropped, "too_long": too_long,
    }


def batches(lines):
    batch, size = [], 0
    for line in lines:
        n = len(json.dumps(line).encode("utf-8"))
        if batch and (len(batch) == MAX_BATCH_LINES or size + n > MAX_BATCH_BYTES):
            yield batch
            batch, size = [], 0
        batch.append(line)
        size += n
    if batch:
        yield batch


def post(url, key, path, body, tries=4):
    data = json.dumps(body).encode("utf-8")
    for attempt in range(tries):
        req = urllib.request.Request(f"{url}/api/history/{path}", data=data, method="POST",
                                     headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json", "User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                return json.loads(res.read() or b"{}")
        except urllib.error.HTTPError as e:
            if e.code < 500 or attempt == tries - 1:
                raise SystemExit(f"brain refused {path} ({e.code}): {e.read()[:300]!r}")
        except urllib.error.URLError as e:
            if attempt == tries - 1:
                raise SystemExit(f"brain unreachable on {path}: {e}")
        time.sleep(2 ** attempt)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--zip", required=True)
    ap.add_argument("--month", action="append", default=[])
    ap.add_argument("--voice")
    ap.add_argument("--url")
    ap.add_argument("--send", action="store_true")
    ap.add_argument("--show", type=int, default=50)
    a = ap.parse_args()

    key = os.environ.get("MIND_API_KEY", "")
    if a.send:
        if not a.voice or not re.match(r"^[a-z0-9-]{1,40}$", a.voice):
            raise SystemExit("--voice is required with --send (e.g. rowan-ash)")
        if not a.url or not key:
            raise SystemExit("--url and MIND_API_KEY are required with --send")
        url = a.url.rstrip("/")
        ready = urllib.request.Request(f"{url}/api/history/ready", headers={"Authorization": f"Bearer {key}", "User-Agent": USER_AGENT})
        with urllib.request.urlopen(ready, timeout=30) as res:
            if not json.loads(res.read()).get("voices"):
                raise SystemExit("the brain's history store is not installed (or is the older version)")

    chats = passages = batches_sent = dropped = with_drops = fallback = 0
    too_long = []
    shown = 0
    for conv in stream_conversations(a.zip):
        if a.month and (conv.get("created_at") or "")[:7] not in a.month:
            continue
        c = prepare(conv)
        if c is None:
            continue
        chats += 1
        passages += len(c["lines"])
        dropped += c["dropped"]
        with_drops += 1 if c["dropped"] else 0
        fallback += 0 if c["summary_from_export"] else 1
        too_long += [(c["title"], mid) for mid in c["too_long"]]
        if not a.send:
            if shown < a.show:
                note = f", {c['dropped']} abandoned drafts dropped" if c["dropped"] else ""
                own = "" if c["summary_from_export"] else ", no summary in export (opening lines used)"
                print(f"  {(c['started_at'] or '')[:10]}  {c['title'][:60]:60}  {len(c['lines']):4} messages{note}{own}")
                shown += 1
            continue
        post(url, key, "conversation", {
            "source": "claude", "chat": c["chat"], "title": c["title"], "voice": a.voice,
            "summary": c["summary"], "started_at": c["started_at"], "ended_at": c["ended_at"],
            "message_count": len(c["lines"]),
        })
        for b in batches(c["lines"]):
            post(url, key, "batch", {"source": "claude", "chat": c["chat"], "title": c["title"], "voice": a.voice, "lines": b})
            batches_sent += 1
        print(f"  sent {c['title'][:60]} ({len(c['lines'])} messages)", flush=True)

    mode = "SENT" if a.send else "DRY RUN (nothing sent)"
    print(f"\n{mode}: {chats} chats, {passages} messages kept, {dropped} abandoned drafts dropped "
          f"in {with_drops} chats, {fallback} chats without an export summary")
    if a.send:
        print(f"batches sent: {batches_sent}")
    if too_long:
        print(f"NOT IMPORTED, over {MAX_MESSAGE_CHARS} characters: {len(too_long)} messages")
        for title, mid in too_long[:20]:
            print(f"  {title[:60]}  ({mid})")


if __name__ == "__main__":
    main()
