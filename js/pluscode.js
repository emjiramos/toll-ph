/*
 * Read Google Plus Codes (Open Location Code), offline.
 *
 * TollPlusCode.find(text) -> {code, before, after} | null
 *   Finds a plus code in pasted text such as
 *   "Ayala Avenue, Poblacion, H268+X3Q, Makati City, 1200 Metro Manila".
 *   before/after are the address parts around the code (to name the place
 *   and to find the town a short code belongs to).
 * TollPlusCode.decode(code, ref) -> {lat, lng} | null
 *   A full code (7Q63H268+X3Q) decodes on its own. A short code (H268+X3Q)
 *   drops its first digits and only means something near a reference point,
 *   so ref {lat, lng} is required for it: the nearest matching spot is used.
 *
 * Algorithm per the Open Location Code spec
 * (github.com/google/open-location-code/blob/main/Documentation/Specification/specification.md).
 */
(function (root) {
  "use strict";

  var ALPHABET = "23456789CFGHJMPQRVWX";
  var PAIR_RES = [20, 1, 0.05, 0.0025, 0.000125];  // degrees per digit, for each pair of digits
  var CODE_RE = /(^|[^0-9A-Z+])([23456789CFGHJMPQRVWX]{2,8}0*\+[23456789CFGHJMPQRVWX]{0,7})(?![0-9A-Z+])/i;

  function find(text) {
    var s = String(text || "");
    var m = CODE_RE.exec(s);
    if (!m) return null;
    var code = m[2].toUpperCase();
    var plus = code.indexOf("+");
    // A valid code has an even number of digits before "+" (2-8), and a full
    // code's padded digits ("0") can't be followed by more digits.
    if (plus % 2 !== 0 || plus > 8) return null;
    if (plus < 8 && code.indexOf("0") < 0 && plus !== 4 && plus !== 6) return null;
    var start = m.index + m[1].length;
    var tidy = function (t) { return t.replace(/^[\s,]+|[\s,]+$/g, ""); };
    return { code: code, before: tidy(s.slice(0, start)), after: tidy(s.slice(start + m[2].length)) };
  }

  function isFull(code) { return code.indexOf("+") === 8; }

  // Lower-left corner + size of a full code's area, then its centre.
  function decodeFull(code) {
    var digits = code.replace("+", "").replace(/0+$/, "");
    var lat = -90, lng = -180, latRes = 20, lngRes = 20;
    for (var i = 0; i < Math.min(digits.length, 10); i += 2) {
      var res = PAIR_RES[i / 2];
      var a = ALPHABET.indexOf(digits[i]), b = ALPHABET.indexOf(digits[i + 1]);
      if (a < 0 || b < 0) return null;
      lat += a * res; lng += b * res;
      latRes = lngRes = res;
    }
    // Grid digits after the 10th: a 4 x 5 grid each (finer than ~14 m).
    for (var j = 10; j < digits.length; j++) {
      var d = ALPHABET.indexOf(digits[j]);
      if (d < 0) return null;
      latRes /= 5; lngRes /= 4;
      lat += Math.floor(d / 4) * latRes; lng += (d % 4) * lngRes;
    }
    if (lat >= 90 || lng >= 180) return null;
    return { lat: lat + latRes / 2, lng: lng + lngRes / 2 };
  }

  // The first n digits of the full code for a point (n even, 2-8).
  function prefixFor(lat, lng, n) {
    var la = Math.min(Math.max(lat, -90), 90 - 1e-9) + 90, ln = ((lng + 180) % 360 + 360) % 360;
    var out = "";
    for (var i = 0; i < n / 2; i++) {
      var res = PAIR_RES[i];
      var a = Math.floor(la / res), b = Math.floor(ln / res);
      out += ALPHABET[a] + ALPHABET[b];
      la -= a * res; ln -= b * res;
    }
    return out;
  }

  function decode(code, ref) {
    code = String(code || "").toUpperCase().trim();
    var plus = code.indexOf("+");
    if (plus < 0) return null;
    if (isFull(code)) return decodeFull(code);
    if (!ref) return null;
    // Short code: borrow the missing leading digits from the reference point,
    // then move one cell over if that lands closer to the reference.
    var missing = 8 - plus;
    var res = Math.pow(20, 2 - missing / 2);
    var p = decodeFull(prefixFor(ref.lat, ref.lng, missing) + code);
    if (!p) return null;
    var half = res / 2;
    if (ref.lat + half < p.lat && p.lat - res >= -90) p.lat -= res;
    else if (ref.lat - half > p.lat && p.lat + res <= 90) p.lat += res;
    if (ref.lng + half < p.lng) p.lng -= res;
    else if (ref.lng - half > p.lng) p.lng += res;
    return p;
  }

  root.TollPlusCode = { find: find, decode: decode };
  if (typeof module !== "undefined" && module.exports) module.exports = root.TollPlusCode;
})(typeof window !== "undefined" ? window : globalThis);
