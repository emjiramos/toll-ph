/*
 * Network map: every toll road drawn at its real position (from each plaza's
 * OpenStreetMap lat/lng), with a pin per plaza. Tap a pin to set From, tap
 * another to set To; the route lights up and its fare shows below.
 *
 * Drawn as plain SVG with no map tiles, so it works offline and inside
 * viewers that block outside images. Pan by dragging, zoom with the buttons,
 * the mouse wheel or a two-finger pinch.
 */
(function () {
  "use strict";

  var SVGNS = "http://www.w3.org/2000/svg";
  var W = 1000, H = 1400;           // drawing units; the SVG scales to fit
  var LABEL_ZOOM = 1.8;             // all plaza names appear from this zoom up
  // Named on the map at every zoom, so there's always something to orient by.
  var KEY_PLACES = ["Balintawak (NLEX)", "San Fernando", "Sta. Ines", "Bocaue", "Buendia", "Alabang", "Calamba",
    "Sto. Tomas", "Kawit"];
  // Faint area names for orientation, placed beside the roads rather than on them.
  var AREAS = [
    { name: "METRO MANILA", lat: 14.63, lng: 121.10 }, { name: "BULACAN", lat: 14.86, lng: 121.02 },
    { name: "PAMPANGA", lat: 14.97, lng: 120.62 }, { name: "CAVITE", lat: 14.38, lng: 120.80 },
    { name: "LAGUNA", lat: 14.36, lng: 121.13 }, { name: "BATANGAS", lat: 14.15, lng: 121.04 },
    { name: "Manila Bay", lat: 14.56, lng: 120.80, water: true }
  ];
  var ROAD_NAMES = { "r-nlex": "NLEX", "r-slex": "SLEX", "r-skyway": "Skyway", "r-skyway3": "Skyway 3",
    "r-mcx": "MCX", "r-naiax": "NAIAX", "r-cavitex": "CAVITEX", "r-calax": "CALAX" };
  var app, engine, svg, world, state = { k: 1, x: 0, y: 0 };
  var proj, built = false, fittedFor = "";

  function el(name, attrs, parent) {
    var e = document.createElementNS(SVGNS, name);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(e);
    return e;
  }

  // Equirectangular projection fitted to the plazas' bounding box.
  function makeProjection(nodes) {
    var lats = nodes.map(function (n) { return n.lat; }), lngs = nodes.map(function (n) { return n.lng; });
    var minLat = Math.min.apply(null, lats), maxLat = Math.max.apply(null, lats);
    var minLng = Math.min.apply(null, lngs), maxLng = Math.max.apply(null, lngs);
    var kx = Math.cos((minLat + maxLat) / 2 * Math.PI / 180);
    var spanX = (maxLng - minLng) * kx, spanY = maxLat - minLat;
    var pad = 70, s = Math.min((W - 2 * pad) / spanX, (H - 2 * pad) / spanY);
    var offX = (W - spanX * s) / 2, offY = (H - spanY * s) / 2;
    return function (lat, lng) {
      return [offX + (lng - minLng) * kx * s, offY + (maxLat - lat) * s];
    };
  }

  // The lines to draw: each road (or carriageway) as its plazas in driving order.
  function roadLines() {
    var lines = [];
    var byRoad = {};
    Object.keys(engine.nodes).forEach(function (id) {
      var n = engine.nodes[id];
      if (n.lat === null || n.lng === null || n.lat === undefined) return;
      (byRoad[n.road] = byRoad[n.road] || []).push(n);
    });
    function sorted(list) {
      return list.slice().sort(function (a, b) {
        return a.km !== null && b.km !== null ? a.km - b.km : a.order - b.order;
      });
    }
    var slex = byRoad.slex || [];
    var shared = slex.filter(function (n) { return n.line === "shared"; });
    lines.push({ cls: "r-slex", nodes: sorted(slex.filter(function (n) { return n.line === "atgrade"; }).concat(shared)) });
    lines.push({
      cls: "r-skyway",
      nodes: sorted(slex.filter(function (n) { return n.line === "skyway" && n.name !== "NAIAX"; })
        .concat(shared.filter(function (n) { return n.km !== null && n.km <= 21.5; })))
    });
    var mcx = slex.filter(function (n) { return n.line === "mcx"; });
    var susana = shared.filter(function (n) { return n.name === "Susana Heights"; });
    if (mcx.length && susana.length) lines.push({ cls: "r-mcx", nodes: mcx.concat(susana) });
    ["skyway3", "naiax", "calax"].forEach(function (r) {
      if (byRoad[r]) lines.push({ cls: "r-" + r, nodes: sorted(byRoad[r]) });
    });
    if (byRoad.nlex) {
      var nmain = sorted(byRoad.nlex.filter(function (n) { return n.line === "nlex"; }));
      lines.push({ cls: "r-nlex", nodes: nmain });
      // Side links (Mindanao Ave, Karuhatan) join near the southern end.
      byRoad.nlex.filter(function (n) { return n.line === "nlexlink"; }).forEach(function (n) {
        lines.push({ cls: "r-nlex", nodes: [nmain[0], n] });
      });
    }
    if (byRoad.cavitex) {
      var main = sorted(byRoad.cavitex.filter(function (n) { return n.line !== "c5link"; }));
      var link = sorted(byRoad.cavitex.filter(function (n) { return n.line === "c5link"; }));
      lines.push({ cls: "r-cavitex", nodes: main });
      // The C5 Link branches off the main line at its northern (Parañaque) end.
      if (link.length) lines.push({ cls: "r-cavitex", nodes: main.slice(0, 1).concat(link) });
    }
    return lines.filter(function (l) { return l.nodes.length > 1; });
  }

  function pinNode(place) {
    for (var i = 0; i < place.nodes.length; i++) {
      var n = engine.nodes[place.nodes[i]];
      if (n.lat !== null && n.lat !== undefined) return n;
    }
    return null;
  }

  function build() {
    var host = document.getElementById("map");
    svg = el("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Toll road network map", class: "net" });
    host.appendChild(svg);
    world = el("g", {}, svg);
    var all = Object.keys(engine.nodes).map(function (id) { return engine.nodes[id]; })
      .filter(function (n) { return n.lat !== null && n.lat !== undefined; });
    proj = makeProjection(all);
    var gAreas = el("g", { class: "areas" }, world);
    AREAS.forEach(function (a) {
      var xy = proj(a.lat, a.lng);
      if (xy[0] < 0 || xy[0] > W || xy[1] < 0 || xy[1] > H) return;
      var t = el("text", { x: xy[0], y: xy[1], class: "area" + (a.water ? " water" : "") }, gAreas);
      t.textContent = a.name;
    });
    var gRoads = el("g", { class: "roads" }, world);
    var named = {};
    var lines = roadLines();
    lines.forEach(function (l) {
      el("polyline", {
        class: "road " + l.cls,
        points: l.nodes.map(function (n) { return proj(n.lat, n.lng).join(","); }).join(" ")
      }, gRoads);
    });
    // One name per road, beside the middle of its longest line.
    var gRoadNames = el("g", { class: "road-names" }, world);
    lines.slice().sort(function (a, b) { return b.nodes.length - a.nodes.length; }).forEach(function (l) {
      if (named[l.cls] || !ROAD_NAMES[l.cls]) return;
      named[l.cls] = true;
      var mid = l.nodes[Math.floor((l.nodes.length - 1) / 2)], next = l.nodes[Math.min(l.nodes.length - 1, Math.floor((l.nodes.length - 1) / 2) + 1)];
      var a = proj(mid.lat, mid.lng), b = proj(next.lat, next.lng);
      var g = el("g", { transform: "translate(" + ((a[0] + b[0]) / 2) + "," + ((a[1] + b[1]) / 2) + ")" }, gRoadNames);
      var t = el("text", { class: "road-name " + l.cls, x: -14, y: 0 }, g);
      t.textContent = ROAD_NAMES[l.cls];
    });
    el("g", { class: "route", id: "map-route" }, world);
    var gPins = el("g", { class: "pins" }, world);
    engine.places.forEach(function (p) {
      if (p.hidden) return;
      var n = pinNode(p);
      if (!n) return;
      var xy = proj(n.lat, n.lng);
      var key = KEY_PLACES.indexOf(p.name) >= 0;
      var g = el("g", { class: "pin" + (key ? " key" : ""), "data-place": p.id, tabindex: "0", role: "button", transform: "translate(" + xy[0] + "," + xy[1] + ")" }, gPins);
      el("title", {}, g).textContent = app.label(p.name);
      el("circle", { r: 30, class: "hit" }, g);
      el("circle", { r: 10, class: "dot r-" + (n.road === "slex" ? (n.line === "skyway" ? "skyway" : n.line === "mcx" ? "mcx" : "slex") : n.road) }, g);
      var t = el("text", { x: 20, y: 9, class: "lbl" }, g);
      t.textContent = app.label(p.name);
    });
    wireGestures();
    gPins.addEventListener("click", onPin);
    gPins.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPin(e); } });
    document.getElementById("map-zoom-in").addEventListener("click", function () { zoomAt(1.5); });
    document.getElementById("map-zoom-out").addEventListener("click", function () { zoomAt(1 / 1.5); });
    document.getElementById("map-reset").addEventListener("click", function () { state = { k: 1, x: 0, y: 0 }; apply(); });
    document.getElementById("map-clear").addEventListener("click", function () { app.select("", ""); refresh(); });
    document.getElementById("map-open").addEventListener("click", function () { app.showTrip(); });
    built = true;
  }

  /* ---------- Selecting ---------- */
  var moved = false;
  function onPin(e) {
    if (moved) return;
    var g = e.target.closest(".pin");
    if (!g) return;
    var id = g.getAttribute("data-place"), place = engine.place(id), sel = app.selection();
    if (!sel.from || sel.to) {
      if (!place.canEnter) { say(app.label(place.name) + " is exit-only. Pick where you get on first."); return; }
      app.select(id, "");
    } else if (id === sel.from) {
      app.select("", "");
    } else {
      if (!app.reachable(sel.from)[id]) {
        say("You can't reach " + app.label(place.name) + " from " + app.label(engine.place(sel.from).name) + ". Tap another exit.");
        return;
      }
      app.select(sel.from, id);
    }
    refresh();
  }

  function say(text) { document.getElementById("map-msg").textContent = text; }

  function refresh() {
    if (!built) return;
    var sel = app.selection();
    var reach = sel.from && !sel.to ? app.reachable(sel.from) : null;
    svg.querySelectorAll(".pin").forEach(function (g) {
      var id = g.getAttribute("data-place");
      g.classList.toggle("is-from", id === sel.from);
      g.classList.toggle("is-to", id === sel.to);
      g.classList.toggle("is-stop", (sel.stops || []).indexOf(id) >= 0);
      g.classList.toggle("is-dim", !!reach && id !== sel.from && !reach[id]);
    });
    declutter();
    var route = document.getElementById("map-route");
    route.innerHTML = "";
    var info = document.getElementById("map-info");
    if (!sel.from) {
      say("Step 1 of 2: tap where you get on.");
      info.hidden = true;
      fittedFor = "";
      return;
    }
    if (!sel.to) {
      say("Step 2 of 2: tap your exit (faded = can't reach).");
      info.hidden = true;
      fittedFor = "";
      return;
    }
    var q = app.trip ? app.trip() : app.quote(sel.from, sel.to);  // through any stops
    if (!q) { say("No toll route between those two."); info.hidden = true; return; }
    var names = [sel.from].concat(sel.stops || [], [sel.to]).map(function (id) { return app.label(engine.place(id).name); });
    var allPts = [];
    q.charges.forEach(function (c) {
      var a = engine.nodes[c.fromId], b = engine.nodes[c.toId], mid = c.passing.map(function (p) { return engine.nodes[p.id]; });
      if (a.km === null || b.km === null) {
        // Roads without km posts (Stage 3, NAIAX…): follow the plazas in list order.
        mid = Object.keys(engine.nodes).map(function (id) { return engine.nodes[id]; }).filter(function (n) {
          return n.road === a.road && n.order > Math.min(a.order, b.order) && n.order < Math.max(a.order, b.order);
        }).sort(function (x, y) { return a.order < b.order ? x.order - y.order : y.order - x.order; });
      }
      var pts = [a].concat(mid, [b])
        .filter(function (n) { return n.lat !== null && n.lat !== undefined; })
        .map(function (n) { return proj(n.lat, n.lng).join(","); });
      if (pts.length > 1) el("polyline", { class: "route-line", points: pts.join(" ") }, route);
      allPts = allPts.concat(pts.map(function (s) { return s.split(",").map(Number); }));
    });
    // Zoom to the trip once when it's picked; the user can pan or reset after.
    var key = names.join(">");
    if (fittedFor !== key && allPts.length > 1) { fittedFor = key; fitTo(allPts); }
    // The prompt strip always holds a line, so the map never jumps under a finger.
    say(names.join(" → ") + ". Tap any plaza to start again.");
    document.getElementById("map-summary").textContent = names.join(" → ");
    document.getElementById("map-total").textContent = app.money(q.total) +
      (q.charges.filter(function (c) { return c.fare > 0; }).length > 1 ? " · " + q.charges.filter(function (c) { return c.fare > 0; }).length + " tolls" : "");
    info.hidden = false;
  }

  function fitTo(points) {
    var xs = points.map(function (p) { return p[0]; }), ys = points.map(function (p) { return p[1]; });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var pad = 160, k = Math.min(W / (maxX - minX + pad), H / (maxY - minY + pad), 5);
    k = Math.max(1, k);
    state.k = k;
    state.x = W / 2 - k * (minX + maxX) / 2;
    state.y = H / 2 - k * (minY + maxY) / 2;
    apply();
  }

  /* ---------- Pan and zoom ---------- */
  function apply() {
    world.setAttribute("transform", "translate(" + state.x + "," + state.y + ") scale(" + state.k + ")");
    svg.classList.toggle("show-labels", state.k >= LABEL_ZOOM);
    svg.style.setProperty("--inv", String(1 / state.k));
    declutter();
  }

  // Hide plaza names that would overlap one already shown. Your From / To go
  // first, then the main plazas, then the rest, so the important names win.
  var declutterTimer = null;
  function declutter() {
    clearTimeout(declutterTimer);
    declutterTimer = setTimeout(function () {
      var pins = Array.prototype.slice.call(svg.querySelectorAll(".pin"));
      var rank = function (g) {
        return g.classList.contains("is-from") || g.classList.contains("is-to") ? 0 : g.classList.contains("key") ? 1 : 2;
      };
      pins.sort(function (a, b) { return rank(a) - rank(b); });
      var placed = [];
      pins.forEach(function (g) {
        var t = g.querySelector(".lbl");
        t.classList.remove("crowded");
        if (getComputedStyle(t).display === "none") return;
        var r = t.getBoundingClientRect();
        if (!r.width) return;
        var hit = placed.some(function (p) {
          return r.left < p.right + 2 && r.right > p.left - 2 && r.top < p.bottom + 1 && r.bottom > p.top - 1;
        });
        if (hit && rank(g) > 0) { t.classList.add("crowded"); return; }
        placed.push(r);
      });
    }, 30);
  }
  function zoomAt(f, cx, cy) {
    var k = Math.max(0.8, Math.min(8, state.k * f));
    if (cx === undefined) { cx = W / 2; cy = H / 2; }
    state.x = cx - (cx - state.x) * (k / state.k);
    state.y = cy - (cy - state.y) * (k / state.k);
    state.k = k;
    apply();
  }
  function toSvg(e) {
    var r = svg.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H];
  }
  function wireGestures() {
    var pts = {}, last = null, startDist = 0, startK = 1;
    svg.addEventListener("pointerdown", function (e) {
      pts[e.pointerId] = toSvg(e);
      moved = false;
      last = toSvg(e);
      var ids = Object.keys(pts);
      if (ids.length === 2) {
        var a = pts[ids[0]], b = pts[ids[1]];
        startDist = Math.hypot(a[0] - b[0], a[1] - b[1]);
        startK = state.k;
      }
    });
    svg.addEventListener("pointermove", function (e) {
      if (!pts[e.pointerId]) return;
      var p = toSvg(e);
      pts[e.pointerId] = p;
      var ids = Object.keys(pts);
      if (ids.length === 2) {
        var a = pts[ids[0]], b = pts[ids[1]];
        var d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (startDist > 0) zoomAt(startK * d / startDist / state.k, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        moved = true;
      } else if (last) {
        var dx = p[0] - last[0], dy = p[1] - last[1];
        if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
        if (moved) { svg.setPointerCapture(e.pointerId); state.x += dx; state.y += dy; apply(); }
        last = p;
      }
    });
    function end(e) {
      delete pts[e.pointerId];
      if (!Object.keys(pts).length) { last = null; setTimeout(function () { moved = false; }, 0); }
    }
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);
    svg.addEventListener("wheel", function (e) {
      e.preventDefault();
      var p = toSvg(e);
      zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, p[0], p[1]);
    }, { passive: false });
  }

  window.TollMap = {
    init: function (api) { app = api; engine = api.engine; },
    show: function () { if (!built) { build(); apply(); } refresh(); },
    refresh: refresh
  };
})();
