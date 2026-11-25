import { useRef, useState, type ReactNode } from "react";
import { downloadCSV, exportPNG } from "../lib/export";
import { Button, IconDownload, IconTable } from "./ui";

/**
 * Every chart gets: a title, a plain-English explanation, PNG + CSV export, and an
 * accessible data-table fallback (toggleable, and always present for screen readers).
 */
export function ChartFrame({
  title,
  explain,
  rows,
  columns,
  filename,
  children,
  aside,
  className,
}: {
  title: string;
  explain?: ReactNode;
  rows: Record<string, unknown>[];
  columns?: string[];
  filename: string;
  children: ReactNode;
  aside?: ReactNode;
  className?: string;
}) {
  const [showTable, setShowTable] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);
  const cols = columns ?? (rows[0] ? Object.keys(rows[0]) : []);
  return (
    <section className={"rounded-xl border border-line bg-surface/60 p-4 md:p-5 " + (className ?? "")} aria-label={title}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <h2 className="font-display text-xl">{title}</h2>
        <div className="flex gap-1">
          <Button onClick={() => setShowTable((s) => !s)} aria-pressed={showTable} title="Show data table">
            <IconTable /> <span className="hidden sm:inline">Table</span>
          </Button>
          <Button onClick={() => chartRef.current && exportPNG(chartRef.current, `${filename}.png`)} title="Export PNG">
            <IconDownload /> PNG
          </Button>
          <Button onClick={() => downloadCSV(`${filename}.csv`, rows, cols)} title="Export CSV">
            <IconDownload /> CSV
          </Button>
        </div>
      </div>
      <div className={aside ? "grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]" : ""}>
        <div>
          <div ref={chartRef} className={showTable ? "hidden" : ""}>
            {children}
          </div>
          <DataTable rows={rows} columns={cols} visible={showTable} caption={title} />
        </div>
        {(aside || explain) && (
          <aside className="text-sm leading-relaxed text-muted">
            {explain && (
              <div className="rounded-lg border border-line bg-bg/40 p-3">
                <p className="mb-1 text-xs tracking-wide text-gold uppercase">In plain English</p>
                {explain}
              </div>
            )}
            {aside}
          </aside>
        )}
      </div>
    </section>
  );
}

export function DataTable({
  rows,
  columns,
  visible,
  caption,
  max = 500,
}: {
  rows: Record<string, unknown>[];
  columns: string[];
  visible: boolean;
  caption: string;
  max?: number;
}) {
  return (
    <div className={visible ? "max-h-[420px] overflow-auto rounded border border-line" : "sr-only"}>
      <table className="w-full text-left text-xs">
        <caption className="sr-only">{caption} (data table)</caption>
        <thead className="sticky top-0 bg-surface">
          <tr>
            {columns.map((c) => (
              <th key={c} scope="col" className="px-2 py-1.5 font-medium text-muted">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, max).map((r, i) => (
            <tr key={i} className="border-t border-line">
              {columns.map((c) => (
                <td key={c} className="px-2 py-1 tabular-nums">
                  {fmtCell(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > max && (
        <p className="p-2 text-xs text-muted">
          Showing {max} of {rows.length} rows; export CSV for all.
        </p>
      )}
    </div>
  );
}

function fmtCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(3);
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}
