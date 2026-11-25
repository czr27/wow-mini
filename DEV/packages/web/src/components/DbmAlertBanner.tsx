import React, { useEffect, useState } from 'react';
import type { DbmAlert, DbmRoleHint, DbmSeverity } from '@cata-raid-sim/engine';

interface Props {
  alerts: DbmAlert[];
  enabled: boolean;
}

const ROLE_LABEL: Record<DbmRoleHint, string> = {
  ALL: '全团',
  TANK: '坦克',
  HEALER: '治疗',
  DPS: '输出',
};

const SEVERITY_STYLE: Record<
  DbmSeverity,
  { border: string; bg: string; title: string; badge: string; icon: string }
> = {
  CRITICAL: {
    border: 'border-red-500/90 shadow-[0_0_18px_rgba(239,68,68,0.45)] animate-pulse',
    bg: 'bg-[#2a0d12]/92',
    title: 'text-red-200',
    badge: 'bg-red-600/80 text-white border-red-400/60',
    icon: '🚨',
  },
  WARN: {
    border: 'border-amber-400/85 shadow-[0_0_14px_rgba(251,191,36,0.3)]',
    bg: 'bg-[#261c0b]/90',
    title: 'text-amber-200',
    badge: 'bg-amber-600/75 text-amber-50 border-amber-400/50',
    icon: '⚠️',
  },
  INFO: {
    border: 'border-sky-400/70 shadow-[0_0_10px_rgba(56,189,248,0.2)]',
    bg: 'bg-[#0f1d2e]/88',
    title: 'text-sky-200',
    badge: 'bg-sky-700/70 text-sky-100 border-sky-400/40',
    icon: '📢',
  },
};

export const DbmAlertBanner: React.FC<Props> = ({ alerts, enabled }) => {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled || alerts.length === 0) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [enabled, alerts.length]);

  if (!enabled || alerts.length === 0) return null;

  const active = alerts
    .filter((a) => nowMs - a.atMs < (a.ttlMs || 3500))
    .slice(-3)
    .reverse();

  if (active.length === 0) return null;

  return (
    <div
      className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1.5 pointer-events-none w-[min(92vw,460px)]"
      data-testid="dbm-alert-banner"
    >
      {active.map((alert) => {
        const st = SEVERITY_STYLE[alert.severity] || SEVERITY_STYLE.WARN;
        const role = ROLE_LABEL[alert.roleHint || 'ALL'];
        return (
          <div
            key={alert.id}
            className={`w-full rounded-lg border px-3.5 py-2 backdrop-blur-md transition-all ${st.bg} ${st.border}`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-sm leading-none shrink-0">{st.icon}</span>
                <span className={`font-extrabold text-xs tracking-wide truncate ${st.title}`}>
                  {alert.title}
                </span>
              </div>
              <span
                className={`text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${st.badge}`}
              >
                {role}
              </span>
            </div>
            <div className="text-[11px] font-semibold text-gray-100 mt-0.5 pl-5 leading-snug">
              {alert.advice}
            </div>
          </div>
        );
      })}
    </div>
  );
};
