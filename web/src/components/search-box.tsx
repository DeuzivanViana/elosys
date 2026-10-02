"use client";

import { useShell } from "./shell/shell-context";

export function SearchBox() {
  const { setPaletteOpen } = useShell();

  return (
    <button
      type="button"
      onClick={() => setPaletteOpen(true)}
      className="input w-full max-w-xl cursor-text text-left"
    >
      <span className="mono" style={{ color: "var(--muted-2)" }}>⌕</span>
      <span style={{ color: "var(--muted-2)" }}>buscar por nome ou CPF…</span>
      <span className="input__kbd ml-auto">Ctrl K</span>
    </button>
  );
}
