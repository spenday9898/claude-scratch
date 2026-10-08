#!/usr/bin/env python3
"""pw_board_data.py — builds board_data.json for the Method KPI board patcher (pw_kpi_patch.js).

  python3 pw_board_data.py RUN_DATE AS_OF OI_THRU kpitable.json
     RUN_DATE  the Thursday the board is published (YYYY-MM-DD)  -> "Week of"
     AS_OF     RUN_DATE - 7 (YYYY-MM-DD)                          -> "Data as of"
     OI_THRU   last posting date covered by the Operating Income PDF (YYYY-MM-DD)
     kpitable.json  the raw JSON from GET https://rest.method.me/api/v1/tables/KPITable
                    (must already include the row for AS_OF)
Writes board_data.json and prints the values it used. The current values come from the KPITable
row whose PWDate = AS_OF, so the board can never disagree with the Historical KPI grid.
"""
import json, sys, re
from datetime import date, timedelta

# KPITable field -> tile name printed on the board (order = the grid order)
FIELDS = [
    ('PWYTDSalesGrowth', 'YTD sales growth'),
    ('PWSalesGoalPace', 'Sales goal pace'),
    ('PWGrossProfit', 'Gross profit'),
    ('PWTotalLabour', 'Total labour'),
    ('PWOperatingIncomePace', 'Operating income pace'),
    ('PWRentalMattingUtilization', 'Rental matting utilization'),
    ('PWWorkwearFlatwareUtilization', 'Workwear / flatware utilization'),
    ('PWRentalWholesaleManagement', 'Rental wholesale management'),
    ('PWSanitationWholesaleManagement', 'Sanitation wholesale management'),
    ('PWARAverageDays', 'A/R collected in 30'),
]
MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
MON = [m[:3] for m in MONTH]

def num(v):
    if v is None: return None
    s = str(v).strip().replace('%', '').replace(',', '')
    try: return float(s)
    except ValueError: return None

def records(j):
    if isinstance(j, list): return j
    for k in ('value', 'data', 'records', 'items', 'Records', 'Value'):
        if isinstance(j, dict) and isinstance(j.get(k), list): return j[k]
    raise SystemExit('cannot find the record list in kpitable.json (keys: %s)' % list(j)[:10])

def fiscal_week(asof):
    fy = date(asof.year if asof.month >= 8 else asof.year - 1, 8, 1)
    anchor = fy - timedelta(days=(fy.weekday() - 3) % 7)   # Thursday on/before Aug 1
    return (asof - anchor).days // 7 + 1, fy.year + 1

def main():
    run, asof, oi = (date.fromisoformat(x) for x in sys.argv[1:4])
    rows = records(json.load(open(sys.argv[4])))
    keymap = {}
    sample = {}
    for r in rows: sample.update(r)
    RULES = [  # first matching rule wins; tested on the lower-cased field name
        ('PWYTDSalesGrowth', ['growth']),
        ('PWSalesGoalPace', ['goal', 'salespace', 'salesgoal']),
        ('PWGrossProfit', ['gross']),
        ('PWTotalLabour', ['labour', 'labor']),
        ('PWOperatingIncomePace', ['operating', 'oip', 'income']),
        ('PWRentalMattingUtilization', ['matting', 'rmu']),
        ('PWWorkwearFlatwareUtilization', ['workwear', 'flatware', 'wfu']),
        ('PWRentalWholesaleManagement', ['rentalwholesale', 'rwm', 'rental']),
        ('PWSanitationWholesaleManagement', ['sanitation', 'swm']),
        ('PWARAverageDays', ['ar', 'receivable', 'collected']),
    ]
    cand = [k for k in sample if k.lower().startswith('pw') and k.lower() != 'pwdate']
    used = set()
    for f, words in RULES:
        exact = [k for k in cand if k.lower() == f.lower()]
        hit = exact or [k for k in cand if k not in used and any(w in k.lower() for w in words)]
        if not hit:
            raise SystemExit('KPITable field for %s not found; PW fields are: %s' % (f, sorted(cand)))
        keymap[f] = hit[0]; used.add(hit[0])
    print('field map:', json.dumps(keymap))
    dkey = [k for k in sample if k.lower() == 'pwdate'][0]
    hist = []
    for r in rows:
        ds = str(r.get(dkey) or '')[:10]
        if not re.match(r'\d{4}-\d{2}-\d{2}$', ds): continue
        hist.append((ds, [num(r.get(keymap[f])) for f, _ in FIELDS]))
    hist.sort()
    cur = [h for h in hist if h[0] == asof.isoformat()]
    if not cur: raise SystemExit('no KPITable row for AS_OF %s — write the row first' % asof)
    upto = [h for h in hist if h[0] <= asof.isoformat()][-14:]
    values = {name: cur[-1][1][i] for i, (_, name) in enumerate(FIELDS)}
    history = {name: [h[1][i] for h in upto] for i, (_, name) in enumerate(FIELDS)}
    wk, fy = fiscal_week(asof)
    out = {
        'weekOf': '%s %d, %d' % (MONTH[run.month - 1], run.day, run.year),
        'asOf': '%s %d, %d' % (MONTH[asof.month - 1], asof.day, asof.year),
        'fiscalWeek': '%d of 52 (FY%02d)' % (wk, fy % 100),
        'footerWeek': 'FY%02d week %d' % (fy % 100, wk),
        'updatedLine': 'Updated %s %d, %d (auto) · OI PDF thru %s %d' % (MON[run.month - 1], run.day, run.year, MON[oi.month - 1], oi.day),
        'values': values, 'history': history,
    }
    json.dump(out, open('board_data.json', 'w'), ensure_ascii=False, indent=1)
    print(json.dumps({'values': values, 'weeks': [h[0] for h in upto], 'fiscalWeek': out['fiscalWeek']}))

if __name__ == '__main__':
    main()
