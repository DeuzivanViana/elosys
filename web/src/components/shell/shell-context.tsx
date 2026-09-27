"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type PageHeaderState = {
  group: string;
  current: string;
  actions?: ReactNode;
};

type Ctx = {
  header: PageHeaderState;
  setHeader: (h: PageHeaderState) => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  /** "modo análise de fonte" — toggled from the navbar's "fonte" button.
   * While on, any <SourceZone> highlights on hover and a click opens its
   * provenance popup instead of the zone's normal behavior (link/button).
   * Off by default so the app behaves normally. */
  analysisMode: boolean;
  setAnalysisMode: (on: boolean) => void;
};

const DEFAULT_HEADER: PageHeaderState = { group: "EloSys", current: "" };

const ShellCtx = createContext<Ctx | null>(null);

export function ShellProvider({ children }: { children: ReactNode }) {
  const [header, setHeader] = useState<PageHeaderState>(DEFAULT_HEADER);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [analysisMode, setAnalysisMode] = useState(false);

  return (
    <ShellCtx.Provider value={{ header, setHeader, paletteOpen, setPaletteOpen, analysisMode, setAnalysisMode }}>
      {children}
    </ShellCtx.Provider>
  );
}

export function useShell(): Ctx {
  const ctx = useContext(ShellCtx);
  if (!ctx) throw new Error("useShell must be used inside <ShellProvider>");
  return ctx;
}

/**
 * Server Components render this to feed the topbar breadcrumb/actions
 * without themselves becoming Client Components — it's a small client
 * island that just pushes its props into ShellCtx on mount/update.
 */
export function PageHeader({ group, current, actions }: PageHeaderState) {
  const { setHeader } = useShell();
  useEffect(() => {
    setHeader({ group, current, actions });
  }, [group, current, actions, setHeader]);
  return null;
}
