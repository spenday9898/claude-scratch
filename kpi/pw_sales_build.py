#!/usr/bin/env python3
"""pw_sales_build.py — builds sales_data.json for the Method "Sales by revenue category" report.

  python3 pw_sales_build.py plan  AS_OF                 -> prints the QBO P&L date ranges to pull (one per line: START END)
  python3 pw_sales_build.py build AS_OF PL_DIR UPDATED  -> writes sales_data.json (UPDATED like "Oct 8, 2026")

PL_DIR holds one QuickBooks P&L connector result per range, saved as START_END.json
(the raw JSON the profit_loss_quickbooks_account tool returns).
Aug/Sep/Oct 2025 were posted as month-end lumps at the Nov 9 2025 system transition, so a
prior-year window that ends part-way through one of those months uses the whole month x days/days-in-month.
"""
import json, sys, os, calendar
from datetime import date, timedelta

LUMP = {(2025, 8), (2025, 9), (2025, 10)}
GREEN, RED = '#3F9A2F', '#B5451B'
MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

def d(s): return date.fromisoformat(s)
def ly(x):
    try: return x.replace(year=x.year - 1)
    except ValueError: return x.replace(year=x.year - 1, day=28)
def month_end(x): return x.replace(day=calendar.monthrange(x.year, x.month)[1])
def fy_start(x): return date(x.year if x.month >= 8 else x.year - 1, 8, 1)

def windows(asof):
    ms = asof.replace(day=1)
    pm_end = ms - timedelta(days=1); pm_start = pm_end.replace(day=1)
    return [('mtd', ms, asof), ('lastmonth', pm_start, pm_end), ('fytd', fy_start(asof), asof)]

def prior_segments(start, end):
    """[(range_start, range_end, factor)] whose weighted sum = the prior-year window."""
    if (end.year, end.month) in LUMP and end != month_end(end):
        ms = end.replace(day=1)
        segs = []
        if start < ms: segs.append((start, ms - timedelta(days=1), 1.0))
        first = max(start, ms)
        dim = calendar.monthrange(end.year, end.month)[1]
        segs.append((ms, month_end(end), (end.day - first.day + 1) / dim))
        return segs, True
    return [(start, end, 1.0)], False

def plan(asof):
    need = []
    for k, s, e in windows(asof):
        need.append((s, e))
        segs, _ = prior_segments(ly(s), ly(e))
        need += [(a, b) for a, b, f in segs]
    out = []
    for r in need:
        if r not in out: out.append(r)
    return out

def load(path):
    t = open(path).read()
    try:
        j = json.loads(t)
        if isinstance(j, list): j = json.loads(j[0]['text'])
    except Exception:
        j = json.loads(t[t.find('{'):])
    return j

def tree(j):
    """ordered income tree: [('group', name, {acct: amt}), ('item', name, amt)] + total"""
    rows = j['reportData']['data']['rows']
    groups, order, top, total = {}, [], {}, None
    for r in rows:
        md = r['metadata']; rid = str(md['id']); typ = md['type'][0]
        if not (rid == '1' or rid.startswith('1.')): continue
        cells = {c['name']: c['value'] for c in (r.get('cells') or [])}
        name, amt = cells.get('ACCOUNT_NAME'), cells.get('DETAIL_NATURAL_HOME_AMOUNT__TOTAL') or 0
        depth = rid.count('.')
        if rid == '1': total = amt; continue
        if typ == 'TOTAL': continue
        if depth == 1 and typ == 'GROUP': groups[rid] = (name, {}); order.append(('g', rid))
        elif depth == 1 and typ == 'ITEM': top[name] = amt; order.append(('i', name))
        elif depth == 2 and typ == 'ITEM':
            groups[md['parentId']][1][name] = amt
    return groups, order, top, total

def combine(parts):
    """parts = [(json, factor)] -> {'groups': {gname: {acct: amt}}, 'top': {name: amt}, 'total': x, 'gorder': [...], 'torder': [...]}"""
    G, T, gorder, torder, tot = {}, {}, [], [], 0.0
    for j, f in parts:
        groups, order, top, total = tree(j)
        tot += (total or 0) * f
        for kind, key in order:
            if kind == 'g':
                gname, accts = groups[key]
                if gname not in G: G[gname] = {}; gorder.append(gname)
                for a, v in accts.items(): G[gname][a] = G[gname].get(a, 0) + v * f
            else:
                if key not in T: T[key] = 0; torder.append(key)
                T[key] += top[key] * f
    return {'groups': G, 'top': T, 'total': tot, 'gorder': gorder, 'torder': torder}

def money(v):
    r = int(round(v))
    return '(' + format(-r, ',') + ')' if r < 0 else format(r, ',')
def pct(c, p):
    if int(round(p)) == 0: return '—'
    return format((c - p) / abs(p) * 100, '+.1f') + '%'
def dd(c, p): return format(int(round(c - p)), '+,')
def color(c, p): return GREEN if c - p >= 0 else RED
def row(kind, label, c, p):
    return {'kind': kind, 'label': label, 'c': money(c), 'p': money(p), 'pct': pct(c, p), 'dd': dd(c, p), 'color': color(c, p)}

def code(s):
    try: return int(s.split()[0])
    except Exception: return 99999

def build_rows(cur, pri):
    rows = [{'kind': 'section', 'label': 'Income'}]
    gnames = sorted(set(cur['gorder']) | set(pri['gorder']), key=code)
    for g in gnames:
        ca, pa = cur['groups'].get(g, {}), pri['groups'].get(g, {})
        rows.append({'kind': 'group', 'label': g})
        for a in sorted(set(ca) | set(pa), key=code):
            if abs(ca.get(a, 0)) < 0.5 and abs(pa.get(a, 0)) < 0.5: continue
            rows.append(row('account', a, ca.get(a, 0), pa.get(a, 0)))
        rows.append(row('gtotal', 'Total ' + g, sum(ca.values()), sum(pa.values())))
    for t in sorted(set(cur['torder']) | set(pri['torder']), key=lambda s: (s != 'Sales Discounts', s)):
        if abs(cur['top'].get(t, 0)) < 0.5 and abs(pri['top'].get(t, 0)) < 0.5: continue
        rows.append(row('discount' if t == 'Sales Discounts' else 'account', t, cur['top'].get(t, 0), pri['top'].get(t, 0)))
    rows.append(row('income', 'Total income', cur['total'], pri['total']))
    return rows

def span(s, e):
    if s == e: return '%s %d, %d' % (MON[s.month - 1], s.day, s.year)
    if s.month == e.month: return '%s %d–%d, %d' % (MON[s.month - 1], s.day, e.day, e.year)
    return '%s %d – %s %d, %d' % (MON[s.month - 1], s.day, MON[e.month - 1], e.day, e.year)

def build(asof, pldir, updated):
    def pl(a, b):
        p = os.path.join(pldir, '%s_%s.json' % (a.isoformat(), b.isoformat()))
        if not os.path.exists(p): raise SystemExit('missing P&L file ' + p)
        return load(p)
    out = {'topline': 'Data through %s %d, %d · vs same period last year · updated %s' % (MONTH[asof.month - 1], asof.day, asof.year, updated), 'windows': []}
    for key, s, e in windows(asof):
        cur = combine([(pl(s, e), 1.0)])
        segs, prorated = prior_segments(ly(s), ly(e))
        pri = combine([(pl(a, b), f) for a, b, f in segs])
        if key == 'lastmonth':
            sub = '%s %d vs %s %d' % (MON[s.month - 1], s.year, MON[s.month - 1], s.year - 1)
        else:
            sub = '%s vs %s' % (span(s, e), span(ly(s), ly(e))) + (' (prorated)' if prorated else '')
        c, p = cur['total'], pri['total']
        head = {'tot': '$' + format(int(round(c)), ','), 'pri': '$' + format(int(round(p)), ','),
                'pct': pct(c, p), 'dd': ('+$' if c - p >= 0 else '-$') + format(abs(int(round(c - p))), ','), 'color': color(c, p)}
        out['windows'].append({'key': key, 'subtitle': sub, 'head': head, 'rows': build_rows(cur, pri),
                               'total_cur': round(c, 2), 'total_pri': round(p, 2)})
    return out

if __name__ == '__main__':
    if sys.argv[1] == 'plan':
        for a, b in plan(d(sys.argv[2])): print(a.isoformat(), b.isoformat())
    else:
        res = build(d(sys.argv[2]), sys.argv[3], sys.argv[4])
        json.dump(res, open('sales_data.json', 'w'), ensure_ascii=False, indent=1)
        for w in res['windows']: print(w['key'], w['subtitle'], w['head'])
