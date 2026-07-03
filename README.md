# frontek reads — client-side RSS/Atom reader

`feeds.frontek.dev` — un lettore di feed RSS/Atom **completamente statico**.
L'utente cerca i siti che preferisce, si "iscrive", e nella home vede gli ultimi
articoli aggregati. **Nessun backend, nessun account, zero storage lato server**:
iscrizioni, impostazioni e una piccola cache degli articoli vivono nel
`localStorage` del browser dell'utente.

## Come funziona (senza server)

- **Iscrizioni** → `localStorage` (`frss.subs`). Sono dati dell'utente: si possono
  esportare/importare in **OPML** o **JSON** per backup e portabilità.
- **Cache articoli** → `localStorage` (`frss.cache`), max 20 articoli per feed,
  TTL 15 min. Serve solo a velocizzare; si può svuotare dalle impostazioni.
- **Lettura dei feed** → il browser non può leggere i feed di altri domini per via
  della **CORS**. Le richieste passano quindi per un **proxy stateless** che gira
  sullo stesso server (Node, dietro nginx): riceve solo l'URL del feed, lo scarica
  e lo restituisce con gli header CORS. **Non salva nulla** — è puro forwarding.

  Proxy di default: `/proxy?url={url}` (same-origin, il nostro servizio Node).
  Fallback automatici se il servizio è giù: `api.allorigins.win`, `api.codetabs.com`.

  Il proxy è configurabile nelle impostazioni con placeholder `{url}`.

### Il proxy CORS (`proxy/`)

`proxy/server.js` è un mini-server Node (~90 righe, nessuna dipendenza) che espone
`GET /proxy?url=<feed>`. Caratteristiche:

- **Stateless**: nessuno storage, nessun log dei contenuti.
- **Guard SSRF**: accetta solo `http(s)`, blocca `localhost`/IP privati/`169.254.x`
  (metadata cloud), cap 5 MB per risposta, timeout 15 s.
- Gira in ascolto su `127.0.0.1:8787`; nginx lo espone su `…/proxy`.
- Girato come servizio **systemd** (`proxy/frontek-reads-proxy.service`) con
  `DynamicUser=yes` e sandboxing (`ProtectSystem=strict`, `NoNewPrivileges`, ecc.).

Perché self-hosted invece dei proxy pubblici gratuiti? Perché quelli sono
inaffidabili: durante lo sviluppo allorigins andava in timeout e corsproxy.io ha
iniziato a bloccare l'uso gratuito. Il proxy interno è affidabile, privato e —
essendo solo forwarding — **non consuma spazio di archiviazione**.

## Struttura

```
feeds.frontek.dev/
├── index.html            # UI: Home (feed aggregato) + Discover (ricerca/iscrizioni)
├── css/style.css         # stile brand, responsive
├── js/app.js             # tutta la logica (storage, fetch, parsing, ricerca, OPML)
├── robots.txt
├── sitemap.xml
└── assets/
    ├── favicon.svg
    ├── og-image.svg      # anteprima social 1200x630
    └── catalog.json      # catalogo curato di feed ricercabili
```

## Funzioni

- **Discover**: ricerca sul catalogo curato (`assets/catalog.json`) per nome/
  categoria/sito, oppure **incolla un URL qualsiasi**: l'app riconosce se è già un
  feed, altrimenti fa auto-discovery (`<link rel="alternate">` nella pagina, poi
  prova i percorsi comuni `/feed`, `/rss`, `/atom.xml`, …).
- **Home**: articoli di tutte le iscrizioni, ordinati per data, con filtro per fonte.
- **Reader interno (ibrido)**: cliccando un articolo si apre un pannello lettura
  *dentro il sito* (non si esce verso l'esterno). Mostra subito il contenuto del
  feed; il pulsante **«Leggi articolo intero»** scarica la pagina originale via il
  proxy ed estrae il testo leggibile (readability-lite). `Ctrl/Cmd+click` sul
  titolo apre comunque l'originale in una nuova scheda, e c'è sempre il link
  «Apri originale ↗». Il contenuto (feed o pagina) viene **sanificato** con una
  allowlist prima di essere mostrato → niente `script`, `iframe`, `on*`,
  `javascript:` (protezione XSS, testata).
- **Sicurezza**: i contenuti dei feed (non fidati) vengono inseriti con
  `textContent`/DOM, mai come `innerHTML` → niente XSS dai feed.
- **Privacy**: nessun account, nessun tracciamento; i dati restano nel browser.

## Aggiornare il catalogo

Aggiungi voci a `assets/catalog.json`:
```json
{ "title": "Nome", "site": "https://sito", "feed": "https://sito/feed", "category": "Tech" }
```

## Deploy

Statico. Script pronto (`~/deploy_feeds.sh`, modellato su `deploy_about-me.sh`):
```bash
sudo bash ~/deploy_feeds.sh
```
Crea la web root `/var/www/feeds.frontek.dev`, scrive il vhost nginx, ricarica e
richiede il certificato TLS. Assicurati che il DNS di `feeds.frontek.dev` punti al
server prima di lanciare certbot.

## Provarlo in locale

```bash
cd feeds.frontek.dev
python3 -m http.server 8080
# apri http://localhost:8080
```
(Serve un server HTTP vero — non aprire come `file://` — perché il catalogo viene
caricato via `fetch`.)

## Note

- Cambio dominio in un colpo solo:
  `sed -i 's#https://feeds\.frontek\.dev#https://NUOVO#g' index.html robots.txt sitemap.xml`
- OG image in SVG: vedi nota nel README della home per esportarla in PNG.
