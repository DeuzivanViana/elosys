"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { SidebarCounts } from "@/lib/stats";
import { ShellProvider } from "./shell-context";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

export function AppShell({ counts, children }: { counts: SidebarCounts; children: ReactNode }) {
  return (
    <ShellProvider>
      <div className="shell-layout">
        <Sidebar counts={counts} />
        <div className="shell-main">
          <Topbar />
          <ContentBody>{children}</ContentBody>
        </div>
      </div>
    </ShellProvider>
  );
}

function ContentBody({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname?.startsWith("/grafo")) {
    return <div style={{ height: "calc(100vh - var(--navbar-offset))" }}>{children}</div>;
  }
  return <div className="content__inner">{children}</div>;
}
