import { useEffect, useRef, useState } from "react";
import { YEAR_MAX, YEAR_MIN } from "../lib/filters";
import { fmtYear } from "../lib/format";
import { useApp } from "../lib/store";
import { IconPause, IconPlay } from "./ui";

/**
 * Global time slider (-600..2025). The track is piecewise-linear so that the dense
 * modern era (1600+) gets most of the width; antiquity is compressed into 15%.
 */
const KNEE_YEAR = 1600;
const KNEE_POS = 0.15;
const STEPS = 1000;

export function yearToPos(y: number): number {
  if (y <= KNEE_YEAR) return ((y - YEAR_MIN) / (KNEE_YEAR - YEAR_MIN)) * KNEE_POS;
  return KNEE_POS + ((y - KNEE_YEAR) / (YEAR_MAX - KNEE_YEAR)) * (1 - KNEE_POS);
}
export function posToYear(p: number): number {
  if (p <= KNEE_POS) return Math.round(YEAR_MIN + (p / KNEE_POS) * (KNEE_YEAR - YEAR_MIN));
  return Math.round(KNEE_YEAR + ((p - KNEE_POS) / (1 - KNEE_POS)) * (YEAR_MAX - KNEE_YEAR));
}

export function TimeSlider() {
  const { filters, setFilters } = useApp();
  const [local, setLocal] = useState(filters.year);
  const [playing, setPlaying] = useState(false);
  const raf = useRef<number | null>(null);
  const yearRef = useRef(filters.year);

  useEffect(() => {
    if (!playing) {
      setLocal(filters.year);
      yearRef.current = filters.year;
    }
  }, [filters.year, playing]);

  // Debounced commit while dragging so URL + worker aren't spammed.
  useEffect(() => {
    if (playing) return;
    const t = setTimeout(() => local !== filters.year && setFilters({ year: local }), 120);
    return () => clearTimeout(t);
  }, [local, playing, filters.year, setFilters]);

  useEffect(() => {
    if (!playing) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let last = performance.now();
    let lastCommit = 0;
    if (yearRef.current >= YEAR_MAX) yearRef.current = 1600;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      // ~12 years/second (or jump in decades when reduced motion is requested)
      yearRef.current = Math.min(YEAR_MAX, yearRef.current + (reduce ? 10 : 14 * dt));
      const y = Math.round(yearRef.current);
      setLocal(y);
      if (now - lastCommit > (reduce ? 600 : 90)) {
        setFilters({ year: y });
        lastCommit = now;
      }
      if (yearRef.current >= YEAR_MAX) {
        setPlaying(false);
        setFilters({ year: YEAR_MAX });
        return;
      }
      raf.current = reduce ? window.setTimeout(() => requestAnimationFrame(tick), 600) : requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [playing, setFilters]);

  const pos = Math.round(yearToPos(local) * STEPS);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <button
        type="button"
        onClick={() => setPlaying((p) => !p)}
        aria-label={playing ? "Pause timeline" : "Play timeline"}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line text-gold hover:bg-surface-2"
        data-testid="play"
      >
        {playing ? <IconPause /> : <IconPlay />}
      </button>
      <div className="relative min-w-0 flex-1">
        <input
          type="range"
          className="slider w-full"
          min={0}
          max={STEPS}
          value={pos}
          aria-label="Year"
          aria-valuetext={fmtYear(local)}
          onChange={(e) => {
            setPlaying(false);
            setLocal(posToYear(Number(e.target.value) / STEPS));
          }}
          onKeyDown={(e) => {
            // arrow keys step by year/decade on the real scale, not the slider scale
            const step = e.shiftKey ? 10 : 1;
            if (e.key === "ArrowRight" || e.key === "ArrowUp") {
              e.preventDefault();
              setLocal((l) => Math.min(YEAR_MAX, l + step));
            } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
              e.preventDefault();
              setLocal((l) => Math.max(YEAR_MIN, l - step));
            }
          }}
          data-testid="time-slider"
        />
        <div className="pointer-events-none absolute inset-x-0 -bottom-2.5 hidden text-[10px] text-muted sm:block" aria-hidden>
          {[-500, 0, 1600, 1700, 1800, 1900, 2000].map((y) => (
            <span key={y} className="absolute -translate-x-1/2" style={{ left: `${yearToPos(y) * 100}%` }}>
              {fmtYear(y)}
            </span>
          ))}
        </div>
      </div>
      <output className="w-20 shrink-0 text-right font-display text-xl tabular-nums" aria-live="off">
        {local >= YEAR_MAX ? "Today" : fmtYear(local)}
      </output>
    </div>
  );
}
