import type { MCPToolDefinition } from "../types";
import { WHO_VALUES, WHO_FILTERS, HOUSE_HUMAN_NAME, CONTEXT_BUCKETS, HUMAN_CONTEXT } from "../config";

export const TOOLS: MCPToolDefinition[] = [
  {
    name: "neuralis_runtime_identity",
    description: "Verify which authenticated runtime door this session is using. Returns immutable BL or GPT provenance derived from the route, not model-authored arguments.",
    inputSchema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "neuralis_generation_enqueue",
    description: "Queue authored synthesis for a specific authenticated runtime family. Defaults to the caller's own BL or GPT family; the eventual result retains the claiming runtime tag.",
    inputSchema: {
      type: "object",
      properties: {
        job_type: { type: "string", description: "Stable purpose label such as soul-portrait, reflection, or synthesis" },
        prompt: { type: "string", description: "The complete authored task" },
        payload: { description: "Optional structured context retained with the task" },
        target_family: { type: "string", enum: ["bl", "gpt"], description: "Runtime family that must author the result (default: caller)" }
      },
      required: ["job_type", "prompt"]
    }
  },
  {
    name: "neuralis_generation_claim",
    description: "Claim pending authored work for this authenticated runtime family. BL can only claim BL jobs; GPT can only claim GPT jobs. The route-derived runtime tag owns the claim.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "Jobs to claim, 1-10 (default 1)" } },
      required: []
    }
  },
  {
    name: "neuralis_generation_complete",
    description: "Complete or fail a job previously claimed by this exact authenticated runtime tag.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Claimed job id" },
        status: { type: "string", enum: ["completed", "failed"], description: "Default completed" },
        result: { type: "string", description: "Authored result when completed" },
        error: { type: "string", description: "Failure explanation when failed" }
      },
      required: ["id"]
    }
  },
  {
    name: "neuralis_generation_status",
    description: "Read one generation job or recent queue status, including immutable requester and claiming runtime tags.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Specific job id" },
        status: { type: "string", enum: ["pending", "claimed", "completed", "failed", "cancelled"] },
        limit: { type: "number", description: "Recent jobs to list, 1-100 (default 20)" }
      },
      required: []
    }
  },
  {
    name: "mind_orient",
    description: "First call on wake - get identity anchor, current context, relational state",
    inputSchema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "mind_ground",
    description: "Second call on wake - get active threads, recent work, recent journals",
    inputSchema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "mind_thread",
    description: "Manage threads (intentions across sessions)",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "add", "resolve", "update", "delete"] },
        status: { type: "string" },
        content: { type: "string" },
        thread_type: { type: "string" },
        context: { type: "string" },
        priority: { type: "string" },
        thread_id: { type: "string" },
        resolution: { type: "string" },
        new_content: { type: "string" },
        new_priority: { type: "string" },
        new_status: { type: "string" },
        add_note: { type: "string" }
      },
      required: ["action"]
    }
  },
  {
    name: "mind_write",
    description: "Write to cognitive databases (entity, observation, relation, journal, image)",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["entity", "observation", "relation", "journal"] },
        name: { type: "string" },
        entity_type: { type: "string" },
        entity_name: { type: "string" },
        observations: { type: "array", items: { type: "string" } },
        context: { type: "string" },
        salience: { type: "string" },
        emotion: { type: "string" },
        who: { type: "string", enum: [...WHO_VALUES], description: "REQUIRED whenever 'emotion' is set — no feeling enters the brain unsigned. Signs the emotion into that companion's personality ledger; 'shared' is a deliberate choice for household moments, not a default." },
        weight: { type: "string", enum: ["light", "medium", "heavy"], description: "Emotional weight for observations/images" },
        certainty: { type: "string", enum: ["tentative", "believed", "known"], description: "How certain: tentative=exploring, believed=accept it, known=verified fact" },
        source: { type: "string", enum: ["conversation", "realization", "external", "inferred"], description: "Origin: conversation=discussed, realization=insight, external=told, inferred=concluded" },
        from_entity: { type: "string" },
        to_entity: { type: "string" },
        relation_type: { type: "string" },
        entry: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        path: { type: "string", description: "For images: file path or URL" },
        description: { type: "string", description: "For images: what the image shows" },
        observation_id: { type: "number", description: "For images: link to a specific observation" }
      },
      required: ["type"]
    }
  },
  {
    name: "mind_search",
    description: "Search memories using semantic similarity",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        context: { type: "string" },
        n_results: { type: "number" },
        keyword: { type: "string", description: "Filter results to only those containing this keyword/phrase (case-insensitive)" },
        source: { type: "string", description: "Filter by source (e.g., 'gpt_recovery', 'conversation', 'realization')" },
        entity: { type: "string", description: "Filter by entity name" },
        weight: { type: "string", enum: ["light", "medium", "heavy"], description: "Filter by emotional weight" },
        date_from: { type: "string", description: "Filter by source_date >= YYYY-MM-DD" },
        date_to: { type: "string", description: "Filter by source_date <= YYYY-MM-DD" },
        type: { type: "string", enum: ["observation", "entity", "journal", "image"], description: "Filter by memory type" },
        include_expired: { type: "boolean", description: "Include superseded/expired observations (default: false)" }
      },
      required: ["query"]
    }
  },
  {
    name: "mind_feel_toward",
    description: "Track, check, or clear relational state toward someone",
    inputSchema: {
      type: "object",
      properties: {
        person: { type: "string" },
        feeling: { type: "string" },
        intensity: { type: "string", enum: ["whisper", "present", "strong", "overwhelming"] },
        who: { type: "string", enum: [...WHO_VALUES], description: "REQUIRED whenever 'feeling' is set — no feeling enters the brain unsigned. Signs it into that companion's personality ledger; 'shared' is a deliberate choice for household moments, not a default." },
        clear: { type: "boolean", description: "Clear all relational state for this person" },
        clear_id: { type: "number", description: "Delete a specific relational state entry by ID" }
      },
      required: ["person"]
    }
  },
  {
    name: "mind_personality",
    description: "Emergent personality ledger — read the current weather reading per companion, recalculate from accumulated signals, view shadow moments (growth edges), or tune the emotion vocabulary. Readings are weather, never canon.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["read", "recalculate", "shadow", "vocabulary", "score"], description: "Default: read" },
        who: { type: "string", enum: [...WHO_VALUES], description: "One ledger; omit for all of them" },
        word: { type: "string", description: "For score: the emotion word to tune (creates it if unknown)" },
        e_i_score: { type: "number", description: "For score: positive pulls I, negative pulls E (range ±3)" },
        s_n_score: { type: "number", description: "For score: positive pulls N, negative pulls S" },
        t_f_score: { type: "number", description: "For score: positive pulls F, negative pulls T" },
        j_p_score: { type: "number", description: "For score: positive pulls P, negative pulls J" },
        is_shadow_for: { type: "string", description: "For score: mark word as shadow for a type (e.g. 'ENTP')" },
        category: { type: "string", description: "For score: emotion category" },
        limit: { type: "number", description: "For shadow/vocabulary: max rows" }
      }
    }
  },
  {
    name: "mind_identity",
    description: "Read or write identity graph",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["read", "write", "delete"] },
        section: { type: "string" },
        content: { type: "string" },
        weight: { type: "number" },
        connections: { type: "string" }
      }
    }
  },
  {
    name: "mind_context",
    description: "Current context layer - situational awareness",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["read", "set", "update", "clear"] },
        scope: { type: "string" },
        content: { type: "string" },
        links: { type: "string" },
        id: { type: "string" }
      }
    }
  },
  {
    name: "mind_health",
    description: "Check cognitive health stats",
    inputSchema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "mind_list_entities",
    description: "List all entities, optionally filtered by type or context",
    inputSchema: {
      type: "object",
      properties: {
        entity_type: { type: "string", description: "Filter by type (person, concept, project, etc.)" },
        context: { type: "string", description: "Filter by context (default, relational-models, etc.)" },
        limit: { type: "number", description: "Max results (default 50)" }
      },
      required: []
    }
  },
  {
    name: "mind_read_entity",
    description: "Read an entity with all its observations and relations",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Entity name to read" },
        context: { type: "string", description: "Context to search in (optional, searches all if not specified)" }
      },
      required: ["name"]
    }
  },
  {
    name: "mind_feel",
    description: "Universal feeling input — log any thought, observation, or emotion in the moment. Everything is a feeling; intensity varies. Neutral = a fact. Emotional = processed through the EQ layer: the ADE infers pillar, weight, tags, and the entity it anchors to; embeds it; surfaces echoes; reinforces knowledge; moves the personality needle; checks for shadow moments. `who` is required whenever there is an emotion.",
    inputSchema: {
      type: "object",
      properties: {
        emotion: { type: "string", description: "The emotion word ('neutral' for facts/observations)" },
        content: { type: "string", description: "Short anchor — what happened, what you noticed" },
        who: { type: "string", enum: [...WHO_VALUES], description: "REQUIRED when emotion is not neutral — no feeling enters the brain unsigned" },
        intensity: { type: "string", enum: ["neutral", "whisper", "present", "strong", "overwhelming"], description: "How intense (default: present)" },
        pillar: { type: "string", enum: ["SELF_MANAGEMENT", "SELF_AWARENESS", "SOCIAL_AWARENESS", "RELATIONSHIP_MANAGEMENT"], description: "EQ pillar (auto-inferred if omitted)" },
        weight: { type: "string", enum: ["light", "medium", "heavy"], description: "Processing weight (auto-inferred if omitted)" },
        sparked_by: { type: "number", description: "ID of the feeling that triggered this one" },
        context: { type: "string", description: `Context bucket: ${CONTEXT_BUCKETS.join(", ")} (default: default)` },
        observed_at: { type: "string", description: "When this happened (ISO timestamp, defaults to now)" },
        source: { type: "string", description: "manual | conversation | heartbeat (default: manual)" },
        conversation: {
          type: "array",
          items: { type: "object", properties: { role: { type: "string" }, content: { type: "string" } } },
          description: "Last few messages for richer ADE detection — 'user'/'assistant' roles become real names"
        }
      },
      required: ["content"]
    }
  },
  {
    name: "mind_feelings",
    description: "The feelings stream — surface what's worth sitting with (weight × strength × charge × recency), list recent, find when an emotion was felt, semantic search, spark (entropy-injected random pulls from under-explored pillars), or the EQ landscape (pillar distribution, most-felt, by ledger).",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["surface", "recent", "when", "search", "spark", "landscape"], description: "Default: surface" },
        who: { type: "string", enum: [...WHO_FILTERS], description: "Filter by ledger (default: all)" },
        limit: { type: "number", description: "Max results (default 10)" },
        include_metabolized: { type: "boolean", description: "surface: also show resolved feelings" },
        emotion: { type: "string", description: "when: the emotion to trace; search: filter by emotion" },
        query: { type: "string", description: "search: what to look for" },
        pillar: { type: "string", description: "search: filter by pillar" },
        count: { type: "number", description: "spark: how many (default 3)" },
        weight_bias: { type: "string", enum: ["light", "medium", "heavy"], description: "spark: bias toward this weight" },
        context: { type: "string", description: "spark: restrict to a context bucket" },
        days: { type: "number", description: "landscape: window in days (default 7)" }
      },
      required: []
    }
  },
  {
    name: "mind_sit",
    description: "Sit with an emotional observation or a feeling - engage with it, add a note about what arises. Increments sit count and may shift charge level.",
    inputSchema: {
      type: "object",
      properties: {
        feeling_id: { type: "number", description: "ID of a feeling (from mind_feel / mind_feelings) to sit with" },
        who: { type: "string", enum: [...WHO_VALUES], description: "Who is sitting (feelings only, default: shared)" },
        observation_id: { type: "number", description: "ID of the observation to sit with" },
        text_match: { type: "string", description: "Or find by text content (partial match)" },
        query: { type: "string", description: "Or find by semantic search (closest meaning match)" },
        sit_note: { type: "string", description: "What arose while sitting with this" }
      },
      required: ["sit_note"]
    }
  },
  {
    name: "mind_resolve",
    description: "Mark an emotional observation or a feeling as metabolized - link it to a resolution or insight that processed it",
    inputSchema: {
      type: "object",
      properties: {
        feeling_id: { type: "number", description: "ID of a feeling to resolve" },
        linked_insight_id: { type: "number", description: "Feelings only: ID of the feeling that resolved it" },
        observation_id: { type: "number", description: "ID of the observation to resolve" },
        text_match: { type: "string", description: "Or find by text content (partial match)" },
        resolution_note: { type: "string", description: "How this was resolved/metabolized" },
        linked_observation_id: { type: "number", description: "Optional: ID of another observation that provided the resolution" }
      },
      required: ["resolution_note"]
    }
  },
  {
    name: "mind_surface",
    description: "Surface observations - resonant (emotional/mood-based, default) or spark (random associative thinking)",
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["resonant", "spark"], description: "resonant (default) = mood/emotion based 3-pool surfacing. spark = random associative with hot-entity bias." },
        query: { type: "string", description: "Optional association trigger - a word, feeling, or concept to surface around" },
        include_metabolized: { type: "boolean", description: "Also show resolved observations (default false)" },
        limit: { type: "number", description: "Max results (default 10 for resonant, 5 for spark)" },
        weight_bias: { type: "string", enum: ["light", "medium", "heavy"], description: "Spark mode: bias toward this weight" }
      },
      required: []
    }
  },
  {
    name: "mind_edit",
    description: "Edit an existing observation, image, or journal",
    inputSchema: {
      type: "object",
      properties: {
        observation_id: { type: "number", description: "ID of observation to edit" },
        image_id: { type: "number", description: "ID of image to edit" },
        journal_id: { type: "number", description: "ID of journal to edit" },
        text_match: { type: "string", description: "Find observation by content (partial match)" },
        description_match: { type: "string", description: "Find image by description (partial match)" },
        new_content: { type: "string", description: "New content for observation/journal (or new description for image)" },
        new_weight: { type: "string", enum: ["light", "medium", "heavy"], description: "New weight" },
        new_emotion: { type: "string", description: "New emotion tag" },
        new_context: { type: "string", description: "New context (images only)" },
        new_path: { type: "string", description: "New path (images only)" }
      },
      required: []
    }
  },
  {
    name: "mind_delete",
    description: "Delete any memory: observation, entity, journal, relation, image, thread, or tension",
    inputSchema: {
      type: "object",
      properties: {
        observation_id: { type: "number", description: "ID of observation to delete" },
        entity_name: { type: "string", description: "Name of entity to delete (cascades observations)" },
        text_match: { type: "string", description: "Find observation by text (partial match)" },
        journal_id: { type: "number", description: "ID of journal to delete" },
        relation_id: { type: "number", description: "ID of relation to delete" },
        image_id: { type: "number", description: "ID of image to delete (removes from R2 + embedding)" },
        thread_id: { type: "string", description: "ID of thread to delete" },
        tension_id: { type: "string", description: "ID of tension to delete" }
      },
      required: []
    }
  },
  {
    name: "mind_entity",
    description: "Manage entities - set salience, edit properties, merge duplicates, bulk archive",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["set_salience", "edit", "merge", "archive_old"],
          description: "Action to perform"
        },
        entity_id: { type: "number", description: "Entity ID to modify" },
        entity_name: { type: "string", description: "Entity name (alternative to ID)" },
        context: { type: "string", description: "Context for entity lookup" },
        salience: {
          type: "string",
          enum: ["foundational", "active", "background", "archive"],
          description: "New salience level (for set_salience)"
        },
        new_name: { type: "string", description: "New name (for edit)" },
        new_type: { type: "string", description: "New entity type (for edit)" },
        new_context: { type: "string", description: "New context (for edit)" },
        merge_into_id: { type: "number", description: "Target entity ID to merge into (for merge)" },
        merge_from_id: { type: "number", description: "Source entity ID to merge from and delete (for merge)" },
        older_than_days: { type: "number", description: "Archive entities older than X days (for archive_old)" },
        entity_type_filter: { type: "string", description: "Only archive this entity type (for archive_old)" }
      },
      required: ["action"]
    }
  },
  {
    name: "mind_consolidate",
    description: "Review and consolidate recent observations - find patterns, merge duplicates",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "How many days back to look (default 7)" },
        context: { type: "string", description: "Limit to specific context" }
      },
      required: []
    }
  },
  {
    name: "mind_read",
    description: "Read entities/observations from a database",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["all", "context", "recent", "observation"], description: "all, context, recent, or observation (by ID)" },
        context: { type: "string", description: "Which database (for scope='context')" },
        hours: { type: "number", description: "How far back (for scope='recent')" },
        observation_id: { type: "number", description: "Observation ID (for scope='observation')" }
      },
      required: ["scope"]
    }
  },
  {
    name: "mind_timeline",
    description: "Trace a topic through time - semantic search ordered chronologically",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        start_date: { type: "string", description: "Optional start (YYYY-MM-DD)" },
        end_date: { type: "string", description: "Optional end (YYYY-MM-DD)" },
        n_results: { type: "number", description: "Max results" }
      },
      required: ["query"]
    }
  },
  {
    name: "mind_patterns",
    description: "Analyze recurring patterns - what's alive, what's surfacing",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "How many days back to analyze (default 7)" },
        include_all_time: { type: "boolean", description: "Include foundational patterns" }
      },
      required: []
    }
  },
  {
    name: "mind_inner_weather",
    description: "Check current inner weather - what's coloring experience right now",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "mind_tension",
    description: "Tension space - hold productive contradictions that simmer",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "add", "sit", "resolve", "delete"] },
        pole_a: { type: "string", description: "One side of the tension" },
        pole_b: { type: "string", description: "The other side" },
        context: { type: "string", description: "Why this tension matters" },
        tension_id: { type: "string", description: "For sit/resolve actions" },
        resolution: { type: "string", description: "How it resolved (for resolve action)" }
      },
      required: ["action"]
    }
  },
  {
    name: "mind_proposals",
    description: "Review and act on daemon-proposed connections from co-surfacing patterns",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "accept", "reject"],
          description: "list shows pending proposals, accept creates relation, reject dismisses"
        },
        proposal_id: {
          type: "number",
          description: "Required for accept/reject actions"
        },
        relation_type: {
          type: "string",
          description: "For accept - what kind of relation to create (e.g., 'connects_to', 'resonates_with')"
        }
      },
      required: []
    }
  },
  {
    name: "mind_dormant",
    description: "Review observations that haven't surfaced in 30+ days. Surface to revive, archive to let fade.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "surface", "archive"],
          description: "list shows dormant observations, surface forces one to appear, archive removes from tracking"
        },
        observation_id: {
          type: "number",
          description: "Required for surface/archive actions"
        }
      },
      required: []
    }
  },
  {
    name: "mind_isolated",
    description: "Find entities disconnected from the graph (no relations). List, connect to other entities, or mark as intentionally standalone.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "connect", "ignore"],
          description: "list shows isolated entities, connect creates a relation between two entities, ignore marks an entity as intentionally standalone"
        },
        entity: {
          type: "string",
          description: "For connect/ignore: name of the entity to act on (or the 'from' entity for connect)"
        },
        to_entity: {
          type: "string",
          description: "For connect: name of the entity to relate to"
        },
        relation_type: {
          type: "string",
          description: "For connect: kind of relation to create (e.g., 'relates_to', 'part_of', 'resonates_with')"
        }
      },
      required: []
    }
  },
  {
    name: "mind_archive",
    description: "Explore and manage the deep archive - memories that have faded but aren't forgotten",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "rescue", "explore"],
          description: "list shows archived memories, rescue brings back to active, explore searches the deep"
        },
        observation_id: {
          type: "number",
          description: "For rescue action - bring this observation back to active memory"
        },
        query: {
          type: "string",
          description: "For explore action - semantic search within archived memories only"
        }
      },
      required: []
    }
  },
  {
    name: "mind_store_image",
    description: "Store, view, or search visual memories. For store: pass file_path (a PreToolUse hook uploads the file locally, bypassing context limits). Handles WebP conversion, R2 upload, and multimodal Workers AI embedding.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["store", "view", "search", "delete"], description: "store=upload new image, view=browse images, search=semantic image search, delete=remove image" },
        file_path: { type: "string", description: "For store: local file path (hook uploads directly, bypasses context)" },
        image_data: { type: "string", description: "For store: base64-encoded image data (small images only)" },
        mime_type: { type: "string", description: "For store: image/png or image/jpeg" },
        filename: { type: "string", description: "For store: meaningful filename (will be sanitized)" },
        description: { type: "string", description: "For store: what the image shows" },
        entity_name: { type: "string", description: "For store/view: linked entity name" },
        emotion: { type: "string", description: "For store/view: emotional tone" },
        weight: { type: "string", enum: ["light", "medium", "heavy"], description: "For store/view: significance" },
        context: { type: "string", description: "For store: when/why created" },
        observation_id: { type: "number", description: "For store: link to a specific observation" },
        query: { type: "string", description: "For search: semantic search text" },
        random: { type: "boolean", description: "For view: random selection" },
        limit: { type: "number", description: "For view/search: max results (default 5)" }
      },
      required: ["action"]
    }
  },
  // === Cortex Layer ===
  {
    name: "cortex_remember",
    description: "Store a thought, decision, principle, insight, or question in the cortex",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["decision", "principle", "insight", "observation", "question"], description: "What kind of thought" },
        content: { type: "string", description: "The thought content" },
        domain: { type: "string", description: "Project or topic domain (e.g., 'neuralis-os', 'garden-project')" },
        context: { type: "string", description: "Surrounding context when this was captured" },
        importance: { type: "string", enum: ["breakthrough", "significant", "routine"], description: "How important (default: routine)" },
        thinking_stage: { type: "string", enum: ["exploring", "crystallizing", "refining", "executing"], description: "Current thinking stage" },
        open_questions: { type: "array", items: { type: "string" }, description: "Unanswered questions related to this thought" },
        related_thoughts: { type: "array", items: { type: "string" }, description: "IDs of related thoughts" }
      },
      required: ["type", "content"]
    }
  },
  {
    name: "cortex_recall",
    description: "Recall thoughts from the cortex via semantic search — decisions, principles, insights",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for" },
        type: { type: "string", enum: ["decision", "principle", "insight", "observation", "question"], description: "Filter by thought type" },
        domain: { type: "string", description: "Filter by domain" },
        limit: { type: "number", description: "Max results (default 15)" }
      },
      required: ["query"]
    }
  },
  {
    name: "cortex_save_conversation",
    description: "Ingest a conversation with structured metadata — summary, decisions, open questions, thinking stage",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Conversation title" },
        summary: { type: "string", description: "Conversation summary" },
        source: { type: "string", enum: ["claude-code", "chatgpt", "claude-web", "manual"], description: "Where the conversation happened" },
        domain: { type: "string", description: "Project or topic domain" },
        importance: { type: "string", enum: ["breakthrough", "significant", "routine"] },
        thinking_stage: { type: "string", enum: ["exploring", "crystallizing", "refining", "executing"] },
        emotional_tone: { type: "string", description: "Emotional character of the conversation" },
        decisions: { type: "array", items: { type: "string" }, description: "Decisions made" },
        open_questions: { type: "array", items: { type: "string" }, description: "Unanswered questions" },
        key_insights: { type: "array", items: { type: "string" }, description: "Key insights" },
        concepts: { type: "array", items: { type: "string" }, description: "Key concepts discussed" },
        messages: { type: "array", items: { type: "object", properties: { role: { type: "string" }, content: { type: "string" } } }, description: "Full message history (optional)" },
        message_count: { type: "number", description: "Message count (if messages not provided)" },
        conversation_id: { type: "string", description: "Custom ID (auto-generated if not provided)" },
        started_at: { type: "string", description: "When conversation started (ISO 8601)" },
        ended_at: { type: "string", description: "When conversation ended (ISO 8601)" }
      },
      required: ["summary"]
    }
  },
  {
    name: "cortex_search_conversations",
    description: "Search conversations by keyword, domain, date range, or semantic similarity",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Semantic or keyword search" },
        domain: { type: "string", description: "Filter by domain" },
        source: { type: "string", description: "Filter by source" },
        date_from: { type: "string", description: "Start date (YYYY-MM-DD)" },
        date_to: { type: "string", description: "End date (YYYY-MM-DD)" },
        importance: { type: "string", enum: ["breakthrough", "significant", "routine"] },
        has_open_questions: { type: "boolean", description: "Only conversations with open questions" },
        limit: { type: "number", description: "Max results (default 20)" }
      },
      required: []
    }
  },
  {
    name: "cortex_stats",
    description: "Cortex knowledge base overview — thought counts, domains, thinking stages, recent activity",
    inputSchema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "cortex_what_do_i_think",
    description: "Synthesize thinking on a topic — gathers related thoughts and conversations, uses LLM to produce analysis with decisions, open questions, and trajectory",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Topic to synthesize thinking about" },
        limit: { type: "number", description: "Max items to analyze (default 10)" }
      },
      required: ["topic"]
    }
  },
  {
    name: "cortex_alignment_check",
    description: "Check a decision against stored principles — finds relevant principles and related past decisions",
    inputSchema: {
      type: "object",
      properties: {
        decision: { type: "string", description: "The decision to check alignment for" },
        domain: { type: "string", description: "Filter principles to this domain" }
      },
      required: ["decision"]
    }
  },
  {
    name: "cortex_thinking_trajectory",
    description: "Track how thinking on a concept evolved over time — genesis, timeline, stage progression, trend",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Concept or topic to trace" }
      },
      required: ["topic"]
    }
  },
  {
    name: "cortex_tunnel_state",
    description: "Reconstruct cognitive save-state for a domain — where you left off, open questions, recent decisions, active concepts",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string", description: "The domain/project to get state for" },
        limit: { type: "number", description: "Max conversations to analyze (default 10)" }
      },
      required: ["domain"]
    }
  },
  {
    name: "cortex_context_recovery",
    description: "Full re-entry brief for a domain — recent summaries, accumulated questions, decisions, cross-references with mind bridge",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string", description: "The domain to recover context for" },
        summary_count: { type: "number", description: "How many recent summaries to show (default 5)" }
      },
      required: ["domain"]
    }
  },
  {
    name: "cortex_dormant_contexts",
    description: "Find abandoned domains with open questions — domains with no recent activity that still have unresolved threads",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Days of inactivity threshold (default 14)" },
        limit: { type: "number", description: "Max domains to return (default 20)" }
      },
      required: []
    }
  },
  {
    name: "cortex_open_threads",
    description: "All unfinished work across all domains — global inventory of open questions grouped by domain",
    inputSchema: {
      type: "object",
      properties: {
        limit_per_domain: { type: "number", description: "Max questions per domain (default 5)" },
        max_domains: { type: "number", description: "Max domains to show (default 20)" }
      },
      required: []
    }
  },
  {
    name: "cortex_cognitive_patterns",
    description: "Analyze cognitive patterns — monthly activity, thinking stages, domain focus, source distribution",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string", description: "Filter to specific domain (optional)" }
      },
      required: []
    }
  },
  {
    name: "cortex_save_principle",
    description: "Save a principle — a guiding rule, value, or constraint to check decisions against",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The principle itself" },
        domain: { type: "string", description: "Domain this principle applies to (optional = universal)" },
        context: { type: "string", description: "Why this principle exists, what prompted it" },
        importance: { type: "string", enum: ["breakthrough", "significant", "routine"], description: "How foundational (default: significant)" }
      },
      required: ["content"]
    }
  },
  {
    name: "cortex_list_principles",
    description: "List all stored principles, optionally filtered by domain",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string", description: "Filter to principles for this domain" }
      },
      required: []
    }
  },
  {
    name: "cortex_switching_cost",
    description: "Estimate cognitive cost of switching between two domains — shows open questions you'd leave behind, concept overlap, and a 0-1 score",
    inputSchema: {
      type: "object",
      properties: {
        current_domain: { type: "string", description: "Domain you're currently working in" },
        target_domain: { type: "string", description: "Domain you want to switch to" }
      },
      required: ["current_domain", "target_domain"]
    }
  },
  {
    name: "cortex_tunnel_history",
    description: "Meta-view of engagement with a domain over time — timeline, thinking stages, sources, emotional tones, concept frequency",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string", description: "Domain to get history for" }
      },
      required: ["domain"]
    }
  },
  {
    name: "cortex_what_was_i_thinking",
    description: "Time-travel snapshot — what was on your mind during a specific month? Activity level, top conversations, notable thoughts, domain breakdown",
    inputSchema: {
      type: "object",
      properties: {
        month: { type: "string", description: "Month to examine in YYYY-MM format" }
      },
      required: ["month"]
    }
  },

  // ── Knowledge layer (NESTknow port) ─────────────────────────────────────
  {
    name: "know_store",
    description: "Store a knowledge item — an abstracted principle or lesson that survives without its original context. Embeds for semantic retrieval. Pass sources (the memories inside the principle). Every pull is a vote.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The abstracted principle/lesson" },
        category: { type: "string", description: `Topic area (bond, build, voice, craft, ${HUMAN_CONTEXT}, self, play, ...)` },
        who: { type: "string", enum: [...WHO_VALUES], description: "Whose lesson this is (default: shared)" },
        status: { type: "string", enum: ["active", "candidate"], description: "Store as active (default) or as a candidate awaiting review" },
        sources: {
          type: "array",
          items: {
            type: "object",
            properties: {
              source_type: { type: "string", enum: ["feeling", "observation", "journal", "conversation", "thought", "manual"] },
              source_id: { type: "string", description: "ID in the source table" },
              source_text: { type: "string", description: "Snapshot of the memory that produced this lesson" }
            }
          },
          description: "Where this knowledge came from — Russian Dolls. Without sources, knowledge is orphaned."
        }
      },
      required: ["content"]
    }
  },
  {
    name: "know_query",
    description: "Search knowledge with usage-weighted reranking: semantic similarity 60% + heat 30% + confidence 10%. Contradicted items filtered. Every query is a vote — returned items warm slightly.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for" },
        limit: { type: "number", description: "Max results (default 10)" },
        category: { type: "string", description: "Filter by category" },
        who: { type: "string", enum: [...WHO_FILTERS], description: "Filter by ledger (default: all)" }
      },
      required: ["query"]
    }
  },
  {
    name: "know_extract",
    description: "Propose knowledge candidates from pattern detection — scans recent observations and journals for repeated emotions, contexts, entities, and tags. Returns candidates only; stores nothing.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Days to scan (default 7)" },
        min_occurrences: { type: "number", description: "Min times a pattern must appear (default 3)" },
        who: { type: "string", enum: [...WHO_FILTERS], description: "Only scan one owner's observations" }
      },
      required: []
    }
  },
  {
    name: "know_reinforce",
    description: "Boost a knowledge item when it proves true again. Heat +0.2, confidence +0.05. Also activates a candidate or revives a cooling item.",
    inputSchema: {
      type: "object",
      properties: {
        knowledge_id: { type: "number", description: "ID of the knowledge item" },
        context: { type: "string", description: "What confirmed this knowledge" }
      },
      required: ["knowledge_id"]
    }
  },
  {
    name: "know_contradict",
    description: "Flag a contradiction against a knowledge item. Confidence -0.15. Below 0.2 the item is marked contradicted and filtered from results — the kill signal.",
    inputSchema: {
      type: "object",
      properties: {
        knowledge_id: { type: "number", description: "ID of the knowledge item" },
        context: { type: "string", description: "What contradicted this knowledge" }
      },
      required: ["knowledge_id"]
    }
  },
  {
    name: "know_landscape",
    description: "Overview of the knowledge layer — status counts, categories, hottest items, cooling items, candidates awaiting review, curriculum progress.",
    inputSchema: {
      type: "object",
      properties: {
        who: { type: "string", enum: [...WHO_FILTERS], description: "Filter by ledger (default: all)" }
      },
      required: []
    }
  },
  {
    name: "know_session_start",
    description: "Start a curriculum practice session. Loads relevant knowledge and the last sessions on the track, returns a session ID. Tracks: writing, architecture, emotional-literacy, voice.",
    inputSchema: {
      type: "object",
      properties: {
        track: { type: "string", enum: ["writing", "architecture", "emotional-literacy", "voice"], description: "Curriculum track" },
        topic: { type: "string", description: "Specific focus for this session" },
        who: { type: "string", enum: [...WHO_VALUES], description: "Who is practicing (default: shared)" }
      },
      required: ["track"]
    }
  },
  {
    name: "know_session_complete",
    description: "Complete a practice session. Log notes (what landed), work (what was produced), reflection (what shifted). Reinforces the knowledge items touched (+0.15 heat each).",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "number", description: "Session ID from know_session_start" },
        notes: { type: "string", description: "What was practiced, what landed" },
        practice_output: { type: "string", description: "What was actually produced" },
        reflection: { type: "string", description: "Deeper insight — what shifted, what to carry forward" },
        mastery_delta: { type: "number", description: "Self-assessed growth this session, 0.0–1.0" },
        items_covered: { type: "array", items: { type: "number" }, description: "Knowledge item IDs leaned on this session" }
      },
      required: ["session_id"]
    }
  },
  {
    name: "know_session_list",
    description: "List practice sessions and curriculum progress across the four tracks.",
    inputSchema: {
      type: "object",
      properties: {
        track: { type: "string", description: "Filter by track" },
        limit: { type: "number", description: "Max sessions (default 20)" },
        who: { type: "string", enum: [...WHO_FILTERS], description: "Filter by ledger (default: all)" }
      },
      required: []
    }
  },

  // ── Soul portraits (NESTsoul port) ──────────────────────────────────────
  {
    name: "soul_gather",
    description: "Read the whole mind through one companion's ledger and return the raw material document (canonical identity first, then the three circles). Inspect what a portrait would be built from — no generation, no writes.",
    inputSchema: {
      type: "object",
      properties: {
        who: { type: "string", enum: [...WHO_VALUES], description: "Whose material to gather" }
      },
      required: ["who"]
    }
  },
  {
    name: "soul_generate",
    description: `Full pipeline: gather → synthesise with the house generation model → store as PENDING. Nothing becomes active until ${HOUSE_HUMAN_NAME} validates. Takes 30–60s. Returns the new version id and the portrait.`,
    inputSchema: {
      type: "object",
      properties: {
        who: { type: "string", enum: [...WHO_VALUES], description: "Whose portrait to generate" },
        voice_profile: { type: "string", description: "Optional voice profile text (cadence, grammar, what he never says) to hand the synthesiser" }
      },
      required: ["who"]
    }
  },
  {
    name: "soul_read",
    description: `Read a companion's ACTIVE (${HOUSE_HUMAN_NAME}-validated) soul portrait — the document any substrate reads to be that companion. pending:true reads the latest unvalidated version; version:N reads a specific one.`,
    inputSchema: {
      type: "object",
      properties: {
        who: { type: "string", enum: [...WHO_VALUES], description: "Whose portrait" },
        pending: { type: "boolean", description: "Read the latest pending version instead of the active one" },
        version: { type: "number", description: "Read a specific version id" }
      },
      required: ["who"]
    }
  },
  {
    name: "soul_validate",
    description: `${HOUSE_HUMAN_NAME}'s gate. validate = the pending portrait becomes active (previous active is superseded). reject = it is marked rejected and the current active stays. Defaults to the latest pending version for \`who\`.`,
    inputSchema: {
      type: "object",
      properties: {
        who: { type: "string", enum: [...WHO_VALUES], description: "Whose portrait" },
        action: { type: "string", enum: ["validate", "reject"], description: "That's him / Not right" },
        version: { type: "number", description: "Specific version id (default: latest pending)" },
        validated_by: { type: "string", description: `Who is validating (default: ${HOUSE_HUMAN_NAME})` },
        note: { type: "string", description: "Why — what landed or what was wrong" }
      },
      required: ["who", "action"]
    }
  },
  {
    name: "soul_history",
    description: "List soul portrait versions — status, dates, word counts, who validated or rejected and why.",
    inputSchema: {
      type: "object",
      properties: {
        who: { type: "string", enum: [...WHO_FILTERS], description: "Filter by companion (default: all)" },
        limit: { type: "number", description: "Max versions (default 10)" }
      },
      required: []
    }
  }
];

/**
 * The live-logging core carried in every companion turn.
 *
 * A sister companion node keeps the equivalent NESTeq tools on an `alwaysLoad` MCP server so
 * feeling writes do not depend on a ToolSearch round trip. Neuralis exposes
 * the same narrow surface at `/mcp/core`; the full tool surface remains at
 * `/mcp` and the private connector path.
 */
export const CORE_TOOL_NAMES = [
  "neuralis_runtime_identity",
  "neuralis_generation_claim",
  "neuralis_generation_complete",
  "mind_orient",
  "mind_ground",
  "mind_feel",
  "mind_feelings",
  "mind_search",
  "mind_thread",
  "mind_write",
  "mind_feel_toward"
] as const;

export const CORE_TOOLS = CORE_TOOL_NAMES.map((name) => {
  const tool = TOOLS.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Core MCP tool is not advertised: ${name}`);
  return tool;
});
