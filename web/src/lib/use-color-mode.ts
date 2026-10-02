"use client";

import { useEffect, useState } from "react";


export type ColorMode = "light" | "dark";

function resolve(): ColorMode {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function useColorMode(): ColorMode {
  const [mode, setMode] = useState<ColorMode>("dark");

  useEffect(() => {
    const raf = requestAnimationFrame(() => setMode(resolve()));
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => setMode(resolve());
    mq.addEventListener("change", onChange);
    const mo = new MutationObserver(onChange);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      cancelAnimationFrame(raf);
      mq.removeEventListener("change", onChange);
      mo.disconnect();
    };
  }, []);

  return mode;
}
