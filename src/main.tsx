import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { APP_VERSION, APP_BUILD_TIME, APP_CACHE_ID } from "@/lib/app-version";

// ── Expose build version globally (for diagnostics & cache-busting) ──
(window as unknown as Record<string, unknown>).APP_VERSION = APP_VERSION;
(window as unknown as Record<string, unknown>).APP_BUILD_TIME = APP_BUILD_TIME;
(window as unknown as Record<string, unknown>).APP_CACHE_ID = APP_CACHE_ID;

// ── Boot-time version guard: if localStorage version differs from the
// build that's actually loaded, purge caches once and hard-reload. This
// catches devices where the SW prompt path failed (e.g., SW never
// registered, or the user dismissed prompts repeatedly).
(() => {
  try {
    const STORAGE_KEY = "data360-loaded-version";
    const RELOAD_GUARD = "data360-boot-reload";
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && stored !== APP_VERSION) {
      const alreadyReloaded = sessionStorage.getItem(RELOAD_GUARD) === APP_VERSION;
      if (!alreadyReloaded) {
        sessionStorage.setItem(RELOAD_GUARD, APP_VERSION);
        if ("caches" in window) {
          caches.keys().then((names) => {
            Promise.all(
              names
                .filter((n) => !n.includes(APP_CACHE_ID))
                .map((n) => caches.delete(n)),
            ).finally(() => {
              localStorage.setItem(STORAGE_KEY, APP_VERSION);
              const url = new URL(window.location.href);
              url.searchParams.set("__data360_v", APP_VERSION);
              window.location.replace(url.toString());
            });
          });
          return;
        }
      }
    }
    localStorage.setItem(STORAGE_KEY, APP_VERSION);
  } catch {
    // Storage unavailable — safe to ignore
  }
})();

// ── PWA iframe / preview guard ──────────────────────────────────
// Prevent service workers from registering inside Lovable editor iframes
// or preview hosts, which causes stale cache issues during development.
const isInIframe = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true; // cross-origin = iframe
  }
})();

const isPreviewHost =
  window.location.hostname.includes("id-preview--") ||
  window.location.hostname.includes("lovableproject.com");

if (isPreviewHost || isInIframe) {
  navigator.serviceWorker?.getRegistrations().then((registrations) => {
    registrations.forEach((r) => r.unregister());
  });
}

createRoot(document.getElementById("root")!).render(<App />);
