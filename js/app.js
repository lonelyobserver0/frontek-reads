/* =========================================================
   frontek reads — client-side RSS/Atom aggregator
   No backend, no accounts: subscriptions, settings and a
   small article cache all live in localStorage. Feeds are
   fetched through a configurable CORS proxy.
   ========================================================= */
(function () {
  'use strict';

  // ---------- constants ----------
  var LS = {
    subs:     'frss.subs',      // [{title, feed, site}]
    settings: 'frss.settings',  // {proxy}
    cache:    'frss.cache'      // { feedUrl: {t:ms, items:[...]} }
  };
  // Default: our own same-origin stateless proxy (nginx -> Node service).
  // Reliable, private, no storage. Falls back to public proxies if it's down.
  var DEFAULT_PROXY = '/proxy?url={url}';
  // Fallback proxies tried automatically if the configured one fails.
  var FALLBACK_PROXIES = [
    'https://api.allorigins.win/raw?url={url}',
    'https://api.codetabs.com/v1/proxy/?quest={url}'
  ];
  var CACHE_TTL = 15 * 60 * 1000;   // 15 min
  var MAX_ITEMS_PER_FEED = 20;      // cap cached items to keep storage small
  var CONTENT_CAP = 12000;          // cap stored feed HTML per item (chars)

  // ---------- tiny helpers ----------
  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { toast('Storage is full — try clearing the cache in settings.', true); return false; }
  }

  var toastTimer;
  function toast(msg, isErr) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast' + (isErr ? ' err' : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  // ---------- state ----------
  var subs = load(LS.subs, []);
  var settings = load(LS.settings, {});
  if (!settings.proxy) settings.proxy = DEFAULT_PROXY;
  var cache = load(LS.cache, {});
  var catalog = [];
  var activeSource = null; // source-title filter on home

  // ---------- URL / fetch ----------
  function proxied(url, proxyTpl) {
    var tpl = proxyTpl || settings.proxy || DEFAULT_PROXY;
    return tpl.indexOf('{url}') >= 0
      ? tpl.replace('{url}', encodeURIComponent(url))
      : tpl + encodeURIComponent(url);
  }

  // Fetch a URL as text, trying the configured proxy then fallbacks.
  function fetchText(url) {
    var proxies = [settings.proxy].concat(FALLBACK_PROXIES.filter(function (p) { return p !== settings.proxy; }));
    var i = 0;
    function attempt() {
      if (i >= proxies.length) return Promise.reject(new Error('All proxies failed'));
      var target = proxied(url, proxies[i]);
      i++;
      return fetch(target, { redirect: 'follow' })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.text();
        })
        .then(function (txt) {
          if (!txt || txt.length < 20) throw new Error('Empty response');
          return txt;
        })
        .catch(function () { return attempt(); });
    }
    return attempt();
  }

  // ---------- feed parsing ----------
  function textOf(node, sel) {
    var n = node.querySelector(sel);
    return n ? n.textContent.trim() : '';
  }
  function stripHtml(html) {
    var d = document.createElement('div');
    d.innerHTML = html || '';
    var t = (d.textContent || '').replace(/\s+/g, ' ').trim();
    return t.length > 260 ? t.slice(0, 257) + '…' : t;
  }
  // Raw text of the first matching (possibly namespaced) child tag.
  function rawOf(node, tag) {
    var els = node.getElementsByTagName(tag);
    return els.length ? (els[0].textContent || '') : '';
  }
  // Richest available HTML body for an item, capped to keep storage small.
  function richHtml(node, isAtom) {
    var html = isAtom
      ? (rawOf(node, 'content') || rawOf(node, 'summary'))
      : (rawOf(node, 'content:encoded') || rawOf(node, 'description'));
    html = (html || '').trim();
    return html.length > CONTENT_CAP ? html.slice(0, CONTENT_CAP) : html;
  }
  function atomLink(entry) {
    var links = entry.getElementsByTagName('link');
    var href = '';
    for (var i = 0; i < links.length; i++) {
      var rel = links[i].getAttribute('rel');
      if (!rel || rel === 'alternate') { href = links[i].getAttribute('href'); break; }
      if (!href) href = links[i].getAttribute('href');
    }
    return href || '';
  }

  // Returns { title, items:[{title, link, date(ms|0), summary, id}] }
  function parseFeed(xmlText) {
    var doc = new DOMParser().parseFromString(xmlText, 'text/xml');
    if (doc.querySelector('parsererror')) {
      // some proxies wrap XML — try to recover the first < ... >
      var start = xmlText.indexOf('<');
      if (start > 0) doc = new DOMParser().parseFromString(xmlText.slice(start), 'text/xml');
    }
    var out = { title: '', items: [] };
    var channelTitle = doc.querySelector('channel > title, feed > title');
    if (channelTitle) out.title = channelTitle.textContent.trim();

    var rssItems = doc.querySelectorAll('item');
    if (rssItems.length) {
      Array.prototype.forEach.call(rssItems, function (it) {
        var html = richHtml(it, false);
        var d = textOf(it, 'pubDate') || textOf(it, 'date');
        out.items.push({
          title:   textOf(it, 'title') || '(untitled)',
          link:    textOf(it, 'link'),
          date:    d ? (Date.parse(d) || 0) : 0,
          summary: stripHtml(html),
          content: html,
          id:      textOf(it, 'guid') || textOf(it, 'link')
        });
      });
      return out;
    }

    var entries = doc.querySelectorAll('entry');
    Array.prototype.forEach.call(entries, function (en) {
      var html = richHtml(en, true);
      var d = textOf(en, 'updated') || textOf(en, 'published');
      out.items.push({
        title:   textOf(en, 'title') || '(untitled)',
        link:    atomLink(en),
        date:    d ? (Date.parse(d) || 0) : 0,
        summary: stripHtml(html),
        content: html,
        id:      textOf(en, 'id') || atomLink(en)
      });
    });
    return out;
  }

  // ---------- feed discovery ----------
  function normalizeUrl(input) {
    var s = input.trim();
    if (!s) return '';
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    return s;
  }
  function looksLikeUrl(s) {
    return /^https?:\/\//i.test(s) || /\.[a-z]{2,}(\/|$)/i.test(s.trim());
  }
  function resolveUrl(href, base) {
    try { return new URL(href, base).href; } catch (e) { return href; }
  }

  // Given a site or feed URL, resolve to a real feed. Returns {feed, title, site}.
  function discover(input) {
    var url = normalizeUrl(input);
    if (!url) return Promise.reject(new Error('Empty URL'));
    return fetchText(url).then(function (txt) {
      // Is it already a feed?
      var parsed = parseFeed(txt);
      if (parsed.items.length) {
        return { feed: url, title: parsed.title || hostOf(url), site: originOf(url) };
      }
      // Otherwise treat as HTML and look for <link rel=alternate ... rss/atom>
      var doc = new DOMParser().parseFromString(txt, 'text/html');
      var links = $$('link[rel="alternate"]', doc).filter(function (l) {
        var ty = (l.getAttribute('type') || '').toLowerCase();
        return ty.indexOf('rss') >= 0 || ty.indexOf('atom') >= 0 || ty.indexOf('xml') >= 0;
      });
      if (links.length) {
        var href = resolveUrl(links[0].getAttribute('href'), url);
        var titleAttr = links[0].getAttribute('title');
        var pageTitle = doc.querySelector('title');
        return {
          feed: href,
          title: titleAttr || (pageTitle ? pageTitle.textContent.trim() : hostOf(url)),
          site: originOf(url)
        };
      }
      // Last resort: probe common feed paths
      return probeCommonPaths(url);
    });
  }

  function probeCommonPaths(siteUrl) {
    var origin = originOf(siteUrl);
    var paths = ['/feed', '/rss', '/feed.xml', '/rss.xml', '/atom.xml', '/index.xml', '/feeds/posts/default'];
    var i = 0;
    function next() {
      if (i >= paths.length) return Promise.reject(new Error('No feed found on that site'));
      var candidate = origin + paths[i]; i++;
      return fetchText(candidate)
        .then(function (txt) {
          var p = parseFeed(txt);
          if (p.items.length) return { feed: candidate, title: p.title || hostOf(origin), site: origin };
          return next();
        })
        .catch(function () { return next(); });
    }
    return next();
  }

  function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } }
  function originOf(u) { try { return new URL(u).origin; } catch (e) { return u; } }

  // ---------- subscriptions ----------
  function isSubscribed(feedUrl) {
    return subs.some(function (s) { return s.feed === feedUrl; });
  }
  function addSub(sub) {
    if (isSubscribed(sub.feed)) { toast('Already subscribed to “' + sub.title + '”.'); return false; }
    subs.push({ title: sub.title || hostOf(sub.feed), feed: sub.feed, site: sub.site || originOf(sub.feed) });
    save(LS.subs, subs);
    toast('Subscribed to “' + (sub.title || hostOf(sub.feed)) + '”.');
    renderSubs();
    return true;
  }
  function removeSub(feedUrl) {
    subs = subs.filter(function (s) { return s.feed !== feedUrl; });
    save(LS.subs, subs);
    delete cache[feedUrl];
    saveCache();
    renderSubs();
    renderCatalog($('#searchInput').value);
    toast('Unsubscribed.');
  }

  // ---------- refresh / home ----------
  var homeItems = [];

  function refreshAll(force) {
    if (!subs.length) { renderHome(); return Promise.resolve(); }
    var btn = $('#btnRefresh'); btn.classList.add('spin');
    var status = $('#feedStatus');
    status.hidden = false; status.className = 'feedstatus';
    status.textContent = 'Refreshing ' + subs.length + ' feed' + (subs.length > 1 ? 's' : '') + '…';

    var collected = [];
    var failures = [];
    var jobs = subs.map(function (sub) {
      var cached = cache[sub.feed];
      var fresh = cached && (Date.now() - cached.t) < CACHE_TTL;
      if (fresh && !force) {
        cached.items.forEach(function (it) { collected.push(withSource(it, sub)); });
        return Promise.resolve();
      }
      return fetchText(sub.feed)
        .then(function (txt) {
          var parsed = parseFeed(txt);
          var items = parsed.items.slice(0, MAX_ITEMS_PER_FEED);
          cache[sub.feed] = { t: Date.now(), items: items };
          // keep a nicer title if the feed reports one
          if (parsed.title && (sub.title === hostOf(sub.feed) || !sub.title)) {
            sub.title = parsed.title;
          }
          items.forEach(function (it) { collected.push(withSource(it, sub)); });
        })
        .catch(function () {
          failures.push(sub.title);
          if (cache[sub.feed]) cache[sub.feed].items.forEach(function (it) { collected.push(withSource(it, sub)); });
        });
    });

    return Promise.all(jobs).then(function () {
      saveCache();
      save(LS.subs, subs);
      collected.sort(function (a, b) { return (b.date || 0) - (a.date || 0); });
      homeItems = collected;
      renderHome();
      renderSourceFilters();
      btn.classList.remove('spin');
      if (failures.length) {
        status.hidden = false; status.className = 'feedstatus err';
        status.textContent = 'Could not load: ' + failures.join(', ') + '. The proxy may be busy — try refresh again.';
      } else {
        status.hidden = true;
      }
    });
  }

  // Persist the article cache; if storage is full, retry without the heavy
  // feed HTML so at least titles/summaries stay cached.
  function saveCache() {
    try { localStorage.setItem(LS.cache, JSON.stringify(cache)); return; }
    catch (e) { /* quota — fall through to slim version */ }
    try {
      var slim = {};
      Object.keys(cache).forEach(function (k) {
        slim[k] = { t: cache[k].t, items: cache[k].items.map(function (it) {
          return { title: it.title, link: it.link, date: it.date, summary: it.summary, id: it.id };
        }) };
      });
      localStorage.setItem(LS.cache, JSON.stringify(slim));
    } catch (e2) { /* give up silently; in-memory cache still works this session */ }
  }

  function withSource(item, sub) {
    return {
      title: item.title, link: item.link, date: item.date,
      summary: item.summary, content: item.content || '',
      source: sub.title, site: sub.site
    };
  }

  function fmtDate(ms) {
    if (!ms) return '';
    var diff = Date.now() - ms;
    var day = 24 * 3600 * 1000;
    if (diff < 3600 * 1000) return Math.max(1, Math.round(diff / 60000)) + 'm ago';
    if (diff < day) return Math.round(diff / 3600000) + 'h ago';
    if (diff < 7 * day) return Math.round(diff / day) + 'd ago';
    return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // ---------- HTML sanitizing (feed/article content is untrusted) ----------
  var ALLOWED = { A:1,P:1,BR:1,HR:1,B:1,STRONG:1,I:1,EM:1,U:1,S:1,SMALL:1,MARK:1,
    H1:1,H2:1,H3:1,H4:1,H5:1,H6:1,UL:1,OL:1,LI:1,BLOCKQUOTE:1,Q:1,CITE:1,
    PRE:1,CODE:1,KBD:1,SAMP:1,FIGURE:1,FIGCAPTION:1,IMG:1,PICTURE:1,SOURCE:1,
    TABLE:1,THEAD:1,TBODY:1,TFOOT:1,TR:1,TD:1,TH:1,CAPTION:1,COLGROUP:1,COL:1,
    SPAN:1,DIV:1,SECTION:1,ARTICLE:1,TIME:1,ABBR:1,SUB:1,SUP:1,DL:1,DT:1,DD:1 };
  var STRIP_TAGS = { SCRIPT:1,STYLE:1,IFRAME:1,OBJECT:1,EMBED:1,FORM:1,INPUT:1,
    BUTTON:1,SELECT:1,TEXTAREA:1,LINK:1,META:1,NOSCRIPT:1,SVG:1,CANVAS:1,
    VIDEO:1,AUDIO:1,HEADER:1,FOOTER:1,NAV:1,ASIDE:1 };

  function safeUrl(u) {
    var s = (u || '').trim();
    if (!s || /^(javascript|data|vbscript|file):/i.test(s)) return '';
    return s;
  }

  // Build a sanitized DocumentFragment from untrusted HTML.
  function sanitizeHtml(html, base) {
    var doc = new DOMParser().parseFromString(html || '', 'text/html');
    var frag = document.createDocumentFragment();
    (function walk(srcNode, dest) {
      for (var n = srcNode.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3) { dest.appendChild(document.createTextNode(n.nodeValue)); continue; }
        if (n.nodeType !== 1) continue;
        var tag = n.tagName;
        if (STRIP_TAGS[tag]) continue;
        if (!ALLOWED[tag]) { walk(n, dest); continue; }   // unknown tag: keep children only
        var out = document.createElement(tag.toLowerCase());
        if (tag === 'A') {
          var href = safeUrl(n.getAttribute('href'));
          if (href) { out.setAttribute('href', resolveUrl(href, base)); out.setAttribute('target', '_blank'); out.setAttribute('rel', 'noopener nofollow'); }
        } else if (tag === 'IMG') {
          var isrc = safeUrl(n.getAttribute('src') || n.getAttribute('data-src'));
          if (!isrc) continue;
          out.setAttribute('src', resolveUrl(isrc, base));
          out.setAttribute('alt', n.getAttribute('alt') || '');
          out.setAttribute('loading', 'lazy');
        } else if (tag === 'SOURCE') {
          var ss = safeUrl(n.getAttribute('srcset') || n.getAttribute('src'));
          if (ss && /^https?:/i.test(ss)) out.setAttribute('srcset', ss);
        }
        walk(n, out);
        dest.appendChild(out);
      }
    })(doc.body, frag);
    return frag;
  }

  // ---------- content cleaning (boilerplate removal) ----------
  // "continue reading" / related-links markers, IT + EN.
  var CONTINUE_RE = /(continua a leggere|clicca qui per continuare|leggi (tutto|l['’]articolo|anche|di più)|continua »|read more|continue reading|\[…\]|\[\.\.\.\])/i;
  // class/id fragments that mark non-article boilerplate.
  var JUNK_RE = /(share|social|related|correlat|leggi[-_]?anche|newsletter|subscribe|comment|commenti|advert|(^|[-_ ])adv?([-_ ]|$)|banner|promo|sponsor|widget|sidebar|author[-_]?box|post[-_]?tags|tag[-_]?list|breadcrumb|clickgo|outbrain|taboola|jp-relatedposts|wp-block-buttons)/i;
  // affiliate / ad / tracking link targets
  var JUNK_HREF_RE = /(\/clickgo\/|outbrain|taboola|doubleclick|googlesyndication|adservice|amzn\.to|\/aff[\/_-]|utm_medium=affiliate)/i;

  function stripJunk(root) {
    // 1) drop elements whose class/id looks like boilerplate
    Array.prototype.slice.call(root.querySelectorAll('[class],[id]')).forEach(function (n) {
      if (!n.parentNode) return; // already removed with an ancestor
      var key = (n.getAttribute('class') || '') + ' ' + (n.getAttribute('id') || '');
      if (JUNK_RE.test(key)) n.remove();
    });
    // 1b) drop affiliate/ad/tracking links
    Array.prototype.slice.call(root.querySelectorAll('a[href]')).forEach(function (n) {
      if (!n.parentNode) return;
      if (JUNK_HREF_RE.test(n.getAttribute('href') || '')) n.remove();
    });
    // 2) drop short links/headings that are "continue reading" / "leggi anche"
    Array.prototype.slice.call(root.querySelectorAll('a, h1, h2, h3, h4, strong, p')).forEach(function (n) {
      if (!n.parentNode) return;
      var t = (n.textContent || '').trim();
      if (t && t.length < 70 && CONTINUE_RE.test(t)) {
        var wrap = n.closest('h1,h2,h3,h4,p,li,div') || n;
        wrap.remove();
      }
    });
    return root;
  }

  // Clean a feed HTML snippet for display (returns HTML string).
  function cleanFeedHtml(html, base) {
    var doc = new DOMParser().parseFromString(html || '', 'text/html');
    stripJunk(doc.body);
    return doc.body.innerHTML;
  }

  // Does the feed body look like a truncated excerpt (not the whole article)?
  function isTruncated(html) {
    var d = document.createElement('div');
    d.innerHTML = html || '';
    var text = (d.textContent || '').trim();
    if (CONTINUE_RE.test(text)) return true;
    return text.length < 900; // short bodies are almost always excerpts
  }

  // ---------- readability-lite extraction of a full page ----------
  function extractArticle(html, base) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    ['script','style','nav','header','footer','aside','form','noscript','iframe','svg'].forEach(function (sel) {
      Array.prototype.forEach.call(doc.querySelectorAll(sel), function (n) { n.remove(); });
    });

    // 1) try explicit, well-known content containers first
    var SELECTORS = [
      '[itemprop="articleBody"]', 'article .entry-content', '.entry-content',
      '.post-content', '.article-content', '.article-body', '.articleBody',
      '.post-body', '.td-post-content', '.single-post-content', '.post__content',
      '.article__content', '.content__article-body', 'main article', 'article'
    ];
    var container = null;
    for (var i = 0; i < SELECTORS.length; i++) {
      var c = doc.querySelector(SELECTORS[i]);
      if (c && (c.textContent || '').trim().length > 400) { container = c; break; }
    }

    // 2) fallback: score blocks by paragraph text, penalised by link density
    if (!container) {
      var best = null, bestScore = 0;
      Array.prototype.forEach.call(doc.querySelectorAll('div, section, article, main'), function (el2) {
        var text = (el2.textContent || '').trim();
        if (text.length < 200) return;
        var pLen = 0;
        Array.prototype.forEach.call(el2.querySelectorAll('p'), function (p) {
          var l = (p.textContent || '').trim().length; if (l > 40) pLen += l;
        });
        if (!pLen) return;
        var linkLen = 0;
        Array.prototype.forEach.call(el2.querySelectorAll('a'), function (a) { linkLen += (a.textContent || '').length; });
        var density = text.length ? linkLen / text.length : 1;
        var score = pLen * (1 - Math.min(density, 0.9));
        if (el2.tagName === 'ARTICLE') score *= 1.2;
        if (score > bestScore) { bestScore = score; best = el2; }
      });
      container = best;
    }

    if (!container) container = doc.body;
    stripJunk(container);
    return { html: container.innerHTML, chars: (container.textContent || '').trim().length };
  }

  // ---------- in-site reader panel ----------
  var readerItem = null;

  function setReaderNote(text, kind) {
    var slot = $('#readerNote');
    slot.textContent = '';
    if (!text) { slot.hidden = true; return; }
    slot.hidden = false;
    slot.className = 'reader__note-slot' + (kind ? ' reader__note-slot--' + kind : '');
    slot.appendChild(document.createTextNode(text + ' '));
    if (readerItem && readerItem.link) {
      var a = el('a', null, 'Apri originale ↗');
      a.href = readerItem.link; a.target = '_blank'; a.rel = 'noopener';
      slot.appendChild(a);
    }
  }

  function openReader(item) {
    readerItem = item;
    $('#readerSource').textContent = item.source || '';
    $('#readerDate').textContent = item.date ? fmtDate(item.date) : '';
    var t = $('#readerTitle');
    t.textContent = item.title || '(untitled)';
    t.href = item.link || '#';
    $('#readerOriginal').href = item.link || '#';

    setReaderNote('');
    var body = $('#readerBody');
    body.textContent = '';
    var feedHtml = (item.content && item.content.trim()) ? cleanFeedHtml(item.content, item.link) : '';
    if (feedHtml.trim()) body.appendChild(sanitizeHtml(feedHtml, item.link));
    else body.appendChild(el('p', 'reader__note', item.summary || 'This feed provides no preview.'));

    var full = $('#readerFull');
    full.hidden = !item.link;
    full.disabled = false;
    full.textContent = 'Leggi articolo intero';

    $('#readerModal').hidden = false;
    document.body.style.overflow = 'hidden';
    $('#readerScroll').scrollTop = 0;

    // Hybrid: if the feed only gave an excerpt, try to pull the full article now.
    if (item.link && (!feedHtml.trim() || isTruncated(item.content || ''))) {
      loadFullArticle(true);
    }
  }

  function closeReader() {
    $('#readerModal').hidden = true;
    document.body.style.overflow = '';
  }

  function loadFullArticle(auto) {
    if (!readerItem || !readerItem.link) return;
    var btn = $('#readerFull');
    btn.disabled = true;
    btn.textContent = auto ? 'Carico l’articolo intero…' : 'Loading full article…';
    if (auto) setReaderNote('');
    fetchText(readerItem.link).then(function (html) {
      var res = extractArticle(html, readerItem.link);
      if (res.chars < 400) throw new Error('too short');
      var body = $('#readerBody');
      body.textContent = '';
      body.appendChild(sanitizeHtml(res.html, readerItem.link));
      setReaderNote('');
      $('#readerScroll').scrollTop = 0;
      btn.hidden = true;
    }).catch(function () {
      btn.disabled = false;
      btn.textContent = auto ? 'Riprova a caricare l’articolo intero' : 'Retry full article';
      // Keep the (cleaned) feed excerpt and explain why there is no more.
      setReaderNote('Anteprima dal feed — questo sito non permette la lettura completa da qui.', 'warn');
    });
  }

  // ---------- rendering ----------
  function renderHome() {
    var wrap = $('#articles');
    wrap.textContent = '';
    var items = activeSource ? homeItems.filter(function (i) { return i.source === activeSource; }) : homeItems;

    $('#emptyState').hidden = subs.length > 0;
    $('#feedCount').textContent = subs.length
      ? subs.length + ' subscription' + (subs.length > 1 ? 's' : '') + ' · ' + homeItems.length + ' articles'
      : 'No subscriptions yet';

    items.forEach(function (it) {
      var card = el('article', 'article');

      var meta = el('div', 'article__meta');
      var src = el('span', 'article__src');
      src.appendChild(el('span', 'article__dot'));
      src.appendChild(document.createTextNode(it.source));
      meta.appendChild(src);
      if (it.date) meta.appendChild(el('span', 'article__date', fmtDate(it.date)));
      card.appendChild(meta);

      var h = el('h3', 'article__title');
      var a = el('a', null, it.title);
      a.href = it.link || '#';
      a.addEventListener('click', function (e) {
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return; // let the browser open the original
        e.preventDefault(); openReader(it);
      });
      h.appendChild(a);
      card.appendChild(h);

      if (it.summary) card.appendChild(el('p', 'article__desc', it.summary));

      var foot = el('div', 'article__foot');
      var read = el('a', 'article__link', 'Read here →');
      read.href = it.link || '#';
      read.addEventListener('click', function (e) {
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return;
        e.preventDefault(); openReader(it);
      });
      foot.appendChild(read);
      var orig = el('a', 'article__link article__link--muted', 'Original ↗');
      orig.href = it.link || '#'; orig.target = '_blank'; orig.rel = 'noopener';
      foot.appendChild(orig);
      card.appendChild(foot);

      wrap.appendChild(card);
    });
  }

  function renderSourceFilters() {
    var wrap = $('#sourceFilters');
    wrap.textContent = '';
    if (subs.length < 2) return;
    var all = el('button', 'srcchip' + (activeSource ? '' : ' is-active'), 'All');
    all.onclick = function () { activeSource = null; renderSourceFilters(); renderHome(); };
    wrap.appendChild(all);
    subs.forEach(function (s) {
      var c = el('button', 'srcchip' + (activeSource === s.title ? ' is-active' : ''), s.title);
      c.onclick = function () { activeSource = s.title; renderSourceFilters(); renderHome(); };
      wrap.appendChild(c);
    });
  }

  function renderSubs() {
    var wrap = $('#subsList');
    wrap.textContent = '';
    if (!subs.length) {
      wrap.appendChild(el('div', 'subrow__empty', 'No subscriptions yet. Search above or paste a URL to add your first feed.'));
      return;
    }
    subs.forEach(function (s) {
      var row = el('div', 'subrow');
      var body = el('div', 'subrow__body');
      body.appendChild(el('div', 'subrow__title', s.title));
      body.appendChild(el('div', 'subrow__url', s.feed));
      row.appendChild(body);
      var btn = el('button', 'btn btn--ghost btn--dark btn--sm', 'Unsubscribe');
      btn.onclick = function () { removeSub(s.feed); };
      row.appendChild(btn);
      wrap.appendChild(row);
    });
  }

  function catalogCard(entry) {
    var card = el('div', 'fcard');
    card.appendChild(el('span', 'fcard__cat', entry.category || 'Feed'));
    card.appendChild(el('h3', 'fcard__title', entry.title));
    card.appendChild(el('p', 'fcard__url', entry.feed));
    var btns = el('div', 'fcard__btns');
    if (isSubscribed(entry.feed)) {
      var done = el('button', 'btn btn--ghost btn--dark btn--sm', '✓ Subscribed');
      done.disabled = true; done.style.opacity = '.7';
      btns.appendChild(done);
    } else {
      var add = el('button', 'btn btn--primary btn--sm', 'Subscribe');
      add.onclick = function () {
        addSub({ title: entry.title, feed: entry.feed, site: entry.site });
        renderCatalog($('#searchInput').value);
        refreshAll(false);
      };
      btns.appendChild(add);
    }
    if (entry.site) {
      var visit = el('a', 'btn btn--ghost btn--dark btn--sm', 'Site ↗');
      visit.href = entry.site; visit.target = '_blank'; visit.rel = 'noopener';
      btns.appendChild(visit);
    }
    card.appendChild(btns);
    return card;
  }

  function renderCatalog(query) {
    var wrap = $('#catalogResults');
    wrap.textContent = '';
    query = (query || '').trim();
    var q = query.toLowerCase();

    var matches = catalog.filter(function (f) {
      return !q ||
        f.title.toLowerCase().indexOf(q) >= 0 ||
        (f.category || '').toLowerCase().indexOf(q) >= 0 ||
        (f.site || '').toLowerCase().indexOf(q) >= 0;
    });

    // If the query is a URL and not in the catalog, offer an "add by URL" card.
    if (query && looksLikeUrl(query)) {
      wrap.appendChild(addByUrlCard(query));
    }
    matches.forEach(function (f) { wrap.appendChild(catalogCard(f)); });

    if (!matches.length && !(query && looksLikeUrl(query))) {
      var none = el('p', 'hint',
        query ? 'No catalog match for “' + query + '”. If it\'s a site, paste its full URL to subscribe directly.'
              : 'Loading catalog…');
      wrap.appendChild(none);
    }
  }

  function addByUrlCard(url) {
    var card = el('div', 'fcard');
    card.appendChild(el('span', 'fcard__cat', 'Custom URL'));
    card.appendChild(el('h3', 'fcard__title', hostOf(normalizeUrl(url))));
    card.appendChild(el('p', 'fcard__url', normalizeUrl(url)));
    var btns = el('div', 'fcard__btns');
    var add = el('button', 'btn btn--primary btn--sm', 'Find & subscribe');
    add.onclick = function () {
      add.disabled = true; add.textContent = 'Searching…';
      discover(url).then(function (found) {
        if (isSubscribed(found.feed)) { toast('Already subscribed.'); }
        else { addSub(found); refreshAll(false); }
        $('#searchInput').value = '';
        renderCatalog('');
      }).catch(function () {
        add.disabled = false; add.textContent = 'Find & subscribe';
        toast('No RSS/Atom feed found there.', true);
      });
    };
    btns.appendChild(add);
    card.appendChild(btns);
    return card;
  }

  // ---------- OPML / JSON import-export ----------
  function exportOpml() {
    if (!subs.length) { toast('Nothing to export yet.'); return; }
    var lines = ['<?xml version="1.0" encoding="UTF-8"?>',
      '<opml version="2.0">', '  <head><title>frontek reads subscriptions</title></head>', '  <body>'];
    subs.forEach(function (s) {
      lines.push('    <outline type="rss" text="' + esc(s.title) + '" title="' + esc(s.title) +
        '" xmlUrl="' + esc(s.feed) + '" htmlUrl="' + esc(s.site || '') + '"/>');
    });
    lines.push('  </body>', '</opml>');
    download('frontek-reads.opml', lines.join('\n'), 'text/xml');
  }
  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function download(name, content, type) {
    var blob = new Blob([content], { type: type });
    var a = el('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(a.href);
  }
  function importFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var text = reader.result, added = 0;
      try {
        if (/^\s*[[{]/.test(text)) {
          // JSON
          var arr = JSON.parse(text);
          if (Array.isArray(arr)) arr.forEach(function (s) {
            if (s.feed && !isSubscribed(s.feed)) { subs.push({ title: s.title || hostOf(s.feed), feed: s.feed, site: s.site || originOf(s.feed) }); added++; }
          });
        } else {
          // OPML / XML
          var doc = new DOMParser().parseFromString(text, 'text/xml');
          $$('outline[xmlUrl], outline[xmlurl]', doc).forEach(function (o) {
            var feed = o.getAttribute('xmlUrl') || o.getAttribute('xmlurl');
            if (feed && !isSubscribed(feed)) {
              subs.push({ title: o.getAttribute('text') || o.getAttribute('title') || hostOf(feed),
                          feed: feed, site: o.getAttribute('htmlUrl') || originOf(feed) });
              added++;
            }
          });
        }
      } catch (e) { toast('Could not read that file.', true); return; }
      save(LS.subs, subs);
      renderSubs();
      toast(added ? 'Imported ' + added + ' feed' + (added > 1 ? 's' : '') + '.' : 'No new feeds found in that file.');
      refreshAll(false);
    };
    reader.readAsText(file);
  }

  // ---------- routing / views ----------
  function showView(name) {
    $('#view-home').hidden = name !== 'home';
    $('#view-discover').hidden = name !== 'discover';
    $$('.nav__links a').forEach(function (a) {
      a.classList.toggle('is-active', a.getAttribute('data-view') === name);
    });
    window.scrollTo(0, 0);
  }
  function routeFromHash() {
    showView(location.hash === '#discover' ? 'discover' : 'home');
  }

  // ---------- settings modal ----------
  function openSettings() {
    $('#proxyInput').value = settings.proxy;
    $('#settingsModal').hidden = false;
  }
  function closeSettings() { $('#settingsModal').hidden = true; }
  function closeAnyModal(node) {
    var m = node && node.closest ? node.closest('.modal') : null;
    if (m === $('#readerModal')) { closeReader(); return; }
    if (m) m.hidden = true; else closeSettings();
  }

  // ---------- wire up ----------
  function init() {
    $('#year').textContent = new Date().getFullYear();

    // nav
    $('#navToggle').onclick = function () { $('#navLinks').classList.toggle('open'); };
    $$('.nav__links a, [data-view]').forEach(function (a) {
      if (a.getAttribute('data-view')) {
        a.addEventListener('click', function () { $('#navLinks').classList.remove('open'); });
      }
    });
    window.addEventListener('hashchange', routeFromHash);

    $('#btnRefresh').onclick = function () { refreshAll(true); };
    $('#btnSettings').onclick = openSettings;

    // modal close buttons/backdrops (settings + reader)
    $$('[data-close]').forEach(function (b) { b.onclick = function () { closeAnyModal(b); }; });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (!$('#readerModal').hidden) closeReader();
        else if (!$('#settingsModal').hidden) closeSettings();
      }
    });

    // in-site reader
    $('#readerFull').onclick = loadFullArticle;

    $('#proxyDefault').onclick = function () { $('#proxyInput').value = DEFAULT_PROXY; };
    $('#proxyInput').addEventListener('change', function () {
      var v = $('#proxyInput').value.trim();
      settings.proxy = v || DEFAULT_PROXY;
      save(LS.settings, settings);
      toast('Proxy saved.');
    });
    $('#btnClearCache').onclick = function () {
      cache = {}; save(LS.cache, cache); toast('Cache cleared.'); refreshAll(true);
    };
    $('#btnClearAll').onclick = function () {
      if (!confirm('Delete all subscriptions, cache and settings from this browser?')) return;
      localStorage.removeItem(LS.subs); localStorage.removeItem(LS.cache); localStorage.removeItem(LS.settings);
      subs = []; cache = {}; settings = { proxy: DEFAULT_PROXY };
      renderSubs(); renderSourceFilters(); homeItems = []; renderHome(); closeSettings();
      toast('All data deleted.');
    };

    // search
    $('#searchForm').addEventListener('submit', function (e) {
      e.preventDefault();
      renderCatalog($('#searchInput').value);
    });
    $('#searchInput').addEventListener('input', function () {
      renderCatalog($('#searchInput').value);
    });

    // import/export
    $('#btnExport').onclick = exportOpml;
    $('#btnImport').onclick = function () { $('#importFile').click(); };
    $('#importFile').addEventListener('change', function (e) {
      if (e.target.files[0]) importFile(e.target.files[0]);
      e.target.value = '';
    });

    // initial render
    renderSubs();
    renderSourceFilters();
    renderHome();
    routeFromHash();

    // load catalog, then category chips + first render
    fetch('assets/catalog.json')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        catalog = (data && data.feeds) || [];
        buildCategoryChips();
        renderCatalog('');
      })
      .catch(function () { renderCatalog(''); });

    // fetch feeds
    refreshAll(false);
  }

  function buildCategoryChips() {
    var cats = [];
    catalog.forEach(function (f) { if (f.category && cats.indexOf(f.category) < 0) cats.push(f.category); });
    var wrap = $('#searchCats');
    wrap.textContent = '';
    cats.forEach(function (c) {
      var chip = el('button', 'srcchip', c);
      chip.type = 'button';
      chip.onclick = function () { $('#searchInput').value = c; renderCatalog(c); };
      wrap.appendChild(chip);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
