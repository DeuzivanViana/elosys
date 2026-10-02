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

export function PageHeader({ group, current, actions }: PageHeaderState) {
  const { setHeader } = useShell();
  useEffect(() => {
    setHeader({ group, current, actions });
  }, [group, current, actions, setHeader]);
  return null;
}
