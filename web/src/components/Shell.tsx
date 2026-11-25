import clsx from "clsx";
import { useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { activeFilterCount } from "../lib/filters";
import { useApp } from "../lib/store";
import { CommandPalette } from "./CommandPalette";
import { FilterDrawer } from "./FilterDrawer";
import { PersonPanel } from "./PersonPanel";
import { TimeSlider } from "./TimeSlider";
import { Button, IconFilter, IconGithub, IconMenu, IconMoon, IconSearch, IconSun, IconX } from "./ui";

export const REPO_URL = (import.meta.env.VITE_REPO_URL as string | undefined) ?? "https://github.com/";

export const ROUTES: { path: string; label: string; ask?: boolean }[] = [
  { path: "/", label: "Story" },
  { path: "/graph", label: "Graph" },
  { path: "/trees", label: "Family trees" },
  { path: "/migration", label: "Migration" },
  { path: "/institutions", label: "Institutions" },
  { path: "/fields", label: "Fields" },
  { path: "/recognition", label: "Recognition" },
  { path: "/missing", label: "Missing links" },
  { path: "/quality", label: "Data quality" },
  { path: "/ask", label: "Ask", ask: true },
  { path: "/about", label: "About" },
];

export function Shell({ children }: { children: ReactNode }) {
  const { theme, toggleTheme, filters, apiUp } = useApp();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const loc = useLocation();
  const nFilters = activeFilterCount(filters);
  const routes = ROUTES.filter((r) => !r.ask || apiUp);
  const fullBleed = loc.pathname === "/graph" || loc.pathname === "/migration";

  return (
    <div className="flex h-full flex-col">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="relative z-30 border-b border-line bg-bg/85 backdrop-blur">
        <div className="flex h-14 items-center gap-3 px-3 md:px-5">
          <NavLink
            to={{ pathname: "/", search: loc.search }}
            className="flex shrink-0 items-center gap-2"
            aria-label="The Physics Family Tree, home"
          >
            <Logo />
            <span className="hidden font-display text-lg leading-none sm:block">
              The Physics <em className="text-gold not-italic">Family Tree</em>
            </span>
          </NavLink>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="ml-auto flex h-9 w-full max-w-xs items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm text-muted hover:text-text"
            aria-label="Search people (Command K)"
            data-testid="search-button"
          >
            <IconSearch />
            <span className="truncate">Search physicists…</span>
            <kbd className="ml-auto hidden rounded border border-line px-1.5 text-[10px] sm:block">⌘K</kbd>
          </button>
          <Button onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
            {theme === "dark" ? <IconSun /> : <IconMoon />}
          </Button>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="hidden rounded-md p-2 text-muted hover:text-text sm:block"
            aria-label="Source on GitHub"
          >
            <IconGithub />
          </a>
          <Button className="lg:hidden" onClick={() => setNavOpen((o) => !o)} aria-expanded={navOpen} aria-label="Menu">
            {navOpen ? <IconX /> : <IconMenu />}
          </Button>
        </div>
        <nav aria-label="Views" className={clsx("border-t border-line px-2 md:px-4 lg:block", navOpen ? "block" : "hidden")}>
          <ul className="flex flex-col gap-0.5 py-1 lg:flex-row lg:flex-wrap">
            {routes.map((r) => (
              <li key={r.path}>
                <NavLink
                  to={{ pathname: r.path, search: stripPerson(loc.search) }}
                  end={r.path === "/"}
                  onClick={() => setNavOpen(false)}
                  className={({ isActive }) =>
                    clsx(
                      "block rounded-md px-3 py-1.5 text-sm transition-colors",
                      isActive ? "bg-surface-2 text-text" : "text-muted hover:text-text",
                    )
                  }
                >
                  {r.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="relative flex items-center gap-3 border-t border-line px-3 pt-1.5 pb-4 md:px-5">
          <TimeSlider />
          <Button
            variant="outline"
            onClick={() => setFiltersOpen((o) => !o)}
            aria-expanded={filtersOpen}
            className={clsx(nFilters > 0 && "border-gold/60 text-gold")}
            data-testid="filters-button"
          >
            <IconFilter /> Filters{nFilters > 0 && ` · ${nFilters}`}
          </Button>
          <FilterDrawer open={filtersOpen} onClose={() => setFiltersOpen(false)} />
        </div>
      </header>
      <main id="main" className={clsx("relative min-h-0 flex-1", fullBleed ? "overflow-hidden" : "overflow-y-auto")}>
        {children}
      </main>
      <PersonPanel />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

function stripPerson(search: string) {
  const p = new URLSearchParams(search);
  p.delete("p");
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={clsx("h-8 w-8", className)} aria-hidden>
      <g stroke="currentColor" strokeWidth="1.4" fill="none" className="text-muted">
        <path d="M16 7v6M16 13l-6 6M16 13l6 6M10 19v5M22 19v5" />
      </g>
      <circle cx="16" cy="7" r="2.8" fill="var(--gold)" />
      <circle cx="10" cy="19" r="2" fill="var(--text)" />
      <circle cx="22" cy="19" r="2" fill="var(--text)" />
      <circle cx="10" cy="25" r="1.6" fill="var(--text)" />
      <circle cx="22" cy="25" r="1.6" fill="var(--gold)" />
    </svg>
  );
}
