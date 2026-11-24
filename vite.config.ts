import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

const buildTime = new Date().toISOString();
const buildStamp = Date.parse(buildTime).toString(36);
const appVersion =
  process.env.VITE_APP_VERSION ||
  `${process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || 'local'}-${buildStamp}`;
const appCacheId = `data360-${appVersion.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
const swCleanupFile = `sw-cache-cleanup-${appVersion.replace(/[^a-zA-Z0-9_-]/g, '-')}.js`;

const versionFilePlugin = (): PluginOption => ({
  name: "data360-version-file",
  generateBundle() {
    const cleanupScript = `const DATA360_ACTIVE_CACHE_ID=${JSON.stringify(appCacheId)};self.addEventListener('install',(event)=>{event.waitUntil(self.skipWaiting());});self.addEventListener('activate',(event)=>{event.waitUntil((async()=>{await self.clients.claim();const names=await caches.keys();await Promise.all(names.map((name)=>{const data360Cache=name.includes('data360')||name==='html-cache'||name==='static-assets'||name==='image-cache'||name.startsWith('workbox-');const current=name.includes(DATA360_ACTIVE_CACHE_ID);return data360Cache&&!current?caches.delete(name):Promise.resolve(false);}));})());});`;
    this.emitFile({
      type: "asset",
      fileName: "version.json",
      source: JSON.stringify({ version: appVersion, buildTime, cacheId: appCacheId }, null, 2),
    });
    this.emitFile({
      type: "asset",
      fileName: swCleanupFile,
      source: cleanupScript,
    });
  },
});

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_BUILD_TIME__: JSON.stringify(buildTime),
    __APP_CACHE_ID__: JSON.stringify(appCacheId),
  },
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    versionFilePlugin(),
    
    VitePWA({
      registerType: "autoUpdate",
      devOptions: {
        enabled: false,
      },
      includeAssets: ["favicon.ico", "favicon.png", "apple-touch-icon.png", "pwa-maskable-192x192.png", "pwa-maskable-512x512.png"],
      workbox: {
        cacheId: appCacheId,
        importScripts: [`/${swCleanupFile}`],
        navigateFallback: undefined,
        navigateFallbackAllowlist: [/^$/],
        navigateFallbackDenylist: [/^\/~oauth/],
        globPatterns: ["**/*.{js,css,ico,png,svg,woff2}"],
        runtimeCaching: [
          {
            // NEVER cache Supabase API / Auth / Realtime / Storage / Functions
            urlPattern: ({ url }) =>
              url.hostname.endsWith('.supabase.co') ||
              url.hostname.endsWith('.supabase.in') ||
              url.hostname.endsWith('.functions.supabase.co'),
            handler: 'NetworkOnly',
            method: 'GET',
          },
          {
            urlPattern: ({ url }) =>
              url.hostname.endsWith('.supabase.co') ||
              url.hostname.endsWith('.supabase.in') ||
              url.hostname.endsWith('.functions.supabase.co'),
            handler: 'NetworkOnly',
            method: 'POST',
          },
          {
            // Network-only for the HTML shell — never serve a stale app shell
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkOnly',
          },
          {
            // Cache-first for hashed JS/CSS assets (immutable, filename-versioned)
            urlPattern: /\.(?:js|css)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: `${appCacheId}-static-assets`,
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
            },
          },
          {
            // Stale-while-revalidate for images
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: `${appCacheId}-image-cache`,
              expiration: {
                maxEntries: 60,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
              },
            },
          },
        ],
        // Activate new SW immediately — critical for Android PWA updates
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
      },
      manifest: {
        name: "DATA360 — Ghana's #1 Data Resale Platform",
        short_name: "DATA360",
        description: "Buy and resell mobile data bundles for MTN, AirtelTigo, and Telecel in Ghana.",
        theme_color: "#2B7DE9",
        background_color: "#f8fafc",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/",
        id: "/",
        categories: ["finance", "utilities"],
        icons: [
          {
            src: "/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/pwa-maskable-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "/pwa-maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
