/* pspice-to-spice3f5.js - PSpice (OrCAD / Cadence) -> SPICE3f5 / PROSPICE. Needs spice-core.js.
   PSpice has features SPICE3f5 lacks (TABLE, LAPLACE, .STEP, .FUNC ...). Those lines are commented out and reported. */
(function (g) {
  'use strict';
  var core = g.SpiceCore;
  var OK_FN = /^(abs|acos|acosh|asin|asinh|atan|atanh|cos|cosh|exp|ln|log|sin|sinh|sqrt|tan|u|uramp|v|i)$/;
  var STEP = 'u', SGN = function (x) { return '(2*' + STEP + '(' + x + ')-1)'; };
  var mx = function (a, b) { return '((' + a + ')+(' + b + ')+abs((' + a + ')-(' + b + ')))/2'; };
  var mn = function (a, b) { return '((' + a + ')+(' + b + ')-abs((' + a + ')-(' + b + ')))/2'; };
  var RULES = {   // PSpice function -> SPICE3f5 expression (args already converted); null = cannot convert
    max: function (a) { return a.length === 2 ? '(' + mx(a[0], a[1]) + ')' : null; },
    min: function (a) { return a.length === 2 ? '(' + mn(a[0], a[1]) + ')' : null; },
    limit: function (a) { return a.length === 3 ? '(' + mn('(' + mx(a[0], a[1]) + ')', a[2]) + ')' : null; },
    stp: function (a) { return 'u(' + a[0] + ')'; },
    sgn: function (a) { return SGN(a[0]); },
    pwr: function (a) { return a.length === 2 ? '(abs(' + a[0] + ')^(' + a[1] + '))' : null; },
    pwrs: function (a) { return a.length === 2 ? '(' + SGN(a[0]) + '*abs(' + a[0] + ')^(' + a[1] + '))' : null; },
    arctan: function (a) { return 'atan(' + a[0] + ')'; },
    log: function (a) { return 'ln(' + a[0] + ')'; },        // PSpice LOG = natural log
    log10: function (a) { return 'log(' + a[0] + ')'; },     // SPICE3f5 log = base 10
    tanh: function (a) { return '(sinh(' + a[0] + ')/cosh(' + a[0] + '))'; },
    'if': function (a) {                                      // IF(x>y,a,b) with ONE relational operator
      var m = a.length === 3 && /^([^<>=!&|]+)(>=|<=|>|<)([^<>=!&|]+)$/.exec(a[0].trim());
      if (!m) return null;
      var d = /^>/.test(m[2]) ? '(' + m[1] + ')-(' + m[3] + ')' : '(' + m[3] + ')-(' + m[1] + ')';
      return '(u(' + d + ')*(' + a[1] + ')+(1-u(' + d + '))*(' + a[2] + '))';
    }
  };
  function close(e, i) { var d = 0; for (var k = i; k < e.length; k++) { if (e[k] === '(') d++; else if (e[k] === ')' && --d === 0) return k; } return -1; }
  function split(s) { var a = [], d = 0, c = '', k; for (k = 0; k < s.length; k++) { if (s[k] === '(') d++; if (s[k] === ')') d--; if (s[k] === ',' && d === 0) { a.push(c); c = ''; } else c += s[k]; } a.push(c); return a; }
  function rewrite(e, bad) {
    var re = /\b([A-Za-z_]\w*)\s*\(/g, m, out = '', last = 0;
    while ((m = re.exec(e))) {
      var nm = m[1].toLowerCase(), open = re.lastIndex - 1, end = close(e, open);
      if (end < 0) { bad.push('unbalanced parentheses'); break; }
      if (!RULES[nm]) { if (!OK_FN.test(nm)) bad.push(nm + '()'); continue; }
      var r = RULES[nm](split(e.slice(open + 1, end)).map(function (x) { return rewrite(x, bad); }));
      if (r === null) { bad.push(nm + '() form'); continue; }
      out += e.slice(last, m.index) + r; last = end + 1; re.lastIndex = end + 1;
    }
    return out + e.slice(last);
  }
  // Evaluate {expr} made only of numbers and + - * / ( ) ^ **  (after SPICE suffixes are expanded)
  function evalNum(x) {
    x = x.replace(/(\d*\.?\d+(?:e[+-]?\d+)?)(meg|mil|[tgkmunpfa])?[a-z]*/gi, function (all, n, s) { var v = core.num(all); return v === null ? all : '(' + v + ')'; });
    if (!/^[\d.eE+\-*/()\s^]+$/.test(x)) return null;
    try { var v = Function('"use strict";return (' + x.replace(/\^/g, '**') + ')')(); return isFinite(v) ? v : null; } catch (er) { return null; }
  }
  function convert(text) {
    var lines = core.logicalLines(text), out = [], notes = [], changed = 0, flagged = 0;
    var names = {}, hasAnalysis = false, sawEnd = false, G = {}, P = {}, inSub = false;
    lines.forEach(function (l) {
      var m = /^\s*([A-Za-z]\S*)/.exec(l.text); if (m) names[m[1].toUpperCase()] = 1;
      if (/^\s*\.(tran|ac|dc|op|tf|noise|sens)\b/i.test(l.text)) hasAnalysis = true;
    });
    // replace known params inside {...}, evaluate numeric ones
    function subst(t, add) {
      return t.replace(/\{([^{}]*)\}/g, function (all, inner) {
        var x = inner.replace(/\b([A-Za-z_]\w*)\b(?!\s*\()/g, function (id) { var k = id.toLowerCase(); return P[k] !== undefined ? '(' + P[k] + ')' : id; });
        var v = evalNum(x); return v === null ? '{' + x + '}' : core.fmt(v);
      });
    }
    lines.forEach(function (l) {
      var no = l.no, add = function (type, msg) { notes.push({ type: type, msg: 'Line ' + no + ': ' + msg }); };
      var t = l.text.trim(), m;
      function emit(s) { out.push(s); if (s !== l.text) changed++; }
      function unsupported(why) { out.push('* [UNSUPPORTED IN SPICE3F5] ' + t); changed++; flagged++; add('warn', why); }
      if (t.charAt(0) === '*') { if (hasAnalysis && no === 1) out.push(l.text); return; }
      t = l.text.replace(/\s*;.*$/, '').trim();
      if (t === '') return out.push('');
      if (/^\.end\s*$/i.test(t)) sawEnd = true;
      if (/^\.ends\b/i.test(t)) { inSub = false; P = {}; for (var k in G) P[k] = G[k]; }

      if ((m = /^\.param\w*\s+(.*)$/i.exec(t))) {                       // .PARAM a=1 b={a*2}
        var re = /(\w+)\s*=\s*(\{[^}]*\}|\S+)/g, q, ok = true;
        while ((q = re.exec(m[1]))) {
          var v = evalNum(subst(q[2].charAt(0) === '{' ? q[2] : '{' + q[2] + '}', add).replace(/[{}]/g, ''));
          if (v === null) { ok = false; add('warn', '.PARAM ' + q[1] + ' is not a plain number - not substituted.'); }
          else { (inSub ? P : G)[q[1].toLowerCase()] = core.fmt(v); P[q[1].toLowerCase()] = core.fmt(v); }
        }
        changed++; return add('ok', '.PARAM removed; numeric values were substituted where used (SPICE3f5 has no .PARAM).');
      }
      if ((m = /^(\.subckt\s+\S+(?:\s+[^\s=]+)*?)\s+params:\s*(.*)$/i.exec(t))) {   // .SUBCKT n a b PARAMS: x=1
        inSub = true; var re2 = /(\w+)\s*=\s*(\{[^}]*\}|\S+)/g, q2;
        while ((q2 = re2.exec(m[2]))) { var v2 = evalNum(subst(q2[2].charAt(0) === '{' ? q2[2] : '{' + q2[2] + '}', add).replace(/[{}]/g, '')); if (v2 !== null) P[q2[1].toLowerCase()] = core.fmt(v2); }
        emit(m[1]); return add('warn', 'PARAMS: defaults substituted inside the subcircuit; per-instance overrides are not possible in SPICE3f5.');
      }
      if (/^\.subckt\b/i.test(t)) inSub = true;
      if (/^x\S*\s.*\sparams:/i.test(t)) { t = t.replace(/\s+params:.*$/i, ''); add('warn', 'Instance PARAMS: dropped - the subcircuit default values are used.'); changed++; }
      if (/\{/.test(t)) t = subst(t, add);

      if ((m = /^\.(step|func\w*|mc|wcase|measure|meas|stimulus|stmlib|distribution|loadbias|savebias|aliases|endaliases|text|lib\s+\S+\s+\S+)\b/i.exec(t)) ||
          /^u\S*\s/i.test(t) || /^[EG]\S*\s+\S+\s+\S+\s+(table|laplace|freq|chebyshev)\b/i.test(t))
        return unsupported('has no SPICE3f5 equivalent - commented out.');
      if ((m = /^\.probe\b\s*(.*)$/i.exec(t))) {
        if (m[1].trim()) emit('.SAVE ' + m[1].replace(/\/\w+/g, '').trim()); else changed++;
        return add('ok', '.PROBE -> ' + (m[1].trim() ? '.SAVE' : 'removed (SPICE3f5 saves everything by default)') + '.');
      }
      if ((m = /^\.(lib|inc\w*)\s+(\S+)\s*$/i.exec(t))) { emit('.INCLUDE ' + m[2]); return add('ok', '.' + m[1].toUpperCase() + ' -> .INCLUDE.'); }

      if ((m = /^([EG]\S*)\s+(\S+)\s+(\S+)\s+VALUE\s*=?\s*\{(.*)\}\s*$/i.exec(t))) {       // E/G VALUE -> B
        var bad = [], ex = rewrite(m[4].replace(/\*\*/g, '^').trim(), bad);
        ex = ex.replace(/(?<![\w.])(\d+\.?\d*|\.\d+)(e[+-]?\d+)?(meg|mil|[tgkmunpfa])[a-z]*(?![\w(])/gi, function (all) { var v = core.num(all); return v === null ? all : core.fmt(v); });
        if (/[<>=!&|~?]/.test(ex.replace(/\bIF\b/gi, ''))) bad.push('relational/logical operator');
        if (bad.length) return unsupported('expression uses ' + bad.join(', ') + ' - cannot be written as a SPICE3f5 B-source.');
        var L = m[1].charAt(0).toUpperCase() === 'E' ? 'V' : 'I', nn = 'B' + m[1].slice(1);
        if (names[nn.toUpperCase()]) nn = 'B' + m[1];
        names[nn.toUpperCase()] = 1;
        emit(nn + ' ' + m[2] + ' ' + m[3] + ' ' + L + '=' + ex);
        return add('ok', m[1] + ' VALUE={} -> ' + nn + ' ' + L + '= (B-source).');
      }
      if ((m = /^\.model\s+(\S+)\s+(vswitch|iswitch)\s*\(?([^)]*)\)?\s*$/i.exec(t))) {   // switch models
        var p = core.params(m[3]), vs = m[2].toUpperCase() === 'VSWITCH', on = core.num(p[vs ? 'VON' : 'ION'] || (vs ? '1' : '1m')), off = core.num(p[vs ? 'VOFF' : 'IOFF'] || '0');
        var ron = p.RON || '1', roff = p.ROFF || '1E6';
        if (on === null || off === null) return unsupported('switch thresholds are expressions - convert by hand.');
        if (on < off) return unsupported('ON threshold below OFF threshold (inverted switch) - convert by hand.');
        emit('.MODEL ' + m[1] + (vs ? ' SW(VT=' : ' CSW(IT=') + core.fmt((on + off) / 2) + (vs ? ' VH=' : ' IH=') + core.fmt((on - off) / 2) + ' RON=' + ron + ' ROFF=' + roff + ')');
        return add('warn', m[1] + ': ' + m[2].toUpperCase() + ' smooth VON/VOFF band became SW hysteresis (VT/VH); switching behaviour differs slightly.');
      }
      if (t !== l.text) emit(t); else out.push(l.text);
    });

    if (hasAnalysis && !sawEnd) { out.push('.END'); changed++; notes.push({ type: 'ok', msg: 'Added .END (analysis command found).' }); }
    else if (!hasAnalysis) {
      var n0 = out.length; out = out.filter(function (s) { return !/^\s*\.end\s*$/i.test(s); });
      notes.push({ type: 'ok', msg: n0 > out.length ? 'Library file - trailing .END removed.' : 'No analysis command found - treated as a library.' });
    }
    out = out.filter(function (x, k) { return x.trim() !== '' || (k > 0 && out[k - 1].trim() !== ''); });
    while (out.length && out[0].trim() === '') out.shift();
    var H = core.header('PSpice', 'SPICE3f5');
    if (hasAnalysis) out.splice.apply(out, [1, 0].concat(H)); else out = H.concat([''], out);
    notes.push({ type: 'warn', msg: 'General: converted text was not run through SPICE3f5/ProSpice. Test a small circuit first.' });
    return { text: out.join('\n'), notes: notes, changed: changed, flagged: flagged };
  }
  core.register('pspice', 'spice3f5', convert);
  core.register('pspice', 'prospice', convert);
})(typeof window !== 'undefined' ? window : globalThis);
