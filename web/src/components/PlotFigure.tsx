import * as Plot from "@observablehq/plot";
import { useEffect, useRef, useState } from "react";

/** Renders an Observable Plot spec responsively (re-plots on resize and on spec change). */
export function PlotFigure({ make, deps, height = 380 }: { make: (width: number) => Plot.PlotOptions; deps: unknown[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!ref.current) return;
    const chart = Plot.plot({
      width,
      height,
      style: { background: "transparent", color: "var(--text)", fontSize: "11px", fontFamily: "var(--font-sans)" },
      ...make(width),
    });
    ref.current.replaceChildren(chart);
    return () => chart.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, ...deps]);
  return <div ref={ref} className="w-full" />;
}

export { Plot };
