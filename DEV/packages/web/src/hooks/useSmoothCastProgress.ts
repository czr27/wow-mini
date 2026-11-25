import { useEffect, useRef, type RefObject } from 'react';

export interface SmoothCastStep {
  ratio: number;
  remainText: string;
}

/**
 * Compute normalized fill ratio (0..1) and 1-decimal remaining seconds string
 * from monotonic performance timestamps.
 */
export function computeSmoothCastStep(
  nowPerfMs: number,
  startPerfMs: number,
  totalMs: number,
): SmoothCastStep {
  const safeTotal = Math.max(1, totalMs);
  const elapsed = Math.max(0, nowPerfMs - startPerfMs);
  const ratio = Math.min(1, elapsed / safeTotal);
  const remainSec = Math.max(0, (safeTotal - elapsed) / 1000);
  return {
    ratio,
    remainText: remainSec.toFixed(1),
  };
}

/**
 * Decide whether the local monotonic clock anchor needs to be re-synced to the
 * 20Hz simulation tick (new cast start or drift > threshold).
 */
export function shouldReanchorCastClock(
  tickElapsedMs: number,
  prevTickElapsedMs: number,
  predictedElapsedMs: number,
  driftThresholdMs = 80,
): boolean {
  if (tickElapsedMs < prevTickElapsedMs - 50) return true;
  return Math.abs(tickElapsedMs - predictedElapsedMs) > driftThresholdMs;
}

export interface UseSmoothCastProgressOptions {
  /** Whether a cast or channel is actively in progress. */
  active: boolean;
  /** Identity key for the current cast/channel instance. */
  castKey: string;
  /** Latest elapsed ms reported by the simulation tick. */
  elapsedMs: number;
  /** Total cast/channel duration in ms. */
  totalMs: number;
  /** Fill element whose `transform: scaleX(0..1)` is driven at display refresh rate. */
  fillRef: RefObject<HTMLElement | null>;
  /** Optional timer text element whose `textContent` is updated without React re-renders. */
  timerRef?: RefObject<HTMLElement | null>;
}

/**
 * Drives cast/channel bar fill (`transform: scaleX`) and remaining-time text via
 * `requestAnimationFrame` at native display refresh rate (60/120/144fps) on the
 * GPU compositor thread, decoupling visual smoothness from the 20Hz combat tick.
 */
export function useSmoothCastProgress({
  active,
  castKey,
  elapsedMs,
  totalMs,
  fillRef,
  timerRef,
}: UseSmoothCastProgressOptions): void {
  const startPerfRef = useRef<number>(0);
  const lastCastKeyRef = useRef<string>('');
  const lastTickElapsedRef = useRef<number>(0);
  const totalMsRef = useRef<number>(totalMs);
  const lastTimerTextRef = useRef<string>('');

  totalMsRef.current = Math.max(1, totalMs);

  // Anchor or re-sync monotonic clock when cast starts or drifts beyond tolerance
  useEffect(() => {
    if (!active) {
      lastCastKeyRef.current = '';
      lastTickElapsedRef.current = 0;
      lastTimerTextRef.current = '';
      return;
    }

    const now = performance.now();
    const keyChanged = castKey !== lastCastKeyRef.current;
    const predicted = now - startPerfRef.current;

    if (
      keyChanged ||
      shouldReanchorCastClock(elapsedMs, lastTickElapsedRef.current, predicted)
    ) {
      startPerfRef.current = now - Math.max(0, elapsedMs);
      if (keyChanged) {
        lastTimerTextRef.current = '';
      }
    }

    lastCastKeyRef.current = castKey;
    lastTickElapsedRef.current = elapsedMs;
  }, [active, castKey, elapsedMs]);

  // Native refresh-rate animation loop (zero React re-renders per frame)
  useEffect(() => {
    if (!active) return;

    let rafId = 0;
    const step = (now: number) => {
      const { ratio, remainText } = computeSmoothCastStep(
        now,
        startPerfRef.current,
        totalMsRef.current,
      );

      const fillEl = fillRef.current;
      if (fillEl) {
        fillEl.style.transform = `scaleX(${ratio})`;
      }

      const timerEl = timerRef?.current;
      if (timerEl && remainText !== lastTimerTextRef.current) {
        lastTimerTextRef.current = remainText;
        timerEl.textContent = remainText;
      }

      rafId = window.requestAnimationFrame(step);
    };

    // Apply immediately on mount/activation so frame 1 is already positioned
    step(performance.now());

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [active, castKey, fillRef, timerRef]);
}
