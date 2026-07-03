# frontek reads

A minimal, **client‑side RSS/Atom reader**. Search and subscribe to the sites you
like, and read their latest articles in one aggregated feed — right inside the app.

**No accounts. No server storage. No tracking.** Your subscriptions, a small article
cache and your settings all live in your browser's `localStorage`. Nothing about you
is stored anywhere else.

It's a static site: plain HTML, CSS and vanilla JavaScript — no build step, no
framework, no runtime dependencies.

## Features

- **Discover** — search a curated catalog of well‑known feeds by name, category or
  site, **or paste any site / feed URL**. If you paste a page instead of a feed, the
  app auto‑discovers the feed (`<link rel="alternate">`, then common paths like
  `/feed`, `/rss`, `/atom.xml`, …).
- **Aggregated home** — the latest articles from every subscription, newest first,
  with a per‑source filter.
- **In‑site reader (hybrid)** — click an article to read it *inside the app* instead
  of leaving. It shows the feed's content immediately; if the feed only ships an
  excerpt, it tries to fetch and extract the **full article** (readability‑style)
  from the original page. `Ctrl/Cmd+click` a title still opens the original in a new
  tab, and there's always an "open original" link.
- **Clean content** — boilerplate is stripped: "continue reading" links, related /
  share boxes, newsletter widgets and affiliate/tracking links.
- **XSS‑safe** — all feed and page HTML is run through an allow‑list sanitizer before
  display (no `script`, `iframe`, `on*` handlers or `javascript:` URLs).
- **Own your data** — export / import your subscriptions as **OPML** or **JSON** for
  backup and portability.

## How it works

Everything runs in the browser. Data is kept under three `localStorage` keys:

| Key             | Contents                                                   |
| --------------- | ---------------------------------------------------------- |
| `frss.subs`     | your subscriptions `[{ title, feed, site }]`               |
| `frss.settings` | your settings (currently the CORS proxy template)          |
| `frss.cache`    | a small article cache (≤ 20 items/feed, 15‑min TTL)        |

### The CORS proxy

Browsers can't `fetch` most third‑party feeds directly — the sites don't send CORS
headers. So feed requests go through a **CORS proxy**: a service that fetches the feed
URL and re‑serves it with permissive CORS headers. The proxy only ever sees the feed
URL being requested.

The proxy is configurable in **Settings**, using `{url}` as the placeholder for the
(encoded) feed address. Out of the box the app is set up for a **same‑origin proxy**
at `/proxy?url={url}` and automatically falls back to public proxies if that isn't
present:

```
Default : /proxy?url={url}                      (a proxy you host next to the app)
Fallback: https://api.allorigins.win/raw?url={url}
Fallback: https://api.codetabs.com/v1/proxy/?quest={url}
```

You have two options:

- **Just use a public proxy** — open Settings and set the proxy to a public one such as
  `https://api.allorigins.win/raw?url={url}`. Zero infrastructure, but public proxies
  can be slow or intermittently unavailable.
- **Host your own** (recommended for reliability & privacy) — run any tiny stateless
  service that accepts `GET /proxy?url=<encoded>` and streams the target back with an
  `Access-Control-Allow-Origin: *` header, then point Settings at it. A ~90‑line
  Node/Deno/Worker script is enough; keep it behind the same origin as the app so no
  external service is involved at all.

> Note: some sites (paywalls, anti‑bot protection) return `403` to any server‑side
> fetch. For those the reader shows the cleaned feed excerpt plus an "open original"
> link — full extraction isn't possible without a real browser.

## Project layout

```
.
├── index.html            # the whole UI (Home + Discover + reader + settings)
├── css/style.css         # styles, responsive, self‑contained
├── js/app.js             # all logic: storage, fetch, parse, sanitize, reader, OPML
├── robots.txt
├── sitemap.xml
└── assets/
    ├── favicon.svg
    ├── og-image.svg      # social preview (1200×630)
    └── catalog.json      # the curated, searchable feed directory
```

## Run it locally

It's fully static, but it must be served over HTTP (not opened as a `file://`), because
the catalog is loaded via `fetch`:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

Locally there is no same‑origin `/proxy`, so feed fetching uses the public fallback
proxies automatically.

## Customize

- **Add feeds to the catalog** — edit `assets/catalog.json`:
  ```json
  { "title": "Example", "site": "https://example.com", "feed": "https://example.com/feed", "category": "Tech" }
  ```
- **Colors** — tweak the CSS custom properties in the `:root` block of `css/style.css`.

## License

No license yet — all rights reserved. If you'd like to reuse this, please get in touch.
