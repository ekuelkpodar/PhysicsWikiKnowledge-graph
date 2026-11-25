import clsx from "clsx";
import { useState, type ButtonHTMLAttributes, type ReactNode, type Ref } from "react";
import { initials, thumbUrl } from "../lib/format";

export function Button({
  className,
  variant = "ghost",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "ghost" | "solid" | "outline"; ref?: Ref<HTMLButtonElement> }) {
  return (
    <button
      type="button"
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors disabled:opacity-40",
        variant === "ghost" && "text-muted hover:bg-surface-2 hover:text-text",
        variant === "outline" && "border border-line text-text hover:bg-surface-2",
        variant === "solid" && "bg-gold font-medium text-bg hover:brightness-110",
        className,
      )}
      {...props}
    />
  );
}

export function Chip({
  children,
  tone = "default",
  className,
}: {
  children: ReactNode;
  tone?: "default" | "gold" | "cyan" | "danger";
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs whitespace-nowrap",
        tone === "default" && "border-line text-muted",
        tone === "gold" && "border-gold/40 text-gold",
        tone === "cyan" && "border-cyan/40 text-cyan",
        tone === "danger" && "border-danger/40 text-danger",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("skeleton", className)} aria-hidden />;
}

export function LoadingBlock({ label = "Loading", rows = 4 }: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3 p-2">
      <span className="sr-only">{label}…</span>
      <Skeleton className="h-6 w-1/3" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-4" />
      ))}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <p className="font-display text-lg">{title}</p>
      {children && <p className="max-w-sm text-sm text-muted">{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error }: { error: Error }) {
  return (
    <EmptyState title="Couldn't load this data">
      {error.message}. Try reloading; if you are running locally, run <code>make web</code> first.
    </EmptyState>
  );
}

export function Avatar({ name, img, size = 40, gold }: { name: string; img?: string; size?: number; gold?: boolean }) {
  const [failed, setFailed] = useState(false);
  const ring = gold ? "ring-2 ring-gold" : "ring-1 ring-line";
  if (img && !failed) {
    return (
      <img
        src={thumbUrl(img, size * 2)}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        onError={() => setFailed(true)}
        className={clsx("shrink-0 rounded-full bg-surface-2 object-cover", ring)}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={clsx("inline-flex shrink-0 items-center justify-center rounded-full bg-surface-2 font-display text-muted", ring)}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials(name)}
    </span>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: "gold" | "cyan" }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="text-xs tracking-wide text-muted uppercase">{label}</div>
      <div className={clsx("mt-1 font-display text-3xl", tone === "gold" && "text-gold", tone === "cyan" && "text-cyan")}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function PageHeader({ kicker, title, children }: { kicker?: string; title: string; children?: ReactNode }) {
  return (
    <header className="mb-6 max-w-3xl">
      {kicker && <p className="mb-1 text-xs tracking-[0.18em] text-gold uppercase">{kicker}</p>}
      <h1 className="font-display text-3xl leading-tight md:text-4xl">{title}</h1>
      {children && <div className="mt-3 text-muted">{children}</div>}
    </header>
  );
}

/* --- icons (inline, 1.5px stroke) --- */
type IconProps = { className?: string };
const S = (d: ReactNode) =>
  function Icon({ className }: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={clsx("h-4 w-4", className)}
        aria-hidden
      >
        {d}
      </svg>
    );
  };
export const IconSearch = S(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </>,
);
export const IconSun = S(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </>,
);
export const IconMoon = S(<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" />);
export const IconFilter = S(<path d="M4 5h16M7 12h10M10 19h4" />);
export const IconPlay = S(<path d="M7 5v14l12-7Z" />);
export const IconPause = S(<path d="M8 5v14M16 5v14" />);
export const IconX = S(<path d="M6 6l12 12M18 6 6 18" />);
export const IconExternal = S(
  <>
    <path d="M14 4h6v6M20 4l-9 9" />
    <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </>,
);
export const IconDownload = S(<path d="M12 4v11M7 10l5 5 5-5M5 20h14" />);
export const IconTable = S(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 10h18M9 10v10" />
  </>,
);
export const IconGithub = S(
  <path d="M9 19c-4 1.5-4-2-6-2.5m12 5v-3.4a3 3 0 0 0-.9-2.3c3-.3 6.1-1.5 6.1-6.6a5.2 5.2 0 0 0-1.4-3.6 4.8 4.8 0 0 0-.1-3.6s-1.1-.3-3.7 1.4a12.7 12.7 0 0 0-6.6 0C5.8 1.6 4.7 1.9 4.7 1.9a4.8 4.8 0 0 0-.1 3.6A5.2 5.2 0 0 0 3.2 9.1c0 5.1 3.1 6.3 6.1 6.6a3 3 0 0 0-.9 2.3V22" />,
);
export const IconChevron = S(<path d="m9 6 6 6-6 6" />);
export const IconCopy = S(
  <>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
  </>,
);
export const IconMenu = S(<path d="M4 7h16M4 12h16M4 17h16" />);
