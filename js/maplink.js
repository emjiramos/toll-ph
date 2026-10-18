/*
 * Read a Google Maps or Waze link and pull out where the trip starts and
 * ends. Works offline: everything comes from the link text itself.
 *
 * TollMapLink.parse(text) -> {
 *   app: "google" | "waze" | null,
 *   from: {lat, lng, name} | null,   // lat/lng may be missing when only a name is known
 *   to:   {lat, lng, name} | null,
 *   error: "" | "short" | "unknown"
 * }
 *
 * Google directions links carry each stop's position in the data= part as
 * !1d<longitude>!2d<latitude>, and the stop names in the /dir/ path. Short
 * links (maps.app.goo.gl) are only a pointer to that full link, and a page
 * can't follow them itself, so they come back as error "short" (with the
 * link in .short); app.js then asks the link relay (relay/worker.js) for the
 * full link and parses that.
 * Waze share links (waze.com/ul/h<geohash>) encode the destination as a
 * geohash; ul?ll=lat,lng and live-map ?to=ll.lat,lng&from=ll.lat,lng are read too.
 */
(function (root) {
  "use strict";

  var NUM = "(-?\\d+(?:\\.\\d+)?)";
  var LATLNG = new RegExp("^\\s*" + NUM + "\\s*,\\s*" + NUM + "\\s*$");

  function point(lat, lng, name) {
    lat = Number(lat); lng = Number(lng);
    var ok = isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    return { lat: ok ? lat : null, lng: ok ? lng : null, name: name || "" };
  }
  function named(name) { return name ? { lat: null, lng: null, name: name } : null; }
  function cleanName(s) {
    try { s = decodeURIComponent(s.replace(/\+/g, " ")); } catch (e) { s = s.replace(/\+/g, " "); }
    return s.trim();
  }
  function fromText(s) {
    if (!s) return null;
    var name = cleanName(s);
    var m = LATLNG.exec(name);
    return m ? point(m[1], m[2], "") : named(name);
  }

  // Standard geohash decoding (base32, interleaved longitude/latitude bits).
  function geohash(hash) {
    var B32 = "0123456789bcdefghjkmnpqrstuvwxyz";
    var lat = [-90, 90], lng = [-180, 180], even = true;
    for (var i = 0; i < hash.length; i++) {
      var cd = B32.indexOf(hash.charAt(i).toLowerCase());
      if (cd < 0) return null;
      for (var mask = 16; mask >= 1; mask >>= 1) {
        var r = even ? lng : lat, mid = (r[0] + r[1]) / 2;
        if (cd & mask) r[0] = mid; else r[1] = mid;
        even = !even;
      }
    }
    return point((lat[0] + lat[1]) / 2, (lng[0] + lng[1]) / 2, "");
  }

  function parseGoogle(url) {
    var out = { app: "google", from: null, to: null, error: "" };
    var path = url.pathname;
    // Stop names from /maps/dir/<stop>/<stop>/...
    var names = [];
    var dir = path.split("/dir/")[1];
    if (dir) {
      dir.split("/").forEach(function (seg) {
        if (seg && seg.charAt(0) !== "@" && seg.indexOf("data=") !== 0 && seg.indexOf("am=") !== 0) names.push(seg);
      });
    }
    // Stop positions from the data= part, in stop order.
    var coords = [], re = /!1d(-?\d+(?:\.\d+)?)!2d(-?\d+(?:\.\d+)?)/g, m;
    var whole = url.href;
    while ((m = re.exec(whole))) coords.push(point(m[2], m[1], ""));
    // A stop typed as "lat,lng" in the path (e.g. a dropped pin or "Your
    // location") has no position in data=; only the named stops do, in order.
    var stops = names.map(fromText);
    var unplaced = stops.filter(function (s) { return s && s.lat === null; });
    if (stops.length >= 2 && coords.length > 0 && coords.length === unplaced.length) {
      unplaced.forEach(function (s, i) { s.lat = coords[i].lat; s.lng = coords[i].lng; });
      out.from = stops[0];
      out.to = stops[stops.length - 1];
      return out;
    }
    if (coords.length >= 2) {
      out.from = coords[0];
      out.to = coords[coords.length - 1];
      if (names.length >= 2) { out.from.name = cleanName(names[0]); out.to.name = cleanName(names[names.length - 1]); }
      return out;
    }
    if (names.length >= 2) {
      out.from = fromText(names[0]);
      out.to = fromText(names[names.length - 1]);
      return out;
    }
    // Maps URLs API: ?api=1&origin=...&destination=...
    var q = url.searchParams;
    if (q.get("destination") || q.get("daddr")) {
      out.from = fromText(q.get("origin") || q.get("saddr"));
      out.to = fromText(q.get("destination") || q.get("daddr"));
      return out;
    }
    // A single place link: treat it as the destination.
    var place = path.split("/place/")[1];
    var at = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(path);
    if (place || at) {
      out.to = at ? point(at[1], at[2], place ? cleanName(place.split("/")[0]) : "") : fromText(place.split("/")[0]);
      return out;
    }
    out.error = "unknown";
    return out;
  }

  function parseWaze(url) {
    var out = { app: "waze", from: null, to: null, error: "" };
    var q = url.searchParams;
    var hm = /\/ul\/h([0-9a-z]+)/i.exec(url.pathname);
    if (hm) { out.to = geohash(hm[1]); return out; }
    function ll(v) {
      if (!v) return null;
      v = cleanName(v).replace(/^ll\./, "");
      var m = LATLNG.exec(v);
      return m ? point(m[1], m[2], "") : null;
    }
    out.to = ll(q.get("ll")) || ll(q.get("to")) || (q.get("q") ? named(cleanName(q.get("q"))) : null);
    out.from = ll(q.get("from"));
    if (!out.to) out.error = "unknown";
    return out;
  }

  function parse(text) {
    var m = /https?:\/\/[^\s<>"']+/i.exec(String(text || ""));
    if (!m) return { app: null, from: null, to: null, error: "unknown" };
    var url;
    try { url = new URL(m[0]); } catch (e) { return { app: null, from: null, to: null, error: "unknown" }; }
    var host = url.hostname.toLowerCase();
    if (host === "maps.app.goo.gl" || (host === "goo.gl" && /^\/maps/.test(url.pathname))) {
      return { app: "google", from: null, to: null, error: "short", short: url.href };
    }
    if (/(^|\.)google\.[a-z.]+$/.test(host) && /^\/maps/.test(url.pathname) || host === "maps.google.com") return parseGoogle(url);
    if (/(^|\.)waze\.com$/.test(host)) return parseWaze(url);
    return { app: null, from: null, to: null, error: "unknown" };
  }

  root.TollMapLink = { parse: parse, geohash: geohash };
  if (typeof module !== "undefined" && module.exports) module.exports = root.TollMapLink;
})(typeof window !== "undefined" ? window : globalThis);
