-- Cortex layer: executive function, decisions, principles, conversation history
-- Part of Neuralis OS v1.0.0

-- cortex_thoughts: decisions, principles, observations, insights
CREATE TABLE cortex_thoughts (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  domain TEXT,
  content TEXT NOT NULL,
  context TEXT,
  importance TEXT DEFAULT 'routine',
  thinking_stage TEXT,
  open_questions TEXT,
  related_thoughts TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  accessed_at TEXT
);

-- cortex_conversations: conversation metadata + summaries
CREATE TABLE cortex_conversations (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  title TEXT,
  summary TEXT,
  domain TEXT,
  importance TEXT DEFAULT 'routine',
  thinking_stage TEXT,
  emotional_tone TEXT,
  decisions TEXT,
  open_questions TEXT,
  key_insights TEXT,
  concepts TEXT,
  message_count INTEGER,
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- cortex_messages: individual messages for full conversation retrieval
CREATE TABLE cortex_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES cortex_conversations(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  msg_index INTEGER,
  has_code INTEGER DEFAULT 0,
  has_question INTEGER DEFAULT 0,
  word_count INTEGER,
  created_at TEXT
);

CREATE INDEX idx_cortex_thoughts_domain ON cortex_thoughts(domain);
CREATE INDEX idx_cortex_thoughts_type ON cortex_thoughts(type);
CREATE INDEX idx_cortex_thoughts_importance ON cortex_thoughts(importance);
CREATE INDEX idx_cortex_conversations_domain ON cortex_conversations(domain);
CREATE INDEX idx_cortex_conversations_source ON cortex_conversations(source);
CREATE INDEX idx_cortex_conversations_importance ON cortex_conversations(importance);
CREATE INDEX idx_cortex_messages_conv ON cortex_messages(conversation_id);
CREATE INDEX idx_cortex_messages_role ON cortex_messages(conversation_id, role);
