/*
 * My vehicles: each car's name, plate, class, fuel use and RFID account
 * numbers, saved only in this browser. Picking a car sets the class and fuel
 * figure on the Trip tab; each car's card has copy buttons and links to the
 * official reload sites, so topping up online is copy, open, paste.
 */
(function () {
  "use strict";

  var KEY = "tollph.vehicles", PICK = "tollph.vehicle";
  // Official sites only. Reload options are listed on each.
  var RELOAD = [
    { tag: "Autosweep", field: "autosweep", url: "https://www.autosweeprfid.com/", roads: "Skyway, SLEX, MCX, NAIAX, STAR, TPLEX" },
    { tag: "Easytrip", field: "easytrip", url: "https://www.easytrip.ph/", roads: "NLEX, CAVITEX, CALAX, SCTEX" }
  ];
  var app, editing = null;
  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || "[]") || []; } catch (e) { return []; }
  }
  function write(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
  }
  function picked() {
    try { return localStorage.getItem(PICK) || ""; } catch (e) { return ""; }
  }
  function setPicked(id) {
    try { localStorage.setItem(PICK, id); } catch (e) { /* storage unavailable */ }
  }

  /* ---------- Trip tab: the vehicle chips ---------- */
  function renderPicker() {
    var list = read(), box = $("vehicle-pick"), cur = picked();
    if (!list.length) {
      box.innerHTML = '<button type="button" class="chip-btn" data-go="vehicles">+ Save your vehicle</button>';
      return;
    }
    box.innerHTML = list.map(function (v) {
      return '<button type="button" class="chip-btn' + (v.id === cur ? " on" : "") + '" data-pick="' + esc(v.id) +
        '" aria-pressed="' + (v.id === cur) + '">' + esc(v.name) + " · " + esc(v.plate) + "</button>";
    }).join("");
  }

  function pick(id) {
    var v = read().filter(function (x) { return x.id === id; })[0];
    if (!v) return;
    setPicked(id);
    app.applyVehicle(v);
    renderPicker();
  }

  /* ---------- Vehicles tab ---------- */
  function copyButton(value, what) {
    return '<button type="button" class="copy" data-copy="' + esc(value) + '" aria-label="Copy ' + esc(what) + '">Copy</button>';
  }

  function renderList() {
    var list = read(), cur = picked();
    var html = "";
    if (!list.length) {
      html += '<div class="card"><p class="card-title">No vehicles saved yet</p>' +
        '<p class="step-sub">Save your car once: its class and fuel use fill in automatically on the Trip tab, ' +
        "and its plate and RFID account numbers are ready to copy when you load up online.</p></div>";
    }
    list.forEach(function (v) {
      var rows = '<div class="v-row"><span class="v-label">Plate</span><span class="v-value">' + esc(v.plate) + "</span>" + copyButton(v.plate, "plate") + "</div>" +
        '<div class="v-row"><span class="v-label">Class</span><span class="v-value">Class ' + esc(v.cls) + "</span><span></span></div>" +
        (v.kml ? '<div class="v-row"><span class="v-label">Fuel use</span><span class="v-value">' + esc(v.kml) + " km/L</span><span></span></div>" : "");
      RELOAD.forEach(function (r) {
        if (v[r.field]) {
          rows += '<div class="v-row"><span class="v-label">' + r.tag + ' account</span><span class="v-value">' + esc(v[r.field]) +
            "</span>" + copyButton(v[r.field], r.tag + " account number") + "</div>";
        }
      });
      var reload = RELOAD.filter(function (r) { return v[r.field]; });
      if (!reload.length) reload = RELOAD;
      html += '<div class="card vehicle' + (v.id === cur ? " on" : "") + '">' +
        '<div class="v-head"><p class="card-title">' + esc(v.name) + "</p>" +
        (v.id === cur ? '<span class="chip slex">In use</span>' : '<button type="button" class="chip-btn" data-pick="' + esc(v.id) + '">Use for trips</button>') +
        "</div>" + rows +
        '<p class="leg-title">Load up online</p><div class="reload">' +
        reload.map(function (r) {
          return '<a class="btn" href="' + r.url + '" target="_blank" rel="noopener">Open ' + r.tag + " site</a>";
        }).join("") + "</div>" +
        '<p class="step-sub">Copy the plate or account number above, open the site, then paste it where it asks. ' +
        reload.map(function (r) { return r.tag + " covers " + r.roads + "."; }).join(" ") + "</p>" +
        '<div class="v-actions"><button type="button" class="btn subtle" data-edit="' + esc(v.id) + '">Edit</button>' +
        '<button type="button" class="btn subtle" data-del="' + esc(v.id) + '">Delete</button></div>' +
        '<p class="copy-msg" aria-live="polite"></p></div>';
    });
    html += '<div class="card"><button type="button" class="btn" id="v-add">+ Add a vehicle</button>' +
      '<p class="step-sub">Saved only on this phone or browser. Nothing is sent anywhere.</p></div>';
    $("vehicles").innerHTML = html;
  }

  function renderForm(v) {
    editing = v ? v.id : "new";
    v = v || { name: "", plate: "", cls: 1, kml: "", autosweep: "", easytrip: "" };
    $("vehicles").innerHTML = '<form class="card v-form" id="v-form" novalidate>' +
      '<p class="card-title">' + (editing === "new" ? "Add a vehicle" : "Edit vehicle") + "</p>" +
      field("v-name", "Vehicle", v.name, "e.g. Toyota Veloz", "text", "words") +
      field("v-plate", "Plate number", v.plate, "e.g. ABC1234", "text", "characters") +
      '<label class="field"><span class="field-label">Toll class</span><select id="v-class">' +
      [1, 2, 3].map(function (c) {
        return '<option value="' + c + '"' + (Number(v.cls) === c ? " selected" : "") + ">Class " + c + " — " +
          esc(app.classes()[String(c)] || "") + "</option>";
      }).join("") + "</select></label>" +
      field("v-kml", "Fuel use, km per litre (optional)", v.kml, "e.g. 12", "number") +
      field("v-autosweep", "Autosweep account number (optional)", v.autosweep, "As printed on your Autosweep card or app", "text") +
      field("v-easytrip", "Easytrip account number (optional)", v.easytrip, "As printed on your Easytrip card or app", "text") +
      '<p id="v-error" class="note warn" hidden></p>' +
      '<div class="v-actions"><button type="submit" class="btn">Save</button>' +
      '<button type="button" class="btn subtle" id="v-cancel">Cancel</button></div></form>';
    $("v-form").addEventListener("submit", save);
    $("v-cancel").addEventListener("click", function () { editing = null; renderList(); });
    $("v-name").focus();
  }
  function field(id, labelText, value, placeholder, type, caps) {
    return '<label class="field"><span class="field-label">' + esc(labelText) + '</span><input id="' + id + '" type="' + type + '"' +
      (type === "number" ? ' inputmode="decimal" min="1" step="0.5"' : "") +
      (caps ? ' autocapitalize="' + caps + '"' : "") + ' value="' + esc(value) + '" placeholder="' + esc(placeholder) + '"></label>';
  }

  function save(e) {
    e.preventDefault();
    var v = {
      id: editing === "new" ? "v" + Date.now().toString(36) : editing,
      name: $("v-name").value.trim().toUpperCase(),
      plate: $("v-plate").value.replace(/\s+/g, "").toUpperCase(),
      cls: Number($("v-class").value),
      kml: $("v-kml").value.trim(),
      autosweep: $("v-autosweep").value.trim(),
      easytrip: $("v-easytrip").value.trim()
    };
    var err = !v.name ? "Add the vehicle's name, e.g. Toyota Veloz." : !v.plate ? "Add the plate number." : "";
    if (err) { $("v-error").textContent = err; $("v-error").hidden = false; return; }
    var list = read(), i = list.map(function (x) { return x.id; }).indexOf(v.id);
    if (i >= 0) list[i] = v; else list.push(v);
    if (!write(list)) {
      $("v-error").textContent = "This browser isn't letting the app save anything (private mode or blocked storage).";
      $("v-error").hidden = false;
      return;
    }
    editing = null;
    if (!picked() || picked() === v.id || list.length === 1) pick(v.id);
    renderList();
    renderPicker();
  }

  function onClick(e) {
    var t = e.target;
    var b = t.closest("button");
    if (!b) return;
    if (b.id === "v-add") { renderForm(null); return; }
    if (b.hasAttribute("data-pick")) { pick(b.getAttribute("data-pick")); renderList(); return; }
    if (b.hasAttribute("data-edit")) {
      renderForm(read().filter(function (x) { return x.id === b.getAttribute("data-edit"); })[0]);
      return;
    }
    if (b.hasAttribute("data-del")) {
      // Two taps instead of confirm(): pop-up dialogs don't show inside every viewer.
      if (!b.getAttribute("data-armed")) {
        b.setAttribute("data-armed", "1");
        b.textContent = "Tap again to delete";
        setTimeout(function () { if (document.body.contains(b)) { b.removeAttribute("data-armed"); b.textContent = "Delete"; } }, 4000);
        return;
      }
      var id = b.getAttribute("data-del");
      write(read().filter(function (x) { return x.id !== id; }));
      if (picked() === id) setPicked("");
      renderList();
      renderPicker();
      return;
    }
    if (b.hasAttribute("data-copy")) {
      var value = b.getAttribute("data-copy"), msg = b.closest(".card").querySelector(".copy-msg");
      var done = function () { msg.textContent = "Copied " + value + "."; };
      var fallback = function () { msg.innerHTML = 'Select and copy: <input class="share-link" readonly value="' + esc(value) + '">'; var i = msg.querySelector("input"); i.focus(); i.select(); };
      try { navigator.clipboard.writeText(value).then(done, fallback); } catch (err) { fallback(); }
    }
  }

  window.TollVehicles = {
    init: function (api) {
      app = api;
      $("vehicles").addEventListener("click", onClick);
      $("vehicle-pick").addEventListener("click", function (e) {
        var b = e.target.closest("button");
        if (!b) return;
        if (b.hasAttribute("data-go")) { app.showTab("vehicles"); renderForm(null); return; }
        if (b.hasAttribute("data-pick")) pick(b.getAttribute("data-pick"));
      });
      renderPicker();
      // Re-apply the car in use so its class and fuel figure are set on start-up.
      var cur = read().filter(function (x) { return x.id === picked(); })[0];
      if (cur) app.applyVehicle(cur, true);
    },
    show: function () { if (!editing) renderList(); },
    // Picking a class by hand means the trip no longer matches the chosen car.
    classChanged: function (cls) {
      var cur = read().filter(function (x) { return x.id === picked(); })[0];
      if (cur && Number(cur.cls) !== cls) { setPicked(""); renderPicker(); }
    }
  };
})();
