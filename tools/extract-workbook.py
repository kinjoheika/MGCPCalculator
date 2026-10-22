"""Reads the MGC pricing workbook and writes the basic tables for Supabase:
products, channels, zones, competitors, clients and client terms.

  python tools/extract-workbook.py "path/to/MGC LPG Pricing Matrix.xlsx"

Outputs (both git-ignored, they hold real customer data):
  db/import.private.json         what tools/provision.mjs --import loads
  db/import-review.private.csv   one line per client, to check before loading

Not read: cost basis, margins, price history, ancillary items, commissions (not part of the basic tables).
"""
import csv, datetime, json, os, re, sys
import openpyxl

SRC = sys.argv[1]
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SEED = json.load(open(os.path.join(ROOT, 'data', 'seed.json'), encoding='utf-8'))
issues = []

wb = openpyxl.load_workbook(SRC, data_only=True, read_only=True)


def grid(name, last_row, last_col):
    ws = wb[name]
    rows = {}
    for row in ws.iter_rows(min_row=1, max_row=last_row, max_col=last_col):
        for c in row:
            if c.value not in (None, ''):
                rows.setdefault(c.row, {})[c.column_letter] = c.value
    return rows


com = grid('Revised Commercial Price List', 192, 110)
blk = grid('Revised Bulk Price List', 45, 45)
dlr = grid('List of Dealers', 20, 3)


def txt(v):
    if v is None:
        return None
    s = re.sub(r'\s+', ' ', str(v).replace('\xa0', ' ')).strip()
    return s or None


def num(v):
    if v is None or v == '' or isinstance(v, bool):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def cents(v):
    n = num(v)
    return None if n is None else int(round(n * 100))


def date(v, who=''):
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.isoformat()[:10]
    if isinstance(v, (int, float)) and 1900 < v < 2100:
        return f'{int(v)}-01-01'
    s = txt(v)
    if not s:
        return None
    m = re.fullmatch(r'(\d{1,2})/+(\d{1,2})/(\d{4})', s)  # "3//8/2028" is 8 March 2028
    if m:
        return f'{int(m.group(3)):04d}-{int(m.group(1)):02d}-{int(m.group(2)):02d}'
    for fmt in ('%Y-%m-%d', '%m/%d/%Y', '%b %Y', '%B %Y', '%d-%b-%y'):
        try:
            return datetime.datetime.strptime(s.replace('Sept', 'Sep'), fmt).date().isoformat()
        except ValueError:
            pass
    issues.append(f'{who}: date "{s}" not understood, left blank')
    return None


def slug(s):
    return re.sub(r'[^a-z0-9]+', '_', s.lower()).strip('_')[:40]


# ---- products: the seed's list plus what the workbook shows and the seed lacks ----
skus = json.loads(json.dumps(SEED['skus']))
have = {k['id'] for k in skus}
if '22KG_FL_B' not in have:  # MPL sheet: Forklift Class B, 20 kg
    skus.insert(skus.index(next(k for k in skus if k['id'] == '22KG_FL_A')) + 1,
                {'id': '22KG_FL_B', 'label': '22 kg Forklift B', 'contentKg': 20, 'active': True, 'parentId': '22KG'})
skus.append({'id': 'BULK_KG', 'label': 'Bulk LPG (per kg)', 'contentKg': 1, 'active': True})
content = {k['id']: k.get('contentKg') for k in skus}

# ---- channels: unchanged from the seed (they match the workbook's price lists) ----
channels = SEED['channels']

# ---- zones: from client locations ----
ALIAS = {
    'trece': 'Trece Martires', 'trece martires': 'Trece Martires', 'trece martires city': 'Trece Martires',
    'tagaytay': 'Tagaytay City', 'tagaytay city': 'Tagaytay City',
    'qc': 'Quezon City', 'cubao qc': 'Quezon City', 'north avenue': 'Quezon City', 'quezon city': 'Quezon City',
    'las pinas': 'Las Piñas', 'paranaque': 'Parañaque', 'parañaque': 'Parañaque', 'binan': 'Biñan',
    'taft avenue': 'Manila', 'tondo': 'Manila', 'malate': 'Manila', 'sampaloc': 'Manila',
    'pasong tamo / makati': 'Makati', 'sycip law ctr': 'Makati', 'osmak': 'Makati',
    'angono rizal': 'Angono', 'ternate': 'Ternate', 'bacoor': 'Bacoor', 'tanza': 'Tanza', 'silang': 'Silang', 'kawit': 'Kawit',
}


def zone_of(loc):
    s = txt(loc)
    if not s:
        return None
    first = re.split(r'[,\n]', str(loc))[0]
    first = re.sub(r'\s+', ' ', first).strip()
    key = first.lower().replace('�', 'n').replace('ñ', 'n')
    if key.startswith('dasmari'):
        return 'Dasmariñas'
    if key.startswith('para') and 'aque' in key:
        return 'Parañaque'
    if key in ALIAS:
        return ALIAS[key]
    return first.title() if first.isupper() else first


# ---- competitors ----
BRAND = {'island': 'Island Gas', 'petron': 'Petron Gasul', 'pryce': 'Pryce Gas', 'dc starr': 'DC Starr', 'solane': 'Solane', 'phoenix': 'Phoenix', 'maxi': 'Maxi'}


def brand_of(v):
    s = txt(v)
    return BRAND.get(s.lower(), s) if s else None


# ---- clients: commercial ----
PROD = [  # (volume-per-drop col, acq col, discount col, sku, kg)
    ('X', 'AG', 'BG', None, 50), ('Y', 'AH', 'BH', '22KG_A', 22), ('Z', 'AI', 'BI', '22KG_FL_A', 22), ('AA', 'AJ', 'BJ', '11KG_MGAS', 11), ('AB', 'AK', 'BK', '2.7KG', 2.7),
]
accounts, review = [], []
used_ids = set()


def new_id(name, prefix='acc'):
    base = f'{prefix}_{slug(name)}'
    i, cand = 2, base
    while cand in used_ids:
        cand, i = f'{base}_{i}', i + 1
    used_ids.add(cand)
    return cand


for r in sorted(com):
    row = com[r]
    name, status = txt(row.get('B')), txt(row.get('C'))
    if r < 14 or not name or not status:
        continue
    who = f'Commercial row {r} {name}'
    cls = (txt(row.get('AM')) or 'A').upper()[:1]
    if status not in ('Active', 'Inactive', 'Active but Needs Attention'):
        issues.append(f'{who}: status "{status}" read as Active')
    # Main product: the one with the most kilograms per drop; the 50 kg class follows the content class column.
    drops = [(num(row.get(v)) or 0) * kg for v, _, _, _, kg in PROD]
    idx = max(range(len(PROD)), key=lambda i: drops[i]) if any(drops) else next((i for i, p in enumerate(PROD) if num(row.get(p[1]))), 0)
    sku = PROD[idx][3] or f'50KG_{cls if cls in "ABC" else "A"}'
    kg = content.get(sku) or PROD[idx][4]
    prem = []
    for col, code in (('AT', 'ROI_INSTALL'), ('AU', 'ENTRUSTED_CYL'), ('AV', 'CREDIT_RISK'), ('AW', 'REPAIRS'), ('AX', 'MARKETING')):
        v = cents(row.get(col))
        if v:
            prem.append({'code': code, 'perKg': v})
    competitor = brand_of(row.get('E'))
    disc = []
    dv = num(row.get(PROD[idx][2]))
    if dv:
        disc.append({'code': 'DUAL_SUPPLIER' if competitor else 'SUPPLY_ONLY', 'perKg': int(round(dv / kg * 100))})
    others = [p[3] or '50 kg' for i, p in enumerate(PROD) if i != idx and num(row.get(p[2]))]
    if others:
        issues.append(f'{who}: discounts also on {", ".join(others)}; only the main product ({sku}) was kept')
    loc = txt(row.get('D'))
    zone = zone_of(row.get('D'))
    cp = cents(row.get('F'))
    acc = {
        'id': new_id(name), 'name': name, 'status': 'Inactive' if status == 'Inactive' else 'Active',
        'needsAttention': status == 'Active but Needs Attention', 'channelId': 'COMMERCIAL', 'zone': zone, 'primarySkuId': sku,
        'contractStart': date(row.get('G'), who), 'contractEnd': date(row.get('H'), who),
        'trmvKg': int(num(row.get('J'))) if num(row.get('J')) else None,
        'volumeGeneratedKg': int(num(row.get('K'))) if num(row.get('K')) is not None else None,
        'avgMonthlyVolumeKg': int(num(row.get('AD'))) if num(row.get('AD')) else None,
        'creditTermDays': None, 'floorOverridePerKg': None, 'fixedMarginPerKg': None, 'investmentCentavos': None, 'reqVolPerMonthKg': None,
        'premiums': prem, 'discounts': disc, 'competitorBrand': competitor,
        'profile': {k: v for k, v in {
            'location': loc, 'installedAt': date(row.get('O'), who), 'manifoldSetup': txt(row.get('N')), 'contentClass': cls,
            'competitorPriceCentavos': cp, 'contractFile': txt(row.get('I')), 'remainingVolumeKg': num(row.get('L')),
            'ecdrNo': txt(row.get('T')), 'cylinderDeposit': bool(row.get('U')) if isinstance(row.get('U'), bool) else None,
            'depositAmountCentavos': cents(row.get('V')), 'deliveryCycle': txt(row.get('AC')), 'highestVolumeKg': num(row.get('AE')),
            'entrustedCylinders': {k: num(row.get(c)) for k, c in (('50kg', 'P'), ('22kgRegular', 'Q'), ('22kgForklift', 'R'), ('11kg', 'S')) if num(row.get(c))} or None,
            'volumePerDrop': {k: num(row.get(c)) for k, c in (('50kg', 'X'), ('22kgRegular', 'Y'), ('22kgForklift', 'Z'), ('11kg', 'AA'), ('2.7kg', 'AB')) if num(row.get(c))} or None,
            'vatTreatment': 'VATable',
        }.items() if v is not None},
    }
    if not acc['zone']:
        issues.append(f'{who}: no location')
    accounts.append(acc)

# ---- clients: bulk (tank / meter) ----
section = 'VATable'
for r in sorted(blk):
    row = blk[r]
    b = txt(row.get('B'))
    if b and 'ZERO' in b.upper():
        section = 'Zero-rated'
    name = txt(row.get('C'))
    if r < 15 or not name:
        continue
    who = f'Bulk row {r} {name}'
    prem = []
    for col, code in (('W', 'ROI_INSTALL'), ('X', 'TANK_RENTAL'), ('Y', 'CREDIT_RISK'), ('Z', 'REPAIRS'), ('AA', 'MARKETING')):
        v = cents(row.get(col))
        if v:
            prem.append({'code': code, 'perKg': v})
    disc = [{'code': code, 'perKg': cents(row.get(col))} for col, code in (('AD', 'SUPPLY_ONLY'), ('AE', 'DUAL_SUPPLIER'), ('AF', 'CASH_ZERO')) if cents(row.get(col))]
    tanks = {k: int(num(row.get(c))) for k, c in (('tank3_2mt', 'H'), ('tank600', 'I'), ('tank4000', 'J'), ('tank2000', 'K'), ('tank20000', 'L')) if num(row.get(c))}
    own = txt(row.get('G'))
    accounts.append({
        'id': new_id(name, 'blk'), 'name': name, 'status': 'Active', 'needsAttention': False, 'channelId': 'BULK', 'zone': None, 'primarySkuId': 'BULK_KG',
        'contractStart': date(row.get('T'), who), 'contractEnd': None, 'trmvKg': None,
        'volumeGeneratedKg': int(num(row.get('U'))) if num(row.get('U')) is not None else None, 'avgMonthlyVolumeKg': None, 'creditTermDays': None,
        'floorOverridePerKg': None, 'fixedMarginPerKg': cents(row.get('P')), 'investmentCentavos': cents(row.get('R')),
        'reqVolPerMonthKg': int(num(row.get('S'))) if num(row.get('S')) else None, 'premiums': prem, 'discounts': disc, 'competitorBrand': None,
        'profile': {k: v for k, v in {
            'installedAt': date(row.get('D'), who), 'lpgContentBilling': txt(row.get('E')), 'factorRate': txt(row.get('F')),
            'tankOwnership': {'MGC': 'MGC-owned'}.get(own, own), 'minKgPerDrop': int(num(row.get('N'))) if num(row.get('N')) else None,
            'vatTreatment': section, **tanks,
        }.items() if v is not None},
    })

# ---- clients: dealers (names only) ----
for r in sorted(dlr):
    name = txt(dlr[r].get('B'))
    if r < 3 or not name:
        continue
    accounts.append({
        'id': new_id(name, 'dlr'), 'name': name, 'status': 'Active', 'needsAttention': False, 'channelId': 'DEALER', 'zone': None, 'primarySkuId': '11KG_MGAS',
        'contractStart': None, 'contractEnd': None, 'trmvKg': None, 'volumeGeneratedKg': None, 'avgMonthlyVolumeKg': None, 'creditTermDays': None,
        'floorOverridePerKg': None, 'fixedMarginPerKg': None, 'investmentCentavos': None, 'reqVolPerMonthKg': None, 'premiums': [], 'discounts': [],
        'competitorBrand': None, 'profile': {},
    })

# Client ID: C-0001, C-0002 ... in workbook order.
for i, a in enumerate(accounts, 1):
    a['clientCode'] = f'C-{i:04d}'

zones = sorted({a['zone'] for a in accounts if a['zone']})
# Tracked competitors: each brand a client names, in the zones where it is named; plus the brands on the competitor price sheet.
pairs = sorted({(a['competitorBrand'], a['zone']) for a in accounts if a['competitorBrand'] and a['zone']})
tracked = [{'name': b, 'zone': z} for b, z in pairs]
sheet_brands = ['Town Gaz', 'Shine Gaz']  # COMPETITORS PRICING sheet (2025 readings, not imported)
for b in sheet_brands:
    tracked.append({'name': b, 'zone': ''})

out = {'skus': skus, 'channels': channels, 'zones': zones, 'trackedBrands': tracked, 'accounts': accounts}
json.dump(out, open(os.path.join(ROOT, 'db', 'import.private.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

with open(os.path.join(ROOT, 'db', 'import-review.private.csv'), 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.writer(f)
    w.writerow(['Client ID', 'Name', 'Channel', 'Status', 'Needs attention', 'Location (workbook)', 'Zone', 'Main product', 'Competitor', 'Contract start', 'Contract end', 'TRMV kg', 'Volume generated kg', 'Fixed margin ₱/kg', 'Premiums (₱/kg)', 'Discounts (₱/kg)'])
    for a in accounts:
        w.writerow([a['clientCode'], a['name'], a['channelId'], a['status'], 'yes' if a['needsAttention'] else '', a['profile'].get('location', ''), a['zone'] or '', a['primarySkuId'],
                    a['competitorBrand'] or '', a['contractStart'] or '', a['contractEnd'] or '', a['trmvKg'] or '', a['volumeGeneratedKg'] if a['volumeGeneratedKg'] is not None else '',
                    f"{a['fixedMarginPerKg'] / 100:.2f}" if a['fixedMarginPerKg'] else '',
                    '; '.join(f"{p['code']} {p['perKg'] / 100:.2f}" for p in a['premiums']), '; '.join(f"{d['code']} {d['perKg'] / 100:.2f}" for d in a['discounts'])])

by = {}
for a in accounts:
    by[a['channelId']] = by.get(a['channelId'], 0) + 1
print(f"products {len(skus)}, channels {len(channels)}, zones {len(zones)}, competitors {len(tracked)}, clients {len(accounts)} {by}")
print('zones:', ', '.join(zones))
print('competitors:', ', '.join(f"{t['name']}@{t['zone'] or '-'}" for t in tracked))
print(f'{len(issues)} things to look at:')
for i in issues:
    print(' -', i)
