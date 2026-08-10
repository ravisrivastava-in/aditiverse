# AditiVerse

A mobile-first, pastel-themed photo gallery front end.

- **Backend: one Worker, one domain.** `api.aditiverse.in` handles both the
  management API (list/upload/rename/move/delete) *and* public file serving —
  see `aditiverse-api-worker.js`. This replaces the earlier two-Worker setup
  (`cdn-uploader.rsoftinnovations.workers.dev` for the API +
  `gallary.aditiverse.in` for public files) — **retire that Custom Domain
  binding once `api.aditiverse.in` is live.**
- Storage: GitHub repo [`aditiravisrivastava/Gallery`](https://github.com/aditiravisrivastava/Gallery), folder `gallary` (internal only — not part of any public URL)
- Auth: dedicated Firebase project `aditiverse-gallary`
- Logo: `https://cdn.futeducation.com/uploads/assets/mis/logo.webp` (already includes the "AditiVerse" wordmark — the app never draws a duplicate text label next to it)

## Files
- `index.html` — app shell (login + gallery, single page)
- `style.css` — pastel design system (pink / yellow / green / white, "verse ring" signature motif)
- `app.js` — Firebase auth + backend API integration + all UI logic
- `aditiverse-api-worker.js` — the backend Worker: management API routes
  (`/list`, `/upload`, `/delete`, `/rename`, `/move`, `/copy`,
  `/folder/*`, `/download`) **plus** a GET/HEAD fallback that serves any
  other path as a public file (e.g. `api.aditiverse.in/Travel/photo.jpg`),
  inline and edge-cached — the merged replacement for the old separate
  router Worker.

## Features implemented against your real backend
- Sign in (Firebase email/password)
- Home grid (3-column, lazy-loaded), filter chips (Photos/Videos/Files), album (folder) browsing with breadcrumb
- Full-screen swipeable viewer with Share / Download / Info / Delete
- Photo detail bottom sheet: size, folder, CDN URL + copy, Download, Share, Move to Album, Rename, Delete
- Albums grid (from real folders), "New Album" (`/folder/create`)
- Search & Filters: text search, type, size range, album scope, sort
- Storage overview: real totals computed from `/list`, broken down by Photos/Videos/Other
- Upload sheet: multi-file picker + drag & drop, per-file progress bar (`/upload`)
- Long-press multi-select → Share / Download / Move / Delete (`/delete-batch`, `/move`)
- Favorites (heart icon) — stored locally per browser

## Honest limitations (matched to what the backend actually supports)
- **No upload timestamps** in `/list`, so Home is a sorted flat grid rather than
  fake "August 2026 / July 2026" sections built from invented dates.
- **No share-link/password/expiry backend** — Share copies the direct CDN
  link(s) or opens the device share sheet, instead of a non-functional
  password/expiry toggle.
- **No soft-delete/trash** — Delete is permanent and always asks for
  confirmation; there's no fake "restore within 30 days."
- **Favorites are local-only** (localStorage), since there's no favorite
  column in the backend today. Add one server-side if you want it to sync
  across devices.

## Deploy

**Frontend** — `index.html`, `style.css`, `app.js` are static, drop them into
any static host (e.g. Cloudflare Pages). No build step.

**Backend** — `aditiverse-api-worker.js` is its own, dedicated Worker
(separate from `cdn-uploader.rsoftinnovations.workers.dev` — no shared
state, no shared token):

1. Create a new Worker in the Cloudflare dashboard, paste in
   `aditiverse-api-worker.js` (a fresh Worker's default "Hello World!"
   template code needs to be replaced — it doesn't run your file automatically).
2. Set its environment variables: `GITHUB_TOKEN` (a token with
   `contents:write` on `aditiravisrivastava/Gallery`), and optionally
   `GITHUB_OWNER` / `GITHUB_REPO` / `GITHUB_BRANCH` / `UPLOAD_PATH` if you
   ever want to point it elsewhere — the defaults already match this repo.
3. Bind it to the **Custom Domain** `api.aditiverse.in`: add `aditiverse.in`
   as a zone on this Cloudflare account if it isn't already (nameservers
   pointed at Cloudflare), then on the Worker go to **Settings → Domains &
   Routes → Add → Custom Domain → `api.aditiverse.in`**. Cloudflare creates
   the DNS record and TLS cert automatically.
4. Once `api.aditiverse.in` is confirmed working (`/debug` should return
   your repo config), remove the **Custom Domain** binding for
   `gallary.aditiverse.in` on the old router Worker — it's no longer used.