/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The worker this dashboard talks to, e.g. https://my-brain.me.workers.dev */
  readonly VITE_MIND_URL?: string;
  /** The human's name, shown in the soul panel and sent as validated_by. */
  readonly VITE_HOUSE_HUMAN?: string;
  /** JSON array of {slug, name, pronouns?} — same slugs as the worker's __HOUSE_COMPANIONS__. */
  readonly VITE_HOUSE_COMPANIONS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
