import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SELECTABLE_DUNGEONS } from '@cata-raid-sim/engine';

export type DungeonPickerMode = 'filter' | 'select' | 'switch';
export type DungeonTierFilter = 'ALL' | '5man' | '20man';

type DungeonEntry = (typeof SELECTABLE_DUNGEONS)[number];

export interface DungeonPickerProps {
  mode: DungeonPickerMode;
  /** filter: 'ALL' | dungeonId; select/switch: dungeonId */
  value: string;
  onChange: (value: string) => void;
  /** switch mode: ids that cannot be selected */
  disabledIds?: ReadonlySet<string> | readonly string[];
  /** switch mode: reason text per disabled id */
  disabledReasons?: Readonly<Record<string, string>>;
  /** Compact trigger label prefix (dropdown modes). */
  label?: string;
  className?: string;
  /** select mode: max height of the list panel */
  listMaxHeightClassName?: string;
}

function tierBadge(tier: '5man' | '20man'): string {
  return tier === '5man' ? '5人' : '20人';
}

function dungeonLabel(id: string): string {
  if (id === 'ALL') return '全部副本';
  return SELECTABLE_DUNGEONS.find((d) => d.id === id)?.label ?? id;
}

function isDisabled(
  id: string,
  disabledIds?: ReadonlySet<string> | readonly string[]
): boolean {
  if (!disabledIds) return false;
  if (disabledIds instanceof Set) return disabledIds.has(id);
  return (disabledIds as readonly string[]).includes(id);
}

function TierChips({
  value,
  onChange,
}: {
  value: DungeonTierFilter;
  onChange: (v: DungeonTierFilter) => void;
}) {
  const items: Array<{ id: DungeonTierFilter; label: string }> = [
    { id: 'ALL', label: '全部' },
    { id: '5man', label: '5人' },
    { id: '20man', label: '20人' },
  ];
  return (
    <div className="flex items-center gap-1 shrink-0">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          className={`px-2 py-1 rounded text-[11px] transition ${
            value === item.id
              ? 'bg-amber-600 text-white font-bold'
              : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function SearchInput({
  value,
  onChange,
  placeholder = '搜索副本…',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative flex-1 min-w-0">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200 text-[10px]"
          aria-label="清除搜索"
        >
          ✕
        </button>
      )}
    </div>
  );
}

function DungeonList({
  mode,
  value,
  items,
  onPick,
  disabledIds,
  disabledReasons,
  maxHeightClassName,
}: {
  mode: DungeonPickerMode;
  value: string;
  items: DungeonEntry[];
  onPick: (id: string) => void;
  disabledIds?: ReadonlySet<string> | readonly string[];
  disabledReasons?: Readonly<Record<string, string>>;
  maxHeightClassName: string;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const groups = useMemo(() => {
    const five = items.filter((d) => d.tier === '5man');
    const twenty = items.filter((d) => d.tier === '20man');
    return [
      { key: '5man' as const, title: '5人小队', entries: five },
      { key: '20man' as const, title: '20人团本', entries: twenty },
    ].filter((g) => g.entries.length > 0);
  }, [items]);

  // Scroll default/current selection into view when panel opens or value changes
  useEffect(() => {
    const list = listRef.current;
    const el = activeRef.current;
    if (!list || !el) return;
    // rAF: wait for layout after mount (create-room modal / dropdown open)
    const id = requestAnimationFrame(() => {
      const listRect = list.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const delta =
        elRect.top - listRect.top - listRect.height / 2 + elRect.height / 2;
      list.scrollTop += delta;
    });
    return () => cancelAnimationFrame(id);
  }, [value, items]);

  if (items.length === 0) {
    return (
      <div className={`${maxHeightClassName} flex items-center justify-center text-xs text-slate-500`}>
        无匹配副本
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      className={`${maxHeightClassName} overflow-y-auto overscroll-contain pr-0.5 space-y-2`}
    >
      {mode === 'filter' && (
        <button
          type="button"
          ref={value === 'ALL' ? activeRef : undefined}
          onClick={() => onPick('ALL')}
          className={`w-full flex items-center justify-between px-2.5 py-2 rounded-md border text-left text-xs transition ${
            value === 'ALL'
              ? 'border-amber-500 bg-amber-950/35 text-amber-300'
              : 'border-transparent bg-slate-950/60 text-slate-300 hover:border-slate-700 hover:bg-slate-900'
          }`}
        >
          <span className="font-semibold">全部副本</span>
          <span className="text-[10px] text-slate-500">不限地图</span>
        </button>
      )}

      {groups.map((group) => (
        <div key={group.key}>
          <div className="sticky top-0 z-[1] px-1 py-1 text-[10px] font-bold tracking-wider uppercase text-slate-500 bg-slate-900/95 backdrop-blur-sm">
            {group.title}
            <span className="ml-1.5 font-mono text-slate-600">{group.entries.length}</span>
          </div>
          <div className="space-y-0.5">
            {group.entries.map((d) => {
              const active = value === d.id;
              const disabled = mode === 'switch' && isDisabled(d.id, disabledIds) && !active;
              const reason = disabledReasons?.[d.id];
              return (
                <div key={d.id} className="relative group">
                  <button
                    type="button"
                    ref={active ? activeRef : undefined}
                    disabled={disabled}
                    onClick={() => {
                      if (disabled) return;
                      onPick(d.id);
                    }}
                    className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md border text-left text-xs transition ${
                      active
                        ? 'border-amber-500 bg-amber-950/35 text-amber-300'
                        : disabled
                          ? 'border-transparent bg-slate-950/40 text-slate-600 cursor-not-allowed opacity-60'
                          : 'border-transparent bg-slate-950/60 text-slate-300 hover:border-slate-700 hover:bg-slate-900'
                    }`}
                  >
                    <span className={`font-semibold truncate ${active ? 'text-amber-300' : ''}`}>
                      {d.label}
                    </span>
                    <span
                      className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border ${
                        active
                          ? 'border-amber-500/40 text-amber-400/90 bg-amber-950/40'
                          : 'border-slate-700 text-slate-500 bg-slate-900'
                      }`}
                    >
                      {tierBadge(d.tier)}
                    </span>
                  </button>
                  {disabled && reason && (
                    <div className="absolute left-0 top-full mt-1 z-30 hidden group-hover:block bg-slate-950 text-red-400 text-[11px] p-2 rounded shadow-xl border border-red-500/40 w-52 whitespace-pre-line">
                      <div className="font-bold mb-1">无法切换：</div>
                      <div>{reason}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function PickerPanel({
  mode,
  value,
  onPick,
  disabledIds,
  disabledReasons,
  listMaxHeightClassName,
}: {
  mode: DungeonPickerMode;
  value: string;
  onPick: (id: string) => void;
  disabledIds?: ReadonlySet<string> | readonly string[];
  disabledReasons?: Readonly<Record<string, string>>;
  listMaxHeightClassName: string;
}) {
  const [tierFilter, setTierFilter] = useState<DungeonTierFilter>('ALL');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SELECTABLE_DUNGEONS.filter((d) => {
      if (tierFilter !== 'ALL' && d.tier !== tierFilter) return false;
      if (!q) return true;
      return d.label.toLowerCase().includes(q) || d.id.toLowerCase().includes(q);
    });
  }, [tierFilter, query]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <TierChips value={tierFilter} onChange={setTierFilter} />
        <SearchInput value={query} onChange={setQuery} />
      </div>
      <DungeonList
        mode={mode}
        value={value}
        items={filtered}
        onPick={onPick}
        disabledIds={disabledIds}
        disabledReasons={disabledReasons}
        maxHeightClassName={listMaxHeightClassName}
      />
    </div>
  );
}

/**
 * Scalable dungeon chooser for lobby filter, create-room select, and in-room map switch.
 * Uses tier chips + search + scrollable grouped list so dozens of dungeons stay usable.
 */
export const DungeonPicker: React.FC<DungeonPickerProps> = ({
  mode,
  value,
  onChange,
  disabledIds,
  disabledReasons,
  label = '地图',
  className = '',
  listMaxHeightClassName,
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const isInline = mode === 'select';
  const listHeight =
    listMaxHeightClassName ?? (isInline ? 'max-h-64' : 'max-h-72');

  useEffect(() => {
    if (!open || isInline) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, isInline]);

  const handlePick = (id: string) => {
    if (mode === 'switch' && id === value) {
      setOpen(false);
      return;
    }
    onChange(id);
    if (!isInline) setOpen(false);
  };

  if (isInline) {
    return (
      <div className={`rounded-lg border border-slate-800 bg-slate-950/70 p-2.5 ${className}`}>
        <PickerPanel
          mode={mode}
          value={value}
          onPick={handlePick}
          disabledIds={disabledIds}
          disabledReasons={disabledReasons}
          listMaxHeightClassName={listHeight}
        />
      </div>
    );
  }

  const selectedDungeon = SELECTABLE_DUNGEONS.find((d) => d.id === value);
  const triggerText =
    mode === 'filter'
      ? value === 'ALL'
        ? '全部'
        : dungeonLabel(value)
      : dungeonLabel(value);
  const triggerMeta =
    mode !== 'filter' && selectedDungeon
      ? tierBadge(selectedDungeon.tier)
      : mode === 'filter' && value !== 'ALL' && selectedDungeon
        ? tierBadge(selectedDungeon.tier)
        : null;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-8 items-center gap-2 px-2.5 rounded-lg border text-xs transition ${
          open
            ? 'border-amber-500/60 bg-amber-950/30 text-amber-200'
            : 'border-slate-700 bg-slate-900/90 text-slate-200 hover:border-slate-500'
        }`}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="text-slate-400 font-semibold shrink-0">{label}</span>
        <span className="font-bold text-slate-100 max-w-[9rem] truncate">{triggerText}</span>
        {triggerMeta && (
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-slate-700 text-slate-400 bg-slate-950">
            {triggerMeta}
          </span>
        )}
        <span className={`text-slate-500 text-[10px] transition ${open ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1.5 z-40 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-slate-700/80 bg-slate-900/95 shadow-2xl backdrop-blur-md p-2.5 animate-in fade-in zoom-in-95 duration-100"
          role="listbox"
        >
          <PickerPanel
            mode={mode}
            value={value}
            onPick={handlePick}
            disabledIds={disabledIds}
            disabledReasons={disabledReasons}
            listMaxHeightClassName={listHeight}
          />
        </div>
      )}
    </div>
  );
};
