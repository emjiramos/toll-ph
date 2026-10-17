/*
 * Toll fare engine. No UI, no network: give it the rate file (window.RATES)
 * and it answers "what does a trip from place A to place B cost?".
 *
 * Terms
 *   node   - one plaza on one road's table (e.g. "slex.buendia")
 *   place  - what a person picks: one or more nodes that are the same spot on
 *            different roads, joined by rates.links (Buendia is on both the
 *            Skyway 1-2 + SLEX table and the Stage 3 table)
 *   charge - one toll transaction: entry and exit on the same road's table
 *
 * A trip is the cheapest chain of charges from the start place to the end
 * place, never two charges in a row on the same table (one table is one
 * transaction; splitting it isn't a real option).
 */
(function (root) {
  "use strict";

  function TollEngine(rates) {
    this.rates = rates;
    this.nodes = {};      // id -> {id, name, road, line, lat, lng, xp}
    this.systems = {};    // id -> {id, road, fares: {"a>b": [c1,c2,c3]}, status}
    this.outgoing = {};   // node id -> [{to, system, fare}]
    this.incoming = {};   // node id -> count
    this.placeOf = {};    // node id -> place id
    this.places = [];     // [{id, name, nodes: [...], roads: [...], group}]
    this._build();
  }

  TollEngine.prototype._build = function () {
    var self = this;
    Object.keys(this.rates.roads).forEach(function (roadId) {
      var road = self.rates.roads[roadId];
      road.nodes.forEach(function (n) {
        self.nodes[n.id] = {
          id: n.id, name: n.name, road: roadId, line: n.line, order: n.order,
          lat: n.lat, lng: n.lng, xp: n.xp,
          km: typeof n.km === "number" ? n.km : null,
          leadsTo: n.leadsTo || [], note: n.note || ""
        };
        self.outgoing[n.id] = [];
        self.incoming[n.id] = 0;
      });
      road.systems.forEach(function (s) {
        var sys = { id: s.id, road: roadId, fares: {}, status: s.status };
        function add(a, b, fare, key) {
          sys.fares[a + ">" + b] = { fare: fare, key: key };
          self.outgoing[a].push({ to: b, system: s.id, fare: fare, key: key });
          self.incoming[b] += 1;
        }
        Object.keys(s.fares).forEach(function (k) {
          var p = k.split("|");
          add(p[0], p[1], s.fares[k], k);
          add(p[1], p[0], s.fares[k], k);
        });
        Object.keys(s.oneWay).forEach(function (k) {
          var p = k.split(">");
          add(p[0], p[1], s.oneWay[k], k);
        });
        self.systems[s.id] = sys;
      });
    });

    // Merge linked nodes into places.
    var placeIdx = {}, placeMeta = {};
    (this.rates.links || []).forEach(function (l) {
      var pid = placeIdx[l.a] || placeIdx[l.b] || ("place." + l.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
      placeIdx[l.a] = pid;
      placeIdx[l.b] = pid;
      placeMeta[pid] = { name: l.name, junction: !!l.junction };
    });
    var byId = {};
    Object.keys(this.nodes).forEach(function (id) {
      var n = self.nodes[id];
      var pid = placeIdx[id] || ("place." + id);
      if (!byId[pid]) {
        var meta = placeMeta[pid] || {};
        byId[pid] = {
          id: pid, name: meta.name || n.name, nodes: [], roads: [], group: groupOf(n),
          // A junction only joins two roads; nobody gets on or off there.
          hidden: !!meta.junction
        };
        self.places.push(byId[pid]);
      }
      byId[pid].nodes.push(id);
      if (byId[pid].roads.indexOf(n.road) < 0) byId[pid].roads.push(n.road);
      self.placeOf[id] = pid;
    });
    this.places.forEach(function (p) {
      p.canEnter = p.nodes.some(function (id) { return self.outgoing[id].length > 0; });
      p.canExit = p.nodes.some(function (id) { return self.incoming[id] > 0; });
    });
    this._placeById = byId;
  };

  // Which heading a place is listed under in the pickers.
  function groupOf(n) {
    if (n.road === "skyway3") return "Skyway Stage 3 (Buendia – Balintawak)";
    if (n.road === "naiax") return "NAIAX (airport)";
    if (n.road === "cavitex") return "CAVITEX (Manila – Cavite)";
    if (n.road === "calax") return "CALAX (Mamplasan – Silang)";
    if (n.road === "nlex") return "NLEX (Balintawak – Sta. Ines)";
    if (n.line === "skyway") return "Skyway (elevated, Buendia – Alabang)";
    if (n.line === "mcx") return "MCX";
    if (n.line === "atgrade") return "SLEX at-grade (Magallanes – Sucat)";
    return "SLEX (Bicutan – Sto. Tomas)";
  }

  TollEngine.prototype.place = function (id) { return this._placeById[id]; };

  /*
   * Cheapest trip from place a to place b for vehicle class cls (1-3).
   * Returns {total, charges: [{road, roadName, from, to, fare, status, rfid}]}
   * or null when there is no way to make that trip.
   */
  TollEngine.prototype.quote = function (fromPlace, toPlace, cls) {
    var self = this, c = cls - 1;
    var from = this._placeById[fromPlace], to = this._placeById[toPlace];
    if (!from || !to || fromPlace === toPlace) return null;
    var goal = {};
    to.nodes.forEach(function (id) { goal[id] = true; });

    // Dijkstra over (node, system of the last charge). Ties go to fewer charges.
    var best = {}, queue = [];
    function push(node, lastSys, cost, steps, prev, edge) {
      var key = node + "#" + (lastSys || "");
      var cur = best[key];
      if (cur && (cur.cost < cost || (cur.cost === cost && cur.steps <= steps))) return;
      best[key] = { cost: cost, steps: steps, prev: prev, edge: edge, node: node, lastSys: lastSys };
      queue.push(key);
    }
    from.nodes.forEach(function (id) { push(id, null, 0, 0, null, null); });
    var found = null;
    while (queue.length) {
      queue.sort(function (x, y) {
        return best[x].cost - best[y].cost || best[x].steps - best[y].steps;
      });
      var key = queue.shift(), st = best[key];
      if (goal[st.node] && st.steps > 0) { found = key; break; }
      // Charges starting here, on a different table than the last one.
      self.outgoing[st.node].forEach(function (e) {
        if (e.system === st.lastSys) return;
        push(e.to, e.system, st.cost + e.fare[c], st.steps + 1, key, e);
      });
      // Walk across to the same place on another road (no cost).
      var pid = self.placeOf[st.node];
      self._placeById[pid].nodes.forEach(function (other) {
        if (other !== st.node) push(other, st.lastSys, st.cost, st.steps, key, null);
      });
    }
    if (!found) return null;

    var charges = [];
    for (var k = found; k; k = best[k].prev) {
      var b = best[k];
      if (!b.edge) continue;
      var prevNode = best[b.prev].node;
      var sys = self.systems[b.edge.system];
      var road = self.rates.roads[sys.road];
      var op = self.rates.operators[road.operator] || {};
      var st = sys.status[b.edge.key] || {};
      charges.unshift({
        road: sys.road,
        roadName: road.name,
        system: b.edge.system,
        fromId: prevNode,
        toId: b.node,
        from: self.nodes[prevNode].name,
        to: self.nodes[b.node].name,
        fare: b.edge.fare[c],
        status: st.s || "unknown",
        since: st.from || road.asOf,
        prevFare: st.prev ? st.prev[c] : null,
        prevFrom: st.prevFrom || null,
        rfid: op.rfid || "",
        tag: op.primary || "",
        operator: op.name || "",
        charging: road.charging || "",
        direction: self.direction(prevNode, b.node),
        km: (self.distance(prevNode, b.node) || {}).km || null,
        kmApprox: !!(self.distance(prevNode, b.node) || {}).approx,
        passing: self.passing(b.edge.system, prevNode, b.node, c)
      });
    }
    var total = charges.reduce(function (t, ch) { return t + ch.fare; }, 0);
    return { total: total, charges: charges };
  };

  /*
   * Travel direction of a charge, as the road's own labels say it
   * (rates.roads[r].directions = {up: "...", down: "..."}, "up" meaning
   * increasing km, or increasing list order when km isn't known).
   */
  TollEngine.prototype.direction = function (a, b) {
    var na = this.nodes[a], nb = this.nodes[b];
    var road = this.rates.roads[na.road], dirs = road.directions || {};
    var byKm = road.directionBy !== "order" && na.km !== null && nb.km !== null;
    var diff = byKm ? nb.km - na.km : nb.order - na.order;
    if (!diff) return "";
    return diff > 0 ? (dirs.up || "") : (dirs.down || "");
  };

  /*
   * Distance between two plazas on the same road: from km posts where both
   * have one, otherwise estimated along the plazas' map positions (straight
   * lines between plazas in road order, +10% for curves). Returns
   * {km, approx} or null when neither works.
   */
  TollEngine.prototype.distance = function (a, b) {
    var na = this.nodes[a], nb = this.nodes[b];
    if (na.km !== null && nb.km !== null) {
      return { km: Math.round(Math.abs(nb.km - na.km) * 10) / 10, approx: false };
    }
    var self = this;
    var path = Object.keys(this.nodes).map(function (id) { return self.nodes[id]; }).filter(function (n) {
      return n.road === na.road && n.line === na.line && n.order > Math.min(na.order, nb.order) && n.order < Math.max(na.order, nb.order);
    }).sort(function (x, y) { return x.order - y.order; });
    path = [na].concat(na.order < nb.order ? path : path.reverse(), [nb]);
    if (path.some(function (n) { return typeof n.lat !== "number"; })) return null;
    var total = 0;
    for (var i = 1; i < path.length; i++) total += haversine(path[i - 1], path[i]);
    return { km: Math.round(total * 1.1 * 10) / 10, approx: true };
  };

  function haversine(p, q) {
    var R = 6371, rad = Math.PI / 180;
    var dLat = (q.lat - p.lat) * rad, dLng = (q.lng - p.lng) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(p.lat * rad) * Math.cos(q.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /*
   * Exits you drive past on a charge from a to b, each with what it would
   * cost to leave there instead. Only plazas that really are exits from a on
   * the same table, lying between a and b by km, are listed.
   */
  TollEngine.prototype.passing = function (systemId, a, b, c) {
    var self = this, na = this.nodes[a], nb = this.nodes[b];
    if (na.km === null || nb.km === null) return [];
    var lo = Math.min(na.km, nb.km), hi = Math.max(na.km, nb.km);
    var lines = {};
    lines[na.line] = lines[nb.line] = lines.shared = true;
    var out = [];
    this.outgoing[a].forEach(function (e) {
      if (e.system !== systemId || e.to === b) return;
      var n = self.nodes[e.to];
      if (n.km === null || n.km <= lo || n.km >= hi || !lines[n.line]) return;
      out.push({ id: n.id, name: n.name, km: n.km, fare: e.fare[c], leadsTo: n.leadsTo });
    });
    out.sort(function (x, y) { return na.km < nb.km ? x.km - y.km : y.km - x.km; });
    return out;
  };

  /* Every trip you can make from a place, cheapest route each, for the fare list. */
  TollEngine.prototype.faresFrom = function (fromPlace, cls) {
    var self = this, out = [];
    this.places.forEach(function (p) {
      if (p.id === fromPlace || !p.canExit || p.hidden) return;
      var q = self.quote(fromPlace, p.id, cls);
      if (q) out.push({ place: p, quote: q });
    });
    return out;
  };

  /* Straight-line km between two map points. */
  TollEngine.prototype.kmBetween = function (p, q) { return haversine(p, q); };

  /* Straight-line km from a map point to a place's plaza, or Infinity. */
  TollEngine.prototype.kmTo = function (pt, place) {
    var self = this, best = Infinity;
    place.nodes.forEach(function (id) {
      var n = self.nodes[id];
      if (typeof n.lat === "number") best = Math.min(best, haversine(pt, n));
    });
    return best;
  };

  /*
   * Pick toll entry and exit for a trip between two map points (from a Google
   * Maps or Waze link). Tries the few plazas nearest each end and keeps the
   * pair with the least driving off the toll roads; ties go to the cheaper.
   * Either end may be a fixed place id instead of a point.
   * Returns {from, to, offFrom, offTo, quote} or null.
   */
  TollEngine.prototype.plan = function (start, end, cls, opts) {
    var self = this, k = (opts && opts.candidates) || 6;
    function nearest(pt, want) {
      if (typeof pt === "string") return [{ place: self.place(pt), km: 0 }];
      return self.places.filter(function (p) { return !p.hidden && p[want]; })
        .map(function (p) { return { place: p, km: self.kmTo(pt, p) }; })
        .filter(function (x) { return isFinite(x.km); })
        .sort(function (a, b) { return a.km - b.km; }).slice(0, k);
    }
    var ins = nearest(start, "canEnter"), outs = nearest(end, "canExit"), best = null;
    ins.forEach(function (a) {
      outs.forEach(function (b) {
        if (a.place.id === b.place.id) return;
        var q = self.quote(a.place.id, b.place.id, cls);
        if (!q) return;
        var off = a.km + b.km;
        if (!best || off < best.off - 0.5 || (Math.abs(off - best.off) <= 0.5 && q.total < best.quote.total)) {
          best = { from: a.place.id, to: b.place.id, offFrom: a.km, offTo: b.km, off: off, quote: q };
        }
      });
    });
    return best;
  };

  /* Places reachable as an exit from fromPlace (for greying out the To list). */
  TollEngine.prototype.reachableFrom = function (fromPlace, cls) {
    var self = this, out = {};
    this.places.forEach(function (p) {
      if (p.id !== fromPlace && p.canExit && !p.hidden && self.quote(fromPlace, p.id, cls)) out[p.id] = true;
    });
    return out;
  };

  /* Roads whose fares were last confirmed more than `months` ago. */
  TollEngine.prototype.staleRoads = function (today, months) {
    var self = this, limit = new Date(today);
    limit.setMonth(limit.getMonth() - (months || 6));
    return Object.keys(this.rates.roads).filter(function (r) {
      var checked = self.rates.roads[r].checked;
      return !checked || new Date(checked) < limit;
    });
  };

  root.TollEngine = TollEngine;
  if (typeof module !== "undefined" && module.exports) module.exports = TollEngine;
})(typeof window !== "undefined" ? window : globalThis);
