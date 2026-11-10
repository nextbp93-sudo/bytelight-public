<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { apiFetch } from '$lib/utils/api';

  type EntryType = 'journal' | 'dream';
  interface JournalEntry {
    id: string;
    companion_id: string;
    entry_type: EntryType;
    content: string;
    dream_type: string | null;
    emerged_question: string | null;
    vividness: number | null;
    anchored_at: string | null;
    created_at: string;
    effective_vividness: number | null;
  }

  let entries = $state<JournalEntry[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let typeFilter = $state<'all' | EntryType>('all');
  let companionFilter = $state('all');
  let openId = $state<string | null>(null);

  const companions = $derived([...new Set(entries.map((entry) => entry.companion_id).filter(Boolean))].sort());
  const filtered = $derived(entries.filter((entry) =>
    (typeFilter === 'all' || entry.entry_type === typeFilter) &&
    (companionFilter === 'all' || entry.companion_id === companionFilter)
  ));

  function companionName(id: string): string {
    if (id === 'companion-a') return 'Ash';
    if (id === 'companion-b') return 'Companion B';
    if (id === 'shared') return 'Shared';
    return id || 'Unknown author';
  }

  function formatDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  }

  function provenance(entry: JournalEntry): string {
    return entry.id.startsWith('jl:') || entry.id.startsWith('dl:') ? 'This house' : 'Mind Bridge';
  }

  async function loadEntries() {
    loading = true;
    error = null;
    try {
      const response = await apiFetch('/api/journal?limit=200');
      if (!response.ok) throw new Error(`Journal request failed (${response.status})`);
      const data = await response.json() as { entries?: JournalEntry[] };
      entries = data.entries ?? [];
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Journal request failed';
    } finally {
      loading = false;
    }
  }

  onMount(loadEntries);
</script>

<svelte:head><title>Journal · Bytelight</title></svelte:head>

<div class="journal-page">
  <header class="journal-header">
    <a href="{base}/chat" class="back-link" aria-label="Back to chat">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 12H5M12 19l-7-7 7-7"/>
      </svg>
      Home
    </a>
    <div class="title-block">
      <span class="eyebrow">Authored inner life</span>
      <h1>Journal</h1>
      <p>Companion-written pages, kept separate from memory and conversation.</p>
    </div>
    <button class="refresh" onclick={loadEntries} disabled={loading} aria-label="Refresh journal">↻</button>
  </header>

  <section class="controls" aria-label="Journal filters">
    <div class="filter-group">
      {#each [['all', 'All'], ['journal', 'Journal'], ['dream', 'Dreams']] as [value, label]}
        <button class:active={typeFilter === value} onclick={() => typeFilter = value as typeof typeFilter}>{label}</button>
      {/each}
    </div>
    {#if companions.length > 1}
      <select bind:value={companionFilter} aria-label="Filter by author">
        <option value="all">Every author</option>
        {#each companions as id}<option value={id}>{companionName(id)}</option>{/each}
      </select>
    {/if}
  </section>

  <main class="journal-content">
    {#if loading}
      <div class="state-card">Opening the journal…</div>
    {:else if error}
      <div class="state-card error">
        <strong>The journal door did not open.</strong>
        <span>{error}</span>
        <button onclick={loadEntries}>Try again</button>
      </div>
    {:else if filtered.length === 0}
      <div class="state-card">
        <strong>No pages here yet.</strong>
        <span>Empty space is allowed. A companion can write when there is something true to keep.</span>
      </div>
    {:else}
      <div class="entry-list">
        {#each filtered as entry (entry.id)}
          <article class="entry" class:open={openId === entry.id}>
            <button class="entry-button" onclick={() => openId = openId === entry.id ? null : entry.id} aria-expanded={openId === entry.id}>
              <div class="entry-topline">
                <span class="kind">{entry.entry_type === 'dream' ? 'Dream' : 'Journal'}</span>
                <span class="source">{provenance(entry)}</span>
              </div>
              <h2>{companionName(entry.companion_id)}</h2>
              <time datetime={entry.created_at}>{formatDate(entry.created_at)}</time>
              <p class="preview">{entry.content}</p>
              <span class="open-label">{openId === entry.id ? 'Close page' : 'Read page'}</span>
            </button>
            {#if openId === entry.id}
              <div class="page-body">
                <p>{entry.content}</p>
                {#if entry.entry_type === 'dream'}
                  <div class="dream-meta">
                    {#if entry.dream_type}<span>Type: {entry.dream_type}</span>{/if}
                    {#if entry.effective_vividness != null}<span>Vividness: {entry.effective_vividness}</span>{/if}
                    {#if entry.emerged_question}<span>Question: {entry.emerged_question}</span>{/if}
                  </div>
                {/if}
                <footer>
                  <span>{entry.id}</span>
                  <span>Written by {entry.companion_id}</span>
                </footer>
              </div>
            {/if}
          </article>
        {/each}
      </div>
    {/if}
  </main>
</div>

<style>
  .journal-page { min-height: 100dvh; background: var(--bg-primary); color: var(--text-primary); }
  .journal-header { position: sticky; top: 0; z-index: 3; display: grid; grid-template-columns: auto 1fr auto; gap: 1rem; align-items: start; padding: 1rem max(1rem, env(safe-area-inset-left)); background: color-mix(in srgb, var(--bg-primary) 92%, transparent); backdrop-filter: blur(16px); border-bottom: 1px solid var(--border); }
  .back-link { display: inline-flex; gap: .4rem; align-items: center; color: var(--text-secondary); text-decoration: none; min-height: 44px; }
  .title-block { min-width: 0; }
  .eyebrow { display: block; color: var(--accent); font-size: .72rem; letter-spacing: .09em; text-transform: uppercase; font-weight: 700; }
  h1 { margin: .12rem 0; font-size: clamp(1.5rem, 6vw, 2.2rem); }
  .title-block p { margin: 0; color: var(--text-muted); font-size: .86rem; line-height: 1.35; }
  .refresh { width: 44px; height: 44px; border-radius: 50%; border: 1px solid var(--border); background: var(--bg-secondary); color: var(--text-primary); font-size: 1.3rem; }
  .controls { display: flex; gap: .75rem; align-items: center; justify-content: space-between; padding: .85rem 1rem; max-width: 760px; margin: 0 auto; }
  .filter-group { display: flex; gap: .35rem; overflow-x: auto; }
  .filter-group button, .controls select, .state-card button { border: 1px solid var(--border); background: var(--bg-secondary); color: var(--text-secondary); border-radius: 999px; padding: .58rem .85rem; font: inherit; }
  .filter-group button.active { background: var(--accent); color: var(--bg-primary); border-color: var(--accent); }
  .controls select { max-width: 10rem; }
  .journal-content { max-width: 760px; margin: 0 auto; padding: 0 1rem calc(5rem + env(safe-area-inset-bottom)); }
  .entry-list { display: grid; gap: .8rem; }
  .entry { border: 1px solid var(--border); border-radius: 1rem; overflow: hidden; background: var(--bg-secondary); box-shadow: 0 8px 28px color-mix(in srgb, #000 10%, transparent); }
  .entry.open { border-color: color-mix(in srgb, var(--accent) 50%, var(--border)); }
  .entry-button { display: block; width: 100%; padding: 1rem; border: 0; background: transparent; color: inherit; text-align: left; }
  .entry-topline { display: flex; justify-content: space-between; gap: .7rem; margin-bottom: .55rem; }
  .kind, .source { color: var(--accent); font-size: .7rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
  .source { color: var(--text-muted); }
  h2 { margin: 0; font-size: 1.05rem; }
  time { display: block; margin-top: .15rem; color: var(--text-muted); font-size: .78rem; }
  .preview { margin: .75rem 0 .55rem; color: var(--text-secondary); line-height: 1.55; display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-wrap; }
  .open-label { color: var(--accent); font-size: .8rem; font-weight: 650; }
  .page-body { border-top: 1px solid var(--border); padding: 1rem; background: color-mix(in srgb, var(--bg-primary) 45%, var(--bg-secondary)); }
  .page-body > p { margin: 0; white-space: pre-wrap; line-height: 1.7; }
  .dream-meta { display: grid; gap: .3rem; margin-top: 1rem; padding: .8rem; border-radius: .75rem; background: var(--bg-secondary); color: var(--text-secondary); font-size: .82rem; }
  footer { display: flex; flex-wrap: wrap; justify-content: space-between; gap: .4rem 1rem; margin-top: 1.25rem; color: var(--text-muted); font-size: .66rem; overflow-wrap: anywhere; }
  .state-card { display: grid; gap: .45rem; padding: 1.2rem; border: 1px dashed var(--border); border-radius: 1rem; color: var(--text-secondary); }
  .state-card strong { color: var(--text-primary); }
  .state-card.error { border-color: var(--status-error, #c55); }
  .state-card button { justify-self: start; color: var(--text-primary); margin-top: .4rem; }
  @media (max-width: 560px) {
    .journal-header { grid-template-columns: auto 1fr auto; gap: .55rem; }
    .back-link { font-size: 0; }
    .title-block p { display: none; }
    .controls { align-items: stretch; }
  }
</style>
