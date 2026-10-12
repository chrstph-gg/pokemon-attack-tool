(function () {
  "use strict";

  var docEl = document.documentElement;

  function looksLikeEditor() {
    try {
      if (window.top !== window.self) return true;
      if (/Bootstrap ?Studio|Electron/i.test(navigator.userAgent)) return true;
      if (!window.requestAnimationFrame) return true;
      return false;
    } catch (e) {
      return true;
    }
  }

  docEl.classList.remove("no-js");
  docEl.classList.add("js");
  var ANIMATE = !looksLikeEditor();
  if (ANIMATE) docEl.classList.add("js-anim");

  var CONFIG = Object.assign({
    apiUrl: "api/pokedex.php",
    fallbackScript: "assets/data/pokedex.js",
    spriteUrl: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/{id}.png",
    artworkUrl: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/{id}.png",
    defaultLang: "de",
    fallbackLang: "en",
    pageSize: 60,
    storageKey: "tc-lang"
  }, window.TC_CONFIG || {});

  var ROWS = ["x4", "x2", "x1", "half", "x0"];

  var state = {
    data: null,
    loadFailed: false,
    lang: CONFIG.defaultLang,
    types: [],
    typeIndex: {},
    entries: [],
    byId: {},
    selected: null,
    results: [],
    rendered: 0,
    active: -1,
    open: false
  };

  var el = {};

  function dict(code) {
    return (window.TC_I18N && window.TC_I18N[code]) || {};
  }

  function t(key, vars) {
    var s = dict(state.lang)[key] || dict(CONFIG.fallbackLang)[key] || dict(CONFIG.defaultLang)[key] || key;
    if (vars) {
      s = s.replace(/\{(\w+)\}/g, function (m, k) {
        return vars[k] != null ? vars[k] : m;
      });
    }
    return s;
  }

  function enabledLangs() {
    var all = window.TC_I18N || {};
    var codes = state.data ? state.data.languages.map(function (l) { return l.code; })
                           : ["de", "en", "fr", "ja", "ko", "zh"];
    Object.keys(all).forEach(function (c) { if (codes.indexOf(c) < 0) codes.push(c); });
    return codes.filter(function (c) { return all[c] && all[c]._meta && all[c]._meta.enabled; });
  }

  function readStoredLang() {
    try { return window.localStorage.getItem(CONFIG.storageKey); } catch (e) { return null; }
  }
  function storeLang(code) {
    try { window.localStorage.setItem(CONFIG.storageKey, code); } catch (e) { /* privat-Modus */ }
  }

  function pickInitialLang() {
    var enabled = enabledLangs();
    var fromUrl = new URLSearchParams(window.location.search).get("lang");
    var candidates = [fromUrl, readStoredLang()]
      .concat((navigator.languages || [navigator.language || ""]).map(function (l) {
        return String(l).toLowerCase().split("-")[0];
      }));
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i] && enabled.indexOf(candidates[i]) >= 0) return candidates[i];
    }
    return enabled.indexOf(CONFIG.defaultLang) >= 0 ? CONFIG.defaultLang : (enabled[0] || CONFIG.defaultLang);
  }

  function applyStaticTexts() {
    docEl.lang = state.lang;
    document.querySelectorAll("[data-i18n]").forEach(function (node) {
      node.textContent = t(node.getAttribute("data-i18n"));
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach(function (node) {
      node.setAttribute("placeholder", t(node.getAttribute("data-i18n-placeholder")));
    });
    document.querySelectorAll("[data-i18n-aria-label]").forEach(function (node) {
      node.setAttribute("aria-label", t(node.getAttribute("data-i18n-aria-label")));
    });
  }

  function buildLangSelect() {
    var select = el.langSelect;
    select.innerHTML = "";
    enabledLangs().forEach(function (code) {
      var opt = document.createElement("option");
      opt.value = code;
      opt.textContent = dict(code)._meta.name;
      opt.lang = code;
      select.appendChild(opt);
    });
    select.value = state.lang;
    select.closest(".tc-lang").hidden = select.options.length < 2;
  }

  function setLang(code) {
    state.lang = code;
    storeLang(code);
    applyStaticTexts();
    el.langSelect.value = code;
    if (state.selected) {
      if (!state.open) el.input.value = displayName(state.selected);
      renderResult(false);
    }
    if (state.open) {
      updateResults();
    } else {
      updateStatus();
    }
  }

  function isValid(d) {
    return d && Array.isArray(d.pokemon) && d.pokemon.length && Array.isArray(d.types) && Array.isArray(d.chart);
  }

  function fetchApi() {
    if (!CONFIG.apiUrl || !window.fetch || window.location.protocol === "file:") {
      return Promise.reject(new Error("API nicht verfügbar"));
    }
    return fetch(CONFIG.apiUrl, { headers: { Accept: "application/json" } })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (d) {
        if (!isValid(d)) throw new Error("Ungültige API-Antwort");
        return d;
      });
  }

  function loadFallback() {
    if (isValid(window.TC_POKEDEX)) return Promise.resolve(window.TC_POKEDEX);
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = CONFIG.fallbackScript;
      s.onload = function () {
        isValid(window.TC_POKEDEX) ? resolve(window.TC_POKEDEX) : reject(new Error("Fallback leer"));
      };
      s.onerror = function () { reject(new Error("Fallback nicht gefunden")); };
      document.head.appendChild(s);
    });
  }

  function loadData() {
    return fetchApi().catch(function (err) {
      if (window.console) console.info("[PAT (Pokemon-Attack-Tool)] API nicht erreichbar, nutze Fallback-Daten:", err.message);
      return loadFallback();
    });
  }


  var SEPARATORS = /[\s\-\u2010-\u2015_.,'\u2019\u2018`\u00b4:;\u00b7\u30fb\u2022()\[\]{}!?\u00a1\u00bf"\u201c\u201d\u201e\u00ab\u00bb\/\\]+/g;

  function norm(str) {
    var s = String(str || "");
    if (s.normalize) s = s.normalize("NFKD");
    s = s.replace(/[\u0300-\u036f]/g, "");
    if (s.normalize) s = s.normalize("NFC");
    s = s.toLowerCase();
    s = s.replace(/[\u3041-\u3096]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) + 0x60);
    });
    return s.replace(SEPARATORS, " ").trim();
  }

  function buildIndex(data) {
    state.types = data.types.map(function (ty, i) {
      var hex = ty.color.replace("#", "");
      state.typeIndex[ty.id] = i;
      return {
        id: ty.id,
        n: ty.n,
        rgb: [0, 2, 4].map(function (o) { return parseInt(hex.substr(o, 2), 16); }).join(", ")
      };
    });

    state.entries = data.pokemon.map(function (p, i) {
      var keys = [];
      var seen = {};
      function add(raw, lang) {
        var s = norm(raw);
        if (!s || seen[s]) return;
        seen[s] = true;
        keys.push({ s: s, c: s.replace(/ /g, ""), raw: raw, lang: lang });
      }
      Object.keys(p.n).forEach(function (l) { add(p.n[l], l); });
      (p.a || []).forEach(function (a) { add(a, "alias"); });
      var entry = { p: p, i: i, no: String(p.no), keys: keys };
      state.byId[p.id] = entry;
      return entry;
    });
  }

  function everyTokenStartsWord(s, tokens) {
    var words = s.split(" ");
    return tokens.every(function (tok) {
      return words.some(function (w) { return w.indexOf(tok) === 0; });
    });
  }

  function search(query) {
    var q = norm(query);
    if (!q) {
      return state.entries.map(function (e) { return { e: e, hit: null }; });
    }

    var num = /^#?\s*0*(\d+)$/.exec(String(query).trim());
    var tokens = q.split(" ");
    var compact = tokens.join("");
    var found = [];

    state.entries.forEach(function (e) {
      var formPenalty = e.p.id >= 10000 ? 0.2 : 0;

      if (num) {
        if (e.no === num[1]) found.push({ e: e, score: formPenalty, hit: null });
        else if (e.no.indexOf(num[1]) === 0) found.push({ e: e, score: 2 + formPenalty, hit: null });
        return;
      }

      var best = Infinity;
      var hit = null;
      for (var k = 0; k < e.keys.length; k++) {
        var key = e.keys[k];
        var score;
        if (key.c === compact) score = 0;
        else if (key.c.indexOf(compact) === 0) score = 1;
        else if (everyTokenStartsWord(key.s, tokens)) score = 2;
        else if (key.c.indexOf(compact) >= 0 ||
                 tokens.every(function (tok) { return key.s.indexOf(tok) >= 0; })) score = 3;
        else continue;
        if (key.lang !== state.lang) score += 0.5;
        if (score < best) { best = score; hit = key; }
      }
      if (hit) found.push({ e: e, score: best + formPenalty, hit: hit });
    });

    found.sort(function (a, b) { return a.score - b.score || a.e.i - b.e.i; });
    return found;
  }

  function displayName(p, lang) {
    return p.n[lang || state.lang] || p.n[CONFIG.fallbackLang] || p.n[CONFIG.defaultLang] || "";
  }
  function typeName(slug) {
    var ty = state.types[state.typeIndex[slug]];
    return (ty && (ty.n[state.lang] || ty.n[CONFIG.fallbackLang])) || slug;
  }
  function pad(no) {
    return ("000" + no).slice(-4);
  }
  function url(template, id) {
    return template ? template.replace("{id}", id) : "";
  }
  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function typeDot(slug) {
    var dot = make("span", "tc-dot tc-type");
    dot.setAttribute("data-type", slug);
    return dot;
  }

  function openPopover() {
    if (state.open) return;
    state.open = true;
    el.popover.classList.add("is-open");
    el.input.setAttribute("aria-expanded", "true");
  }

  function closePopover() {
    if (!state.open) return;
    state.open = false;
    el.popover.classList.remove("is-open");
    el.input.setAttribute("aria-expanded", "false");
    el.input.removeAttribute("aria-activedescendant");
  }

  function currentQuery() {
    var v = el.input.value;
    if (state.selected && v === displayName(state.selected)) return "";
    return v;
  }

  function updateResults() {
    if (!state.data) { updateStatus(); return; }
    var q = currentQuery();
    state.results = search(q);
    state.active = q.trim() && state.results.length ? 0 : -1;
    renderList(true);

    if (!q.trim() && state.selected) {
      var idx = indexOfSelected();
      if (idx >= 0) setActive(idx, true);
    } else {
      setActive(state.active, true);
    }
    updateStatus();
    announceCount(q);
  }

  function indexOfSelected() {
    for (var i = 0; i < state.results.length; i++) {
      if (state.results[i].e.p.id === state.selected.id) return i;
    }
    return -1;
  }

  function renderList(reset) {
    if (reset) {
      el.listbox.innerHTML = "";
      el.listbox.scrollTop = 0;
      state.rendered = 0;
    }
    var end = Math.min(state.results.length, state.rendered + CONFIG.pageSize);
    var frag = document.createDocumentFragment();
    for (var i = state.rendered; i < end; i++) frag.appendChild(optionNode(state.results[i], i));
    el.listbox.appendChild(frag);
    state.rendered = end;
  }

  function ensureRendered(index) {
    while (index >= state.rendered && state.rendered < state.results.length) renderList(false);
  }

  function optionNode(result, index) {
    var p = result.e.p;
    var name = displayName(p);
    var li = make("li", "tc-option");
    li.id = "tc-opt-" + index;
    li.setAttribute("role", "option");
    li.setAttribute("data-index", index);
    li.setAttribute("aria-selected", state.selected && state.selected.id === p.id ? "true" : "false");

    if (CONFIG.spriteUrl) {
      var img = make("img", "tc-option__sprite");
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.width = 44;
      img.height = 44;
      img.onerror = function () { img.classList.add("is-broken"); };
      img.src = url(CONFIG.spriteUrl, p.id);
      li.appendChild(img);
    } else {
      li.appendChild(make("span"));
    }

    var text = make("span", "tc-option__text");
    text.appendChild(make("span", "tc-option__name", name));
    if (result.hit && result.hit.raw !== name) {
      text.appendChild(make("span", "tc-option__alias", result.hit.raw));
    }
    li.appendChild(text);

    var meta = make("span", "tc-option__meta");
    var dots = make("span", "tc-option__dots");
    p.t.forEach(function (slug) {
      var d = typeDot(slug);
      d.title = typeName(slug);
      dots.appendChild(d);
    });
    meta.appendChild(dots);
    meta.appendChild(make("span", "tc-option__no", "#" + pad(p.no)));
    li.appendChild(meta);
    return li;
  }

  function setActive(index, scroll) {
    var prev = el.listbox.querySelector(".tc-option.is-active");
    if (prev) prev.classList.remove("is-active");
    state.active = index;
    if (index < 0) {
      el.input.removeAttribute("aria-activedescendant");
      return;
    }
    ensureRendered(index);
    var node = document.getElementById("tc-opt-" + index);
    if (!node) return;
    node.classList.add("is-active");
    el.input.setAttribute("aria-activedescendant", node.id);
    if (scroll) node.scrollIntoView({ block: "nearest" });
  }

  function moveActive(delta) {
    if (!state.results.length) return;
    var next = state.active + delta;
    if (next < 0) next = 0;
    if (next > state.results.length - 1) next = state.results.length - 1;
    setActive(next, true);
  }

  function updateStatus() {
    var msg = "";
    if (state.loadFailed) msg = t("search.loadError");
    else if (!state.data) msg = t("search.loading");
    else if (!state.results.length) msg = t("search.noResults", { query: el.input.value.trim() });
    el.status.textContent = msg;
  }

  var announceTimer = null;
  function announceCount(q) {
    clearTimeout(announceTimer);
    if (!q.trim()) return;
    announceTimer = setTimeout(function () {
      el.live.textContent = state.results.length ? t("search.results", { count: state.results.length }) : "";
    }, 450);
  }

  function updateClearButton() {
    el.clear.hidden = !el.input.value;
  }

  function selectPokemon(p, opts) {
    opts = opts || {};
    state.selected = p;
    el.input.value = displayName(p);
    updateClearButton();
    closePopover();
    renderResult(opts.animate !== false);

    if (!opts.fromHash && window.history && window.history.replaceState) {
      window.history.replaceState(null, "", "#" + p.id);
    }
    if (opts.fromPointer && window.matchMedia && window.matchMedia("(pointer: coarse)").matches) {
      el.input.blur();
    }
    el.live.textContent = t("result.announce", {
      name: displayName(p),
      types: p.t.map(typeName).join(", ")
    });
  }

  function matchups(p) {
    var defIdx = p.t.map(function (slug) { return state.typeIndex[slug]; });
    var chart = state.data.chart;
    var groups = { x4: [], x2: [], x1: [], half: [], x0: [] };
    state.types.forEach(function (ty, a) {
      var m = 1;
      defIdx.forEach(function (d) { m *= chart[a][d] / 100; });
      var row = m >= 4 ? "x4" : m >= 2 ? "x2" : m === 1 ? "x1" : m === 0 ? "x0" : "half";
      groups[row].push({ slug: ty.id, m: m });
    });
    groups.half.sort(function (x, y) { return x.m - y.m; });
    return groups;
  }

  function renderResult(animate) {
    var p = state.selected;
    if (!p) return;
    var name = displayName(p);
    var primary = state.types[state.typeIndex[p.t[0]]];

    el.card.classList.add("has-result");
    docEl.style.setProperty("--accent", primary.rgb);

    el.dex.textContent = t("result.dex", { no: pad(p.no) });
    el.name.textContent = name;
    el.badges.innerHTML = "";
    el.badges.setAttribute("aria-label", t("result.typesLabel", { name: name }));
    p.t.forEach(function (slug) {
      var b = make("li", "tc-badge tc-type", typeName(slug));
      b.setAttribute("data-type", slug);
      el.badges.appendChild(b);
    });

    var artSrc = url(CONFIG.artworkUrl, p.id);
    el.art.alt = t("result.artworkAlt", { name: name });
    if (artSrc && el.art.getAttribute("src") !== artSrc) {
      el.art.classList.remove("is-broken");
      el.art.classList.add("is-loading");
      el.art.src = artSrc;
    }

    var groups = matchups(p);
    el.matchups.setAttribute("aria-label", t("result.matchupLabel", { name: name }));
    ROWS.forEach(function (key) {
      var row = el.matchups.querySelector('[data-row="' + key + '"]');
      var list = row.querySelector(".tc-chips");
      list.innerHTML = "";
      row.classList.toggle("is-empty", !groups[key].length);
      if (!groups[key].length) {
        list.appendChild(make("li", "tc-chips__none", t("eff.none")));
        return;
      }
      groups[key].forEach(function (item) {
        var chip = make("li", "tc-chip tc-type");
        chip.setAttribute("data-type", item.slug);
        chip.appendChild(typeDot(item.slug));
        chip.appendChild(document.createTextNode(typeName(item.slug)));
        if (item.m === 0.25) {
          var q = make("span", "tc-chip__quarter", "¼");
          q.title = t("eff.quarter");
          q.setAttribute("aria-label", t("eff.quarter"));
          chip.appendChild(q);
        }
        list.appendChild(chip);
      });
    });

    if (animate && ANIMATE) {
      el.result.classList.add("is-entering");
      void el.result.offsetWidth;
      window.requestAnimationFrame(function () {
        el.result.classList.remove("is-entering");
      });
    }
  }

  function selectFromHash() {
    var id = parseInt(String(window.location.hash).replace(/[^0-9]/g, ""), 10);
    var entry = id && state.byId[id];
    if (entry && (!state.selected || state.selected.id !== id)) {
      selectPokemon(entry.p, { fromHash: true });
    }
  }

  function bindEvents() {
    el.input.addEventListener("focus", function () {
      openPopover();
      updateResults();
      if (state.selected && el.input.value === displayName(state.selected)) el.input.select();
    });

    el.input.addEventListener("input", function () {
      updateClearButton();
      openPopover();
      updateResults();
    });

    el.input.addEventListener("keydown", function (ev) {
      switch (ev.key) {
        case "ArrowDown":
          ev.preventDefault();
          if (!state.open) { openPopover(); updateResults(); }
          else moveActive(1);
          break;
        case "ArrowUp":
          ev.preventDefault();
          moveActive(-1);
          break;
        case "PageDown":
          if (state.open) { ev.preventDefault(); moveActive(8); }
          break;
        case "PageUp":
          if (state.open) { ev.preventDefault(); moveActive(-8); }
          break;
        case "Enter":
          if (ev.isComposing) return;
          if (state.open && state.results.length) {
            ev.preventDefault();
            var r = state.results[state.active >= 0 ? state.active : 0];
            selectPokemon(r.e.p);
          }
          break;
        case "Escape":
          if (state.open) {
            ev.preventDefault();
            closePopover();
            if (state.selected) { el.input.value = displayName(state.selected); updateClearButton(); }
          } else if (el.input.value) {
            el.input.value = "";
            updateClearButton();
          }
          break;
        case "Tab":
          closePopover();
          break;
      }
    });

    el.input.addEventListener("blur", function () {
      closePopover();
      if (state.selected && !el.input.value.trim()) {
        el.input.value = displayName(state.selected);
        updateClearButton();
      }
    });

    el.popover.addEventListener("mousedown", function (ev) { ev.preventDefault(); });

    el.listbox.addEventListener("click", function (ev) {
      var node = ev.target.closest(".tc-option");
      if (!node) return;
      var r = state.results[+node.getAttribute("data-index")];
      if (r) selectPokemon(r.e.p, { fromPointer: true });
    });

    el.listbox.addEventListener("mousemove", function (ev) {
      var node = ev.target.closest(".tc-option");
      if (node && +node.getAttribute("data-index") !== state.active) {
        setActive(+node.getAttribute("data-index"), false);
      }
    });

    el.listbox.addEventListener("scroll", function () {
      var lb = el.listbox;
      if (state.rendered < state.results.length && lb.scrollTop + lb.clientHeight > lb.scrollHeight - 240) {
        renderList(false);
      }
    }, { passive: true });

    el.clear.addEventListener("click", function () {
      el.input.value = "";
      updateClearButton();
      el.input.focus();
      openPopover();
      updateResults();
    });

    el.langSelect.addEventListener("change", function () {
      setLang(el.langSelect.value);
    });

    el.art.addEventListener("load", function () { el.art.classList.remove("is-loading"); });
    el.art.addEventListener("error", function () {
      el.art.classList.remove("is-loading");
      el.art.classList.add("is-broken");
    });

    window.addEventListener("hashchange", selectFromHash);
  }

  function init() {
    el.card = document.getElementById("tc-app");
    if (!el.card) return;
    el.input = document.getElementById("tc-input");
    el.clear = document.getElementById("tc-clear");
    el.popover = document.getElementById("tc-popover");
    el.listbox = document.getElementById("tc-listbox");
    el.status = document.getElementById("tc-status");
    el.result = document.getElementById("tc-result");
    el.art = document.getElementById("tc-art");
    el.dex = document.getElementById("tc-dex");
    el.name = document.getElementById("tc-name");
    el.badges = document.getElementById("tc-badges");
    el.matchups = document.getElementById("tc-matchups");
    el.langSelect = document.getElementById("tc-lang-select");
    el.live = document.getElementById("tc-live");

    el.art.removeAttribute("src");

    state.lang = pickInitialLang();
    applyStaticTexts();
    buildLangSelect();
    bindEvents();
    updateStatus();

    loadData().then(function (data) {
      state.data = data;
      buildIndex(data);
      buildLangSelect();
      selectFromHash();
      if (state.open) updateResults();
    }).catch(function (err) {
      state.loadFailed = true;
      if (window.console) console.error("[PAT (Pokemon-Attack-Tool)] Daten konnten nicht geladen werden:", err);
      updateStatus();
      openPopover();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
