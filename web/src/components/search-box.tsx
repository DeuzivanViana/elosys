"use client";

import { useShell } from "./shell/shell-context";

/** The home hero's search field — a trigger, not its own search widget: a
 * click/focus opens the same command palette used everywhere else (Ctrl+K,
 * the sidebar's icon button), instead of duplicating a second inline
 * search/results implementation. */
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
