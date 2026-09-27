"use client";

import { useEffect, useRef, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

function readEffectiveTheme(): Theme {
  const explicit = document.documentElement.getAttribute("data-theme");
  if (explicit === "light" || explicit === "dark") return explicit;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

// Minimal typing for the bits of the View Transitions API this uses — not
// yet in TS's built-in DOM lib.
type ViewTransition = { ready: Promise<void> };
type DocumentWithViewTransitions = Document & { startViewTransition?: (cb: () => void) => ViewTransition };

/** Defaults to the device's own preference (globals.css handles that part
 * with a plain `@media` query, no JS needed) — this only comes into play
 * once someone picks an explicit theme, which then overrides the device
 * default via `data-theme` + localStorage (see layout.tsx's no-flash
 * script for how that's applied before hydration on future loads).
 *
 * The switch itself animates with the View Transitions API: a circle grows
 * from the button out to cover the screen, revealing the new theme —
 * browsers without support (older Safari/Firefox) just flip instantly,
 * same as before. */
export function ThemeToggle() {
  // Unknown until mount: the server can't know the device's preference, so
  // rendering a guess here would mismatch hydration. The button is inert
  // for one frame, then reflects reality.
  const [theme, setTheme] = useState<Theme | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setTheme(readEffectiveTheme()));
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onSystemChange = () => {
      // Only follow the device if the user never overrode it explicitly.
      if (!localStorage.getItem("theme")) setTheme(readEffectiveTheme());
    };
    mq.addEventListener("change", onSystemChange);
    return () => {
      cancelAnimationFrame(raf);
      mq.removeEventListener("change", onSystemChange);
    };
  }, []);

  function apply(next: Theme) {
    localStorage.setItem("theme", next);
    document.documentElement.setAttribute("data-theme", next);
    setTheme(next);
  }

  function toggle() {
    const next: Theme = theme === "light" ? "dark" : "light";
    const doc = document as DocumentWithViewTransitions;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!doc.startViewTransition || reduceMotion) {
      apply(next);
      return;
    }

    // Grow the circle from the button's own center, out to whichever
    // corner is farthest — that's always enough radius to cover the
    // viewport no matter where the toggle sits.
    const rect = btnRef.current?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const y = rect ? rect.top + rect.height / 2 : 0;
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );

    const transition = doc.startViewTransition(() => apply(next));
    transition.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`] },
        { duration: 650, easing: "cubic-bezier(0.65, 0, 0.35, 1)", pseudoElement: "::view-transition-new(root)" }
      );
    });
  }

  return (
    <button
      ref={btnRef}
      type="button"
      className="btn btn--icon"
      onClick={toggle}
      disabled={theme === null}
      aria-label={theme === "light" ? "mudar para tema escuro" : "mudar para tema claro"}
      title={theme === "light" ? "tema escuro" : "tema claro"}
    >
      {theme === "light" ? <Moon size={14} /> : <Sun size={14} />}
    </button>
  );
}
