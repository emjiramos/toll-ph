/*
 * Toll PH screens: Trip (find a place or pick From / To, see the route step
 * by step with every toll), Map, History (past trips) and Tips.
 * All fares come from window.RATES through TollEngine; the only network call
 * is the optional "Compare this trip" check against Expressway.PH.
 */
(function () {
  "use strict";

  var COMPARE_API = "https://www.expressway.ph/api/toll-calculator";
  // The published page's own address, for share links when the app runs
  // inside the claude.ai viewer (its frame can't see the outer URL).
  var SHARE_BASE = "https://claude.ai/artifact/Hm1DJk6RWD9VKa4Sc5QNfo";
  var STORE_KEY = "tollph.trip";
  var HISTORY_KEY = "tollph.history";
  var FUEL_KEY = "tollph.fuel";
  var HISTORY_MAX = 50;
  var HISTORY_DELAY_MS = 2500;  // a trip goes into history once it has been on screen this long
  var AVG_KMH = 70;             // for "about N min with no traffic"
  var DEFAULT_KML = 10;

  // Clearer names where the rate tables' names are ambiguous.
  var DISPLAY = {
    "Magallanes": "Magallanes (at-grade)",
    "C-5": "C-5 (at-grade)",
    "MCX": "MCX – Daang Hari",
    "NAIAX": "NAIAX (airport link)",
    "NLEX": "Balintawak (NLEX)",
    "Balintawak": "A. Bonifacio (Balintawak)",
    "E. Rodriguez": "G. Araneta (E. Rodriguez)",
    "Nagtahan": "Nagtahan (Plaza Azul)",
    "ABI/Greenfield": "ABI / Greenfield",
    "Silang Interchange": "Silang (Aguinaldo)",
    "Sucat Rd./Dr. A. Santos Ave.": "Sucat (C5 Link)",
    "Greenfield": "Greenfield (CALAX)"
  };
  var CERTAINTY = {
    official: "Officially announced rate",
    source: "Published rate",
    page: "Published rate",
    carried: "Published rate",
    "reverse-confirmed": "Published rate",
    derived: "Worked out from published rates"
  };
  // Words people type that the exit signs say differently.
  // Each value is a list of whole phrases to look for on the exit signs.
  var ALIASES = {
    "moa": ["mall of asia"], "mall of asia": ["mall of asia"], "airport": ["naia"], "terminal": ["naia"],
    "batangas": ["santo tomas"], "lipa": ["santo tomas"], "laguna": ["calamba", "santa rosa", "biñan"],
    "cavite": ["bacoor", "kawit", "dasmariñas", "general trias", "silang"], "qc": ["quezon"],
    "quezon city": ["quezon"], "baguio": ["nlex"], "pampanga": ["nlex"], "bulacan": ["nlex"],
    "uplb": ["los baños"], "los banos": ["los baños"], "pansol": ["calamba"], "sta rosa": ["santa rosa"]
  };
  // One-tap trips, by plaza name. Any that the data can't route are skipped.
  var POPULAR = [
    { label: "Makati → Calamba", from: "Buendia", to: "Calamba" },
    { label: "Makati → Batangas (Sto. Tomas)", from: "Buendia", to: "Sto. Tomas" },
    { label: "QC → Alabang", from: "Quezon Ave.", to: "Alabang" },
    { label: "NLEX → Makati", from: "NLEX", to: "Buendia" },
    { label: "Makati → Pampanga (San Fernando)", from: "Buendia", to: "San Fernando" },
    { label: "Balintawak → Clark (Angeles)", from: "NLEX", to: "Angeles" },
    { label: "Alabang → Tagaytay (CALAX)", from: "Alabang", to: "Sta. Rosa/Tagaytay" },
    { label: "Alabang → Nuvali", from: "Alabang", to: "Laguna Blvd." },
    { label: "Airport (T1) → Calamba", from: "NAIA Terminal 1", to: "Calamba" },
    { label: "Airport (T1) → Kawit", from: "NAIA Terminal 1", to: "Kawit" }
  ];

  var rates = window.RATES;
  var engine = new TollEngine(rates);
  var $ = function (id) { return document.getElementById(id); };
  var fromSel = $("from"), toSel = $("to"), roundBox = $("round");
  var vehicleClass = 1;

  function label(name) { return DISPLAY[name] || name; }
  function peso(n) { return "₱" + Math.round(n).toLocaleString("en-PH"); }
  function fareText(n) { return n === 0 ? "free transfer" : peso(n); }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function niceDate(s) {
    if (!s) return "unknown";
    var p = s.split("-"), m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return (p[2] ? Number(p[2]) + " " : "") + m[Number(p[1]) - 1] + " " + p[0];
  }
  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
  }
  function recall(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; }
  }
  function placeByName(name) {
    for (var i = 0; i < engine.places.length; i++) {
      var p = engine.places[i];
      if (!p.hidden && (p.name === name || p.nodes.some(function (id) { return engine.nodes[id].name === name; }))) return p;
    }
    return null;
  }
  function quote(a, b) { return engine.quote(a, b, vehicleClass); }

  /* ---------- Tabs ---------- */
  var TABS = ["trip", "map", "history", "vehicles", "tips"];
  function showTab(name) {
    $("view-changelog").hidden = true;
    $("view-support").hidden = true;
    TABS.forEach(function (t) {
      $("tab-" + t).setAttribute("aria-selected", String(t === name));
      $("view-" + t).hidden = t !== name;
    });
    if (name === "map" && window.TollMap) window.TollMap.show();
    if (name === "history") renderHistory();
    if (name === "vehicles" && window.TollVehicles) window.TollVehicles.show();
    if (name === "tips") renderTips();
    window.scrollTo(0, 0);
  }
  TABS.forEach(function (t) { $("tab-" + t).addEventListener("click", function () { showTab(t); }); });

  /* ---------- Vehicle class ---------- */
  function setClass(c, silent) {
    vehicleClass = c;
    document.querySelectorAll(".classes [data-class]").forEach(function (b) {
      b.setAttribute("aria-checked", String(Number(b.getAttribute("data-class")) === c));
    });
    $("class-desc").textContent = (rates.classes || {})[String(c)] || "";
    if (!silent) update("from");
  }
  document.querySelectorAll(".classes [data-class]").forEach(function (b) {
    b.addEventListener("click", function () {
      var c = Number(b.getAttribute("data-class"));
      setClass(c);
      if (window.TollVehicles) window.TollVehicles.classChanged(c);
    });
  });

  /* ---------- Pickers ---------- */
  function grouped() {
    var groups = [], byName = {};
    engine.places.forEach(function (p) {
      if (p.hidden) return;
      if (!byName[p.group]) { byName[p.group] = { name: p.group, places: [] }; groups.push(byName[p.group]); }
      byName[p.group].places.push(p);
    });
    var rank = function (g) {
      return ["NLEX", "Skyway Stage 3", "Skyway (", "NAIAX", "CAVITEX", "SLEX at-grade", "SLEX (", "MCX", "CALAX"]
        .findIndex(function (k) { return g.name.indexOf(k) === 0; });
    };
    groups.sort(function (a, b) { return rank(a) - rank(b); });
    groups.forEach(function (g) {
      if (g.name.indexOf("Skyway Stage 3") === 0) { g.places.reverse(); return; } // north first
      g.places.sort(function (a, b) {
        var ka = engine.nodes[a.nodes[0]].km, kb = engine.nodes[b.nodes[0]].km;
        return ka === null || kb === null ? 0 : ka - kb;
      });
    });
    return groups;
  }

  function fill(sel, mode, reachable) {
    var keep = sel.value;
    sel.innerHTML = "";
    var ph = document.createElement("option");
    ph.value = ""; ph.textContent = mode === "from" ? "Choose entry…" : "Choose exit…";
    sel.appendChild(ph);
    grouped().forEach(function (g) {
      var og = document.createElement("optgroup");
      og.label = g.name;
      g.places.forEach(function (p) {
        var o = document.createElement("option");
        o.value = p.id;
        var text = label(p.name);
        if (mode === "from" && !p.canEnter) { o.disabled = true; text += " (exit only)"; }
        if (mode === "to" && !p.canExit) { o.disabled = true; text += " (entry only)"; }
        if (mode === "to" && reachable && p.canExit && !reachable[p.id]) {
          o.disabled = true; text += " (can't reach)";
        }
        if (mode === "to" && p.id === fromSel.value) o.disabled = true;
        o.textContent = text;
        og.appendChild(o);
      });
      sel.appendChild(og);
    });
    var opt = keep && sel.querySelector('option[value="' + CSS.escape(keep) + '"]');
    sel.value = opt && !opt.disabled ? keep : "";
  }

  /* ---------- Find a place ---------- */
  function norm(s) { return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim(); }
  var searchIndex = engine.places.filter(function (p) { return !p.hidden; }).map(function (p) {
    var words = [p.name, label(p.name)];
    p.nodes.forEach(function (id) { words = words.concat(engine.nodes[id].leadsTo); });
    return { place: p, name: norm(label(p.name) + " " + p.name), text: norm(words.join(" ")) };
  });

  function search(q) {
    var n = norm(q);
    if (n.length < 2) return [];
    var terms = [];
    Object.keys(ALIASES).forEach(function (k) {
      if (norm(k).indexOf(n) === 0 || n.indexOf(norm(k)) === 0) terms = terms.concat(ALIASES[k].map(norm));
    });
    var out = [];
    searchIndex.forEach(function (e) {
      var score = 0;
      if (e.name.indexOf(n) >= 0) score = 3;
      else if (e.text.indexOf(n) >= 0) score = 2;
      else if (terms.some(function (t) { return t.length > 2 && e.text.indexOf(t) >= 0; })) score = 1;
      if (score) out.push({ e: e, score: score });
    });
    out.sort(function (a, b) { return b.score - a.score; });
    return out.slice(0, 8).map(function (x) { return x.e.place; });
  }

  // Towns and cities (OpenStreetMap) for places that aren't on an exit sign,
  // like Pagbilao or Lucena. A town is matched by the start of its name or of
  // any word in it.
  var townIndex = (window.TOWNS || []).map(function (t) {
    return { name: t[0], province: t[1], lat: t[2], lng: t[3], key: norm(t[0]) };
  });
  function searchTowns(q) {
    var n = norm(q);
    if (n.length < 3) return [];
    return townIndex.filter(function (t) {
      return t.key.indexOf(n) === 0 || t.key.indexOf(" " + n) >= 0;
    }).sort(function (a, b) { return (a.key.indexOf(n) === 0 ? 0 : 1) - (b.key.indexOf(n) === 0 ? 0 : 1); }).slice(0, 5);
  }
  function nearestPlace(pt, want) {
    var best = null;
    engine.places.forEach(function (p) {
      if (p.hidden || !p[want]) return;
      var d = engine.kmTo(pt, p);
      if (!best || d < best.km) best = { id: p.id, km: d };
    });
    return best;
  }

  // The two ends the user chose by search: a plaza id or a town point.
  var ends = { from: null, to: null };
  function townLabel(t) { return t.name + (t.province ? ", " + t.province : ""); }
  function chooseTown(side, t) {
    var pt = { lat: t.lat, lng: t.lng, name: townLabel(t) };
    ends[side] = pt;
    var other = side === "from" ? "to" : "from";
    // The other end: a town picked earlier, else whatever plaza is selected now.
    var otherEnd = ends[other] || (side === "from" ? toSel.value : fromSel.value) || null;
    var note = $("search-note");
    if (!otherEnd) {
      var near = nearestPlace(pt, side === "from" ? "canEnter" : "canExit");
      if (side === "from") load(near.id, "", roundBox.checked); else load(fromSel.value, near.id, roundBox.checked);
      note.innerHTML = "Nearest toll " + (side === "from" ? "entry" : "exit") + " to <strong>" + esc(pt.name) + "</strong>: <strong>" +
        esc(label(engine.place(near.id).name)) + "</strong> (" + esc(km(near.km)) + " away). Now pick your " +
        (side === "from" ? "destination" : "starting point") + ".";
      return;
    }
    var start = side === "from" ? pt : otherEnd, end = side === "from" ? otherEnd : pt;
    var plan = engine.plan(start, end, vehicleClass);
    var straight = typeof start === "object" && typeof end === "object" ? engine.kmBetween(start, end) : Infinity;
    if (!plan) { note.innerHTML = '<span class="warn-text">No toll route in this app connects those two places.</span>'; return; }
    if (plan.offFrom + plan.offTo >= straight) {
      note.innerHTML = '<span class="warn-text">This trip doesn\'t look like it needs a toll road.</span> Both places are closer to each other than to any expressway in this app.';
      return;
    }
    load(plan.from, plan.to, roundBox.checked);
    ends.from = start; ends.to = end;
    var bits = [];
    if (typeof start === "object") bits.push("Toll entry for " + esc(start.name) + ": <strong>" + esc(label(engine.place(plan.from).name)) + "</strong> (" + esc(km(plan.offFrom)) + " away)");
    if (typeof end === "object") bits.push("toll exit for " + esc(end.name) + ": <strong>" + esc(label(engine.place(plan.to).name)) + "</strong> (" + esc(km(plan.offTo)) + " away)");
    note.innerHTML = bits.join("; ") + "." +
      (plan.offFrom > 30 || plan.offTo > 30 ? ' <span class="warn-text">That\'s a long drive off the toll roads in this app, so check your map app\'s route too.</span>' : "");
  }

  var foundTowns = [];
  function renderSearch() {
    var list = $("search-results"), q = $("search").value;
    var found = search(q);
    foundTowns = searchTowns(q);
    if (!q.trim()) { list.hidden = true; list.innerHTML = ""; return; }
    list.hidden = false;
    if (!found.length && !foundTowns.length) {
      list.innerHTML = '<li class="empty">Nothing found for "' + esc(q) + '". Try a town or city in Luzon, a mall, or a road name.</li>';
      return;
    }
    var townRows = foundTowns.map(function (t, i) {
      var pt = { lat: t.lat, lng: t.lng };
      var nin = nearestPlace(pt, "canEnter"), nout = nearestPlace(pt, "canExit");
      return '<li><div class="sr-text"><span class="sr-name">' + esc(t.name) + '</span><span class="leads">' +
        esc((t.province ? t.province + " · " : "") + "town or city · nearest toll plaza: " + label(engine.place(nin.id).name) +
          " (" + km(Math.min(nin.km, nout.km)) + ")") + "</span></div>" +
        '<div class="sr-actions"><button type="button" data-town="' + i + '" data-side="from">From</button>' +
        '<button type="button" data-town="' + i + '" data-side="to">To</button></div></li>';
    }).join("");
    list.innerHTML = townRows + found.map(function (p) {
      var leads = [];
      p.nodes.forEach(function (id) {
        engine.nodes[id].leadsTo.forEach(function (l) { if (leads.indexOf(l) < 0) leads.push(l); });
      });
      return "<li><div class=\"sr-text\"><span class=\"sr-name\">" + esc(label(p.name)) + "</span>" +
        '<span class="leads">' + esc(p.group) + (leads.length ? " · → " + esc(leads.slice(0, 4).join(", ")) : "") + "</span></div>" +
        '<div class="sr-actions">' +
        (p.canEnter ? '<button type="button" data-set="from" data-place="' + esc(p.id) + '">From</button>' : "") +
        (p.canExit ? '<button type="button" data-set="to" data-place="' + esc(p.id) + '">To</button>' : "") +
        "</div></li>";
    }).join("");
  }
  $("search").addEventListener("input", renderSearch);
  $("search-results").addEventListener("click", function (e) {
    var tb = e.target.closest("button[data-town]");
    if (tb) {
      chooseTown(tb.getAttribute("data-side"), foundTowns[Number(tb.getAttribute("data-town"))]);
      $("search").value = "";
      renderSearch();
      return;
    }
    var b = e.target.closest("button[data-set]");
    if (!b) return;
    var id = b.getAttribute("data-place");
    ends[b.getAttribute("data-set")] = id;
    $("search-note").textContent = "";
    if (b.getAttribute("data-set") === "from") load(id, toSel.value === id ? "" : toSel.value, roundBox.checked);
    else load(fromSel.value, id, roundBox.checked);
    $("search").value = "";
    renderSearch();
  });

  /* ---------- Paste a Google Maps / Waze link ---------- */
  // The link's start and end become the nearest toll entry and exit. The link
  // itself (which may hold a home address) is never stored.
  function km(n) { return n < 1 ? "under 1 km" : "about " + Math.round(n) + " km"; }
  function resolve(pt, want) {
    if (!pt) return null;
    if (pt.lat !== null) return pt;
    var hit = search(pt.name).filter(function (p) { return p[want]; })[0];
    return hit ? hit.id : null;
  }
  function useMapLink(text) {
    var out = $("maplink-out");
    if (!text.trim()) { out.textContent = ""; return; }
    var r = TollMapLink.parse(text);
    var appName = r.app === "waze" ? "Waze" : "Google Maps";
    if (r.error === "short") {
      out.innerHTML = '<span class="warn-text">That\'s a short link, which this page can\'t open by itself.</span> ' +
        "Open it in your phone's browser (Chrome or Safari, not the Maps app), copy the full address from the address bar " +
        "(it starts with google.com/maps/dir/), and paste that here instead.";
      return;
    }
    if (r.error) {
      out.innerHTML = '<span class="warn-text">That doesn\'t look like a Google Maps or Waze directions link.</span>';
      return;
    }
    var start = resolve(r.from, "canEnter");
    if (!start && r.from) {
      // The link names a start we can't place: say so rather than quietly
      // keeping whatever entry was picked before.
      out.innerHTML = '<span class="warn-text">Couldn\'t tell where this ' + esc(appName) + " trip starts (" +
        esc(r.from.name.split(",")[0] || "no place name") + ").</span> Search for your start above, or pick your entry.";
      return;
    }
    if (!start) start = fromSel.value || null;
    var end = resolve(r.to, "canExit");
    if (!end) {
      out.innerHTML = '<span class="warn-text">Couldn\'t tell where this ' + esc(appName) + " trip ends.</span> Try searching for the place above.";
      return;
    }
    if (!start) {
      // Waze usually shares only the destination.
      var exitOnly = eng_planExit(end);
      if (exitOnly) {
        out.innerHTML = esc(appName) + " shared only the destination. Nearest toll exit: <strong>" +
          esc(label(engine.place(exitOnly.id).name)) + "</strong> (" + esc(km(exitOnly.km)) + " from it). " +
          "Pick where you get on, then choose that exit.";
      }
      return;
    }
    var plan = engine.plan(start, end, vehicleClass);
    if (!plan) {
      out.innerHTML = '<span class="warn-text">No toll route in this app connects those two places.</span>';
      return;
    }
    var straight = typeof start === "object" && typeof end === "object" ? engine.kmBetween(start, end) : Infinity;
    if (plan.offFrom + plan.offTo >= straight) {
      out.innerHTML = '<span class="warn-text">This trip doesn\'t look like it needs a toll road.</span> ' +
        "Both ends are closer to each other than to any expressway in this app.";
      return;
    }
    load(plan.from, plan.to, roundBox.checked);
    $("maplink").value = "";
    var who = function (pt) { return pt && pt.name ? esc(pt.name.split(",")[0]) : "your start"; };
    out.innerHTML = (r.from
      ? "From " + esc(appName) + ": " + who(r.from) + " → " + (r.to && r.to.name ? esc(r.to.name.split(",")[0]) : "your destination") + ".<br>"
      : esc(appName) + " shared only the destination, so your current entry is kept.<br>") +
      "Toll entry: <strong>" + esc(label(engine.place(plan.from).name)) + "</strong>" +
      (typeof start === "object" ? " (" + esc(km(plan.offFrom)) + " from your start)" : "") + ". " +
      "Toll exit: <strong>" + esc(label(engine.place(plan.to).name)) + "</strong>" +
      (typeof end === "object" ? " (" + esc(km(plan.offTo)) + " from your destination)" : "") + ". " +
      "Check these match the route " + esc(appName) + " gives you." +
      (plan.offFrom > 30 || plan.offTo > 30 ? ' <span class="warn-text">One end is far from the toll roads in this app, so your actual route may join somewhere else.</span>' : "");
  }
  // Nearest exit to a destination point (for destination-only links).
  function eng_planExit(end) {
    if (typeof end === "string") return { id: end, km: 0 };
    var best = null;
    engine.places.forEach(function (p) {
      if (p.hidden || !p.canExit) return;
      var d = engine.kmTo(end, p);
      if (!best || d < best.km) best = { id: p.id, km: d };
    });
    return best;
  }
  var linkTimer = null;
  $("maplink").addEventListener("input", function () {
    clearTimeout(linkTimer);
    linkTimer = setTimeout(function () { useMapLink($("maplink").value); }, 250);
  });

  function renderPopular() {
    $("popular").innerHTML = POPULAR.map(function (r, i) {
      var a = placeByName(r.from), b = placeByName(r.to);
      if (!a || !b || !engine.quote(a.id, b.id, 1)) return "";
      return '<button type="button" class="chip-btn" data-pop="' + i + '">' + esc(r.label) + "</button>";
    }).join("");
  }
  $("popular").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-pop]");
    if (!b) return;
    var r = POPULAR[Number(b.getAttribute("data-pop"))];
    load(placeByName(r.from).id, placeByName(r.to).id, roundBox.checked);
  });

  /* ---------- Trip result ---------- */
  function leadsTo(list) {
    return list && list.length ? '<span class="leads">→ ' + esc(list.join(", ")) + "</span>" : "";
  }
  function plazaNote(id) {
    var n = engine.nodes[id];
    return n.note ? '<p class="step-note">' + esc(n.note) + "</p>" : "";
  }
  function minutes(km) { return Math.max(1, Math.round(km / AVG_KMH * 60)); }

  // One trip (one way) as driving steps, with every toll in place.
  function steps(q) {
    var html = '<ol class="steps">';
    q.charges.forEach(function (c, i) {
      var first = i === 0, last = i === q.charges.length - 1;
      if (first) {
        html += '<li class="step"><span class="dot in"></span><div>' +
          '<p class="step-title">Enter at ' + esc(label(c.from)) + "</p>" +
          '<p class="step-sub">' + esc(c.roadName) + (c.direction ? " · " + esc(c.direction) : "") + "</p>" +
          '<p class="step-sub">Use an RFID lane (' + esc(c.rfid) + ").</p>" +
          plazaNote(c.fromId) + "</div></li>";
      } else {
        html += '<li class="step"><span class="dot mid"></span><div>' +
          '<p class="step-title">At ' + esc(label(c.from)) + ", carry on onto " + esc(c.roadName) + "</p>" +
          (c.direction ? '<p class="step-sub">' + esc(c.direction) + "</p>" : "") +
          (c.fare ? '<p class="step-sub">This is a new, separate toll.</p>' : "") + "</div></li>";
      }
      if (c.passing.length) {
        html += '<li class="step"><span class="dot pass"></span><div><details class="passing">' +
          "<summary>Drive past " + c.passing.length + (c.passing.length === 1 ? " exit" : " exits") +
          " — don't exit yet</summary><ul>" +
          c.passing.map(function (p) {
            return "<li><span>" + esc(label(p.name)) + leadsTo(p.leadsTo) + '</span><span class="fare">' +
              (p.fare === 0 ? "free transfer + NAIAX toll" : "exit here " + peso(p.fare)) + "</span></li>";
          }).join("") + "</ul></details>" +
          '<p class="step-sub">Your exit comes after ' + esc(label(c.passing[c.passing.length - 1].name)) + ".</p>" +
          "</div></li>";
      }
      if (c.fare === 0) {
        if (last) {
          html += '<li class="step"><span class="dot out"></span><div><p class="step-title">Exit at ' + esc(label(c.to)) +
            '</p><p class="step-sub">No ' + esc(c.roadName) + " toll for this part.</p></div></li>";
        }
        return;
      }
      var dist = c.km ? (c.kmApprox ? "Roughly " : "About ") + c.km + " km · ~" + minutes(c.km) + " min with no traffic" : "";
      var was = c.prevFare !== null && c.prevFare !== c.fare
        ? '<p class="step-sub was">Was ' + peso(c.prevFare) + " before " + esc(niceDate(c.since)) + "</p>" : "";
      html += '<li class="step"><span class="dot toll"></span><div class="toll-line">' +
        '<p class="step-title">Toll: ' + peso(c.fare) + "</p>" +
        '<p class="step-sub"><span class="chip ' + esc(c.road) + '">' + esc(c.roadName) + "</span> " +
        esc(CERTAINTY[c.status] || "Rate") + (c.charging ? " · " + esc(c.charging) : "") + "</p>" +
        was + (dist ? '<p class="step-sub">' + esc(dist) + "</p>" : "") + "</div></li>";
      if (last) {
        html += '<li class="step"><span class="dot out"></span><div>' +
          '<p class="step-title">Exit at ' + esc(label(c.to)) + "</p>" +
          (engine.nodes[c.toId].leadsTo.length ? '<p class="step-sub">Leads to ' + esc(engine.nodes[c.toId].leadsTo.join(", ")) + "</p>" : "") +
          plazaNote(c.toId) + "</div></li>";
      }
    });
    return html + "</ol>";
  }

  // How much comes off each operator's sticker. Since Oct 2025 one sticker
  // works everywhere, but people with both like to know which one pays what.
  function stickerSplit(charges) {
    var by = {}, order = [];
    charges.forEach(function (c) {
      if (!c.fare) return;
      if (!(c.tag in by)) { by[c.tag] = { total: 0, roads: [] }; order.push(c.tag); }
      by[c.tag].total += c.fare;
      if (by[c.tag].roads.indexOf(c.roadName) < 0) by[c.tag].roads.push(c.roadName);
    });
    if (!order.length) return "";
    var rows = order.map(function (t) {
      return '<li><span><strong>' + esc(t) + "</strong> roads<span class=\"leads\">" + esc(by[t].roads.join(", ")) +
        '</span></span><span class="fare">' + peso(by[t].total) + "</span></li>";
    }).join("");
    return '<div class="split"><p class="leg-title">By RFID sticker</p><ul>' + rows + "</ul>" +
      '<p class="step-sub">One Autosweep or Easytrip sticker works on all of these since Oct 2025. ' +
      (order.length > 1 ? "If you carry both, this is what each one pays." : "") + "</p></div>";
  }

  function tripKm(q) {
    var km = 0, approx = false, missing = false;
    q.charges.forEach(function (c) {
      if (c.km) { km += c.km; approx = approx || c.kmApprox; } else if (c.fare) { missing = true; }
    });
    return { km: Math.round(km * 10) / 10, approx: approx, missing: missing };
  }

  function prevTotal(q) {
    var changed = q.charges.filter(function (c) { return c.prevFare !== null && c.prevFare !== c.fare; });
    if (!changed.length) return "";
    var before = q.total - changed.reduce(function (t, c) { return t + c.fare - c.prevFare; }, 0);
    return "Price history: " + peso(before) + " before " + niceDate(changed[0].since) + " (+" + peso(q.total - before) + ")";
  }

  function faresFromList(fromId) {
    var list = engine.faresFrom(fromId, vehicleClass);
    var buckets = {};
    list.forEach(function (x) {
      var c = x.quote.charges;
      var paid = c.filter(function (ch) { return ch.fare > 0; }).length;
      var key = paid > 1 ? "Via other roads (" + paid + " tolls)" : (c[c.length - 1].direction || c[c.length - 1].roadName);
      (buckets[key] = buckets[key] || []).push(x);
    });
    var html = '<div class="card"><p class="card-title">Fares from ' + esc(label(engine.place(fromId).name)) +
      " · Class " + vehicleClass + "</p>" + '<p class="step-sub">Tap an exit to see the route.</p>';
    Object.keys(buckets).forEach(function (k) {
      var rows = buckets[k];
      rows.sort(function (a, b) { return a.quote.total - b.quote.total; });
      html += '<p class="leg-title">' + esc(k) + '</p><ul class="fare-list">' + rows.map(function (x) {
        var n = engine.nodes[x.place.nodes[0]];
        return '<li><button type="button" data-to="' + esc(x.place.id) + '"><span>' + esc(label(x.place.name)) +
          leadsTo(n.leadsTo) + '</span><span class="fare">' + fareText(x.quote.total) + "</span></button></li>";
      }).join("") + "</ul>";
    });
    return html + "</div>";
  }

  var historyTimer = null, current = null, current0 = "";
  function render() {
    var out = $("result"), from = fromSel.value, to = toSel.value;
    $("compare-out").textContent = "";
    $("share-out").textContent = "";
    clearTimeout(historyTimer);
    current = null;
    $("fuel-card").hidden = true;
    $("compare-card").hidden = true;
    if (!from) {
      out.innerHTML = '<div class="card"><p class="empty">Pick where you enter the expressway, or search for a place above. ' +
        "You'll see the fare to every exit, then the full route once you pick where you exit.</p></div>";
      return;
    }
    if (!to) { out.innerHTML = faresFromList(from); return; }
    var go = quote(from, to);
    if (!go) {
      out.innerHTML = '<div class="card"><p class="empty">There\'s no toll route between those two plazas.</p></div>';
      return;
    }
    var back = roundBox.checked ? quote(to, from) : null;
    var all = go.charges.concat(back ? back.charges : []);
    var total = go.total + (back ? back.total : 0);
    var html = '<div class="card result">';
    html += '<div class="total"><span class="amount">' + peso(total) + '</span><span class="what">' +
      esc((back ? "round trip · " + peso(go.total) + " + " + peso(back.total) : "one way") + " · Class " + vehicleClass) + "</span></div>";
    var hist = back ? "" : prevTotal(go);
    if (hist) html += '<p class="was-total">' + esc(hist) + "</p>";
    html += '<p class="with-fuel" id="with-fuel"></p>';
    html += stickerSplit(all);
    html += '<p class="leg-title">' + (back ? "Going" : "Your route") + "</p>" + steps(go);
    if (back) {
      html += '<details class="return"><summary>Coming back · ' + peso(back.total) + "</summary>" + steps(back) + "</details>";
    } else if (roundBox.checked) {
      html += '<p class="note warn">You can\'t enter at ' + esc(label(engine.place(to).name)) +
        " for the trip back (it's exit-only or one-way). Pick another exit to price the return.</p>";
    }
    var paidCount = go.charges.filter(function (c) { return c.fare > 0; }).length;
    if (paidCount > 1) {
      html += '<p class="note">This trip is ' + paidCount + " separate toll charges. Each one is taken from your " +
        "RFID balance at its own plaza, so keep enough load for all of them.</p>";
    }
    html += "</div>";
    out.innerHTML = html;
    // A typed trip km belongs to one trip; clear it when the trip changes.
    if (!current0 || current0 !== from + ">" + to) $("fuel-trip-km").value = "";
    current0 = from + ">" + to;
    current = { from: from, to: to, round: roundBox.checked, go: go, back: back, total: total };
    $("compare-card").hidden = false;
    $("fuel-card").hidden = false;
    renderFuel();
    historyTimer = setTimeout(function () { addHistory(from, to, roundBox.checked, total); }, HISTORY_DELAY_MS);
  }

  /* ---------- Fuel ---------- */
  function renderFuel() {
    if (!current) return;
    var kml = parseFloat($("fuel-kml").value) || DEFAULT_KML;
    var price = parseFloat($("fuel-price").value);
    var d = tripKm(current.go);
    var ways = current.back ? 2 : 1;
    // Google's door-to-door km, typed in by the user, replaces the toll-road-only estimate.
    var typed = parseFloat($("fuel-trip-km").value);
    var exact = typed > 0;
    var km = exact ? typed * ways : d.km * ways;
    store(FUEL_KEY, { kml: $("fuel-kml").value, price: $("fuel-price").value });
    var out = $("fuel-out");
    if ($("with-fuel")) $("with-fuel").textContent = "";
    if (!km) { out.textContent = "Distance isn't known for this trip yet. Type the trip km from Google Maps above."; return; }
    var distText = exact
      ? Math.round(km) + " km door to door, from Google Maps" + (ways === 2 ? " (both ways)" : "")
      : (d.approx ? "roughly " : "about ") + Math.round(km) + " km on toll roads" + (ways === 2 ? " (both ways)" : "");
    if (!price) {
      out.innerHTML = esc("This trip is " + distText + ". Add the fuel price to see fuel and toll together.");
      return;
    }
    var litres = km / kml, fuel = litres * price;
    out.innerHTML = '<span class="fuel-total">' + peso(fuel + current.total) + "</span> fuel + tolls" +
      '<ul class="fuel-list">' +
      "<li><span>Fuel</span><span>" + peso(fuel) + "</span></li>" +
      '<li class="sub"><span>' + esc(distText.charAt(0).toUpperCase() + distText.slice(1) + ", at " + kml + " km/L") + "</span></li>" +
      '<li class="sub"><span>' + esc(litres.toFixed(1) + " L × " + peso(price) + " per litre") + "</span></li>" +
      "<li><span>Tolls</span><span>" + peso(current.total) + "</span></li>" +
      "</ul>" +
      '<p class="fuel-note">' + (exact
        ? "Uses the whole trip distance you entered, including roads to and from the expressway."
        : "Not included: driving to and from the expressway. For the whole trip, type the km Google Maps shows." +
          (d.missing ? " Part of this route has no distance data, so fuel is a little low." : "")) + "</p>";
    var top = $("with-fuel");
    if (top) top.textContent = "With fuel: " + peso(fuel + current.total) + " (fuel " + peso(fuel) + " + tolls " + peso(current.total) + ")";
  }
  ["fuel-kml", "fuel-price", "fuel-trip-km"].forEach(function (id) { $(id).addEventListener("input", renderFuel); });

  /* ---------- Share ---------- */
  function tripToken(t) { return "t." + t.from + "~" + t.to + "~c" + vehicleClass + "~" + (t.round ? "r" : "o"); }
  function shareLink() {
    // Inside the claude.ai viewer the page runs in a frame and can't see the
    // address people actually open, so use the published page's link there.
    // Anywhere else (the public website, a local file, the app) the page's
    // own address is the right one.
    var framed = false;
    try { framed = window.self !== window.top; } catch (e) { framed = true; }
    var base = framed ? SHARE_BASE : location.href.split("#")[0];
    return base + "#" + tripToken(current);
  }
  $("share").addEventListener("click", function () {
    if (!current) return;
    var link = shareLink(), out = $("share-out");
    var framed = false;
    try { framed = window.self !== window.top; } catch (e) { framed = true; }
    function shown() {
      out.innerHTML = 'Link: <input class="share-link" readonly value="' + esc(link) + '">' +
        // Only the private claude.ai copy needs sharing first; the public site opens for anyone.
        (framed ? '<span class="leads">People need access to this page to open the link (Share menu on the page).</span>' : "");
      var inp = out.querySelector("input");
      inp.focus(); inp.select();
    }
    try {
      navigator.clipboard.writeText(link).then(function () {
        shown();
        out.insertAdjacentHTML("afterbegin", "<strong>Copied.</strong> ");
      }, shown);
    } catch (e) { shown(); }
  });
  function readToken() {
    var m = /^#t\.(.+)~(.+)~c([123])~([ro])$/.exec(location.hash || "");
    if (!m || !engine.place(m[1]) || !engine.place(m[2])) return null;
    return { from: m[1], to: m[2], cls: Number(m[3]), round: m[4] === "r" };
  }

  /* ---------- State ---------- */
  function update(changed) {
    if (changed === "from" || changed === "init") {
      fill(toSel, "to", fromSel.value ? engine.reachableFrom(fromSel.value, vehicleClass) : null);
    }
    render();
    store(STORE_KEY, { from: fromSel.value, to: toSel.value, round: roundBox.checked, cls: vehicleClass });
    if (window.TollMap) window.TollMap.refresh();
  }

  function load(from, to, round, cls) {
    if (cls) setClass(cls, true);
    var o = fromSel.querySelector('option[value="' + CSS.escape(from || "") + '"]');
    fromSel.value = o && !o.disabled ? from : "";
    roundBox.checked = !!round;
    update("from");
    var t = toSel.querySelector('option[value="' + CSS.escape(to || "") + '"]');
    toSel.value = t && !t.disabled ? to : "";
    update("to");
  }

  $("result").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-to]");
    if (!b) return;
    toSel.value = b.getAttribute("data-to");
    update("to");
    window.scrollTo(0, 0);
  });

  /* ---------- History ---------- */
  function readHistory() { return recall(HISTORY_KEY) || []; }
  function addHistory(from, to, round, total) {
    var h = readHistory().filter(function (x) {
      return !(x.from === from && x.to === to && x.round === round && (x.cls || 1) === vehicleClass);
    });
    h.unshift({ from: from, to: to, round: round, cls: vehicleClass, total: total, at: new Date().toISOString() });
    store(HISTORY_KEY, h.slice(0, HISTORY_MAX));
  }
  function renderHistory() {
    var h = readHistory().filter(function (x) { return engine.place(x.from) && engine.place(x.to); });
    var box = $("history");
    if (!h.length) {
      box.innerHTML = '<div class="card"><p class="empty">No trips yet. Trips you look up on the Trip tab are saved here.</p></div>';
      return;
    }
    box.innerHTML = '<div class="card"><ul class="history-list">' + h.map(function (x, i) {
      var cls = x.cls || 1;
      var go = engine.quote(x.from, x.to, cls);
      var back = x.round ? engine.quote(x.to, x.from, cls) : null;
      var now = go ? go.total + (back ? back.total : 0) : null;
      var when = new Date(x.at);
      var changed = now !== null && now !== x.total
        ? '<span class="was">was ' + peso(x.total) + " when you checked</span>" : "";
      return '<li><button type="button" data-i="' + i + '">' +
        '<span class="h-route">' + esc(label(engine.place(x.from).name)) + " → " + esc(label(engine.place(x.to).name)) +
        (x.round ? " · round trip" : "") + "</span>" +
        '<span class="fare">' + (now !== null ? peso(now) : "—") + "</span>" +
        '<span class="h-meta">Class ' + cls + " · " + esc(when.toLocaleDateString("en-PH", { day: "numeric", month: "short", year: "numeric" })) +
        " " + esc(when.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })) + " " + changed + "</span>" +
        "</button></li>";
    }).join("") + '</ul><button id="clear-history" class="btn subtle" type="button">Clear history</button></div>';
    box.querySelectorAll("button[data-i]").forEach(function (b) {
      b.addEventListener("click", function () {
        var x = h[Number(b.getAttribute("data-i"))];
        showTab("trip");
        load(x.from, x.to, x.round, x.cls || 1);
      });
    });
    // Two taps instead of confirm(): pop-up dialogs don't show inside every viewer.
    $("clear-history").addEventListener("click", function () {
      var b = $("clear-history");
      if (b.getAttribute("data-armed")) { store(HISTORY_KEY, []); renderHistory(); return; }
      b.setAttribute("data-armed", "1");
      b.textContent = "Tap again to clear all " + h.length + " trips";
      setTimeout(function () {
        if (document.body.contains(b)) { b.removeAttribute("data-armed"); b.textContent = "Clear history"; }
      }, 4000);
    });
  }

  /* ---------- Tips ---------- */
  function renderTips() {
    var tips = rates.tips || [];
    if (!tips.length) {
      $("tips").innerHTML = '<div class="card"><p class="empty">Tips are being added.</p></div>';
      return;
    }
    $("tips").innerHTML = tips.map(function (t) {
      return '<div class="card tip"><p class="card-title">' + esc(t.title) + "</p>" +
        "<ul>" + t.points.map(function (p) { return "<li>" + esc(p) + "</li>"; }).join("") + "</ul>" +
        (t.calls ? '<div class="calls">' + t.calls.map(function (c) {
          return '<a class="btn call" href="tel:' + esc(c.number.replace(/[^0-9+]/g, "")) + '">Call ' + esc(c.label) + "</a>";
        }).join("") + "</div>" : "") +
        (t.source ? '<p class="tip-src">Source: ' + esc(t.source) + "</p>" : "") + "</div>";
    }).join("");
  }

  /* ---------- Compare ---------- */
  function compare() {
    if (!current) return;
    var from = engine.place(current.from), to = engine.place(current.to), ours = current.go;
    var btn = $("compare"), out = $("compare-out");
    btn.disabled = true;
    out.textContent = "Asking Expressway.PH…";
    var q = "?origin=" + encodeURIComponent(engine.nodes[from.nodes[0]].xp) +
      "&dest=" + encodeURIComponent(engine.nodes[to.nodes[0]].xp) + "&class=" + vehicleClass;
    var http = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp;
    var request = http
      ? http.get({ url: COMPARE_API + q }).then(function (r) { return r.data; })
      : fetch(COMPARE_API + q).then(function (r) { return r.json(); });
    request.then(function (d) {
      if (!d || typeof d.totalToll !== "number") {
        out.textContent = "Expressway.PH has no route for this trip.";
        return;
      }
      var diff = ours.total - d.totalToll;
      if (diff === 0) {
        out.textContent = "Expressway.PH agrees: " + peso(d.totalToll) + ".";
      } else if (diff > 0) {
        out.textContent = "Expressway.PH says " + peso(d.totalToll) + ", " + peso(diff) + " less than ours. " +
          "Their data is from Feb 2026, before the July SLEX increase and the 2026 CALAX and C5 Link changes.";
      } else {
        out.textContent = "Expressway.PH says " + peso(d.totalToll) + ", " + peso(-diff) + " more than ours. " +
          "That's unexpected — worth checking this trip's rate.";
      }
    }).catch(function () {
      out.textContent = "Couldn't reach Expressway.PH from here (no internet, or this viewer blocks outside sites). " +
        "The calculator itself doesn't need it.";
    }).then(function () { btn.disabled = false; });
  }

  function footer() {
    var roads = rates.roads, parts = [];
    Object.keys(roads).forEach(function (k) { parts.push(roads[k].name + ": " + niceDate(roads[k].asOf)); });
    var checked = Object.keys(roads).map(function (k) { return roads[k].checked; }).sort()[0];
    $("as-of").textContent = "Rates in force from — " + parts.join(" · ") + ". Last checked " + niceDate(checked) + ".";
    var stale = engine.staleRoads(new Date().toISOString().slice(0, 10), 6);
    if (stale.length) {
      $("stale").hidden = false;
      $("stale").textContent = "These rates were last checked over 6 months ago and may be out of date: " +
        stale.map(function (k) { return roads[k].name; }).join(", ") + ".";
    }
  }

  /* ---------- Version and What's new ---------- */
  var LOG = window.CHANGELOG || [];
  var VERSION = LOG.length ? LOG[0].version : "";
  function shortVersion(v) { return "v" + v.replace(/\.0$/, ""); }
  // Pages outside the tab bar (What's new, Buy me a coffee): hide every tab view.
  function showPage(id) {
    TABS.forEach(function (t) {
      $("tab-" + t).setAttribute("aria-selected", "false");
      $("view-" + t).hidden = true;
    });
    ["view-changelog", "view-support"].forEach(function (v) { $(v).hidden = v !== id; });
    window.scrollTo(0, 0);
  }
  function showSupport() { showPage("view-support"); }
  $("support-top").addEventListener("click", showSupport);
  $("support-foot").addEventListener("click", showSupport);
  $("support-back").addEventListener("click", function () { showTab("trip"); });
  function showChangelog() {
    showPage("view-changelog");
    $("changelog-phase").textContent = "Toll PH " + shortVersion(VERSION) + " · " + (window.TOLLPH_PHASE || "") +
      ". Open to everyone, still being checked on real trips. Version 1.0 comes once real drivers have confirmed it.";
    // Newest version open, the rest folded, as in the Calendar app.
    $("changelog").innerHTML = LOG.map(function (e, i) {
      return '<details class="cl-entry"' + (i === 0 ? " open" : "") + "><summary>" +
        '<span class="cl-ver">' + esc(shortVersion(e.version)) + "</span>" +
        '<span class="cl-head">' + esc(e.title) + '<span class="leads">' + esc(niceDate(e.date)) + "</span></span></summary><ul>" +
        e.items.map(function (it) {
          return "<li><strong>" + esc(it[0]) + "</strong>" + (it[1] ? " " + esc(it[1]) : "") + "</li>";
        }).join("") + "</ul></details>";
    }).join("");
    window.scrollTo(0, 0);
  }
  if (VERSION) {
    $("verbadge").textContent = shortVersion(VERSION) + " · BETA";
    $("app-version").innerHTML = "Toll PH " + esc(shortVersion(VERSION)) + " (" + esc((window.TOLLPH_PHASE || "").toLowerCase()) +
      ') · <button type="button" class="linkish" id="foot-whatsnew">What\'s new</button>';
    $("verbadge").addEventListener("click", showChangelog);
    $("foot-whatsnew").addEventListener("click", showChangelog);
  } else {
    $("verbadge").hidden = true;
  }
  $("changelog-back").addEventListener("click", function () { showTab("trip"); });

  /* ---------- Start-up ---------- */
  fill(fromSel, "from");
  renderPopular();
  var fuel = recall(FUEL_KEY);
  if (fuel) { $("fuel-kml").value = fuel.kml || ""; $("fuel-price").value = fuel.price || ""; }
  var linked = readToken(), saved = recall(STORE_KEY);
  setClass((linked && linked.cls) || (saved && saved.cls) || 1, true);
  if (linked) load(linked.from, linked.to, linked.round, linked.cls);
  else if (saved) load(saved.from, saved.to, saved.round);
  else update("init");
  footer();

  // Picking a plaza by hand replaces any town chosen for that end.
  fromSel.addEventListener("change", function () { ends.from = null; $("search-note").textContent = ""; update("from"); });
  toSel.addEventListener("change", function () { ends.to = null; $("search-note").textContent = ""; update("to"); });
  roundBox.addEventListener("change", function () { update("round"); });
  $("swap").addEventListener("click", function () {
    var a = fromSel.value, b = toSel.value;
    var opt = fromSel.querySelector('option[value="' + CSS.escape(b) + '"]');
    if (!b || !opt || opt.disabled) return; // can't start at an exit-only plaza
    load(b, a, roundBox.checked);
  });
  $("compare").addEventListener("click", compare);
  window.addEventListener("hashchange", function () {
    var t = readToken();
    if (t) { showTab("trip"); load(t.from, t.to, t.round, t.cls); }
  });

  // What the map screen uses: it reads and sets the same From / To as the pickers.
  window.TollApp = {
    engine: engine,
    label: label,
    money: peso,
    selection: function () { return { from: fromSel.value, to: toSel.value }; },
    select: function (fromId, toId) { load(fromId, toId, roundBox.checked); },
    reachable: function (fromId) { return engine.reachableFrom(fromId, vehicleClass); },
    quote: quote,
    showTrip: function () { showTab("trip"); },
    showTab: showTab,
    classes: function () { return rates.classes || {}; },
    // A saved vehicle sets the class and the fuel figure. On start-up a shared
    // trip link wins over the car in use, since the link names its own class.
    applyVehicle: function (v, startup) {
      if (startup && linked) return;
      setClass(Number(v.cls) || 1, true);
      if (v.kml) $("fuel-kml").value = v.kml;
      update("from");
    }
  };
  if (window.TollMap) window.TollMap.init(window.TollApp);
  if (window.TollVehicles) window.TollVehicles.init(window.TollApp);
})();
