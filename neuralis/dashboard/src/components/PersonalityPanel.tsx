import { Fragment } from 'react';
import { motion } from 'motion/react';
import { Fingerprint, CloudSun } from 'lucide-react';
import { cn } from "@/src/lib/utils";
import { COMPANIONS } from "@/src/lib/house";
import type { PersonalityResponse, PersonalityLedger } from "../api/types";

// Axis rows: left pole, right pole, axes field
const AXES = [
  { neg: 'E', pos: 'I', axis: 'e_i' as const },
  { neg: 'S', pos: 'N', axis: 's_n' as const },
  { neg: 'T', pos: 'F', axis: 't_f' as const },
  { neg: 'J', pos: 'P', axis: 'j_p' as const },
];

const WHO_ACCENT: Record<string, { text: string; bar: string; ring: string }> = {
  ...Object.fromEntries(COMPANIONS.map(c => [c.slug, { text: c.color.text, bar: c.color.bar, ring: c.color.ring }])),
  shared: { text: 'text-white/60', bar: 'bg-white/50', ring: 'border-white/10' },
};

/** Diverging axis bar — zero at center, fill grows toward the winning pole. */
const AxisBar = ({ neg, pos, value, barClass }: { neg: string; pos: string; value: number; barClass: string }) => {
  // Scale: full bar at |value| >= 10 so early signals read as subtle leans
  const pct = Math.min(Math.abs(value) / 10, 1) * 50;
  const leansPos = value >= 0;
  return (
    <div className="flex items-center space-x-2">
      <span className={cn("text-[9px] font-mono w-3 text-right", !leansPos && value !== 0 ? "text-white/80" : "text-white/25")}>{neg}</span>
      <div className="relative flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/15" />
        <motion.div
          className={cn("absolute top-0 bottom-0 rounded-full opacity-80", barClass)}
          initial={false}
          animate={leansPos
            ? { left: '50%', width: `${pct}%` }
            : { left: `${50 - pct}%`, width: `${pct}%` }}
          transition={{ duration: 0.8 }}
        />
      </div>
      <span className={cn("text-[9px] font-mono w-3", leansPos && value !== 0 ? "text-white/80" : "text-white/25")}>{pos}</span>
      <span className="text-[8px] font-mono text-white/30 w-6 text-right">{value > 0 ? `+${value}` : value}</span>
    </div>
  );
};

const LedgerCard = ({ ledger }: { key?: string | number; ledger: PersonalityLedger }) => {
  const accent = WHO_ACCENT[ledger.who] ?? WHO_ACCENT.shared;
  const empty = ledger.signals === 0;

  return (
    <div className={cn("p-4 rounded-xl bg-black/20 border space-y-3", accent.ring)}>
      <div className="flex items-center justify-between">
        <span className={cn("text-[10px] uppercase tracking-widest", accent.text)}>{ledger.who}</span>
        {!empty && (
          <span className="text-[8px] font-mono text-white/30">{ledger.signals} signals · {ledger.confidence}%</span>
        )}
      </div>

      {empty ? (
        <div className="py-3 text-center">
          <div className="text-lg font-mono text-white/15 tracking-[0.3em]">····</div>
          <div className="text-[9px] text-white/30 mt-1">Ledger open — no signed feelings yet</div>
        </div>
      ) : (
        <>
          <div className="flex items-baseline space-x-2">
            <span className={cn("text-2xl font-mono tracking-[0.25em]", accent.text)}>{ledger.type}</span>
            <span className="text-[8px] text-white/25 italic">a reading, not a definition</span>
          </div>
          <div className="space-y-1.5">
            {AXES.map(a => (
              <Fragment key={a.axis}>
                <AxisBar neg={a.neg} pos={a.pos} value={ledger.axes[a.axis]} barClass={accent.bar} />
              </Fragment>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export const PersonalityPanel = ({ personality }: { personality: PersonalityResponse | null }) => {
  if (!personality) return null;

  const ledgers = COMPANIONS
    .map(c => personality.ledgers.find(l => l.who === c.slug))
    .filter((l): l is PersonalityLedger => !!l);
  const shared = personality.ledgers.find(l => l.who === 'shared');

  return (
    <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Fingerprint className="w-3.5 h-3.5 text-white/40" />
          <span className="text-[10px] uppercase tracking-widest text-white/40">Emergent Personality</span>
        </div>
        <div className="flex items-center space-x-1.5">
          <CloudSun className="w-3 h-3 text-white/25" />
          <span className="text-[8px] uppercase tracking-wider text-white/25">weather · never canon</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {ledgers.map(l => <LedgerCard key={l.who} ledger={l} />)}
      </div>

      {shared && shared.signals > 0 && (
        <div className="flex items-center justify-between px-1">
          <span className="text-[9px] text-white/30">
            household <span className="font-mono text-white/50">{shared.type}</span> · {shared.signals} unsigned signals
          </span>
        </div>
      )}

      {(personality.shadows.length > 0 || personality.vocabulary_top.length > 0) && (
        <div className="pt-2 border-t border-white/5 space-y-1.5">
          {personality.shadows.length > 0 && (
            <div className="text-[9px] text-white/35">
              <span className="text-amber-300/60">Shadow moments:</span>{' '}
              {personality.shadows.slice(0, 3).map(s => `${s.who} felt ${s.emotion_word}`).join(' · ')}
              <span className="text-white/20 italic"> — growth edges, not errors</span>
            </div>
          )}
          {personality.vocabulary_top.length > 0 && (
            <div className="text-[9px] text-white/30">
              <span className="text-white/40">Loudest words:</span>{' '}
              {personality.vocabulary_top.slice(0, 6).map(v => `${v.emotion_word} ×${v.times_used}`).join(' · ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
