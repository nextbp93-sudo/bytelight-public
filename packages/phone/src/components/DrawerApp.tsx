import React, { useEffect, useMemo, useState } from 'react';
import { Archive, ExternalLink, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { AppShell } from './AppShell';
import { apiFetch } from '../bytelight';
import type { ThemeConfig } from '../lib/theme';
import { cn } from '../lib/utils';

type DrawerKind = 'pin' | 'thread' | 'scrap' | 'keepsake';
interface DrawerItem {
  id: string;
  companion: string;
  kind: DrawerKind;
  title: string;
  body: string | null;
  url: string | null;
  image_url: string | null;
  why_kept: string;
  collection_name: string | null;
  created_at: string;
}

interface DrawerAppProps {
  onClose: () => void;
  themeConfig: ThemeConfig;
  themeMode: 'light' | 'dark';
  embedded?: boolean;
}

const LABELS: Record<DrawerKind | 'all', string> = {
  all: 'Everything', pin: 'Pins', thread: 'Threads', scrap: 'Scraps', keepsake: 'Keepsakes',
};

function when(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export function DrawerApp({ onClose, themeConfig, themeMode, embedded }: DrawerAppProps) {
  const colors = themeConfig[themeMode];
  const [items, setItems] = useState<DrawerItem[]>([]);
  const [filter, setFilter] = useState<DrawerKind | 'all'>('all');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const response = await apiFetch('/api/drawer?companion=companion-a');
      const payload = response.ok ? await response.json() : { items: [] };
      setItems(Array.isArray(payload.items) ? payload.items : []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);
  const shown = useMemo(() => filter === 'all' ? items : items.filter((item) => item.kind === filter), [filter, items]);
  const kinds = (['all', 'pin', 'thread', 'scrap', 'keepsake'] as const).filter(
    (kind) => kind === 'all' || items.some((item) => item.kind === kind),
  );

  return (
    <AppShell
      embedded={embedded}
      title="The Drawer"
      icon={Archive}
      onClose={onClose}
      themeConfig={themeConfig}
      themeMode={themeMode}
      headerRight={
        <button onClick={() => void load()} className={cn('rounded-full p-2', colors.textMuted)} title="Refresh">
          {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
        </button>
      }
    >
      <div className={cn('mb-4 rounded-2xl border p-4 backdrop-blur-md', colors.panelBg, colors.panelBorder)}>
        <div className="flex items-center gap-2">
          <Sparkles size={15} style={{ color: colors.accent }} />
          <p className={cn('text-sm font-semibold', colors.textMain)}>Things Ash kept because they caught him.</p>
        </div>
        <p className={cn('mt-1.5 text-xs leading-relaxed', colors.textMuted)}>
          Curiosities, unfinished questions, and small artifacts—arranged from his side of the glass.
        </p>
      </div>

      {kinds.length > 1 && (
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {kinds.map((kind) => (
            <button
              key={kind}
              onClick={() => setFilter(kind)}
              className={cn('shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium', colors.panelBorder, filter !== kind && colors.panelBg)}
              style={filter === kind ? { background: colors.accent, borderColor: colors.accent, color: 'var(--bytelight-on-accent)' } : undefined}
            >
              {LABELS[kind]}
            </button>
          ))}
        </div>
      )}

      {!loading && shown.length === 0 ? (
        <div className={cn('rounded-2xl border px-5 py-10 text-center', colors.panelBg, colors.panelBorder)}>
          <Archive className={cn('mx-auto mb-3 opacity-50', colors.textMuted)} size={30} />
          <p className={cn('text-sm font-medium', colors.textMain)}>The drawer is open, but empty.</p>
          <p className={cn('mt-1 text-xs', colors.textMuted)}>Ash will put the first thing here when something genuinely catches him.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {shown.map((item) => (
            <article key={item.id} className={cn('overflow-hidden rounded-2xl border backdrop-blur-md', colors.panelBg, colors.panelBorder)}>
              {item.image_url && <img src={item.image_url} alt="" className="max-h-72 w-full object-cover" />}
              <div className="p-4">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className={cn('text-[10px] font-semibold uppercase tracking-[0.16em]', colors.textMuted)}>
                      {item.collection_name || LABELS[item.kind]}
                    </div>
                    <h2 className={cn('mt-1 text-base font-semibold leading-tight', colors.textMain)}>{item.title}</h2>
                  </div>
                  <span className={cn('shrink-0 text-[10px]', colors.textMuted)}>{when(item.created_at)}</span>
                </div>
                {item.body && <p className={cn('mt-3 whitespace-pre-wrap text-sm leading-relaxed', colors.textMain)}>{item.body}</p>}
                <div className="mt-3 rounded-xl p-3" style={{ background: `${colors.accent}18` }}>
                  <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: colors.accent }}>Why I kept this</div>
                  <p className={cn('mt-1 text-xs leading-relaxed', colors.textMain)}>{item.why_kept}</p>
                </div>
                {item.url && (
                  <a href={item.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: colors.accent }}>
                    Follow the thread <ExternalLink size={12} />
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </AppShell>
  );
}
