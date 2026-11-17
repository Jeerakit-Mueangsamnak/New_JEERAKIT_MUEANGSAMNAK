import type { Config } from "tailwindcss";

// Slate greys come from CSS variables (app/globals.css): light mode keeps Tailwind's own slate; dark mode
// swaps them for the near-black neutral greys of the owner's reference screen (owner 2026-11-16).
const SLATE_SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
const slate = Object.fromEntries(SLATE_SHADES.map((s) => [s, `rgb(var(--slate-${s}) / <alpha-value>)`]));

const config: Config = {
  darkMode: 'class',
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    // Most screens live under features/ — without it their utility classes are never generated
    "./features/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        slate,
        background: "var(--background)",
        foreground: "var(--foreground)",
        surface: "var(--surface)",
        "surface-raised": "var(--surface-raised)",
        border: "var(--border)",
        muted: "var(--muted)",
        primary: "var(--primary)",
        "primary-strong": "var(--primary-strong)",
      },
    },
  },
  plugins: [],
};
export default config;
