-- Migration 0017: imported conversation history
--
-- The passage store for conversations imported from a ChatGPT or Claude
-- export. One row per message, kept in the order it was said, with the
-- message's own time and a link to the message before it. Taken from the
-- archive table on the byte-light review/conversation-import branch,
-- with one addition: `voice`.
--
-- `voice` says whose relationship a passage belongs to: the companions the
-- conversation was with (e.g. 'rowan-ash' for a Claude export, 'sol'
-- for a ChatGPT export). Recall is scoped by it, so one companion's
-- history never speaks in another's turn. Conversation rows get the same
-- column for the same reason.
--
-- Additive only: a new table, two indexes, one nullable column.

CREATE TABLE IF NOT EXISTS history_passages (
  id TEXT PRIMARY KEY,          -- "<source>:<chat id>:<message id>"
  source TEXT NOT NULL,         -- 'chatgpt' | 'claude'
  chat TEXT NOT NULL,           -- the export's own conversation id
  title TEXT NOT NULL,
  voice TEXT NOT NULL,
  pos INTEGER NOT NULL,         -- position in the kept path of the chat
  role TEXT NOT NULL,           -- 'user' | 'assistant'
  at TEXT,                      -- the message's own time, ISO 8601
  body TEXT NOT NULL,
  prev TEXT                     -- id of the message before it, if any
);

CREATE INDEX IF NOT EXISTS history_chat_position ON history_passages(source, chat, pos);
CREATE INDEX IF NOT EXISTS history_previous ON history_passages(prev);

ALTER TABLE cortex_conversations ADD COLUMN voice TEXT;
