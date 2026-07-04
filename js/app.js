/* =========================================================
   frontek reads — client-side RSS/Atom aggregator
   No backend, no accounts: subscriptions, favorites, settings
   and a small article cache all live in localStorage. Feeds
   (and feed search) are fetched through a configurable CORS
   proxy. Feature parity with the native Android reader.
   ========================================================= */
(function () {
  'use strict';

  // ---------- constants ----------
  var LS = {
    subs:     'frss.subs',      // [{title, feed, site}]
    settings: 'frss.settings',  // {proxy, lang, fontScale}
    cache:    'frss.cache',     // { feedUrl: {t:ms, items:[...]} }
    saved:    'frss.saved'      // [{...article, favorite, readLater, savedAt}]
  };
  var DEFAULT_PROXY = '/proxy?url={url}';
  var FALLBACK_PROXIES = [
    'https://api.allorigins.win/raw?url={url}',
    'https://api.codetabs.com/v1/proxy/?quest={url}'
  ];
  var CACHE_TTL = 15 * 60 * 1000;   // 15 min
  var MAX_ITEMS_PER_FEED = 20;
  var CONTENT_CAP = 12000;
  var FEEDLY_SEARCH = 'https://cloud.feedly.com/v3/search/feeds?count=20&query=';

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
    catch (e) { toast(t('toast_storage_full'), true); return false; }
  }

  var toastTimer;
  function toast(msg, isErr) {
    var el2 = $('#toast');
    el2.textContent = msg;
    el2.className = 'toast' + (isErr ? ' err' : '');
    el2.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el2.hidden = true; }, 3200);
  }

  // ---------- i18n ----------
  var STRINGS = {
    en: {
      nav_home:'Home', nav_favorites:'Favorites', nav_read_later:'Read later', nav_discover:'Discover',
      action_refresh:'Refresh', action_settings:'Settings', action_import:'Import', action_export:'Export',
      action_remove:'Remove', action_close:'Close', action_delete:'Delete', action_cancel:'Cancel',
      home_kicker:'Your feed', home_title:'Latest from your subscriptions',
      home_empty_title:'No subscriptions',
      home_empty_body:'Subscribe to a few sites and their latest articles will show up here — kept privately in your browser.',
      filter_all:'All',
      subscriptions_count: function (n) { return n + ' subscription' + (n === 1 ? '' : 's'); },
      articles_count:      function (n) { return n + ' article' + (n === 1 ? '' : 's'); },
      card_read_here:'Read here →',
      fav_add:'Add to favorites', fav_remove:'Remove from favorites',
      read_later_add:'Save to read later', read_later_remove:'Remove from read later',
      saved_favorites_title:'Favorites', saved_read_later_title:'Read later',
      saved_favorites_empty:'Articles you mark as favorite will appear here.',
      saved_read_later_empty:'Articles you save to read later will appear here.',
      discover_title:'Find sites to follow',
      discover_lead:'Search the web for feeds, or paste any site / feed URL to subscribe.',
      discover_search_placeholder:'Search feeds, or paste a URL…',
      discover_search_btn:'Search',
      discover_custom_url_label:'Custom URL', discover_find_subscribe:'Find & subscribe',
      discover_searching:'Searching…', discover_subscribe:'Subscribe', discover_subscribed:'✓ Subscribed',
      discover_no_match: function (q) { return 'No match for “' + q + '”. If it\'s a site, paste its full URL to subscribe directly.'; },
      discover_your_subs:'Your subscriptions',
      discover_subs_empty:'No subscriptions yet. Go to Discover to add your first feed.',
      discover_search_fallback:'No web results — showing matches from the built-in catalog.',
      discover_privacy_note:'Search queries are sent to Feedly to find feeds. Nothing else leaves your browser.',
      subs_manage_title:'Manage feeds', site_link:'Site ↗',
      reader_close:'Close', reader_open_original:'Open original ↗', reader_read_full:'Read full article',
      reader_loading_full:'Loading full article…', reader_retry_full:'Retry full article',
      reader_feed_preview_note:'Feed preview — this site doesn\'t allow full reading from here.',
      no_preview:'This feed provides no preview.',
      settings_title:'Settings',
      settings_body: function (n) { return 'Stored in this browser: ' + n + ' subscription' + (n === 1 ? '' : 's') + '.'; },
      settings_text_size:'Text size', font_decrease:'Decrease text size', font_increase:'Increase text size', font_reset:'Reset',
      settings_language:'Language', lang_system:'System default', lang_italian:'Italiano', lang_english:'English', lang_spanish:'Español', lang_french:'Français',
      settings_proxy_label:'CORS proxy',
      settings_proxy_hint:'Browsers can\'t read most feeds directly, so requests go through a proxy. Use {url} as the placeholder for the feed address.',
      settings_proxy_reset:'Reset default',
      settings_clear_cache:'Clear article cache', settings_delete_all:'Delete all my data',
      confirm_delete_title:'Delete everything?',
      confirm_delete_body:'This removes all subscriptions, favorites, cache and settings from this browser.',
      status_refreshing: function (n) { return 'Refreshing ' + n + ' feed' + (n === 1 ? '' : 's') + '…'; },
      status_load_failed: function (list) { return 'Could not load: ' + list + '. The proxy may be busy — try refresh again.'; },
      toast_subscribed_named:        function (name) { return 'Subscribed to “' + name + '”.'; },
      toast_already_subscribed_named:function (name) { return 'Already subscribed to “' + name + '”.'; },
      toast_unsubscribed:'Unsubscribed.', toast_already_subscribed:'Already subscribed.',
      toast_no_feed_found:'No RSS/Atom feed found there.',
      toast_load_failed: function (name) { return 'Could not load “' + name + '”.'; },
      toast_nothing_export:'Nothing to export yet.', toast_export_ok:'Subscriptions exported.', toast_export_fail:'Export failed.',
      toast_import_read_fail:'Could not read that file.', toast_no_new_feeds:'No new feeds found in that file.',
      feeds_imported: function (n) { return 'Imported ' + n + ' feed' + (n === 1 ? '' : 's') + '.'; },
      toast_cache_cleared:'Cache cleared.', toast_all_deleted:'All data deleted.',
      toast_fav_added:'Added to favorites.', toast_fav_removed:'Removed from favorites.',
      toast_read_later_added:'Saved to read later.', toast_read_later_removed:'Removed from read later.',
      toast_storage_full:'Storage is full — try clearing the cache in settings.',
      footer_tagline:'A private, no-account RSS reader — part of <a href="https://frontek.dev">frontek.dev</a>.',
      footer_backup:'Your subscriptions live only in this browser. Export them to keep a backup.',
      time_minutes_ago: function (n) { return n + 'm ago'; },
      time_hours_ago:   function (n) { return n + 'h ago'; },
      time_days_ago:    function (n) { return n + 'd ago'; }
    },
    it: {
      nav_home:'Home', nav_favorites:'Preferiti', nav_read_later:'Leggi più tardi', nav_discover:'Esplora',
      action_refresh:'Aggiorna', action_settings:'Impostazioni', action_import:'Importa', action_export:'Esporta',
      action_remove:'Rimuovi', action_close:'Chiudi', action_delete:'Elimina', action_cancel:'Annulla',
      home_kicker:'Il tuo feed', home_title:'Ultimi articoli dalle tue iscrizioni',
      home_empty_title:'Nessuna iscrizione',
      home_empty_body:'Iscriviti a qualche sito e i loro ultimi articoli compariranno qui — salvati privatamente nel tuo browser.',
      filter_all:'Tutti',
      subscriptions_count: function (n) { return n + (n === 1 ? ' iscrizione' : ' iscrizioni'); },
      articles_count:      function (n) { return n + (n === 1 ? ' articolo' : ' articoli'); },
      card_read_here:'Leggi qui →',
      fav_add:'Aggiungi ai preferiti', fav_remove:'Rimuovi dai preferiti',
      read_later_add:'Salva per dopo', read_later_remove:'Togli da leggi più tardi',
      saved_favorites_title:'Preferiti', saved_read_later_title:'Leggi più tardi',
      saved_favorites_empty:'Gli articoli che segni come preferiti compariranno qui.',
      saved_read_later_empty:'Gli articoli che salvi per dopo compariranno qui.',
      discover_title:'Trova siti da seguire',
      discover_lead:'Cerca feed sul web o incolla l\'URL di un sito / feed per iscriverti.',
      discover_search_placeholder:'Cerca feed o incolla un URL…',
      discover_search_btn:'Cerca',
      discover_custom_url_label:'URL personalizzato', discover_find_subscribe:'Trova e iscriviti',
      discover_searching:'Ricerca in corso…', discover_subscribe:'Iscriviti', discover_subscribed:'✓ Iscritto',
      discover_no_match: function (q) { return 'Nessun risultato per “' + q + '”. Se è un sito, incolla l\'URL completo per iscriverti.'; },
      discover_your_subs:'Le tue iscrizioni',
      discover_subs_empty:'Nessuna iscrizione. Vai su Esplora per aggiungere il primo feed.',
      discover_search_fallback:'Nessun risultato dal web — mostro le corrispondenze dal catalogo integrato.',
      discover_privacy_note:'Le ricerche vengono inviate a Feedly per trovare i feed. Nient\'altro esce dal tuo browser.',
      subs_manage_title:'Gestisci feed', site_link:'Sito ↗',
      reader_close:'Chiudi', reader_open_original:'Apri originale ↗', reader_read_full:'Leggi articolo intero',
      reader_loading_full:'Carico l\'articolo intero…', reader_retry_full:'Riprova a caricare l\'articolo',
      reader_feed_preview_note:'Anteprima dal feed — questo sito non permette la lettura completa da qui.',
      no_preview:'Questo feed non fornisce anteprima.',
      settings_title:'Impostazioni',
      settings_body: function (n) { return 'Salvate in questo browser: ' + n + (n === 1 ? ' iscrizione' : ' iscrizioni') + '.'; },
      settings_text_size:'Dimensione testo', font_decrease:'Riduci testo', font_increase:'Ingrandisci testo', font_reset:'Ripristina',
      settings_language:'Lingua', lang_system:'Predefinita di sistema', lang_italian:'Italiano', lang_english:'English', lang_spanish:'Español', lang_french:'Français',
      settings_proxy_label:'Proxy CORS',
      settings_proxy_hint:'I browser non possono leggere la maggior parte dei feed direttamente, quindi le richieste passano da un proxy. Usa {url} come segnaposto per l\'indirizzo del feed.',
      settings_proxy_reset:'Ripristina predefinito',
      settings_clear_cache:'Svuota la cache', settings_delete_all:'Elimina tutti i dati',
      confirm_delete_title:'Eliminare tutto?',
      confirm_delete_body:'Verranno rimossi tutte le iscrizioni, i preferiti, la cache e le impostazioni da questo browser.',
      status_refreshing: function (n) { return 'Aggiorno ' + n + ' feed…'; },
      status_load_failed: function (list) { return 'Impossibile caricare: ' + list + '. Il proxy potrebbe essere occupato — riprova ad aggiornare.'; },
      toast_subscribed_named:        function (name) { return 'Iscritto a “' + name + '”.'; },
      toast_already_subscribed_named:function (name) { return 'Già iscritto a “' + name + '”.'; },
      toast_unsubscribed:'Iscrizione rimossa.', toast_already_subscribed:'Già iscritto.',
      toast_no_feed_found:'Nessun feed RSS/Atom trovato lì.',
      toast_load_failed: function (name) { return 'Impossibile caricare “' + name + '”.'; },
      toast_nothing_export:'Niente da esportare.', toast_export_ok:'Iscrizioni esportate.', toast_export_fail:'Esportazione non riuscita.',
      toast_import_read_fail:'Impossibile leggere quel file.', toast_no_new_feeds:'Nessun nuovo feed trovato nel file.',
      feeds_imported: function (n) { return 'Importati ' + n + ' feed.'; },
      toast_cache_cleared:'Cache svuotata.', toast_all_deleted:'Tutti i dati eliminati.',
      toast_fav_added:'Aggiunto ai preferiti.', toast_fav_removed:'Rimosso dai preferiti.',
      toast_read_later_added:'Salvato per dopo.', toast_read_later_removed:'Tolto da leggi più tardi.',
      toast_storage_full:'Spazio esaurito — prova a svuotare la cache nelle impostazioni.',
      footer_tagline:'Un lettore RSS privato e senza account — parte di <a href="https://frontek.dev">frontek.dev</a>.',
      footer_backup:'Le tue iscrizioni vivono solo in questo browser. Esportale per avere un backup.',
      time_minutes_ago: function (n) { return n + 'm fa'; },
      time_hours_ago:   function (n) { return n + 'h fa'; },
      time_days_ago:    function (n) { return n + 'g fa'; }
    },
    es: {
      nav_home:'Inicio', nav_favorites:'Favoritos', nav_read_later:'Leer después', nav_discover:'Descubrir',
      action_refresh:'Actualizar', action_settings:'Ajustes', action_import:'Importar', action_export:'Exportar',
      action_remove:'Quitar', action_close:'Cerrar', action_delete:'Eliminar', action_cancel:'Cancelar',
      home_kicker:'Tu feed', home_title:'Lo último de tus suscripciones',
      home_empty_title:'Sin suscripciones',
      home_empty_body:'Suscríbete a algunos sitios y sus últimos artículos aparecerán aquí — guardados de forma privada en tu navegador.',
      filter_all:'Todos',
      subscriptions_count: function (n) { return n + (n === 1 ? ' suscripción' : ' suscripciones'); },
      articles_count:      function (n) { return n + (n === 1 ? ' artículo' : ' artículos'); },
      card_read_here:'Leer aquí →',
      fav_add:'Añadir a favoritos', fav_remove:'Quitar de favoritos',
      read_later_add:'Guardar para después', read_later_remove:'Quitar de leer después',
      saved_favorites_title:'Favoritos', saved_read_later_title:'Leer después',
      saved_favorites_empty:'Los artículos que marques como favoritos aparecerán aquí.',
      saved_read_later_empty:'Los artículos que guardes para leer después aparecerán aquí.',
      discover_title:'Encuentra sitios que seguir',
      discover_lead:'Busca feeds en la web o pega la URL de un sitio / feed para suscribirte.',
      discover_search_placeholder:'Busca feeds o pega una URL…',
      discover_search_btn:'Buscar',
      discover_custom_url_label:'URL personalizada', discover_find_subscribe:'Buscar y suscribirse',
      discover_searching:'Buscando…', discover_subscribe:'Suscribirse', discover_subscribed:'✓ Suscrito',
      discover_no_match: function (q) { return 'Sin resultados para “' + q + '”. Si es un sitio, pega su URL completa para suscribirte.'; },
      discover_your_subs:'Tus suscripciones',
      discover_subs_empty:'Aún no hay suscripciones. Ve a Descubrir para añadir tu primer feed.',
      discover_search_fallback:'Sin resultados en la web — mostrando coincidencias del catálogo integrado.',
      discover_privacy_note:'Las búsquedas se envían a Feedly para encontrar feeds. Nada más sale de tu navegador.',
      subs_manage_title:'Gestionar feeds', site_link:'Sitio ↗',
      reader_close:'Cerrar', reader_open_original:'Abrir original ↗', reader_read_full:'Leer artículo completo',
      reader_loading_full:'Cargando artículo completo…', reader_retry_full:'Reintentar artículo completo',
      reader_feed_preview_note:'Vista previa del feed — este sitio no permite la lectura completa desde aquí.',
      no_preview:'Este feed no ofrece vista previa.',
      settings_title:'Ajustes',
      settings_body: function (n) { return 'Guardado en este navegador: ' + n + (n === 1 ? ' suscripción' : ' suscripciones') + '.'; },
      settings_text_size:'Tamaño del texto', font_decrease:'Reducir texto', font_increase:'Aumentar texto', font_reset:'Restablecer',
      settings_language:'Idioma', lang_system:'Predeterminado del sistema', lang_italian:'Italiano', lang_english:'English', lang_spanish:'Español', lang_french:'Français',
      settings_proxy_label:'Proxy CORS',
      settings_proxy_hint:'Los navegadores no pueden leer la mayoría de los feeds directamente, así que las solicitudes pasan por un proxy. Usa {url} como marcador para la dirección del feed.',
      settings_proxy_reset:'Restablecer predeterminado',
      settings_clear_cache:'Vaciar caché', settings_delete_all:'Eliminar todos mis datos',
      confirm_delete_title:'¿Eliminar todo?',
      confirm_delete_body:'Esto elimina todas las suscripciones, favoritos, caché y ajustes de este navegador.',
      status_refreshing: function (n) { return 'Actualizando ' + n + ' feeds…'; },
      status_load_failed: function (list) { return 'No se pudo cargar: ' + list + '. El proxy puede estar ocupado — inténtalo de nuevo.'; },
      toast_subscribed_named:        function (name) { return 'Suscrito a “' + name + '”.'; },
      toast_already_subscribed_named:function (name) { return 'Ya suscrito a “' + name + '”.'; },
      toast_unsubscribed:'Suscripción cancelada.', toast_already_subscribed:'Ya suscrito.',
      toast_no_feed_found:'No se encontró ningún feed RSS/Atom.',
      toast_load_failed: function (name) { return 'No se pudo cargar “' + name + '”.'; },
      toast_nothing_export:'Nada que exportar.', toast_export_ok:'Suscripciones exportadas.', toast_export_fail:'Error al exportar.',
      toast_import_read_fail:'No se pudo leer ese archivo.', toast_no_new_feeds:'No se encontraron feeds nuevos en el archivo.',
      feeds_imported: function (n) { return 'Importados ' + n + ' feeds.'; },
      toast_cache_cleared:'Caché vaciada.', toast_all_deleted:'Todos los datos eliminados.',
      toast_fav_added:'Añadido a favoritos.', toast_fav_removed:'Quitado de favoritos.',
      toast_read_later_added:'Guardado para después.', toast_read_later_removed:'Quitado de leer después.',
      toast_storage_full:'Almacenamiento lleno — prueba a vaciar la caché en ajustes.',
      footer_tagline:'Un lector RSS privado y sin cuenta — parte de <a href="https://frontek.dev">frontek.dev</a>.',
      footer_backup:'Tus suscripciones viven solo en este navegador. Expórtalas para tener una copia.',
      time_minutes_ago: function (n) { return 'hace ' + n + 'm'; },
      time_hours_ago:   function (n) { return 'hace ' + n + 'h'; },
      time_days_ago:    function (n) { return 'hace ' + n + 'd'; }
    },
    fr: {
      nav_home:'Accueil', nav_favorites:'Favoris', nav_read_later:'À lire plus tard', nav_discover:'Découvrir',
      action_refresh:'Actualiser', action_settings:'Paramètres', action_import:'Importer', action_export:'Exporter',
      action_remove:'Retirer', action_close:'Fermer', action_delete:'Supprimer', action_cancel:'Annuler',
      home_kicker:'Votre flux', home_title:'Les derniers articles de vos abonnements',
      home_empty_title:'Aucun abonnement',
      home_empty_body:'Abonnez-vous à quelques sites et leurs derniers articles apparaîtront ici — conservés en privé dans votre navigateur.',
      filter_all:'Tous',
      subscriptions_count: function (n) { return n + (n === 1 ? ' abonnement' : ' abonnements'); },
      articles_count:      function (n) { return n + (n === 1 ? ' article' : ' articles'); },
      card_read_here:'Lire ici →',
      fav_add:'Ajouter aux favoris', fav_remove:'Retirer des favoris',
      read_later_add:'Enregistrer pour plus tard', read_later_remove:'Retirer de à lire plus tard',
      saved_favorites_title:'Favoris', saved_read_later_title:'À lire plus tard',
      saved_favorites_empty:'Les articles que vous marquez comme favoris apparaîtront ici.',
      saved_read_later_empty:'Les articles enregistrés pour plus tard apparaîtront ici.',
      discover_title:'Trouvez des sites à suivre',
      discover_lead:'Recherchez des flux sur le web ou collez l\'URL d\'un site / flux pour vous abonner.',
      discover_search_placeholder:'Recherchez des flux ou collez une URL…',
      discover_search_btn:'Rechercher',
      discover_custom_url_label:'URL personnalisée', discover_find_subscribe:'Trouver et s\'abonner',
      discover_searching:'Recherche…', discover_subscribe:'S\'abonner', discover_subscribed:'✓ Abonné',
      discover_no_match: function (q) { return 'Aucun résultat pour « ' + q + ' ». Si c\'est un site, collez son URL complète pour vous abonner.'; },
      discover_your_subs:'Vos abonnements',
      discover_subs_empty:'Aucun abonnement. Allez dans Découvrir pour ajouter votre premier flux.',
      discover_search_fallback:'Aucun résultat sur le web — affichage des correspondances du catalogue intégré.',
      discover_privacy_note:'Les recherches sont envoyées à Feedly pour trouver des flux. Rien d\'autre ne quitte votre navigateur.',
      subs_manage_title:'Gérer les flux', site_link:'Site ↗',
      reader_close:'Fermer', reader_open_original:'Ouvrir l\'original ↗', reader_read_full:'Lire l\'article complet',
      reader_loading_full:'Chargement de l\'article complet…', reader_retry_full:'Réessayer l\'article complet',
      reader_feed_preview_note:'Aperçu du flux — ce site ne permet pas la lecture complète ici.',
      no_preview:'Ce flux ne fournit pas d\'aperçu.',
      settings_title:'Paramètres',
      settings_body: function (n) { return 'Enregistré dans ce navigateur : ' + n + (n === 1 ? ' abonnement' : ' abonnements') + '.'; },
      settings_text_size:'Taille du texte', font_decrease:'Réduire le texte', font_increase:'Agrandir le texte', font_reset:'Réinitialiser',
      settings_language:'Langue', lang_system:'Par défaut du système', lang_italian:'Italiano', lang_english:'English', lang_spanish:'Español', lang_french:'Français',
      settings_proxy_label:'Proxy CORS',
      settings_proxy_hint:'Les navigateurs ne peuvent pas lire la plupart des flux directement, les requêtes passent donc par un proxy. Utilisez {url} comme espace réservé pour l\'adresse du flux.',
      settings_proxy_reset:'Réinitialiser par défaut',
      settings_clear_cache:'Vider le cache', settings_delete_all:'Supprimer toutes mes données',
      confirm_delete_title:'Tout supprimer ?',
      confirm_delete_body:'Cela supprime tous les abonnements, favoris, le cache et les paramètres de ce navigateur.',
      status_refreshing: function (n) { return 'Actualisation de ' + n + ' flux…'; },
      status_load_failed: function (list) { return 'Impossible de charger : ' + list + '. Le proxy est peut-être occupé — réessayez.'; },
      toast_subscribed_named:        function (name) { return 'Abonné à « ' + name + ' ».'; },
      toast_already_subscribed_named:function (name) { return 'Déjà abonné à « ' + name + ' ».'; },
      toast_unsubscribed:'Désabonné.', toast_already_subscribed:'Déjà abonné.',
      toast_no_feed_found:'Aucun flux RSS/Atom trouvé ici.',
      toast_load_failed: function (name) { return 'Impossible de charger « ' + name + ' ».'; },
      toast_nothing_export:'Rien à exporter.', toast_export_ok:'Abonnements exportés.', toast_export_fail:'Échec de l\'export.',
      toast_import_read_fail:'Impossible de lire ce fichier.', toast_no_new_feeds:'Aucun nouveau flux trouvé dans ce fichier.',
      feeds_imported: function (n) { return n + ' flux importés.'; },
      toast_cache_cleared:'Cache vidé.', toast_all_deleted:'Toutes les données supprimées.',
      toast_fav_added:'Ajouté aux favoris.', toast_fav_removed:'Retiré des favoris.',
      toast_read_later_added:'Enregistré pour plus tard.', toast_read_later_removed:'Retiré de à lire plus tard.',
      toast_storage_full:'Stockage plein — essayez de vider le cache dans les paramètres.',
      footer_tagline:'Un lecteur RSS privé et sans compte — partie de <a href="https://frontek.dev">frontek.dev</a>.',
      footer_backup:'Vos abonnements ne vivent que dans ce navigateur. Exportez-les pour garder une sauvegarde.',
      time_minutes_ago: function (n) { return 'il y a ' + n + 'min'; },
      time_hours_ago:   function (n) { return 'il y a ' + n + 'h'; },
      time_days_ago:    function (n) { return 'il y a ' + n + 'j'; }
    }
  };

  function detectLang() {
    var l = (navigator.language || 'en').toLowerCase();
    if (l.indexOf('it') === 0) return 'it';
    if (l.indexOf('es') === 0) return 'es';
    if (l.indexOf('fr') === 0) return 'fr';
    return 'en';
  }
  function currentLang() {
    var s = settings.lang;
    if (s === 'it' || s === 'es' || s === 'fr' || s === 'en') return s;
    return detectLang();
  }
  function t(key) {
    var dict = STRINGS[currentLang()] || STRINGS.en;
    var v = dict[key];
    if (v == null) v = STRINGS.en[key];
    if (v == null) return key;
    var args = Array.prototype.slice.call(arguments, 1);
    if (typeof v === 'function') return v.apply(null, args);
    if (args.length) return v.replace(/\{(\d+)\}/g, function (_, i) { return args[+i] != null ? args[+i] : ''; });
    return v;
  }

  function applyI18n() {
    document.documentElement.lang = currentLang();
    $$('[data-i18n]').forEach(function (n) { n.textContent = t(n.getAttribute('data-i18n')); });
    $$('[data-i18n-html]').forEach(function (n) { n.innerHTML = t(n.getAttribute('data-i18n-html')); });
    $$('[data-i18n-ph]').forEach(function (n) { n.setAttribute('placeholder', t(n.getAttribute('data-i18n-ph'))); });
    $$('[data-i18n-title]').forEach(function (n) {
      var v = t(n.getAttribute('data-i18n-title')); n.title = v; n.setAttribute('aria-label', v);
    });
    renderAll();
  }

  // ---------- state ----------
  var subs = load(LS.subs, []);
  var settings = load(LS.settings, {});
  if (!settings.proxy) settings.proxy = DEFAULT_PROXY;
  if (!settings.fontScale) settings.fontScale = 100;
  var cache = load(LS.cache, {});
  var saved = load(LS.saved, []);
  var catalog = [];
  var activeSource = null;
  var currentView = 'home';

  // ---------- URL / fetch ----------
  function proxied(url, proxyTpl) {
    var tpl = proxyTpl || settings.proxy || DEFAULT_PROXY;
    return tpl.indexOf('{url}') >= 0
      ? tpl.replace('{url}', encodeURIComponent(url))
      : tpl + encodeURIComponent(url);
  }
  function fetchText(url) {
    var proxies = [settings.proxy].concat(FALLBACK_PROXIES.filter(function (p) { return p !== settings.proxy; }));
    var i = 0;
    function attempt() {
      if (i >= proxies.length) return Promise.reject(new Error('All proxies failed'));
      var target = proxied(url, proxies[i]); i++;
      return fetch(target, { redirect: 'follow' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(function (txt) { if (!txt || txt.length < 20) throw new Error('Empty response'); return txt; })
        .catch(function () { return attempt(); });
    }
    return attempt();
  }

  // ---------- feed parsing ----------
  function textOf(node, sel) { var n = node.querySelector(sel); return n ? n.textContent.trim() : ''; }
  function stripHtml(html) {
    var d = document.createElement('div'); d.innerHTML = html || '';
    var tx = (d.textContent || '').replace(/\s+/g, ' ').trim();
    return tx.length > 260 ? tx.slice(0, 257) + '…' : tx;
  }
  function rawOf(node, tag) { var els = node.getElementsByTagName(tag); return els.length ? (els[0].textContent || '') : ''; }
  function richHtml(node, isAtom) {
    var html = isAtom ? (rawOf(node, 'content') || rawOf(node, 'summary'))
                      : (rawOf(node, 'content:encoded') || rawOf(node, 'description'));
    html = (html || '').trim();
    return html.length > CONTENT_CAP ? html.slice(0, CONTENT_CAP) : html;
  }
  function atomLink(entry) {
    var links = entry.getElementsByTagName('link'), href = '';
    for (var i = 0; i < links.length; i++) {
      var rel = links[i].getAttribute('rel');
      if (!rel || rel === 'alternate') { href = links[i].getAttribute('href'); break; }
      if (!href) href = links[i].getAttribute('href');
    }
    return href || '';
  }

  // image extraction -----------------------------------------------------
  function absImg(u) {
    u = (u || '').trim(); if (!u) return '';
    if (u.indexOf('//') === 0) u = 'https:' + u;
    return /^https?:\/\//i.test(u) ? u : '';
  }
  function attrOfTag(node, tag, attr) {
    var els = node.getElementsByTagName(tag);
    for (var i = 0; i < els.length; i++) { var v = els[i].getAttribute(attr); if (v) return v; }
    return '';
  }
  function firstImg(html) {
    if (!html) return '';
    var m = /<img[^>]+src\s*=\s*["']?(https?:\/\/[^"'\s>]+)/i.exec(html);
    return m ? m[1] : '';
  }
  // media:thumbnail -> media:content(image) -> enclosure(image) -> itunes:image -> first <img>
  function extractImage(node, html) {
    var u = attrOfTag(node, 'media:thumbnail', 'url');
    if (u) return absImg(u);
    var mc = node.getElementsByTagName('media:content');
    for (var i = 0; i < mc.length; i++) {
      var medium = (mc[i].getAttribute('medium') || '').toLowerCase();
      var type   = (mc[i].getAttribute('type') || '').toLowerCase();
      var url    = mc[i].getAttribute('url') || '';
      if (url && (medium === 'image' || type.indexOf('image') === 0 || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url))) return absImg(url);
    }
    var enc = node.getElementsByTagName('enclosure');
    for (var j = 0; j < enc.length; j++) {
      var et = (enc[j].getAttribute('type') || '').toLowerCase(), eu = enc[j].getAttribute('url') || '';
      if (eu && et.indexOf('image') === 0) return absImg(eu);
    }
    var it = attrOfTag(node, 'itunes:image', 'href');
    if (it) return absImg(it);
    return absImg(firstImg(html));
  }

  function parseFeed(xmlText) {
    var doc = new DOMParser().parseFromString(xmlText, 'text/xml');
    if (doc.querySelector('parsererror')) {
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
          image:   extractImage(it, html),
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
        image:   extractImage(en, html),
        id:      textOf(en, 'id') || atomLink(en)
      });
    });
    return out;
  }

  // ---------- feed discovery ----------
  function normalizeUrl(input) {
    var s = (input || '').trim(); if (!s) return '';
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    return s;
  }
  function looksLikeUrl(s) { return /^https?:\/\//i.test(s) || /\.[a-z]{2,}(\/|$)/i.test((s || '').trim()); }
  function resolveUrl(href, base) { try { return new URL(href, base).href; } catch (e) { return href; } }
  function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } }
  function originOf(u) { try { return new URL(u).origin; } catch (e) { return u; } }

  var COMMON_PATHS = ['/feed/', '/feed', '/rss', '/rss.xml', '/feed.xml', '/atom.xml', '/atom',
    '/index.xml', '/index.rss', '/feed/rss', '/?feed=rss2', '/feeds/posts/default?alt=rss'];

  // Collect feed candidates from an HTML document.
  function collectFeedCandidates(doc, base) {
    var out = [], seen = {};
    function add(href) {
      if (!href) return;
      var abs = resolveUrl(href, base);
      if (!/^https?:/i.test(abs) || seen[abs]) return;
      seen[abs] = 1; out.push(abs);
    }
    $$('link[rel="alternate"], link[rel="feed"]', doc).forEach(function (l) {
      var ty = (l.getAttribute('type') || '').toLowerCase();
      if (ty.indexOf('rss') >= 0 || ty.indexOf('atom') >= 0 || ty.indexOf('xml') >= 0 || ty.indexOf('json') >= 0) add(l.getAttribute('href'));
    });
    $$('a[href]', doc).forEach(function (a) {
      var h = a.getAttribute('href') || '';
      if (/comment/i.test(h)) return;
      if (/(\/feed(\/|$)|\/rss|atom|\.xml|feed=rss)/i.test(h)) add(h);
    });
    return out;
  }

  // Verify candidates one by one; accept the first that parses to items.
  function verifyCandidates(list, i, pageTitle) {
    i = i || 0;
    if (i >= list.length) return Promise.reject(new Error('no candidate parsed'));
    var url = list[i];
    return fetchText(url).then(function (txt) {
      var p = parseFeed(txt);
      if (p.items.length) return { feed: url, title: p.title || pageTitle || hostOf(url), site: originOf(url) };
      return verifyCandidates(list, i + 1, pageTitle);
    }).catch(function () { return verifyCandidates(list, i + 1, pageTitle); });
  }

  function probeCommonPaths(siteUrl, pageTitle) {
    var origin = originOf(siteUrl), i = 0;
    function next() {
      if (i >= COMMON_PATHS.length) return Promise.reject(new Error('No feed found on that site'));
      var candidate = origin + COMMON_PATHS[i]; i++;
      return fetchText(candidate).then(function (txt) {
        var p = parseFeed(txt);
        if (p.items.length) return { feed: candidate, title: p.title || pageTitle || hostOf(origin), site: origin };
        return next();
      }).catch(function () { return next(); });
    }
    return next();
  }

  function discover(input) {
    var url = normalizeUrl(input);
    if (!url) return Promise.reject(new Error('Empty URL'));
    return fetchText(url).then(function (txt) {
      var parsed = parseFeed(txt);
      if (parsed.items.length) return { feed: url, title: parsed.title || hostOf(url), site: originOf(url) };
      var doc = new DOMParser().parseFromString(txt, 'text/html');
      var pageTitleEl = doc.querySelector('title');
      var pageTitle = pageTitleEl ? pageTitleEl.textContent.trim() : hostOf(url);
      var candidates = collectFeedCandidates(doc, url);
      return verifyCandidates(candidates, 0, pageTitle)
        .catch(function () { return probeCommonPaths(url, pageTitle); });
    });
  }

  // ---------- subscriptions ----------
  function isSubscribed(feedUrl) { return subs.some(function (s) { return s.feed === feedUrl; }); }
  function addSub(sub) {
    if (isSubscribed(sub.feed)) { toast(t('toast_already_subscribed_named', sub.title || hostOf(sub.feed))); return false; }
    subs.push({ title: sub.title || hostOf(sub.feed), feed: sub.feed, site: sub.site || originOf(sub.feed) });
    save(LS.subs, subs);
    toast(t('toast_subscribed_named', sub.title || hostOf(sub.feed)));
    renderSubs();
    return true;
  }
  function removeSub(feedUrl) {
    subs = subs.filter(function (s) { return s.feed !== feedUrl; });
    save(LS.subs, subs);
    delete cache[feedUrl]; saveCache();
    renderSubs();
    if (currentView === 'discover') { var q = $('#searchInput').value; if (q) runDiscover(q); else renderDiscoverDefault(); }
    toast(t('toast_unsubscribed'));
    refreshAll(false);
  }

  // ---------- saved (favorites / read later) ----------
  function keyOf(it) { return it.id || it.link || ''; }
  function findSavedIndex(it) {
    var k = keyOf(it); if (!k) return -1;
    for (var i = 0; i < saved.length; i++) if (keyOf(saved[i]) === k) return i;
    return -1;
  }
  function isFav(it)       { var i = findSavedIndex(it); return i >= 0 && !!saved[i].favorite; }
  function isReadLater(it) { var i = findSavedIndex(it); return i >= 0 && !!saved[i].readLater; }
  function savedRecord(it) {
    return { title: it.title, link: it.link, date: it.date, summary: it.summary,
             content: it.content || '', id: it.id, source: it.source, site: it.site, image: it.image || '' };
  }
  function toggleFlag(it, flag) {
    var i = findSavedIndex(it), rec;
    if (i >= 0) { rec = saved[i]; rec[flag] = !rec[flag]; }
    else { rec = savedRecord(it); rec.favorite = false; rec.readLater = false; rec[flag] = true; rec.savedAt = Date.now(); saved.push(rec); i = saved.length - 1; }
    var added = rec[flag];
    if (!rec.favorite && !rec.readLater) saved.splice(i, 1);
    save(LS.saved, saved);
    toast(t(flag === 'favorite'
      ? (added ? 'toast_fav_added' : 'toast_fav_removed')
      : (added ? 'toast_read_later_added' : 'toast_read_later_removed')));
  }
  function refreshSavedViews() { renderFavorites(); renderReadLater(); }

  // ---------- refresh / home ----------
  var homeItems = [];

  function refreshAll(force) {
    if (!subs.length) { homeItems = []; renderHome(); renderSourceFilters(); return Promise.resolve(); }
    var btn = $('#btnRefresh'); btn.classList.add('spin');
    var status = $('#feedStatus');
    status.hidden = false; status.className = 'feedstatus';
    status.textContent = t('status_refreshing', subs.length);

    var collected = [], failures = [];
    var jobs = subs.map(function (sub) {
      var cached = cache[sub.feed];
      var fresh = cached && (Date.now() - cached.t) < CACHE_TTL;
      if (fresh && !force) { cached.items.forEach(function (it) { collected.push(withSource(it, sub)); }); return Promise.resolve(); }
      return fetchText(sub.feed).then(function (txt) {
        var parsed = parseFeed(txt);
        var items = parsed.items.slice(0, MAX_ITEMS_PER_FEED);
        cache[sub.feed] = { t: Date.now(), items: items };
        if (parsed.title && (sub.title === hostOf(sub.feed) || !sub.title)) sub.title = parsed.title;
        items.forEach(function (it) { collected.push(withSource(it, sub)); });
      }).catch(function () {
        failures.push(sub.title);
        if (cache[sub.feed]) cache[sub.feed].items.forEach(function (it) { collected.push(withSource(it, sub)); });
      });
    });

    return Promise.all(jobs).then(function () {
      saveCache(); save(LS.subs, subs);
      collected.sort(function (a, b) { return (b.date || 0) - (a.date || 0); });
      homeItems = collected;
      renderHome(); renderSourceFilters();
      btn.classList.remove('spin');
      if (failures.length) { status.hidden = false; status.className = 'feedstatus err'; status.textContent = t('status_load_failed', failures.join(', ')); }
      else status.hidden = true;
    });
  }

  function saveCache() {
    try { localStorage.setItem(LS.cache, JSON.stringify(cache)); return; } catch (e) {}
    try {
      var slim = {};
      Object.keys(cache).forEach(function (k) {
        slim[k] = { t: cache[k].t, items: cache[k].items.map(function (it) {
          return { title: it.title, link: it.link, date: it.date, summary: it.summary, image: it.image || '', id: it.id };
        }) };
      });
      localStorage.setItem(LS.cache, JSON.stringify(slim));
    } catch (e2) {}
  }

  function withSource(item, sub) {
    return { title: item.title, link: item.link, date: item.date, summary: item.summary,
             content: item.content || '', image: item.image || '', id: item.id,
             source: sub.title, site: sub.site };
  }

  function fmtDate(ms) {
    if (!ms) return '';
    var diff = Date.now() - ms, day = 24 * 3600 * 1000;
    if (diff < 3600 * 1000) return t('time_minutes_ago', Math.max(1, Math.round(diff / 60000)));
    if (diff < day)         return t('time_hours_ago', Math.round(diff / 3600000));
    if (diff < 7 * day)     return t('time_days_ago', Math.round(diff / day));
    var loc = { en: 'en', it: 'it', es: 'es', fr: 'fr' }[currentLang()] || undefined;
    return new Date(ms).toLocaleDateString(loc, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // ---------- HTML sanitizing ----------
  var ALLOWED = { A:1,P:1,BR:1,HR:1,B:1,STRONG:1,I:1,EM:1,U:1,S:1,SMALL:1,MARK:1,
    H1:1,H2:1,H3:1,H4:1,H5:1,H6:1,UL:1,OL:1,LI:1,BLOCKQUOTE:1,Q:1,CITE:1,
    PRE:1,CODE:1,KBD:1,SAMP:1,FIGURE:1,FIGCAPTION:1,IMG:1,PICTURE:1,SOURCE:1,
    TABLE:1,THEAD:1,TBODY:1,TFOOT:1,TR:1,TD:1,TH:1,CAPTION:1,COLGROUP:1,COL:1,
    SPAN:1,DIV:1,SECTION:1,ARTICLE:1,TIME:1,ABBR:1,SUB:1,SUP:1,DL:1,DT:1,DD:1 };
  var STRIP_TAGS = { SCRIPT:1,STYLE:1,IFRAME:1,OBJECT:1,EMBED:1,FORM:1,INPUT:1,
    BUTTON:1,SELECT:1,TEXTAREA:1,LINK:1,META:1,NOSCRIPT:1,SVG:1,CANVAS:1,
    VIDEO:1,AUDIO:1,HEADER:1,FOOTER:1,NAV:1,ASIDE:1 };

  function safeUrl(u) { var s = (u || '').trim(); if (!s || /^(javascript|data|vbscript|file):/i.test(s)) return ''; return s; }

  function sanitizeHtml(html, base) {
    var doc = new DOMParser().parseFromString(html || '', 'text/html');
    var frag = document.createDocumentFragment();
    (function walk(srcNode, dest) {
      for (var n = srcNode.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3) { dest.appendChild(document.createTextNode(n.nodeValue)); continue; }
        if (n.nodeType !== 1) continue;
        var tag = n.tagName;
        if (STRIP_TAGS[tag]) continue;
        if (!ALLOWED[tag]) { walk(n, dest); continue; }
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

  // ---------- content cleaning ----------
  var CONTINUE_RE = /(continua a leggere|clicca qui per continuare|leggi (tutto|l['’]articolo|anche|di più)|continua »|read more|continue reading|\[…\]|\[\.\.\.\])/i;
  var JUNK_RE = /(share|social|related|correlat|leggi[-_]?anche|newsletter|subscribe|comment|commenti|advert|(^|[-_ ])adv?([-_ ]|$)|banner|promo|sponsor|widget|sidebar|author[-_]?box|post[-_]?tags|tag[-_]?list|breadcrumb|clickgo|outbrain|taboola|jp-relatedposts|wp-block-buttons)/i;
  var JUNK_HREF_RE = /(\/clickgo\/|outbrain|taboola|doubleclick|googlesyndication|adservice|amzn\.to|\/aff[\/_-]|utm_medium=affiliate)/i;

  function stripJunk(root) {
    Array.prototype.slice.call(root.querySelectorAll('[class],[id]')).forEach(function (n) {
      if (!n.parentNode) return;
      var key = (n.getAttribute('class') || '') + ' ' + (n.getAttribute('id') || '');
      if (JUNK_RE.test(key)) n.remove();
    });
    Array.prototype.slice.call(root.querySelectorAll('a[href]')).forEach(function (n) {
      if (!n.parentNode) return;
      if (JUNK_HREF_RE.test(n.getAttribute('href') || '')) n.remove();
    });
    Array.prototype.slice.call(root.querySelectorAll('a, h1, h2, h3, h4, strong, p')).forEach(function (n) {
      if (!n.parentNode) return;
      var tx = (n.textContent || '').trim();
      if (tx && tx.length < 70 && CONTINUE_RE.test(tx)) { (n.closest('h1,h2,h3,h4,p,li,div') || n).remove(); }
    });
    return root;
  }
  function cleanFeedHtml(html) {
    var doc = new DOMParser().parseFromString(html || '', 'text/html');
    stripJunk(doc.body);
    return doc.body.innerHTML;
  }
  function isTruncated(html) {
    var d = document.createElement('div'); d.innerHTML = html || '';
    var text = (d.textContent || '').trim();
    if (CONTINUE_RE.test(text)) return true;
    return text.length < 900;
  }

  function extractArticle(html, base) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    ['script','style','nav','header','footer','aside','form','noscript','iframe','svg'].forEach(function (sel) {
      Array.prototype.forEach.call(doc.querySelectorAll(sel), function (n) { n.remove(); });
    });
    var SELECTORS = ['[itemprop="articleBody"]', 'article .entry-content', '.entry-content',
      '.post-content', '.article-content', '.article-body', '.articleBody', '.post-body',
      '.td-post-content', '.single-post-content', '.post__content', '.article__content',
      '.content__article-body', 'main article', 'article'];
    var container = null;
    for (var i = 0; i < SELECTORS.length; i++) {
      var c = doc.querySelector(SELECTORS[i]);
      if (c && (c.textContent || '').trim().length > 400) { container = c; break; }
    }
    if (!container) {
      var best = null, bestScore = 0;
      Array.prototype.forEach.call(doc.querySelectorAll('div, section, article, main'), function (el2) {
        var text = (el2.textContent || '').trim();
        if (text.length < 200) return;
        var pLen = 0;
        Array.prototype.forEach.call(el2.querySelectorAll('p'), function (p) { var l = (p.textContent || '').trim().length; if (l > 40) pLen += l; });
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

  // ---------- reader panel ----------
  var readerItem = null;

  function setReaderNote(text, kind) {
    var slot = $('#readerNote'); slot.textContent = '';
    if (!text) { slot.hidden = true; return; }
    slot.hidden = false;
    slot.className = 'reader__note-slot' + (kind ? ' reader__note-slot--' + kind : '');
    slot.appendChild(document.createTextNode(text + ' '));
    if (readerItem && readerItem.link) {
      var a = el('a', null, t('reader_open_original'));
      a.href = readerItem.link; a.target = '_blank'; a.rel = 'noopener';
      slot.appendChild(a);
    }
  }
  function paintReaderToggle(btn, kind) {
    var on = kind === 'fav' ? isFav(readerItem) : isReadLater(readerItem);
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.textContent = kind === 'fav' ? (on ? '♥' : '♡') : '🔖';
    var lbl = kind === 'fav' ? t(on ? 'fav_remove' : 'fav_add') : t(on ? 'read_later_remove' : 'read_later_add');
    btn.title = lbl; btn.setAttribute('aria-label', lbl);
  }

  function openReader(item) {
    readerItem = item;
    $('#readerSource').textContent = item.source || '';
    $('#readerDate').textContent = item.date ? fmtDate(item.date) : '';
    var ttl = $('#readerTitle');
    ttl.textContent = item.title || '(untitled)';
    ttl.href = item.link || '#';
    $('#readerOriginal').href = item.link || '#';
    paintReaderToggle($('#readerFav'), 'fav');
    paintReaderToggle($('#readerRl'), 'rl');

    setReaderNote('');
    var body = $('#readerBody'); body.textContent = '';
    var feedHtml = (item.content && item.content.trim()) ? cleanFeedHtml(item.content) : '';
    if (feedHtml.trim()) body.appendChild(sanitizeHtml(feedHtml, item.link));
    else body.appendChild(el('p', 'reader__note', item.summary || t('no_preview')));

    var full = $('#readerFull');
    full.hidden = !item.link; full.disabled = false; full.textContent = t('reader_read_full');

    $('#readerModal').hidden = false;
    document.body.style.overflow = 'hidden';
    $('#readerScroll').scrollTop = 0;

    if (item.link && (!feedHtml.trim() || isTruncated(item.content || ''))) loadFullArticle(true);
  }
  function closeReader() { $('#readerModal').hidden = true; document.body.style.overflow = ''; }

  function loadFullArticle(auto) {
    if (!readerItem || !readerItem.link) return;
    var btn = $('#readerFull');
    btn.disabled = true; btn.textContent = t('reader_loading_full');
    if (auto) setReaderNote('');
    fetchText(readerItem.link).then(function (html) {
      var res = extractArticle(html, readerItem.link);
      if (res.chars < 400) throw new Error('too short');
      var body = $('#readerBody'); body.textContent = '';
      body.appendChild(sanitizeHtml(res.html, readerItem.link));
      setReaderNote('');
      $('#readerScroll').scrollTop = 0;
      btn.hidden = true;
    }).catch(function () {
      btn.disabled = false; btn.textContent = t('reader_retry_full');
      setReaderNote(t('reader_feed_preview_note'), 'warn');
    });
  }

  // ---------- article card (shared) ----------
  function makeToggle(kind, item, onToggle) {
    var isFavKind = kind === 'fav';
    var btn = el('button', 'toggle toggle--' + kind); btn.type = 'button';
    function paint() {
      var on = isFavKind ? isFav(item) : isReadLater(item);
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.textContent = isFavKind ? (on ? '♥' : '♡') : '🔖';
      var lbl = isFavKind ? t(on ? 'fav_remove' : 'fav_add') : t(on ? 'read_later_remove' : 'read_later_add');
      btn.title = lbl; btn.setAttribute('aria-label', lbl);
    }
    btn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      toggleFlag(item, isFavKind ? 'favorite' : 'readLater');
      paint(); if (onToggle) onToggle();
    });
    paint(); return btn;
  }

  function articleCard(it) {
    var card = el('article', 'article');
    var row = el('div', 'article__row');
    if (it.image) {
      var img = el('img', 'article__thumb'); img.src = it.image; img.alt = ''; img.loading = 'lazy';
      img.addEventListener('error', function () { img.remove(); });
      row.appendChild(img);
    }
    var main = el('div', 'article__main');
    var meta = el('div', 'article__meta');
    var src = el('span', 'article__src');
    src.appendChild(el('span', 'article__dot'));
    src.appendChild(document.createTextNode(it.source || ''));
    meta.appendChild(src);
    if (it.date) meta.appendChild(el('span', 'article__date', fmtDate(it.date)));
    main.appendChild(meta);

    var h = el('h3', 'article__title');
    var a = el('a', null, it.title);
    a.href = it.link || '#';
    a.addEventListener('click', function (e) { if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return; e.preventDefault(); openReader(it); });
    h.appendChild(a); main.appendChild(h);
    if (it.summary) main.appendChild(el('p', 'article__desc', it.summary));
    row.appendChild(main); card.appendChild(row);

    var foot = el('div', 'article__foot');
    var read = el('a', 'article__link', t('card_read_here')); read.href = it.link || '#';
    read.addEventListener('click', function (e) { if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return; e.preventDefault(); openReader(it); });
    foot.appendChild(read);
    var orig = el('a', 'article__link article__link--muted', t('reader_open_original'));
    orig.href = it.link || '#'; orig.target = '_blank'; orig.rel = 'noopener';
    foot.appendChild(orig);
    var acts = el('div', 'article__acts');
    acts.appendChild(makeToggle('fav', it, refreshSavedViews));
    acts.appendChild(makeToggle('rl', it, refreshSavedViews));
    foot.appendChild(acts);
    card.appendChild(foot);
    return card;
  }

  // ---------- rendering: home / favorites / read later ----------
  function renderHome() {
    var wrap = $('#articles'); wrap.textContent = '';
    var items = activeSource ? homeItems.filter(function (i) { return i.source === activeSource; }) : homeItems;
    $('#emptyState').hidden = subs.length > 0;
    $('#feedCount').textContent = subs.length
      ? (t('subscriptions_count', subs.length) + ' · ' + t('articles_count', homeItems.length))
      : t('home_empty_title');
    items.forEach(function (it) { wrap.appendChild(articleCard(it)); });
  }
  function renderFavorites() {
    var list = saved.filter(function (s) { return s.favorite; }).sort(function (a, b) { return (b.savedAt || 0) - (a.savedAt || 0); });
    var wrap = $('#favArticles'); wrap.textContent = '';
    $('#favEmpty').hidden = list.length > 0;
    list.forEach(function (it) { wrap.appendChild(articleCard(it)); });
  }
  function renderReadLater() {
    var list = saved.filter(function (s) { return s.readLater; }).sort(function (a, b) { return (b.savedAt || 0) - (a.savedAt || 0); });
    var wrap = $('#readLaterArticles'); wrap.textContent = '';
    $('#readLaterEmpty').hidden = list.length > 0;
    list.forEach(function (it) { wrap.appendChild(articleCard(it)); });
  }

  function renderSourceFilters() {
    var wrap = $('#sourceFilters'); wrap.textContent = '';
    if (subs.length < 2) return;
    var all = el('button', 'srcchip' + (activeSource ? '' : ' is-active'), t('filter_all'));
    all.onclick = function () { activeSource = null; renderSourceFilters(); renderHome(); };
    wrap.appendChild(all);
    subs.forEach(function (s) {
      var c = el('button', 'srcchip' + (activeSource === s.title ? ' is-active' : ''), s.title);
      c.onclick = function () { activeSource = s.title; renderSourceFilters(); renderHome(); };
      wrap.appendChild(c);
    });
  }

  // ---------- subscriptions view ----------
  function renderSubs() {
    var wrap = $('#subsList'); wrap.textContent = '';
    var countEl = $('#subsCount'); if (countEl) countEl.textContent = t('subscriptions_count', subs.length);
    if (!subs.length) { wrap.appendChild(el('div', 'subrow__empty', t('discover_subs_empty'))); return; }
    subs.forEach(function (s) {
      var rowEl = el('div', 'subrow');
      var body = el('div', 'subrow__body');
      body.appendChild(el('div', 'subrow__title', s.title));
      body.appendChild(el('div', 'subrow__url', s.feed));
      rowEl.appendChild(body);
      var btn = el('button', 'btn btn--ghost btn--dark btn--sm', t('action_remove'));
      btn.onclick = function () { removeSub(s.feed); };
      rowEl.appendChild(btn);
      wrap.appendChild(rowEl);
    });
  }

  // ---------- discover: matching ----------
  function deburr(s) { return (s || '').normalize('NFD').replace(/\p{Mn}+/gu, '').toLowerCase(); }
  var CAT_SYNONYMS = {
    'Tech':    ['tech','technology','tecnologia','tecnologie','informatica','tecnologia','tecnología','technologie','gadget'],
    'Tech IT': ['tech','tecnologia','informatica','italia','italiano','technology'],
    'News':    ['news','notizie','attualita','actualite','noticias','actualites','world','mondo'],
    'News IT': ['news','notizie','attualita','italia','italiano','cronaca'],
    'Dev':     ['dev','developer','sviluppo','programmazione','programming','desarrollo','developpement','code','coding','web'],
    'Science': ['science','scienza','ciencia','sciences','scienze','research','ricerca'],
    'Gaming':  ['gaming','games','giochi','videogiochi','videojuegos','jeux','gioco','game','videogame'],
    'Fun':     ['fun','divertimento','svago','humor','humour','diversion','ocio','comics']
  };
  function matchCatalog(query) {
    var dq = deburr(query).trim();
    if (!dq) return catalog.slice();
    var tokens = dq.split(/\s+/);
    var res = catalog.filter(function (f) {
      var hay = deburr((f.title || '') + ' ' + (f.site || '') + ' ' + (f.category || ''));
      var group = (CAT_SYNONYMS[f.category] || []).map(deburr);
      return tokens.every(function (tok) {
        if (hay.indexOf(tok) >= 0) return true;
        return group.some(function (syn) { return syn.indexOf(tok) >= 0; });
      });
    });
    res.sort(function (a, b) {
      var ta = deburr(a.title), tb = deburr(b.title);
      var sa = ta.indexOf(dq) === 0 ? 0 : ta.indexOf(dq) >= 0 ? 1 : 2;
      var sb = tb.indexOf(dq) === 0 ? 0 : tb.indexOf(dq) >= 0 ? 1 : 2;
      return sa - sb;
    });
    return res;
  }

  // ---------- discover: cards ----------
  function catalogCard(entry) {
    var card = el('div', 'fcard');
    card.appendChild(el('span', 'fcard__cat', entry.category || 'Feed'));
    card.appendChild(el('h3', 'fcard__title', entry.title));
    card.appendChild(el('p', 'fcard__url', entry.feed));
    var btns = el('div', 'fcard__btns');
    if (isSubscribed(entry.feed)) {
      var done = el('button', 'btn btn--ghost btn--dark btn--sm', t('discover_subscribed')); done.disabled = true; done.style.opacity = '.7';
      btns.appendChild(done);
    } else {
      var add = el('button', 'btn btn--primary btn--sm', t('discover_subscribe'));
      add.onclick = function () { addSub({ title: entry.title, feed: entry.feed, site: entry.site }); var q = $('#searchInput').value; q ? runDiscover(q) : renderDiscoverDefault(); refreshAll(false); };
      btns.appendChild(add);
    }
    if (entry.site) { var v = el('a', 'btn btn--ghost btn--dark btn--sm', t('site_link')); v.href = entry.site; v.target = '_blank'; v.rel = 'noopener'; btns.appendChild(v); }
    card.appendChild(btns);
    return card;
  }

  function feedlyCard(r) {
    var card = el('div', 'fcard');
    var head = el('div', 'fcard__head');
    if (r.icon) { var ic = el('img', 'fcard__icon'); ic.src = r.icon; ic.alt = ''; ic.loading = 'lazy'; ic.addEventListener('error', function () { ic.remove(); }); head.appendChild(ic); }
    head.appendChild(el('span', 'fcard__cat', hostOf(r.site || r.feed)));
    card.appendChild(head);
    card.appendChild(el('h3', 'fcard__title', r.title));
    if (r.description) card.appendChild(el('p', 'fcard__desc', r.description));
    else card.appendChild(el('p', 'fcard__url', r.feed));
    var btns = el('div', 'fcard__btns');
    if (isSubscribed(r.feed)) {
      var done = el('button', 'btn btn--ghost btn--dark btn--sm', t('discover_subscribed')); done.disabled = true; done.style.opacity = '.7';
      btns.appendChild(done);
    } else {
      var add = el('button', 'btn btn--primary btn--sm', t('discover_subscribe'));
      add.onclick = function () { addSub({ title: r.title, feed: r.feed, site: r.site }); runDiscover($('#searchInput').value); refreshAll(false); };
      btns.appendChild(add);
    }
    if (r.site) { var v = el('a', 'btn btn--ghost btn--dark btn--sm', t('site_link')); v.href = r.site; v.target = '_blank'; v.rel = 'noopener'; btns.appendChild(v); }
    card.appendChild(btns);
    return card;
  }

  function addByUrlCard(url) {
    var card = el('div', 'fcard');
    card.appendChild(el('span', 'fcard__cat', t('discover_custom_url_label')));
    card.appendChild(el('h3', 'fcard__title', hostOf(normalizeUrl(url))));
    card.appendChild(el('p', 'fcard__url', normalizeUrl(url)));
    var btns = el('div', 'fcard__btns');
    var add = el('button', 'btn btn--primary btn--sm', t('discover_find_subscribe'));
    add.onclick = function () {
      add.disabled = true; add.textContent = t('discover_searching');
      discover(url).then(function (found) {
        if (isSubscribed(found.feed)) toast(t('toast_already_subscribed'));
        else { addSub(found); refreshAll(false); }
        $('#searchInput').value = ''; renderDiscoverDefault();
      }).catch(function () { add.disabled = false; add.textContent = t('discover_find_subscribe'); toast(t('toast_no_feed_found'), true); });
    };
    btns.appendChild(add);
    card.appendChild(btns);
    return card;
  }

  // ---------- discover: Feedly search ----------
  function searchFeedly(query) {
    return fetchText(FEEDLY_SEARCH + encodeURIComponent(query))
      .then(function (txt) { return JSON.parse(txt); })
      .then(function (data) {
        var results = (data && data.results) || [];
        return results.map(function (r) {
          var feed = (r.feedId || '').replace(/^feed\//, '');
          return { title: r.title || hostOf(feed), feed: feed, site: r.website || originOf(feed),
                   description: r.description || '', icon: r.iconUrl || r.visualUrl || '' };
        }).filter(function (r) { return r.feed; });
      });
  }

  var searchSeq = 0;
  function runDiscover(query) {
    query = (query || '').trim();
    var wrap = $('#catalogResults'), status = $('#discoverStatus');
    if (!query) { status.hidden = true; renderDiscoverDefault(); return; }
    var myseq = ++searchSeq;
    wrap.textContent = '';
    if (looksLikeUrl(query)) wrap.appendChild(addByUrlCard(query));
    status.hidden = false; status.className = 'feedstatus'; status.textContent = t('discover_searching');
    searchFeedly(query).then(function (results) {
      if (myseq !== searchSeq) return;
      status.hidden = true;
      wrap.textContent = '';
      if (looksLikeUrl(query)) wrap.appendChild(addByUrlCard(query));
      if (results.length) results.forEach(function (r) { wrap.appendChild(feedlyCard(r)); });
      else fallbackCatalog(query);
    }).catch(function () {
      if (myseq !== searchSeq) return;
      status.hidden = true; fallbackCatalog(query);
    });
  }
  function fallbackCatalog(query) {
    var wrap = $('#catalogResults');
    if (!looksLikeUrl(query)) wrap.textContent = '';
    var matches = matchCatalog(query);
    if (matches.length) {
      wrap.appendChild(el('p', 'hint', t('discover_search_fallback')));
      matches.forEach(function (f) { wrap.appendChild(catalogCard(f)); });
    } else if (!looksLikeUrl(query)) {
      wrap.appendChild(el('p', 'hint', t('discover_no_match', query)));
    }
  }
  function renderDiscoverDefault() {
    var wrap = $('#catalogResults'); wrap.textContent = '';
    $('#discoverStatus').hidden = true;
    catalog.forEach(function (f) { wrap.appendChild(catalogCard(f)); });
  }
  function filterCatalogLocal(q) {
    var wrap = $('#catalogResults'); wrap.textContent = ''; $('#discoverStatus').hidden = true;
    matchCatalog(q).forEach(function (f) { wrap.appendChild(catalogCard(f)); });
  }
  function buildCategoryChips() {
    var wrap = $('#searchCats'); if (!wrap) return;
    var cats = [];
    catalog.forEach(function (f) { if (f.category && cats.indexOf(f.category) < 0) cats.push(f.category); });
    wrap.textContent = '';
    cats.forEach(function (c) {
      var chip = el('button', 'srcchip', c); chip.type = 'button';
      chip.onclick = function () { $('#searchInput').value = c; filterCatalogLocal(c); };
      wrap.appendChild(chip);
    });
  }

  // ---------- OPML / JSON import-export ----------
  function exportOpml() {
    if (!subs.length) { toast(t('toast_nothing_export')); return; }
    var lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<opml version="2.0">',
      '  <head><title>frontek reads subscriptions</title></head>', '  <body>'];
    subs.forEach(function (s) {
      lines.push('    <outline type="rss" text="' + esc(s.title) + '" title="' + esc(s.title) +
        '" xmlUrl="' + esc(s.feed) + '" htmlUrl="' + esc(s.site || '') + '"/>');
    });
    lines.push('  </body>', '</opml>');
    try { download('frontek-reads.opml', lines.join('\n'), 'text/xml'); toast(t('toast_export_ok')); }
    catch (e) { toast(t('toast_export_fail'), true); }
  }
  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function download(name, content, type) {
    var blob = new Blob([content], { type: type });
    var a = el('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
  }
  function importFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var text = reader.result, added = 0;
      try {
        if (/^\s*[[{]/.test(text)) {
          var arr = JSON.parse(text);
          if (Array.isArray(arr)) arr.forEach(function (s) {
            if (s.feed && !isSubscribed(s.feed)) { subs.push({ title: s.title || hostOf(s.feed), feed: s.feed, site: s.site || originOf(s.feed) }); added++; }
          });
        } else {
          var doc = new DOMParser().parseFromString(text, 'text/xml');
          $$('outline[xmlUrl], outline[xmlurl]', doc).forEach(function (o) {
            var feed = o.getAttribute('xmlUrl') || o.getAttribute('xmlurl');
            if (feed && !isSubscribed(feed)) {
              subs.push({ title: o.getAttribute('text') || o.getAttribute('title') || hostOf(feed), feed: feed, site: o.getAttribute('htmlUrl') || originOf(feed) });
              added++;
            }
          });
        }
      } catch (e) { toast(t('toast_import_read_fail'), true); return; }
      save(LS.subs, subs);
      renderSubs();
      toast(added ? t('feeds_imported', added) : t('toast_no_new_feeds'));
      refreshAll(false);
    };
    reader.readAsText(file);
  }

  // ---------- font scale ----------
  function applyFontScale() {
    var s = Math.min(180, Math.max(80, settings.fontScale || 100));
    document.documentElement.style.fontSize = s + '%';
  }
  function setFontScale(v) {
    v = Math.min(180, Math.max(80, v));
    settings.fontScale = v; save(LS.settings, settings);
    applyFontScale(); $('#fontVal').textContent = v + '%';
  }

  // ---------- routing / views ----------
  var VIEWS = ['home', 'favorites', 'readlater', 'discover', 'subs'];
  function showView(name) {
    if (VIEWS.indexOf(name) < 0) name = 'home';
    currentView = name;
    VIEWS.forEach(function (v) { $('#view-' + v).hidden = v !== name; });
    $$('.nav__links a').forEach(function (a) { a.classList.toggle('is-active', a.getAttribute('data-view') === name); });
    if (name === 'favorites') renderFavorites();
    if (name === 'readlater') renderReadLater();
    if (name === 'subs') renderSubs();
    if (name === 'discover') { var q = $('#searchInput').value; if (!q) renderDiscoverDefault(); }
    window.scrollTo(0, 0);
  }
  function routeFromHash() { showView((location.hash || '').replace('#', '') || 'home'); }

  // ---------- settings ----------
  function openSettings() {
    $('#proxyInput').value = settings.proxy;
    $('#langSelect').value = settings.lang || 'system';
    $('#fontVal').textContent = (settings.fontScale || 100) + '%';
    $('#settingsModal').hidden = false;
  }
  function closeSettings() { $('#settingsModal').hidden = true; }
  function closeAnyModal(node) {
    var m = node && node.closest ? node.closest('.modal') : null;
    if (m === $('#readerModal')) { closeReader(); return; }
    if (m) m.hidden = true; else closeSettings();
  }

  // ---------- render everything (used after i18n / language change) ----------
  function renderAll() {
    renderHome(); renderFavorites(); renderReadLater(); renderSourceFilters(); renderSubs(); buildCategoryChips();
    if (currentView === 'discover') { var q = $('#searchInput').value; q ? runDiscover(q) : renderDiscoverDefault(); }
    else renderDiscoverDefault();
  }

  // ---------- wire up ----------
  function init() {
    $('#year').textContent = new Date().getFullYear();

    $('#navToggle').onclick = function () { $('#navLinks').classList.toggle('open'); };
    $$('.nav__links a, [data-view]').forEach(function (a) {
      if (a.getAttribute('data-view')) a.addEventListener('click', function () { $('#navLinks').classList.remove('open'); });
    });
    window.addEventListener('hashchange', routeFromHash);

    $('#btnSubs').onclick = function () { location.hash = '#subs'; };
    $('#btnRefresh').onclick = function () { refreshAll(true); };
    $('#btnSettings').onclick = openSettings;

    $$('[data-close]').forEach(function (b) { b.onclick = function () { closeAnyModal(b); }; });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (!$('#readerModal').hidden) closeReader();
        else if (!$('#settingsModal').hidden) closeSettings();
      }
    });

    // reader
    $('#readerFull').onclick = function () { loadFullArticle(false); };
    $('#readerFav').onclick = function () { if (!readerItem) return; toggleFlag(readerItem, 'favorite'); paintReaderToggle($('#readerFav'), 'fav'); refreshSavedViews(); };
    $('#readerRl').onclick  = function () { if (!readerItem) return; toggleFlag(readerItem, 'readLater'); paintReaderToggle($('#readerRl'), 'rl'); refreshSavedViews(); };

    // settings: proxy
    $('#proxyDefault').onclick = function () { $('#proxyInput').value = DEFAULT_PROXY; };
    $('#proxyInput').addEventListener('change', function () {
      settings.proxy = $('#proxyInput').value.trim() || DEFAULT_PROXY; save(LS.settings, settings);
    });
    // settings: language
    $('#langSelect').addEventListener('change', function () { settings.lang = this.value; save(LS.settings, settings); applyI18n(); });
    // settings: font size
    $('#fontMinus').onclick = function () { setFontScale((settings.fontScale || 100) - 10); };
    $('#fontPlus').onclick  = function () { setFontScale((settings.fontScale || 100) + 10); };
    $('#fontReset').onclick = function () { setFontScale(100); };
    // settings: data
    $('#btnClearCache').onclick = function () { cache = {}; save(LS.cache, cache); toast(t('toast_cache_cleared')); refreshAll(true); };
    $('#btnClearAll').onclick = function () {
      if (!confirm(t('confirm_delete_body'))) return;
      [LS.subs, LS.cache, LS.settings, LS.saved].forEach(function (k) { localStorage.removeItem(k); });
      subs = []; cache = {}; saved = []; settings = { proxy: DEFAULT_PROXY, fontScale: 100 };
      applyFontScale();
      renderSubs(); renderSourceFilters(); homeItems = []; renderHome(); refreshSavedViews();
      closeSettings(); toast(t('toast_all_deleted'));
    };

    // search (debounced Feedly search)
    var debTimer;
    $('#searchForm').addEventListener('submit', function (e) { e.preventDefault(); clearTimeout(debTimer); runDiscover($('#searchInput').value); });
    $('#searchInput').addEventListener('input', function () {
      clearTimeout(debTimer); var v = this.value;
      debTimer = setTimeout(function () { runDiscover(v); }, 350);
    });

    // import/export
    $('#btnExport').onclick = exportOpml;
    $('#btnImport').onclick = function () { $('#importFile').click(); };
    $('#importFile').addEventListener('change', function (e) { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ''; });

    applyFontScale();
    applyI18n();      // static strings + initial dynamic render
    routeFromHash();

    fetch('assets/catalog.json').then(function (r) { return r.json(); }).then(function (data) {
      catalog = (data && data.feeds) || [];
      buildCategoryChips();
      if (currentView === 'discover' && !$('#searchInput').value) renderDiscoverDefault();
    }).catch(function () {});

    refreshAll(false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
