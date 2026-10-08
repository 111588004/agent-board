// Board themes. "brand" (the default) uses the Agent Board logo palette; "classic" is the original orange look
// (study/brand/v3/final/GUIDELINES.md): ink #0f1a24 and teal #0b6e8a (#4fc0dc on dark).
// Colours are CSS variables on <html>, so App, Tour and the Guide page all follow. The agent colours
// (e.g. the orange "Claude Code" chip) identify agents, not the brand, and stay the same in every theme.
import { readStore, writeStore } from "./Tour.jsx";

export const THEMES = {
  classic: {
    label: "Classic",
    favicon: "/favicon.svg",
    vars: { "--ab-chrome": "#181B21", "--ab-menu": "#22262F", "--ab-accent": "#D97757", "--ab-accent-on-dark": "#D97757" },
  },
  brand: {
    label: "Brand",
    favicon: "/favicon-brand.svg",
    vars: { "--ab-chrome": "#0f1a24", "--ab-menu": "#1a2733", "--ab-accent": "#0b6e8a", "--ab-accent-on-dark": "#4fc0dc" },
  },
};

const KEY = "agent-board-theme";

export function readTheme() {
  const q = new URLSearchParams(window.location.search).get("theme");
  const name = q || readStore(KEY);
  return THEMES[name] ? name : "brand";
}

export function applyTheme(name, persist = false) {
  const theme = THEMES[name] || THEMES.brand;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(theme.vars)) root.style.setProperty(k, v);
  root.dataset.boardTheme = name;
  const icon = document.querySelector('link[rel="icon"]');
  if (icon) icon.href = theme.favicon;
  if (persist) writeStore(KEY, name);
}

// The logo mark (two boards forming ">_"), colours for dark backgrounds.
export function BrandMark({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" aria-hidden="true">
      <g transform="scale(0.68)">
        <path fill="#FFFFFF" d="M70.5 51.41L202.5 127.62A22 22 0 0 1 213.5 146.68L213.5 183.87A22 22 0 0 1 180.5 202.92L48.5 126.71A22 22 0 0 1 37.5 107.66L37.5 70.47A22 22 0 0 1 70.5 51.41Z" />
        <path fill="#4fc0dc" d="M48.5 229.24L117.29 189.52A12 12 0 0 1 129.29 189.52L181.5 219.66A12 12 0 0 1 181.5 240.45L70.5 304.53A22 22 0 0 1 37.5 285.48L37.5 248.29A22 22 0 0 1 48.5 229.24Z" />
        <path fill="#4fc0dc" d="M251.5 267.59L319.5 267.59A18 18 0 0 1 337.5 285.59L337.5 305.59A18 18 0 0 1 319.5 323.59L251.5 323.59A18 18 0 0 1 233.5 305.59L233.5 285.59A18 18 0 0 1 251.5 267.59Z" />
      </g>
    </svg>
  );
}
