/** CSV + PNG export helpers. */

export function toCSV(rows: Record<string, unknown>[], columns?: string[]): string {
  if (!rows.length) return "";
  const cols = columns ?? Object.keys(rows[0]);
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = Array.isArray(v) ? v.join("; ") : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

export function download(filename: string, content: Blob | string, type = "text/csv;charset=utf-8") {
  const blob = typeof content === "string" ? new Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCSV(filename: string, rows: Record<string, unknown>[], columns?: string[]) {
  download(filename, toCSV(rows, columns));
}

/** Rasterise the first <svg> (or a <canvas>) inside `el` to PNG at 2x. */
export async function exportPNG(el: HTMLElement, filename: string) {
  const bg = getComputedStyle(document.body).backgroundColor;
  const canvasEl = el.querySelector("canvas");
  const svg = el.querySelector("svg");
  let out: HTMLCanvasElement;
  if (svg) {
    const rect = svg.getBoundingClientRect();
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(rect.width));
    clone.setAttribute("height", String(rect.height));
    // inline computed colours so CSS variables survive rasterisation
    const style = getComputedStyle(svg);
    clone.style.color = style.color;
    clone.style.fontFamily = style.fontFamily;
    const xml = new XMLSerializer()
      .serializeToString(clone)
      .replace(/var\(--([a-z0-9-]+)\)/g, (_, v) => getComputedStyle(document.documentElement).getPropertyValue(`--${v}`).trim());
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
    await img.decode();
    out = document.createElement("canvas");
    out.width = rect.width * 2;
    out.height = rect.height * 2;
    const ctx = out.getContext("2d")!;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0, rect.width, rect.height);
  } else if (canvasEl) {
    out = document.createElement("canvas");
    out.width = canvasEl.width;
    out.height = canvasEl.height;
    const ctx = out.getContext("2d")!;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, out.width, out.height);
    el.querySelectorAll("canvas").forEach((c) => ctx.drawImage(c, 0, 0, out.width, out.height));
  } else return;
  const blob: Blob = await new Promise((res) => out.toBlob((b) => res(b!), "image/png"));
  download(filename, blob, "image/png");
}
