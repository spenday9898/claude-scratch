// pw_kpi_patch.js — Progressive Westman KPI board + Sales by revenue category patcher.
// Works in a browser (pass a detached <div>) and in Node with jsdom.
// Node usage:
//   node pw_kpi_patch.js board  in.html board_data.json  out.html
//   node pw_kpi_patch.js sales  in.html sales_data.json  out.html
// The HTML in/out is the inner HTML of the Method text control (no <html>/<body> wrapper).
(function (root) {
  'use strict';

  var GREEN = '#3F9A2F', AMBER = '#C8901A', RED = '#B5451B', GREY = '#8A8F84';
  var COL = { on: GREEN, close: AMBER, off: RED };
  var BG = { on: '#E9F5E1', close: '#FBF1DC', off: '#FBEBE4', wait: '#EEF0EB' };
  var TXT = { on: 'On target', close: 'Close', off: 'Off target', wait: 'Waiting' };

  // Tile names exactly as printed on the board (lower-case compare).
  var DEFAULTS = {
    targets: { 'ytd sales growth': 11.57, 'gross profit': 55, 'total labour': 25 },   // everything else 100
    lowerIsBetter: { 'total labour': true },
    baselineLabel: 'Jul 23',
    baseline: {
      'sales goal pace': 97.35, 'ytd sales growth': 10.74, 'gross profit': 54.89, 'total labour': 29.91,
      'operating income pace': 96.86, 'rental matting utilization': 129.14,
      'workwear / flatware utilization': 84.15, 'rental wholesale management': 82.57,
      'sanitation wholesale management': 93.18, 'a/r collected in 30': 65.83
    }
  };

  function textNodes(el) {
    var out = [], doc = el.ownerDocument, w = doc.createTreeWalker(el, 4 /* SHOW_TEXT */, null), n;
    while ((n = w.nextNode())) { if (n.textContent.trim()) out.push(n); }
    return out;
  }
  function setStyleProp(el, prop, val) {
    var s = el.getAttribute('style') || '';
    var re = new RegExp('(^|;)\\s*' + prop + '\\s*:[^;]*', 'i');
    if (re.test(s)) s = s.replace(re, '$1' + prop + ':' + val);
    else s = (s && !/;\s*$/.test(s) ? s + ';' : s) + prop + ':' + val;
    el.setAttribute('style', s);
  }
  function replaceAfterLabel(nodes, label, value) {
    for (var i = 0; i < nodes.length - 1; i++) {
      if (nodes[i].textContent.trim().toLowerCase() === label.toLowerCase()) { nodes[i + 1].textContent = value; return true; }
    }
    return false;
  }

  // ---------------------------------------------------------------- BOARD
  function patchBoard(container, data) {
    var log = [], cfg = DEFAULTS;
    var targets = Object.assign({}, cfg.targets, data.targets || {});
    var baseline = Object.assign({}, cfg.baseline, data.baseline || {});
    var tiles = Array.prototype.filter.call(container.querySelectorAll('div'), function (d) {
      return (d.getAttribute('style') || '').indexOf('min-height:176px') >= 0;
    });
    if (tiles.length !== 10) throw new Error('expected 10 KPI tiles, found ' + tiles.length);
    var numericTile = null;
    tiles.forEach(function (t) { if (!numericTile && /\d/.test(t.children[1].textContent)) numericTile = t; });
    var counts = { on: 0, close: 0, off: 0, wait: 0 };

    tiles.forEach(function (t) {
      var name = t.children[0].children[0].textContent.trim();
      var key = name.toLowerCase();
      var vals = data.values || {};
      var vk = Object.keys(vals).filter(function (k) { return k.toLowerCase() === key; })[0];
      if (vk === undefined) { log.push('no value for ' + name + ' (left as is)'); var s0 = /waiting/i.test(t.children[2].textContent) ? 'wait' : null; if (s0) counts.wait++; else { var b0 = t.children[2].textContent; counts[/off/i.test(b0) ? 'off' : /close/i.test(b0) ? 'close' : 'on']++; } return; }
      var v = vals[vk];
      var tg = targets[key] !== undefined ? targets[key] : 100;
      var low = !!cfg.lowerIsBetter[key];

      if (v === null || v === undefined || v === 'n/a' || isNaN(Number(v))) {
        counts.wait++;
        var vtn = textNodes(t.children[1])[0]; if (vtn) vtn.textContent = 'n/a';
        var bw = t.children[2].children[0];
        setStyleProp(bw, 'background', BG.wait); setStyleProp(bw, 'color', GREY);
        var btw = Array.prototype.filter.call(bw.childNodes, function (n) { return n.nodeType === 3 && n.textContent.trim(); })[0];
        if (btw) btw.textContent = TXT.wait;
        if (t.children[2].children[1]) t.children[2].children[1].textContent = '';
        setStyleProp(t, 'border-top', '4px solid #C9CEC4');
        log.push(name + ' waiting');
        return;
      }
      v = Number(v);
      // a tile that was "Waiting" gets the value + badge markup of a numeric tile
      if (!/\d/.test(t.children[1].textContent) && numericTile && numericTile !== t) {
        t.replaceChild(numericTile.children[1].cloneNode(true), t.children[1]);
        t.replaceChild(numericTile.children[2].cloneNode(true), t.children[2]);
      }
      var gap = low ? v - tg : tg - v;
      var st = gap <= 0 ? 'on' : (gap <= 5 ? 'close' : 'off');
      counts[st]++;
      var tn = Array.prototype.filter.call(t.children[1].childNodes, function (n) { return n.nodeType === 3 && n.textContent.trim(); })[0];
      tn.textContent = v.toFixed(2);
      setStyleProp(t, 'border-top', '4px solid ' + COL[st]);
      var b = t.children[2].children[0];
      setStyleProp(b, 'background', BG[st]); setStyleProp(b, 'color', COL[st]);
      var bc = b.querySelector('circle');
      if (bc) { bc.setAttribute('fill', COL[st]); bc.removeAttribute('stroke'); bc.removeAttribute('stroke-width'); bc.setAttribute('r', '4'); }
      var btn = Array.prototype.filter.call(b.childNodes, function (n) { return n.nodeType === 3 && n.textContent.trim(); })[0];
      btn.textContent = TXT[st];
      var base = baseline[key];
      var ds = t.children[2].children[1];
      if (ds && base !== undefined) {
        var dl = v - base, better = low ? dl < 0 : dl > 0;
        ds.textContent = (dl >= 0 ? '▲ ' : '▼ ') + Math.abs(dl).toFixed(2) + ' pts vs ' + (data.baselineLabel || cfg.baselineLabel);
        setStyleProp(ds, 'color', better ? GREEN : RED);
      }

      // sparkline
      var sv = t.querySelector('svg[viewBox="0 0 200 38"]');
      if (sv && sv.children.length >= 4) {
        var ln = sv.children[0], area = sv.children[1], stroke = sv.children[2], ci = sv.children[3];
        var hist = (data.history || {})[Object.keys(data.history || {}).filter(function (k) { return k.toLowerCase() === key; })[0]];
        var series;
        if (hist && hist.filter(function (x) { return x !== null && !isNaN(Number(x)); }).length >= 2) {
          series = hist.filter(function (x) { return x !== null && !isNaN(Number(x)); }).map(Number);
          series[series.length - 1] = v;
        } else {
          // fallback: recover the plotted values from the existing path and replace the last point
          var pts = stroke.getAttribute('d').trim().split(/\s+/).map(function (s) { return s.replace(/^[ML]/, '').split(',').map(Number); });
          var yT = Number(ln.getAttribute('y1')), yL = pts[pts.length - 1][1];
          var prev = data.previous && data.previous[name] !== undefined ? Number(data.previous[name]) : null;
          if (prev !== null && Math.abs(yT - yL) > 0.5) {
            series = pts.map(function (p) { return tg + (p[1] - yT) * (prev - tg) / (yL - yT); });
          } else { series = pts.map(function () { return v; }); }
          series[series.length - 1] = v;
          log.push(name + ' sparkline: recovered (no history supplied)');
        }
        var lo = Math.min.apply(null, series.concat([tg])), hi = Math.max.apply(null, series.concat([tg]));
        if (hi - lo < 1e-9) { hi = lo + 1; }
        var Y = function (x) { return (35 - (x - lo) / (hi - lo) * 32).toFixed(1); };
        var n = series.length, step = n > 1 ? 194 / (n - 1) : 0;
        var d = series.map(function (x, i) { return (i ? 'L' : 'M') + (3 + i * step).toFixed(1) + ',' + Y(x); }).join(' ');
        stroke.setAttribute('d', d);
        area.setAttribute('d', d + ' L' + (3 + (n - 1) * step).toFixed(1) + ',35 L3.0,35 Z');
        ln.setAttribute('y1', Y(tg)); ln.setAttribute('y2', Y(tg));
        ci.setAttribute('cx', (3 + (n - 1) * step).toFixed(1)); ci.setAttribute('cy', Y(v)); ci.setAttribute('fill', COL[st]);
      }
      log.push(name + ' ' + v.toFixed(2) + ' ' + st);
    });

    // header + footer
    var nodes = textNodes(container), hits = {};
    hits.weekOf = replaceAfterLabel(nodes, 'Week of', data.weekOf);
    hits.asOf = replaceAfterLabel(nodes, 'Data as of', data.asOf);
    hits.fiscal = replaceAfterLabel(nodes, 'Fiscal week', data.fiscalWeek);
    nodes.forEach(function (n) {
      var s = n.textContent.trim();
      if (/^\d+ on target$/.test(s)) { n.textContent = n.textContent.replace(s, counts.on + ' on target'); hits.on = true; }
      else if (/^·\s*\d+ close · \d+ off · \d+ waiting$/.test(s)) { n.textContent = n.textContent.replace(s, '· ' + counts.close + ' close · ' + counts.off + ' off · ' + counts.wait + ' waiting'); hits.tally = true; }
      else if (/^Updated .*OI PDF thru/.test(s) && data.updatedLine) { n.textContent = n.textContent.replace(s, data.updatedLine); hits.updated = true; }
      else if (/FY\d+ week \d+/.test(s) && data.footerWeek) { n.textContent = n.textContent.replace(/FY\d+ week \d+/, data.footerWeek); hits.footer = true; }
    });
    // scorecard pips: sorted tally green, amber, red, grey
    var order = [].concat(rep(GREEN, counts.on), rep(AMBER, counts.close), rep(RED, counts.off), rep(GREY, counts.wait));
    var pips = container.querySelectorAll('i');
    if (pips.length === 10) Array.prototype.forEach.call(pips, function (p, i) { setStyleProp(p, 'background', order[i] || GREY); });
    else log.push('pips: expected 10, found ' + pips.length);
    return { counts: counts, hits: hits, log: log };
  }
  function rep(x, n) { var a = []; for (var i = 0; i < n; i++) a.push(x); return a; }

  // ---------------------------------------------------------------- SALES
  var TITLES = ['Month to date', 'Last month', 'Fiscal year to date'];
  function patchSales(container, data) {
    var log = [];
    var tables = container.querySelectorAll('table');
    if (tables.length !== 3) throw new Error('expected 3 sales tables, found ' + tables.length);
    // collect row templates from every table (first match wins)
    var tpl = {};
    Array.prototype.forEach.call(tables, function (tb) {
      Array.prototype.forEach.call(tb.querySelectorAll('tr'), function (r) {
        var c = r.children, k = rowKind(r);
        if (k && !tpl[k]) tpl[k] = r.cloneNode(true);
      });
    });
    ['section', 'group', 'account', 'gtotal', 'discount', 'income'].forEach(function (k) { if (!tpl[k]) throw new Error('missing row template ' + k); });

    // top line
    textNodes(container).forEach(function (n) {
      if (/^Data through .*updated/.test(n.textContent.trim())) n.textContent = data.topline;
    });

    data.windows.forEach(function (w, wi) {
      var tb = tables[wi], all0 = textNodes(container);
      // the window's title, subtitle and headline are the text nodes between its title and its table
      var ti = -1; all0.forEach(function (n, i) { if (ti < 0 && n.textContent.trim() === TITLES[wi]) ti = i; });
      if (ti < 0) throw new Error('window title not found: ' + TITLES[wi]);
      var seq = [];
      for (var k = ti + 1; k < all0.length && !tb.contains(all0[k]); k++) seq.push(all0[k]);
      seq[0].textContent = w.subtitle;
      var at = function (label) { for (var i = 0; i < seq.length - 1; i++) if (seq[i].textContent.trim() === label) return i; return -1; };
      var i1 = at('Total income'), i2 = at('Same period last year'), i3 = at('Change');
      if (i1 < 0 || i2 < 0 || i3 < 0) throw new Error('headline labels not found in window ' + wi);
      seq[i1 + 1].textContent = w.head.tot;
      seq[i2 + 1].textContent = w.head.pri;
      seq[i3 + 1].textContent = w.head.pct; recolor(seq[i3 + 1].parentElement, w.head.color);
      seq[i3 + 2].textContent = w.head.dd; recolor(seq[i3 + 2].parentElement, w.head.color);

      // rebuild body rows
      var all = tb.querySelectorAll('tr');
      var parent = all[1].parentNode;
      for (var r = all.length - 1; r >= 1; r--) all[r].parentNode.removeChild(all[r]);
      w.rows.forEach(function (row) {
        var tr = tpl[row.kind].cloneNode(true);
        if (row.kind === 'section' || row.kind === 'group') { tr.children[0].textContent = row.label; }
        else {
          tr.children[0].textContent = row.label;
          tr.children[1].textContent = row.c;
          tr.children[2].textContent = row.p;
          var ch = tr.children[3].children;
          ch[0].textContent = row.pct; recolor(ch[0], row.color);
          ch[1].textContent = row.dd;
        }
        parent.appendChild(tr);
      });
      log.push(TITLES[wi] + ': ' + w.rows.length + ' rows, ' + w.head.tot);
    });
    return { log: log };
  }
  function recolor(el, color) {
    if (!el || !color) return;
    var s = el.getAttribute('style') || '';
    if (/color:\s*#(3F9A2F|B5451B)/i.test(s)) el.setAttribute('style', s.replace(/color:\s*#(3F9A2F|B5451B)/i, 'color:' + color));
  }
  function rowKind(r) {
    var c = r.children;
    if (!c.length || c[0].tagName === 'TH') return null;
    var label = c[0].textContent.trim();
    if (c.length === 1) return /^\d/.test(label) ? 'group' : 'section';
    if (label === 'Total income') return 'income';
    if (label === 'Sales Discounts') return 'discount';
    if (/^Total /.test(label)) return 'gtotal';
    return 'account';
  }

  var api = { patchBoard: patchBoard, patchSales: patchSales };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PWKPI = api;

  // ---------------------------------------------------------------- CLI
  if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
    var fs = require('fs'), JSDOM = require('jsdom').JSDOM;
    var mode = process.argv[2], html = fs.readFileSync(process.argv[3], 'utf8'), data = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
    var dom = new JSDOM('<!doctype html><body><div id="x"></div></body>'), div = dom.window.document.getElementById('x');
    div.innerHTML = html;
    var res = mode === 'board' ? patchBoard(div, data) : patchSales(div, data);
    fs.writeFileSync(process.argv[5], div.innerHTML);
    console.log(JSON.stringify(res, null, 1));
  }
})(this);
