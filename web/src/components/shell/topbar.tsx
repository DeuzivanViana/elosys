"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useShell } from "./shell-context";
import { CommandPalette, useCommandPaletteShortcut } from "./command-palette";
import { ThemeToggle } from "./theme-toggle";

/** The top bar left once the logo, search and nav moved into the sidebar:
 * just the current page's breadcrumb, page-specific actions (e.g. the year
 * dropdown), the "fonte" analysis-mode toggle, and the theme toggle. Ctrl+K
 * still opens the command palette from anywhere — its visible trigger now
 * lives in the sidebar. */
export function Topbar() {
  const { header, analysisMode, setAnalysisMode } = useShell();
  const pathname = usePathname();
  useCommandPaletteShortcut();

  // /grafo has its own node/edge popovers already, and its canvas isn't made
  // of <SourceZone>-wrapped blocks -- the toggle would just do nothing there,
  // so it's hidden and forced off instead of leaving a dead button around.
  const analysisAvailable = !pathname.startsWith("/grafo");
  useEffect(() => {
    if (!analysisAvailable && analysisMode) setAnalysisMode(false);
  }, [analysisAvailable, analysisMode, setAnalysisMode]);

  return (
    <div className="navbar-wrap">
      <div
        className="navbar-blur"
        aria-hidden
        style={{ backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" }}
      />
      <div className="navbar">
        <span className="crumb">{header.group}</span>
        {header.current ? (
          <>
            <span className="crumb crumb__sep">/</span>
            <span className="crumb__current">{header.current}</span>
          </>
        ) : null}
        <span style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flex: "none" }}>
          {header.actions}
          {analysisAvailable ? (
            <button
              type="button"
              className={`btn${analysisMode ? " btn--fonte-active" : ""}`}
              onClick={() => setAnalysisMode(!analysisMode)}
              title="Modo análise: passe o mouse sobre um dado para destacá-lo, clique para ver a fonte"
              aria-pressed={analysisMode}
            >
              ◎ fonte
            </button>
          ) : null}
          <ThemeToggle />
        </span>
        <CommandPaletteMount />
      </div>
    </div>
  );
}

// Mounted only while open, so its query/results state resets for free
// instead of needing an effect to clear it on every open.
function CommandPaletteMount() {
  const { paletteOpen } = useShell();
  return paletteOpen ? <CommandPalette /> : null;
}
