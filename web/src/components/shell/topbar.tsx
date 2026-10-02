"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useShell } from "./shell-context";
import { CommandPalette, useCommandPaletteShortcut } from "./command-palette";
import { ThemeToggle } from "./theme-toggle";

export function Topbar() {
  const { header, analysisMode, setAnalysisMode } = useShell();
  const pathname = usePathname();
  useCommandPaletteShortcut();

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

function CommandPaletteMount() {
  const { paletteOpen } = useShell();
  return paletteOpen ? <CommandPalette /> : null;
}
