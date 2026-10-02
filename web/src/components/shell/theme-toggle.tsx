"use client";

import { useEffect, useRef, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

function readEffectiveTheme(): Theme {
  const explicit = document.documentElement.getAttribute("data-theme");
  if (explicit === "light" || explicit === "dark") return explicit;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

// Minimal typing for the View Transitions API (not in TS's DOM lib yet).
type ViewTransition = { ready: Promise<void> };
type DocumentWithViewTransitions = Document & { startViewTransition?: (cb: () => void) => ViewTransition };

export function ThemeToggle() {
  // Unknown until mount: guessing on the server would mismatch hydration.
  const [theme, setTheme] = useState<Theme | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setTheme(readEffectiveTheme()));
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onSystemChange = () => {
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
