import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/shell/app-shell";
import { getSidebarCounts } from "@/lib/stats";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "EloSys — busca de candidatos",
  description:
    "Cruzamento de dados públicos de políticos brasileiros por CPF/CNPJ. Indício, não prova — todo campo aponta para a fonte oficial de onde saiu.",
};

// Runs before hydration, so an explicit saved choice applies with zero
// flash. No saved choice = no attribute set = globals.css's own
// `@media (prefers-color-scheme: light)` renders the right theme on the
// very first paint, no JS required at all — this script only has anything
// to do once the user has actually picked a theme via <ThemeToggle>.
const THEME_INIT_SCRIPT = `
try {
  var t = localStorage.getItem("theme");
  if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
} catch (e) {}
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  const counts = getSidebarCounts();

  return (
    <html
      lang="pt-BR"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full bg-background text-foreground font-sans">
        <AppShell counts={counts}>{children}</AppShell>
      </body>
    </html>
  );
}
