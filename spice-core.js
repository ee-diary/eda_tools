/* spice-core.js - shared helpers + converter registry. Load this first. */
(function (g) {
  'use strict';
  var SCALE = { t: 1e12, g: 1e9, meg: 1e6, k: 1e3, mil: 25.4e-6, m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15, a: 1e-18 };
  var core = {
    converters: {},                       // 'from->to' -> function (text) => {text, notes, changed, flagged}
    register: function (from, to, fn) { core.converters[from + '->' + to] = fn; },
    // Join '+' continuation lines. Returns [{ no: first physical line number, text }]
    logicalLines: function (text) {
      var out = [];
      text.split(/\r\n|\r|\n/).forEach(function (raw, i) {
        if (/^\s*\+/.test(raw) && out.length) out[out.length - 1].text += ' ' + raw.replace(/^\s*\+/, '').trim();
        else out.push({ no: i + 1, text: raw });
      });
      return out;
    },
    // SPICE number -> float, or null if not a plain number. NOTE: F = femto, M = milli, MEG = mega.
    num: function (s) {
      var m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(meg|mil|[tgkmunpfa])?[a-z]*$/i.exec(String(s).trim());
      return m ? parseFloat(m[1]) * (m[2] ? SCALE[m[2].toLowerCase()] : 1) : null;
    },
    fmt: function (x) { return String(+x.toPrecision(9)); },
    // "VT=4 VH=0" -> { VT: '4', VH: '0' } (upper-case keys; values must not contain spaces)
    params: function (s) {
      var p = {}, re = /(\w+)\s*=\s*([^\s=]+)/g, m;
      while ((m = re.exec(s))) p[m[1].toUpperCase()] = m[2];
      return p;
    }
  };
  g.SpiceCore = core;
})(typeof window !== 'undefined' ? window : globalThis);
