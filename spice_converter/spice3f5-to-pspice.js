/* spice3f5-to-pspice.js - SPICE3f5 / PROSPICE -> PSpice (OrCAD / Cadence). Needs spice-core.js. */
(function (g) {
  'use strict';
  var core = g.SpiceCore;

  // Expression fixes for B-source bodies moved into VALUE={...}
  function fixExpr(e, add) {
    if (/(^|[^\w])uramp\s*\(/i.test(e)) add('warn', 'uramp() has no PSpice equivalent - rewrite it by hand.');
    if (/(^|[^\w])log\s*\(/i.test(e)) add('warn', 'log() - check the base; PSpice LOG is natural log, LOG10 is base 10.');
    return e.replace(/\^/g, '**').replace(/(^|[^\w])u\s*\(/gi, '$1stp(');
  }

  // .MODEL x SW(VT VH RON ROFF)  ->  VSWITCH(RON ROFF VON VOFF)   (CSW -> ISWITCH)
  function switchModel(name, kind, body, add) {
    var p = core.params(body), v = kind === 'SW';
    var T = v ? 'VT' : 'IT', H = v ? 'VH' : 'IH';
    var t = p[T] === undefined ? 0 : core.num(p[T]), h = p[H] === undefined ? 0 : core.num(p[H]);
    var on, off;
    if (t === null || h === null) {
      on = '{(' + p[T] + ')+(' + (p[H] || 0) + ')}'; off = '{(' + p[T] + ')-(' + (p[H] || 0) + ')}';
      add('warn', name + ': ' + T + '/' + H + ' are expressions - VON/VOFF written as expressions; check H is not 0.');
    } else {
      if (h === 0) {
        h = v ? 0.05 : 1e-6;
        add('warn', name + ': ' + H + '=0 (ideal threshold). PSpice needs ' + (v ? 'VON<>VOFF' : 'ION<>IOFF') +
          ', so a +/-' + h + ' band around ' + T + ' was used; the switching point shifts slightly.');
      }
      on = core.fmt(t + h); off = core.fmt(t - h);
    }
    var ron = p.RON || '1', roff = p.ROFF || '1E12';
    return '.MODEL ' + name + (v
      ? ' VSWITCH(RON=' + ron + ' ROFF=' + roff + ' VON=' + on + ' VOFF=' + off + ')'
      : ' ISWITCH(RON=' + ron + ' ROFF=' + roff + ' ION=' + on + ' IOFF=' + off + ')');
  }

  function convert(text) {
    var lines = core.logicalLines(text), out = [], notes = [], changed = 0, flagged = 0;
    var names = {}, hasAnalysis = false, sawEnd = false;
    lines.forEach(function (l) {
      var m = /^\s*([A-Za-z]\S*)/.exec(l.text);
      if (m) names[m[1].toUpperCase()] = 1;
    });
    lines.forEach(function (l) { if (/^\s*\.(tran|ac|dc|op|tf|noise|disto)\b/i.test(l.text)) hasAnalysis = true; });

    lines.forEach(function (l) {
      var t = l.text.trim(), no = l.no, m, add = function (type, msg) { notes.push({ type: type, msg: 'Line ' + no + ': ' + msg }); };
      function emit(s, isFlag) { out.push(s); if (s !== l.text) changed++; if (isFlag) flagged++; }
      // Source comments are dropped (line 1 of a main netlist is its title and stays).
      if (t.charAt(0) === '*') { if (hasAnalysis && no === 1) out.push(l.text); return; }
      l.text = l.text.replace(/\s*;.*$/, ''); t = l.text.trim();
      if (t === '') return out.push('');

      if (/^\.end\s*$/i.test(t)) sawEnd = true;
      if (/^\.(tran|ac|dc|op|tf|noise|disto)\b/i.test(t)) hasAnalysis = true;

      // B-source  ->  E (V=) / G (I=) with VALUE={...}
      if ((m = /^(B\S*)\s+(\S+)\s+(\S+)\s+([VI])\s*=\s*(.+)$/i.exec(t))) {
        var L = m[4].toUpperCase() === 'V' ? 'E' : 'G', nn = L + m[1].slice(1);
        if (names[nn.toUpperCase()]) nn = L + m[1];            // avoid name clash: BACS1 -> GBACS1
        names[nn.toUpperCase()] = 1;
        emit(nn + ' ' + m[2] + ' ' + m[3] + ' VALUE={' + fixExpr(m[5].replace(/;.*$/, '').trim(), add) + '}');
        return add('ok', m[1] + ' -> ' + nn + ' (B-source is not valid PSpice; it is a GaAs FET there).');
      }
      // Switch models
      if ((m = /^\.model\s+(\S+)\s+(sw|csw)\s*\(?([^)]*)\)?\s*$/i.exec(t))) {
        emit(switchModel(m[1], m[2].toUpperCase(), m[3], add));
        return add('ok', '.MODEL ' + m[1] + ': ' + m[2].toUpperCase() + ' -> ' + (m[2].toUpperCase() === 'SW' ? 'VSWITCH' : 'ISWITCH') + ' (PSpice uses ' + (m[2].toUpperCase() === 'SW' ? 'VON/VOFF, not VT/VH' : 'ION/IOFF, not IT/IH') + ').');
      }
      // Proteus animation primitives - no meaning outside Proteus
      if (/^[A-Za-z]/.test(t) && /^(RT[VID]PROBE|RTSWITCH)$/i.test(t.split(/\s+/).pop())) {
        emit('* [UNSUPPORTED IN PSPICE] ' + t, true);
        return add('warn', 'Proteus real-time probe/switch commented out (animation only).');
      }
      if (/^\.pz\b/i.test(t)) {
        emit('* [UNSUPPORTED IN PSPICE] ' + t, true);
        return add('warn', '.PZ has no PSpice equivalent - commented out.');
      }
      out.push(l.text);
    });

    if (hasAnalysis && !sawEnd) { out.push('.END'); changed++; notes.push({ type: 'ok', msg: 'Added .END (analysis command found).' }); }
    else if (!hasAnalysis) {
      var n0 = out.length;
      out = out.filter(function (s) { return !/^\s*\.end\s*$/i.test(s); });
      if (out.length < n0) { changed++; notes.push({ type: 'ok', msg: 'No analysis command found - treated as a library, so the trailing .END was removed (an .END inside an included file can end the parent netlist).' }); }
      else notes.push({ type: 'ok', msg: 'No analysis command found - treated as a library, so no .END was added.' });
    }
    // Collapse blank lines, then add the ee-diary header (after the title line for main netlists)
    out = out.filter(function (x, k) { return x.trim() !== '' || (k > 0 && out[k - 1].trim() !== ''); });
    while (out.length && out[0].trim() === '') out.shift();
    var H = core.header('SPICE3f5', 'PSpice');
    if (hasAnalysis) out.splice.apply(out, [1, 0].concat(H)); else out = H.concat([''], out);
    return { text: out.join('\n'), notes: notes, changed: changed, flagged: flagged };
  }

  core.register('spice3f5', 'pspice', convert);
  core.register('prospice', 'pspice', convert);
})(typeof window !== 'undefined' ? window : globalThis);