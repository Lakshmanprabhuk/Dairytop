"""Build the DairyTop data module (data.js) and the dashboard dataset (dash.json).

Sources: the latest Microfas ZIP (Google Drive, or --zip / LOCAL_ZIP_PATH) and the
historical portal workbooks in static_data/. The scheduled runner can call this
script without arguments. --out / OUTPUT_PATH sets data.js; --dashboard-out /
DASHBOARD_OUTPUT also writes the compact dash.json read by the Business Cockpit.

Optional files in static_data/ (all validated, all optional):
  label_map.csv      kind,portal_label,mapped_label   portal names -> Microfas names
  product_lines.csv  line,product_id,action           curate a product line (include|exclude)
  targets.csv        verkoper,month,line,tonnes,pieces,revenue_eur   targets per verkoper

Every run validates its own output and stops before writing if a total does not tally.
Requires openpyxl; Drive mode also requires google-auth and google-api-python-client.
"""
import argparse
import calendar
import csv
import io
import json
import os
import re
import tempfile
from statistics import median
import zipfile
from collections import Counter, defaultdict
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from fractions import Fraction
from pathlib import Path

EMPTY = {"", "NULL", None}
START = "2026-04-07"
SCHEMA = "5.0.0"
VAT_ACCOUNT = re.compile(r"\b(btw|mwst|ust)\b", re.I)

# Product group for every Microfas category. Unknown categories land in "Other",
# visibly, and are listed in dataQuality; they are never folded into another group.
PRODUCT_GROUPS = {
    "Melkpoeder": "Milk powder",
    "Veevoeders": "Feed", "Aanvullende Veevoeders": "Feed",
    "Kalverhuisvesting": "Calf housing", "CalfOtel": "Calf housing",
    "Milkbar": "Calf supplies", "Kleine Kalverbenodigdheden": "Calf supplies", "Overige Artikelen": "Calf supplies",
    "Perfect Udder": "Perfect Udder",
}
GROUP_ORDER = ["Milk powder", "Feed", "Calf housing", "Calf supplies", "Perfect Udder", "Other"]
COUNTRY_EN = {"Deutschland": "Germany", "Nederland": "Netherlands", "Tsjechië": "Czechia", "België": "Belgium"}

# Product lines answer "how many tonnes of Pro Elite / how many calf pens did each verkoper sell".
# A line is a product group, a name rule, or both; static_data/product_lines.csv can include or
# exclude single products. Lines may overlap (Pro Elite is part of milk powder): never add lines up.
PEN_NAMES = re.compile(r"(k[äa]lber|kalver)(einzel)?box|gruppenbucht|k[äa]lberboxen|quattro|duobox|duo-box|"
                       r"cuddle box|deluxe box|trio box|flex box|^calfotel (comfort|xl-5 (met|mit)|xl-5 lose|plus)", re.I)
PEN_EXCLUDE = re.compile(r"set duoboxen|futterbox", re.I)
PRODUCT_LINES = [
    ("proElite", "Pro Elite milk powder", None, lambda n: re.match(r"pro elite", n, re.I) is not None),
    ("milkPowder", "All milk powder", "Milk powder", None),
    ("feed", "Feed", "Feed", None),
    ("calfPens", "Calf pens & hutches", "Calf housing", lambda n: bool(PEN_NAMES.search(n)) and not PEN_EXCLUDE.search(n)),
    ("calfHousing", "All calf housing", "Calf housing", None),
    ("calfSupplies", "Calf supplies", "Calf supplies", None),
    ("perfectUdder", "Perfect Udder", "Perfect Udder", None),
]
# Books (P&L accounts) are classed by account name. Revenue and purchase accounts also carry
# the product group their name points to; anything unclear stays "Other", visibly.
PNL_CLASSES = [
    ("Revenue", r"^(omzet|doorberekende kosten|overige bedrijfsopbrengsten)"),
    ("Purchases", r"^(inkopen|overige inkoopkosten)"),
    ("Personnel", r"lonen|salaris|sociale lasten|pensioen|personeel|uitzend|inleen|vakantie|ziekengeld|scholing|werkkleding|kantine|onkostenvergoeding|zorgverzekeringswet|payroll|managementvergoeding|reis- en verblijf"),
    ("Transport", r"truck|oplegger|brandstof|maut|^tol |toll |kilometerheffing|autokst|vervoermiddel|motorrijtuig|pakketdienst|porti|autokosten|chauffeurs|track & trace"),
    ("Housing", r"huur bedrijfspand|huur kantoorpand|huisvestingskosten|onroerende|^water$|schoonmaak|afschr|huur van derden|afvoer afval"),
    ("Sales & marketing", r"reclame|beurs|sponsoring|representatie|drukwerk|provisies|verkoopkosten|studiereis|winkel|bauernkultur|handelsnaam|verteerkosten"),
    ("Finance & tax", r"bank|rente|betalingskorting|betalingsverschil|dubieuze|incasso|paypal|pay\.nl|vennootschapsbelasting|fiscus"),
    ("Office & admin", r"accountants|administratie|advies|automatisering|kantoor|internet|telefo|contributies|verzekering|verwerkingskosten|vergader|kleine|onderhoud|reparatie"),
]
PNL_GROUPS = [
    ("Milk powder", r"melkpoeder|pro elite|premium \(fokkamel\)"),
    ("Feed", r"veevoe|k[äa]lber tmr|kälberpellets|kalverdpp|sojabonen|stro|gerste"),
    ("Calf housing", r"huisvesting|calfotel|futtertr[öo]ge|kalverhuisvesting"),
    ("Calf supplies", r"milkbar"),
    ("Perfect Udder", r"perfect udder"),
]
# Reorder signal: a regular buyer is late when the days since the last order exceed
# 1.5 x the median gap between orders, up to 120 days (after that it is churn, not a reorder).
REORDER_MIN_ORDERS, REORDER_FACTOR, REORDER_MAX_DAYS, REORDER_VALUE_MONTHS = 3, 1.5, 120, 6


def number(value):
    return Decimal(0) if value in EMPTY else Decimal(str(value))


def scaled(value, factor):
    v = number(value) * factor
    if v != v.to_integral_value():
        raise ValueError(f"Precision exceeds measure scale: {value}")
    return int(v)


def period(value, monthly=False):
    if value in EMPTY:
        return {}
    d = date.fromisoformat(value)
    y, w, _ = d.isocalendar()
    return dict(day=None if monthly else value, week=None if monthly else f"{y}-W{w:02}",
                month=value[:7], quarter=f"{d.year}-Q{(d.month-1)//3+1}", year=d.year, isoYear=None if monthly else y,
                weekStart=None if monthly else str(d-timedelta(days=d.weekday())))


# Portal labels that differ from the Microfas names (kind, portal label) -> Microfas label.
LABEL_MAP = {
    ("category", "Overig veevoer"): "Veevoeders",
    ("category", "Overige artikelen"): "Overige Artikelen",
    ("category", "Aanvullende diervoeders"): "Aanvullende Veevoeders",
    ("category", "Geen groep"): "Overige Artikelen",
    ("verkoper", "Orsi Hongarije"): "Judit Hongarije",
}

def build(archive, portals):
    from openpyxl import load_workbook
    start = os.getenv("AR_START", START)
    date.fromisoformat(start)
    label_map = dict(LABEL_MAP)
    map_path = SCRIPT_DIR / "static_data" / "label_map.csv"   # optional extra mappings
    if map_path.exists():
        with map_path.open(encoding="utf-8-sig", newline="") as stream:
            for row in csv.DictReader(stream):
                key = (row["kind"], row["portal_label"])
                if key in label_map and label_map[key] != row["mapped_label"] and key not in LABEL_MAP:
                    raise ValueError(f"Conflicting label mapping {key}")
                label_map[key] = row["mapped_label"]
    quality = defaultdict(list)
    tables, inventory = {}, []
    with zipfile.ZipFile(archive) as z:
        for name in z.namelist():
            if not name.lower().endswith(".csv"):
                continue
            key = re.sub(r"_\d{4}-\d\d-\d\d$", "", Path(name).stem)
            if key in tables:
                raise ValueError(f"Duplicate table {key}")
            with io.TextIOWrapper(z.open(name), encoding="utf-8-sig", newline="") as stream:
                reader = csv.DictReader(stream)
                tables[key] = [{k: None if v in EMPTY else v for k,v in r.items()} for r in reader]
                inventory.append(dict(table=key, rows=len(tables[key]), columns=reader.fieldnames))
    def index(table, field="id"):
        return {r[field]: r for r in tables[table]}
    art, rel = index("art"), index("rel")
    groups, units = index("art_artikelgroep"), index("art_prijskode")
    accounts, journals = index("fin_grbrek"), index("fin_dagboek")
    roles = defaultdict(set)
    for r in tables["rel_k_rel__vert"]:
        roles[r["id_rel"]].add(r["id_rel__vert"])
    def seller(customer):
        reps = roles[customer]
        if len(reps) != 1:
            return "Multiple representatives" if reps else "Unassigned"
        return (rel.get(next(iter(reps)), {}).get("naam_volledig") or "Unassigned").strip()
    def category(product):
        return groups.get(art.get(product, {}).get("id_art_artikelgroep"), {}).get("naam","Unclassified")
    def aliases(table, target):
        result = defaultdict(set)
        for r in tables[table]:
            result[(r["kode"] or "").strip().upper()].add(r[target])
        return result
    products, customers = aliases("art_relatie","id_art"), aliases("rel_v_afn","id")
    def resolve(mapping, code):
        code = str(code).strip().upper()
        ids = mapping.get(code,set())
        return next(iter(ids)) if len(ids)==1 else "portal:"+code
    sales, milk = [], defaultdict(lambda: [0,0])
    covered = set()
    for path in portals:
        book = load_workbook(path, read_only=True, data_only=True)
        months=set()
        for sheet in book:
            rows = iter(sheet.values)
            header = next(rows, ())
            if "Totaalbedrag" not in header:
                continue
            for values in rows:
                r=dict(zip(header,values))
                if not any(values):
                    continue
                y,m=int(r["Factuurjaar"]),int(r["Factuurmaand"])
                dt=f"{y}-{m:02}-01"
                months.add(dt[:7])
                cents=scaled(r["Totaalbedrag"],100)
                kg=scaled(r["Tonnage"],1000)
                pid=resolve(products,r["Artikelnummer"]); cid=resolve(customers,r["Klantnummer"])
                cat_o=(r["Artikelgroep"] or "Unclassified").strip(); rep_o=(r["Verkoper"] or "Unassigned").strip()
                # Same basis as Microfas months, so periods compare like for like: the product's
                # Microfas category and the customer's current verkoper. Unmatched codes fall
                # back to the label map, then to the portal label. Originals are kept.
                cat=category(pid) if pid in art else label_map.get(("category",cat_o),cat_o)
                rep=seller(cid) if not cid.startswith("portal:") else "Unassigned"
                if rep=="Unassigned":
                    rep=label_map.get(("verkoper",rep_o),rep_o)
                sales.append(dict(**period(dt,True),source="portal",customer=cid,product=pid,
                    categoryOriginal=cat_o,category=cat,verkoperOriginal=rep_o,verkoper=rep,
                    revenueCents=cents,kg=kg,microPieces=scaled(r["Aantal"],1000000)))
                if y==2025 and r["Artikelgroep"]=="Melkpoeder":
                    totals=milk[r["Verkoper"],m]; totals[0]+=kg; totals[1]+=cents
        book.close()
        if not months or months & covered:
            raise ValueError(f"Missing or overlapping portal periods: {path}")
        covered.update(months)
    ledger=[]; invoices={}; adjustments=defaultdict(list); issuer=defaultdict(set)
    # Microfas open-item status on the debtors account: 0 = open, 10 = matched (settled).
    open_items=defaultdict(int); open_last={}; pre_start_invoices=set()
    cutoff=max(r["datum"] for r in tables["fin_boeking"] if r["datum"] not in EMPTY)
    for r in tables["fin_boeking"]:
        dt,customer,inv=r["datum"],r["id_rel"],r["factuur_nr"]
        journal=journals[r["id_fin_dagboek"]]["naam"]
        kind=r["id_gen_fin_boeking_type"]; cents=scaled(r["bedrag"],100)
        ledger.append(dict(**period(dt),id=r["id"],journal=journal,account=accounts[r["id_fin_grbrek"]]["naam"],
                           accountId=r["id_fin_grbrek"],role=kind,customer=customer,invoice=inv,postingCents=cents))
        if kind!="10": continue
        key=(customer,inv,r["id_alg_valuta"])
        if r.get("id_gen_fin_boeking_status")=="0":
            open_items[key]+=cents; open_last[key]=max(open_last.get(key,""),dt)
        if journal=="Fakturering" and dt<start: pre_start_invoices.add(key)
        if journal=="Fakturering":
            issuer[inv].add(customer)
            if dt>=start:
                if key in invoices: raise ValueError(f"Duplicate invoice origin {key}")
                invoices[key]=(dt,cents)
        else: adjustments[key].append((dt,cents,journal))
    def dims(p,c):
        return dict(product=p,customer=c,category=category(p),verkoper=seller(c))
    bridge=defaultdict(lambda:[0,0,0,0])  # per invoice: revenue, VAT, repeated-VAT offset, other (credit side positive)
    for r in tables["fin_boeking"]:
        if journals[r["id_fin_dagboek"]]["naam"]!="Fakturering" or r["id_gen_fin_boeking_type"]!="0": continue
        name=accounts[r["id_fin_grbrek"]]["naam"].lower()
        if r["datum"]>=start:
            slot=0 if name.startswith(("omzet ","doorberekende kosten")) else 1 if VAT_ACCOUNT.search(name) else 2 if name.startswith("tegenrekening") else 3
            bridge[r["factuur_nr"]][slot]-=scaled(r["bedrag"],100)
        if not name.startswith(("omzet ","doorberekende kosten")): continue
        dt=r["datum"]
        if dt[:7] in covered: raise ValueError("Overlapping portal and Microfas sales month "+dt[:7])
        cs=issuer[r["factuur_nr"]]; c=next(iter(cs)) if len(cs)==1 else None
        sales.append(dict(**period(dt),**dims(r["id_art"],c),source="ledger",invoice=r["factuur_nr"],
                          revenueCents=-scaled(r["bedrag"],100),kg=0,microPieces=0))
    deliveries=[]
    for r in tables["stat"]:
        dt=r["factuur_datum"]; unit=units.get(r["id_art_prijskode"],{}).get("naam","unknown").lower()
        qty=number(r["aflever_aantal"])
        if r["id_art_prijskode"] is None and qty == 0:
            quality["textLinesExcluded"].append(r["id"])
            continue
        if unit not in {"kg","stuk"}:
            quality["unsupportedDeliveryUnits"].append(r["id"])
        if qty < 0:
            quality["returns"].append(r["id"])
        anomaly = bool(r["bestel_datum"] and r["bestel_datum"] > dt)
        if anomaly:
            quality["orderAfterInvoice"].append(r["id"])
        d=dims(r["id_art"],r["id_rel__fac"])
        deliveries.append(dict(**period(dt),**d,order=r["order_nr"],invoice=r["factuur_nr"],orderDay=r["bestel_datum"],
            deliveryDay=r["aflever_datum"],requestedThrough=r["wens_datum_tm"],unit=unit,microQuantity=scaled(qty,1000000),isReturn=qty<0,dateAnomaly=anomaly))
        if dt[:7] not in covered:
            sales.append(dict(**period(dt),**d,source="delivery",invoice=r["factuur_nr"],revenueCents=0,
                              kg=scaled(qty,1) if unit=="kg" else 0,microPieces=scaled(qty,1000000) if unit=="stuk" else 0))
    land={r["id"]:(r["naam"] or "").strip() for r in tables["alg_land"]}
    def market(customer):
        row=rel.get(customer) if customer else None
        name=land.get(row.get("id_alg_land__aflever")) if row else None
        return COUNTRY_EN.get(name,name) or "Unknown"
    def group(cat):
        return PRODUCT_GROUPS.get(cat,"Other")
    for row in sales:
        row["productGroup"]=group(row["category"]); row["market"]=market(row["customer"])
    for row in deliveries:
        row["productGroup"]=group(row["category"]); row["market"]=market(row["customer"])
    terms=index("rel_afn","id_rel"); receivables=[]
    for (c,i,currency),(dt,gross) in invoices.items():
        changes=[v for v in adjustments[c,i,currency] if v[0]<=cutoff and v[2]!="Beginbalans"]
        balance=open_items.get((c,i,currency),0)   # ledger open-item status, not our own matching
        payment_days = [v[0] for v in changes if v[1]<0 and v[2] not in {"Correctieboek"}]
        first_payment = min(payment_days, default=None)
        days=terms.get(c,{}).get("betterm")
        due=date.fromisoformat(dt)+timedelta(days=int(days)) if days not in EMPTY else None
        age=(date.fromisoformat(cutoff)-due).days if due else None
        rv,vat,off,oth=bridge[i] if len(issuer[i])==1 else (None,)*4
        receivables.append(dict(**period(dt),customer=c,invoice=i,currency=currency,grossCents=gross,
            netRevenueCents=rv,vatCents=vat,vatOffsetCents=off,otherInvoiceLineCents=oth,
            firstPaymentDay=first_payment,daysToPay=(date.fromisoformat(first_payment)-date.fromisoformat(dt)).days if first_payment else None,
            overpaid=gross>0 and balance<0,appliedCents=balance-gross,balanceCents=balance,estimatedDue=str(due) if due else None,
            ageing="Credit" if balance<0 else "Settled" if balance==0 else "Unknown" if age is None else
            "Current" if age<=0 else "1–30" if age<=30 else "31–60" if age<=60 else "61–90" if age<=90 else "91+"))
    orderFacts=[]; orderLines=[]; status=index("ord_status"); extensions=index("ord_order_verkoop","id_ord_order")
    extract=re.search(r"\d{4}-\d\d-\d\d",Path(archive).name)
    snapshot=extract.group() if extract else cutoff
    for r in tables["ord_order"]:
        st=status.get(r["id_ord_status"],{}); due=r["wens_datum_tm"]; c=extensions.get(r["id"],{}).get("id_rel__fac")
        orderFacts.append(dict(**period(r["bestel_datum"]),id=r["id"],order=r["order_nr"],customer=c,verkoper=seller(c),
            type="sales" if r["id"] in extensions else "other",status=st.get("naam"),openByStatus=st.get("id_gen_ord_status") in {"0","10","20","30","35"},
            due=due,schedule="unknown" if due in EMPTY else "past" if due<snapshot else "today" if due==snapshot else "future"))
    line_counts=Counter(r["id_ord_order"] for r in tables["ord_order_regel"])
    for row in orderFacts:
        row["lineCount"]=line_counts[row["id"]]
    headers={r["id"]:r for r in orderFacts}
    line_disc=index("ord_order_regel_verkoop","id_ord_order_regel")
    DISCOUNTS=("algkort","betkort","beskort","afnkort","indkort","lidkort","srtkort","kaskort")
    for r in tables["ord_order_regel"]:
        # Order-line price excl. VAT: (price - line discounts) / price-unit factor, per ordered unit.
        factor=number(units.get(r["id_art_prijskode"],{}).get("factor")) or Decimal(1)
        net=(number(r["prijs"])-sum(number(line_disc.get(r["id"],{}).get(k)) for k in DISCOUNTS))/factor
        value=lambda q: int((number(q)*net*100).quantize(Decimal(1),rounding=ROUND_HALF_UP))
        orderLines.append(dict(**headers[r["id_ord_order"]],lineId=r["id"],product=r["id_art"],category=category(r["id_art"]),
            unit=units.get(r["id_art_prijskode"],{}).get("naam"),orderedMicroQuantity=scaled(r["bestel_aantal"],1000000),deliveryMicroQuantity=scaled(r["lever_aantal"],1000000),
            priced=number(r["prijs"])!=0,orderedValueCents=value(r["bestel_aantal"]),deliveredValueCents=value(r["lever_aantal"])))
    # Order stage: an order still "open" by status may already be on an invoice (status not closed),
    # or be delivered and waiting for invoicing. Only "toDeliver" is real outstanding delivery work.
    invoiced_orders={str(d["order"]) for d in deliveries if d["order"] and d["invoice"]}
    remaining=defaultdict(int)
    for l in orderLines:
        remaining[l["id"]]+=max(0,l["orderedMicroQuantity"]-l["deliveryMicroQuantity"])
    for o in orderFacts:
        o["invoiced"]=str(o["order"]) in invoiced_orders
        o["fullyDelivered"]=o["lineCount"]>0 and remaining[o["id"]]==0
        o["stage"]="invoiced" if o["invoiced"] else "noLines" if o["lineCount"]==0 else "deliveredNotInvoiced" if o["fullyDelivered"] else "toDeliver"
    quality["openOrdersAlreadyInvoiced"]=[o["order"] for o in orderFacts if o["type"]=="sales" and o["openByStatus"] and o["invoiced"]]
    quality["deliveredOrdersNotInvoiced"]=[o["order"] for o in orderFacts if o["type"]=="sales" and o["openByStatus"] and o["stage"]=="deliveredNotInvoiced"]
    baseline=[]
    for rep in sorted({k[0] for k in milk}):
        mm=[dict(m=calendar.month_abbr[m]+" 25",tonnage=milk[rep,m][0]/1000,revenue=milk[rep,m][1]/100) for m in range(1,13) if (rep,m) in milk]
        baseline.append(dict(salesman=rep,category="Melkpoeder",tonnage=sum(v[0] for (s,m),v in milk.items() if s==rep)/1000,
            revenue=sum(v[1] for (s,m),v in milk.items() if s==rep)/100,monthly=mm))
    # Restrict the public module to analytical fields. Never copy unrestricted source rows.
    specs={"stockMovements":("voor_mutatie_regel","datum","id id_voor_mutatie id_art id_rel__locatie id_voor_partij id_art_prijskode hoeveelheid aantal bedrag"),
           "stockHeaders":("voor_mutatie","datum","id id_gen_voor_mutatie_soort id_rel__lev id_rel__afn"),
           "contracts":("con_contract","termijn_datum_tm","id id_rel__afn id_rel__lev id_con_contract_status contract_aantal termijn_datum_van actief"),
           "priceLists":("art_prijslijst_regel","datum","id id_art id_art_prijslijst id_art_prijskode prijs_excl prijs_incl"),
           "paymentInstructions":("bet_mutatie","datum","id id_fin_boeking id_rel factuur_nr bedrag id_gen_bet_mutatie_status"),
           "purchaseLines":("ord_order_regel_inkoop",None,"id id_ord_order_regel id_rel__lev")}
    extra={}
    for name,(table,dt,fields) in specs.items():
        extra[name]=[dict(**(period(r[dt]) if dt else {}),**{k:r[k] for k in fields.split() if k in r}) for r in tables[table]]
    # Secondary tables supply dimensions, relationship bridges and independent facts.
    # Identifier-only projections avoid exporting bank details, credentials or contact info.
    # Current, historical and view tables remain separate and must never be summed together.
    secondary={}
    used={"stat","fin_boeking","ord_order","ord_order_regel",*(spec[0] for spec in specs.values())}
    for table, rows in tables.items():
        if not rows or table in used:
            continue
        fields=[k for k in rows[0] if (k=="id" or k.startswith("id_")) and k!="id_alg_user"]
        fields.extend(k for k in ("actief","factor","btw_perc","betterm","standaard_aantal",
            "bestel_aantal","lever_aantal","prijs","prijs_netto","bedrag_netto","contract_aantal",
            "datum","bestel_datum","factuur_datum","wens_datum","wens_datum_tm","termijn_datum_tm")
            if k in rows[0])
        if table.startswith("gen_") or table in {"ord_status","art_prijskode","art_artikelgroep","art_diergroep",
            "fin_dagboek","fin_grbrek","ord_leveringswijze","alg_land","art_verpakking","con_contract_status"}:
            fields.extend(k for k in ("kode","naam") if k in rows[0])
        secondary[table]=[{k:None if r[k] in EMPTY else r[k] for k in fields} for r in rows]
    for name in extra:
        for r in extra[name]:
            for k in ("hoeveelheid","aantal","contract_aantal","prijs_excl","prijs_incl","bedrag"):
                if k in r:
                    r[k]=None if r[k] in EMPTY else float(number(r[k]))
    for v in receivables:
        if v["grossCents"]+v["appliedCents"]!=v["balanceCents"] or v["day"]<start:
            raise ValueError("Invoice control failed")
    dates=defaultdict(set)
    for row in deliveries:
        if row["microQuantity"]>0 and row["orderDay"] not in EMPTY:
            dates[row["customer"],row["product"]].add(date.fromisoformat(row["orderDay"]))
    cadence=[]
    for (customer,product),days in dates.items():
        days=sorted(days)
        gaps=[(b-a).days for a,b in zip(days,days[1:])]
        cadence.append(dict(**dims(product,customer),orderDays=len(days),lastOrder=str(days[-1]),
            medianGapDays=median(gaps) if gaps else None,minGapDays=min(gaps,default=None),
            maxGapDays=max(gaps,default=None)))
    paymentEvents=[]; exceptions=[]
    opening_keys={key for key,events in adjustments.items() if any(v[2]=="Beginbalans" for v in events)}
    for key,events in adjustments.items():
        for day,cents,journal in events:
            row=dict(**period(day),customer=key[0],invoice=key[1],currency=key[2],journal=journal,postingCents=cents)
            if key in invoices and day<=cutoff and journal!="Beginbalans":
                paymentEvents.append(row)
            else:
                row["reason"]=("legacyOpening" if journal=="Beginbalans" else
                    "legacySettlement" if key in opening_keys else
                    "unallocated" if key[1] is None else "unmatchedInvoice")
                exceptions.append(row)
    # Include invoice origins outside the requested cohort in the reconciliation.
    for row in ledger:
        if row["role"]=="10" and row["journal"]=="Fakturering" and row["day"]<start:
            exceptions.append(dict(row,reason="unmatchedInvoice"))
    # Product dimension: name, category, group, the unit it sells in, and its product lines.
    used_products={r["product"] for r in sales}|{r["product"] for r in deliveries}|{r["product"] for r in orderLines}
    sold_kg=defaultdict(int); sold_pcs=defaultdict(int)
    for r in sales:
        sold_kg[r["product"]]+=r["kg"]; sold_pcs[r["product"]]+=r["microPieces"]
    def pname(p):
        if p is None: return "Unknown product"
        if str(p).startswith("portal:"): return "Portal item "+str(p)[7:]
        return ((art.get(p,{}).get("naam_zoek") or f"Product {p}").strip().rstrip("*").strip())
    curated=defaultdict(dict)
    lines_path=SCRIPT_DIR/"static_data"/"product_lines.csv"
    known={l[0] for l in PRODUCT_LINES}
    if lines_path.exists():
        with lines_path.open(encoding="utf-8-sig",newline="") as stream:
            for row in csv.DictReader(stream):
                if row["line"] not in known or row["action"] not in {"include","exclude"}:
                    raise ValueError(f"Bad product_lines.csv row {row}")
                curated[row["line"]][row["product_id"]]=row["action"]
    productDimension=[]; members=defaultdict(list)
    for p in sorted(x for x in used_products if x is not None):
        cat=category(p) if p in art else next((r["category"] for r in sales if r["product"]==p),"Unclassified")
        name=pname(p); grp=group(cat)
        basis="kg" if sold_kg[p] and not sold_pcs[p] else "piece" if sold_pcs[p] and not sold_kg[p] else "mixed" if sold_kg[p] else "none"
        lines=[]
        for key,_,lg,rule in PRODUCT_LINES:
            hit=(lg is None or grp==lg) and (rule is None or rule(name))
            act=curated[key].get(p)
            if act=="include": hit=True
            elif act=="exclude": hit=False
            if hit: lines.append(key); members[key].append(p)
        productDimension.append(dict(id=p,name=name,category=cat,productGroup=grp,unitBasis=basis,lines=lines))
    productLines=[dict(key=k,label=l,productGroup=g,rule="curated" if curated[k] else "group" if r is None else "name",
        unitBasis="kg" if any(sold_kg[p] for p in members[k]) else "piece",productIds=members[k]) for k,l,g,r in PRODUCT_LINES]
    # Customer dimension: name, market, current verkoper, payment terms, first purchase in the data.
    first=defaultdict(lambda:None)
    for r in sales:
        if r["revenueCents"]>0:
            key=r["day"] or r["month"]
            if first[r["customer"]] is None or key<first[r["customer"]]: first[r["customer"]]=key
    used_customers=({r["customer"] for r in sales}|{r["customer"] for r in deliveries}|{r["customer"] for r in receivables}
        |{r["customer"] for r in orderFacts}|{k[0] for k in adjustments})
    def cname(c):
        if c is None: return "Unassigned customer"
        if str(c).startswith("portal:"): return "Portal customer "+str(c)[7:]
        return ((rel.get(c,{}).get("naam_volledig") or f"Customer {c}").strip())
    fact_rep=defaultdict(set)
    for r in sales: fact_rep[r["customer"]].add(r["verkoper"])
    def dim_rep(c):
        s=seller(c) if c and not str(c).startswith("portal:") else "Unassigned"
        # A customer with no representative in Microfas keeps the single verkoper its sales were attributed to.
        return next(iter(fact_rep[c])) if s=="Unassigned" and len(fact_rep.get(c,()))==1 else s
    customerDimension=[dict(id=c,name=cname(c),market=market(c),verkoper=dim_rep(c),
        paymentTermsDays=int(terms[c]["betterm"]) if c in terms and terms[c].get("betterm") not in EMPTY else None,
        firstPurchase=first[c]) for c in sorted(used_customers,key=lambda x:(x is None,str(x)))]
    # Invoice facts: one row per invoice, day and product group; positive net = invoice, negative = credit note.
    inv=defaultdict(int)
    for r in sales:
        if r["source"]=="ledger":
            inv[(r["invoice"],r["day"],r["customer"],r["verkoper"],r["productGroup"])]+=r["revenueCents"]
    invoiceFacts=[dict(**period(d),invoice=i,customer=c,verkoper=v,productGroup=g,revenueCents=x) for (i,d,c,v,g),x in sorted(inv.items(),key=lambda t:(t[0][1],str(t[0][0])))]
    # Reorder signals from delivery cadence, valued at the pair's average monthly revenue.
    live_months=sorted({r["month"] for r in sales if r["source"]!="portal" and r["month"]<cutoff[:7]})[-REORDER_VALUE_MONTHS:]
    pair_rev=defaultdict(int)
    for r in sales:
        if r["month"] in live_months: pair_rev[r["customer"],r["product"]]+=r["revenueCents"]
    reorderSignals=[]
    for r in cadence:
        if r["orderDays"]<REORDER_MIN_ORDERS or not r["medianGapDays"]: continue
        since=(date.fromisoformat(cutoff)-date.fromisoformat(r["lastOrder"])).days
        if since>REORDER_FACTOR*r["medianGapDays"] and since<=REORDER_MAX_DAYS:
            reorderSignals.append(dict(customer=r["customer"],product=r["product"],verkoper=r["verkoper"],productGroup=group(r["category"]),
                orderDays=r["orderDays"],medianGapDays=r["medianGapDays"],lastOrder=r["lastOrder"],daysSinceLastOrder=since,
                daysLate=round(since-r["medianGapDays"]),monthlyRevenueCents=round(pair_rev[r["customer"],r["product"]]/max(1,len(live_months)))))
    reorderSignals.sort(key=lambda x:-x["monthlyRevenueCents"])
    # Targets (optional): attainment needs a target per verkoper, month and line or "revenue".
    targets=[]
    tpath=SCRIPT_DIR/"static_data"/"targets.csv"
    if tpath.exists():
        with tpath.open(encoding="utf-8-sig",newline="") as stream:
            for row in csv.DictReader(stream):
                if row["line"] not in known|{"revenue"}: raise ValueError(f"Unknown target line {row['line']}")
                date.fromisoformat(row["month"]+"-01")
                targets.append(dict(verkoper=row["verkoper"].strip(),month=row["month"],line=row["line"],
                    kg=scaled(row.get("tonnes") or 0,1000),microPieces=scaled(row.get("pieces") or 0,1000000),
                    revenueCents=scaled(row.get("revenue_eur") or 0,100)))
    # Purchase prices (price list named "...inkoop...") give a cost per kg for milk powders.
    # Cost applies from each product's first price date; earlier sales are left out of margins.
    plist={r["id"]:(r.get("naam") or "") for r in tables["art_prijslijst"]}
    cost_rows=defaultdict(list)
    for r in tables["art_prijslijst_regel"]:
        if re.search("inkoop",plist.get(r["id_art_prijslijst"],""),re.I) and r["prijs_excl"] not in EMPTY and number(r["prijs_excl"])>0 and r["datum"]:
            cost_rows[r["id_art"]].append((r["datum"],number(r["prijs_excl"])))
    for v in cost_rows.values(): v.sort()
    productCosts=[dict(product=p,validFrom=d,purchasePricePerKgCents=float(x*100)) for p,v in sorted(cost_rows.items()) for d,x in v]
    def cost_at(p,day):
        price=None
        for d,x in cost_rows.get(p,()):
            if d<=day: price=x
        return price
    margin=defaultdict(lambda:[0,0,Decimal(0)])
    for r in sales:
        if r["source"]=="portal" or r["product"] not in cost_rows or r["day"]<cost_rows[r["product"]][0][0]: continue
        x=margin[(r["month"],r["verkoper"],r["customer"],r["product"],r["productGroup"])]
        x[0]+=r["revenueCents"]; x[1]+=r["kg"]
        if r["kg"]: x[2]+=Decimal(r["kg"])*cost_at(r["product"],r["day"])*100
    marginFacts=[dict(month=m,verkoper=v,customer=c,product=p,productGroup=g,revenueCents=x[0],kg=x[1],costCents=int(x[2].quantize(Decimal(1),rounding="ROUND_HALF_UP")))
        for (m,v,c,p,g),x in sorted(margin.items(),key=lambda t:tuple(str(k) for k in t[0]))]
    # Contract call-off: delivered kg of the contract's product group to the customer within the term.
    agroup={r["id"]:r["naam"] for r in tables["art_artikelgroep"]}
    contractProgress=[]
    for r in tables["con_contract"]:
        if r.get("actief")!="1": continue
        cgroup=group(agroup.get(r.get("id_art_artikelgroep"),"")); start_d,end_d=r["termijn_datum_van"],r["termijn_datum_tm"]
        through=min(end_d,cutoff); done=0; partial=[]
        for s2 in sales:
            if s2["customer"]!=r["id_rel__afn"] or s2["productGroup"]!=cgroup: continue
            if s2["day"]:
                if start_d<=s2["day"]<=through: done+=s2["kg"]
            else:
                m0=s2["month"]+"-01"; m1=s2["month"]+"-%02d"%calendar.monthrange(int(s2["month"][:4]),int(s2["month"][5:]))[1]
                if start_d<=m0 and m1<=end_d: done+=s2["kg"]
                elif m0<=end_d and m1>=start_d and s2["kg"]: partial.append(s2["month"])
        qty=number(r["contract_aantal"])
        elapsed=(date.fromisoformat(through)-date.fromisoformat(start_d)).days; span=(date.fromisoformat(end_d)-date.fromisoformat(start_d)).days
        contractProgress.append(dict(contract=r["id"],customer=r["id_rel__afn"],productGroup=cgroup,contractQuantity=float(qty),
            termFrom=start_d,termTo=end_d,deliveredKg=done,deliveredPercent=float(done/qty*100) if qty else None,
            termElapsedPercent=max(0,min(100,elapsed/span*100)) if span>0 else None,
            uncountedMonths=sorted(set(partial)),unitNote="Quantity as entered on the contract; compared with delivered kg"))
    # Books: every P&L posting, classed; income positive, cost negative.
    pnl_type={r["id"]:r.get("id_gen_fin_grbrek_type") for r in tables["fin_grbrek"]}
    def pnl_class(name):
        n=name.lower()
        for cls,rx in PNL_CLASSES:
            if re.search(rx,n): return cls
        return "Other"
    def pnl_group(name,cls):
        if cls not in ("Revenue","Purchases"): return None
        for g,rx in PNL_GROUPS:
            if re.search(rx,name.lower()): return g
        return "Other"
    books=defaultdict(int)
    for row in ledger:
        if pnl_type.get(row["accountId"])!="10": continue
        cls=pnl_class(row["account"])
        books[(row["month"],row["account"],cls,pnl_group(row["account"],cls))]-=row["postingCents"]
    profitAndLoss=[dict(month=m,account=a,pnlClass=c,productGroup=g,amountCents=v) for (m,a,c,g),v in sorted(books.items()) if v]
    # ---- Every amount leaves this pipeline EXCLUDING VAT. ----
    # Receivables are booked incl. VAT. Per invoice the VAT share is exact (revenue lines vs the amount
    # billed); payments are assumed to settle VAT pro rata. Items without invoice lines in this export
    # (balances from before the cohort, unallocated cash) use the customer's own net/gross ratio over
    # its cohort invoices (else its market's ratio, else the company's) and are flagged vatBasis="customerRate".
    def rnd(q): return int((q+Fraction(1,2)).__floor__())
    num=defaultdict(int); den=defaultdict(int)
    for v in receivables:
        if v["netRevenueCents"] is not None and v["grossCents"]>0:
            num[v["customer"]]+=v["netRevenueCents"]; den[v["customer"]]+=v["grossCents"]
    company=Fraction(sum(num.values()),sum(den.values())) if sum(den.values()) else Fraction(1)
    mnum=defaultdict(int); mden=defaultdict(int)
    for c in den: mnum[market(c)]+=num[c]; mden[market(c)]+=den[c]
    def cust_rate(c):
        if den.get(c): return Fraction(num[c],den[c])
        m=market(c); return Fraction(mnum[m],mden[m]) if mden.get(m) else company
    rate={}
    for v in receivables:
        g,b=v["grossCents"],v["balanceCents"]
        exact=v["netRevenueCents"] is not None and g!=0
        r=Fraction(v["netRevenueCents"],g) if exact else cust_rate(v["customer"])
        rate[v["customer"],v["invoice"],v["currency"]]=r
        gx=v["netRevenueCents"] if exact else rnd(g*r); bx=gx+rnd((b-g)*r)
        v.update(grossInclVatCents=g,appliedInclVatCents=b-g,balanceInclVatCents=b,vatBasis="invoice" if exact else "customerRate",
                 grossCents=gx,appliedCents=bx-gx,balanceCents=bx,vatInBalanceCents=b-bx,overpaid=gx>0 and bx<0)
        if bx<=0: v["ageing"]="Credit" if bx<0 else "Settled"
    def to_ex(rows,rate_of,basis):
        groups=defaultdict(list)
        for row in rows: groups[row["customer"],row["invoice"],row.get("currency")].append(row)
        for key,grp in groups.items():
            r=rate_of(key); cum=0; done=0
            for row in sorted(grp,key=lambda x:(x["day"] or "",x["journal"])):
                cum+=row["postingCents"]; x=rnd(cum*r)
                row["postingInclVatCents"]=row["postingCents"]; row["postingCents"]=x-done; done=x
                row["vatBasis"]=basis
    to_ex(paymentEvents,lambda k:rate[k],"invoice")
    to_ex(exceptions,lambda k:cust_rate(k[0]),"customerRate")
    # Open items outside the invoice cohort: balances on older invoices and cash not matched to an invoice.
    otherOpenItems=[]
    for key,amount in sorted(open_items.items(),key=lambda t:(str(t[0][0]),str(t[0][1]))):
        if key in invoices or amount==0: continue
        ex=rnd(amount*cust_rate(key[0]))
        otherOpenItems.append(dict(**period(open_last[key]),customer=key[0],invoice=key[1],currency=key[2],
            reason="legacy" if (key in opening_keys or key in pre_start_invoices) else "unallocated",
            amountInclVatCents=amount,amountCents=ex,vatBasis="customerRate"))
    control=sum(r["postingCents"] for r in ledger if r["role"]=="10" and r["day"]<=cutoff)
    reconciliation = dict(cohortBalanceCents=sum(r["balanceCents"] for r in receivables),
        legacyOpenCents=sum(r["amountCents"] for r in otherOpenItems if r["reason"]=="legacy"),
        unallocatedOpenCents=sum(r["amountCents"] for r in otherOpenItems if r["reason"]=="unallocated"),
        vatInOpenItemsCents=sum(v["vatInBalanceCents"] for v in receivables)+sum(r["amountInclVatCents"]-r["amountCents"] for r in otherOpenItems),
        matchedResidualCents=control-sum(open_items.values()),
        controlCents=control)
    quality["overpaidInvoices"]=[r["invoice"] for r in receivables if r["overpaid"]]
    quality["salesOrdersWithoutLines"]=[r["id"] for r in orderFacts if r["type"]=="sales" and r["lineCount"]==0]
    for dim in ("customer","product"):
        quality["unresolvedPortal"+dim.title()]=sorted({r[dim] for r in sales if r["source"]=="portal" and r[dim].startswith("portal:")})
    # A VAT line posted twice is absorbed by "Tegenrekening dagboeken"; its net per invoice is the excess.
    offset=defaultdict(int)
    for row in ledger:
        if row["journal"]=="Fakturering" and row["account"]=="Tegenrekening dagboeken":
            offset[row["invoice"]]+=row["postingCents"]
    quality["repeatedVatAccountInvoices"]=sorted(i for i,v in offset.items() if v)
    quality["unknownCategories"]=sorted({r["category"] for r in sales if r["productGroup"]=="Other"})
    quality["unallocatedPayments"]=[r["day"] for r in exceptions if r["reason"]=="unallocated"]
    quality["orderAfterInvoice"]=[r["id"] for r in tables["stat"] if r["bestel_datum"] and r["bestel_datum"]>r["factuur_datum"]]
    quality["unsupportedOrderUnits"]=[r["lineId"] for r in orderLines if r["unit"] and r["unit"].lower() not in {"kg","stuk"}]
    amounts=dict(repeatedVatAccountInvoices=sum(v for v in offset.values() if v),
        overpaidInvoices=sum(r["balanceCents"] for r in receivables if r["overpaid"]),
        unresolvedPortalCustomer=sum(r["revenueCents"] for r in sales if str(r["customer"]).startswith("portal:")),
        unresolvedPortalProduct=sum(r["revenueCents"] for r in sales if str(r["product"]).startswith("portal:")),
        unallocatedPayments=sum(r["postingCents"] for r in exceptions if r["reason"]=="unallocated"))
    # The books in this export start with the first billing in Microfas; P&L postings dated
    # earlier are back-dated corrections and are reported, not mixed into the first months.
    billing_days=[r["day"] for r in ledger if r["journal"]=="Fakturering" and r["day"]]
    # The books start on the first day of the month of the first billing: costs dated 1-7 April 2026
    # belong to the April result, because goods delivered that week were invoiced from 8 April.
    books_opening=(min(billing_days)[:8]+"01") if billing_days else None
    result = dict(metadata=dict(schemaVersion=SCHEMA,booksOpening=books_opening,productGroups=PRODUCT_GROUPS,productGroupOrder=GROUP_ORDER,
        reorderRule=dict(minOrders=REORDER_MIN_ORDERS,factor=REORDER_FACTOR,maxDays=REORDER_MAX_DAYS,valueMonths=live_months),quantityScales=dict(microPieces=1000000,microQuantity=1000000,orderedMicroQuantity=1000000,deliveryMicroQuantity=1000000,kg=1),snapshot=snapshot,ledgerThrough=cutoff,accountsReceivableStart=start,portalMonths=sorted(covered),
        revenueDefinition="Signed portal total plus billing journal Omzet and Doorberekende kosten accounts; cents. Microfas representative uses current assignment.",
        balanceDefinition="Open balance per invoice from the Microfas open-item status on the debtors account 132000 (status 0 = open, 10 = matched), so credit notes matched to an invoice settle it. Invoices from 7 April 2026; amounts EXCLUDING VAT (VAT share exact per invoice; items without invoice lines use the customer's own VAT ratio, else its market's). Older balances and unmatched cash are listed as other open items. Due date = invoice date + the customer's current payment terms. Tie-out: open items excl. VAT + VAT in them + matched items that do not net to zero = account 132000.",
        vatDefinition="All amounts in this dataset exclude VAT: revenue, receivables, payments, open balances, margins and the books. VAT appears only in *InclVat reference fields used to reconcile with the debtors ledger.",
        orderDefinition="Current header status before invoiced; schedule relative to extract. stage: invoiced (order number already on an invoiced delivery; status not closed), noLines (open header without any order lines), deliveredNotInvoiced (all lines delivered, no invoice yet), toDeliver (quantity outstanding). Historical backlog requires archived snapshots.",
        timeDefinition="ISO weeks. Portal day/week unavailable. Filter null buckets when presenting daily detail and state coverage.",
        attributionDefinition="All months use the product's current Microfas category and the customer's current verkoper; portal labels are kept in categoryOriginal and verkoperOriginal.",
        marginDefinition="Estimated gross margin = revenue - kg x purchase price (price list named inkoop) valid at the invoice date; only products and days with a purchase price. Freight, discounts and stock effects not included.",
        booksDefinition="All P&L postings by month and account, income positive. The books start on the first day of the month of the first billing in Microfas (1 April 2026); costs dated 1-7 April are included because that week's deliveries were invoiced from 8 April. A few postings are back-dated before it and are excluded. Purchases are booked when bought, not when sold; no stock-change postings exist, so monthly results swing with purchase timing.",
        contractDefinition="Delivered kg of the contract product group to the contract customer within the term; portal months count only when the whole month lies in the term.",
        volumeDefinition="kg for products sold by weight, microPieces/1e6 for products sold per piece, net of returns. Product lines may overlap; never add lines together."),
        dataQuality=[dict(check=k,count=len(v),amountCents=amounts.get(k,0),exampleIds=v[:20]) for k,v in quality.items()],arReconciliation=reconciliation,customerProductCadence=cadence,invoiceApplications=paymentEvents,otherCustomerPostings=exceptions,referenceTables=secondary,tableInventory=inventory,salesFacts=sales,deliveryFacts=deliveries,financePostings=ledger,accountsReceivable=receivables,
        orders=orderFacts,orderLines=orderLines,otherOpenItems=otherOpenItems,melkpoederTonnage2025=baseline,
        productDimension=productDimension,productLines=productLines,customerDimension=customerDimension,
        invoiceFacts=invoiceFacts,reorderSignals=reorderSignals,targets=targets,
        productCosts=productCosts,marginFacts=marginFacts,contractProgress=contractProgress,profitAndLoss=profitAndLoss,
        productNames={k:r["naam_zoek"] for k,r in art.items()},customerNames={k:r["naam_volledig"] for k,r in rel.items()},
        **extra)
    result=clean_output(result)
    validate_output(result)
    return result


def clean_output(value):
    if isinstance(value, dict):
        return {k:clean_output(v) for k,v in value.items()}
    if isinstance(value, list):
        return [clean_output(v) for v in value]
    return None if isinstance(value,str) and value in {"","NULL"} else value


def validate_output(data):
    if '"NULL"' in json.dumps(data, allow_nan=False):
        raise ValueError("NULL sentinel in dataset")
    ar=data["arReconciliation"]
    if sum(v for k,v in ar.items() if k!="controlCents")!=ar["controlCents"]:
        raise ValueError("Accounts receivable reconciliation does not close")
    for row in data["accountsReceivable"]:
        if row["grossCents"]+row["appliedCents"]!=row["balanceCents"]:
            raise ValueError("Invoice balance does not close")
        if row["grossInclVatCents"]+row["appliedInclVatCents"]!=row["balanceInclVatCents"] or row["balanceInclVatCents"]-row["balanceCents"]!=row["vatInBalanceCents"]:
            raise ValueError(f"Invoice {row['invoice']}: VAT split does not close")
        parts=(row["netRevenueCents"],row["vatCents"],row["vatOffsetCents"],row["otherInvoiceLineCents"])
        if None not in parts and (sum(parts)!=row["grossInclVatCents"] or row["grossCents"]!=row["netRevenueCents"]):
            raise ValueError(f"Invoice {row['invoice']}: revenue + VAT does not equal the amount billed")
    months=defaultdict(list)
    for row in data["salesFacts"]:
        months[row["month"]].append(row)
    for month,rows in months.items():
        total=sum(r["revenueCents"] for r in rows)
        for dimension in ("verkoper","category","customer","product"):
            grouped=defaultdict(int)
            for row in rows:
                grouped[row[dimension]]+=row["revenueCents"]
            if sum(grouped.values())!=total:
                raise ValueError(f"Sales do not reconcile for {month}/{dimension}")
    for dim in ("verkoper","category"):
        seen=defaultdict(set)
        key="customer" if dim=="verkoper" else "product"
        for row in data["salesFacts"]:
            seen[row[key]].add(row[dim])
        split=[k for k,v in seen.items() if len(v)>1]
        if split:
            raise ValueError(f"{len(split)} {key}s carry more than one {dim} across periods")
    pnl_ids={r["id"] for r in data["referenceTables"]["fin_grbrek"] if r.get("id_gen_fin_grbrek_type")=="10"}
    if sum(r["amountCents"] for r in data["profitAndLoss"])!=-sum(r["postingCents"] for r in data["financePostings"] if r["accountId"] in pnl_ids):
        raise ValueError("Books do not tally with P&L postings")
    inv_total=sum(r["revenueCents"] for r in data["invoiceFacts"])
    if inv_total!=sum(r["revenueCents"] for r in data["salesFacts"] if r["source"]=="ledger"):
        raise ValueError("Invoice facts do not tally with ledger revenue")
    portal=set(data["metadata"]["portalMonths"])
    live={r["month"] for r in data["salesFacts"] if r["source"]=="ledger"}
    if portal & live:
        raise ValueError("Overlapping portal and ledger months")
    if portal:
        first=date.fromisoformat(min(portal)+"-01")
        last=data["metadata"]["ledgerThrough"][:7]
        while first.isoformat()[:7]<=last:
            if first.isoformat()[:7] not in months:
                raise ValueError(f"Missing sales month {first:%Y-%m}")
            first=date(first.year+first.month//12,first.month%12+1,1)


JS = """
// Any combination, e.g. aggregate(salesFacts,['month','verkoper','category'],['revenueCents','kg']).
// Use orders for header counts. Ledger totals must be filtered by posting role and journal.
export function aggregate(rows, dimensions, measures) {
  const groups = new Map();
  for (const row of rows) {
    const values = dimensions.map(k => row[k] ?? null);
    const key = JSON.stringify(values);
    if (!groups.has(key)) groups.set(key, Object.fromEntries([...dimensions.map((k,i)=>[k,values[i]]), ...measures.map(k=>[k,0])]));
    const group = groups.get(key);
    for (const k of measures) {
      if (typeof row[k] !== 'number') throw new TypeError('Expected numeric measure '+k);
      group[k] += row[k];
    }
  }
  return [...groups.values()];
}
export const revenueSummary = aggregate(salesFacts, [], ['revenueCents','kg','microPieces']);
export const salesByMonth = aggregate(salesFacts,['month'],['revenueCents','kg','microPieces']);
export const salesByVerkoper = aggregate(salesFacts,['verkoper'],['revenueCents','kg','microPieces']);
export const salesByCustomerProduct = aggregate(salesFacts,['customer','product'],['revenueCents','kg','microPieces']);
export const salesByProductVerkoper = aggregate(salesFacts,['product','verkoper'],['revenueCents','kg','microPieces']);
export const salesByCustomerCategory = aggregate(salesFacts,['customer','category'],['revenueCents','kg','microPieces']);
export const receivablesByAge = aggregate(accountsReceivable,['ageing'],['grossCents','appliedCents','balanceCents']);
export const salesVolumeByVerkoperProduct = aggregate(salesFacts,['month','verkoper','category','product'],['kg','microPieces']).map(r=>({...r,tonnes:r.kg/1000,quantity:r.microPieces/1000000}));
export const openSalesOrders = orders.filter(r=>r.type==='sales' && r.openByStatus);

// Filter periods as YYYY-MM (legacy and live) or use day for live data only.
// Arrays select any listed value. Missing dimensions stay in explicit null buckets.
export function querySales({filters={},dimensions=['month','verkoper','product']}={}) {
  const rows=salesFacts.filter(row=>Object.entries(filters).every(([field,value])=>
    Array.isArray(value) ? value.includes(row[field]) : row[field]===value));
  return aggregate(rows,dimensions,['revenueCents','kg','microPieces']);
}
export function compareSalesPeriods(currentMonths, previousMonths, dimensions=['verkoper','product']) {
  const current=querySales({filters:{month:currentMonths},dimensions});
  const previous=querySales({filters:{month:previousMonths},dimensions});
  const key=row=>JSON.stringify(dimensions.map(k=>row[k]??null));
  const currentMap=new Map(current.map(row=>[key(row),row]));
  const previousMap=new Map(previous.map(row=>[key(row),row]));
  return [...new Set([...currentMap.keys(),...previousMap.keys()])].map(id=>{
    const a=currentMap.get(id), b=previousMap.get(id);
    const result=Object.fromEntries(dimensions.map(k=>[k,(a??b)[k]]));
    for(const measure of ['revenueCents','kg','microPieces']) {
      const now=a?.[measure]??0, before=b?.[measure]??0;
      result[measure]={current:now,previous:before,change:now-before,
        changePercent:before===0?null:(now-before)/Math.abs(before)*100};
    }
    return result;
  });
}
export const salesByVerkoperCustomerProduct = aggregate(salesFacts,['month','verkoper','customer','category','product'],['revenueCents','kg','microPieces']);
export const salesByVerkoperCategory = aggregate(salesFacts,['month','verkoper','category'],['revenueCents','kg','microPieces']);
export const salesByCustomerMonth = aggregate(salesFacts,['month','customer'],['revenueCents','kg','microPieces']);
export const salesByProductMonth = aggregate(salesFacts,['month','category','product'],['revenueCents','kg','microPieces']);
export const salesByDay = aggregate(salesFacts.filter(r=>r.day!==null),['day'],['revenueCents','kg','microPieces']);
export const salesByIsoWeek = aggregate(salesFacts.filter(r=>r.week!==null),['isoYear','week','weekStart'],['revenueCents','kg','microPieces']);
export const salesByQuarter = aggregate(salesFacts,['quarter'],['revenueCents','kg','microPieces']);
export const salesByYear = aggregate(salesFacts,['year'],['revenueCents','kg','microPieces']);

// Split signed components to explain net volume without counting delivery/ledger
// records as separate transactions. Physical returns and financial credits differ.
export const salesSignedComponents = aggregate(salesFacts.map(r=>({...r,
  positiveRevenueCents:Math.max(r.revenueCents,0),creditRevenueCents:Math.min(r.revenueCents,0),
  positiveKg:Math.max(r.kg,0),returnedKg:Math.min(r.kg,0),
  positiveMicroPieces:Math.max(r.microPieces,0),returnedMicroPieces:Math.min(r.microPieces,0)
})),['month','verkoper','category','product','market'],[
  'positiveRevenueCents','creditRevenueCents','positiveKg','returnedKg',
  'positiveMicroPieces','returnedMicroPieces'
]);
export const deliveryVolumesByVerkoperProduct = aggregate(deliveryFacts,
  ['month','verkoper','product','unit','isReturn'],['microQuantity']);
export const openSalesOrderLines = orderLines.filter(r=>r.type==='sales' && r.openByStatus);
export const openOrderVolumesByVerkoperProduct = aggregate(openSalesOrderLines,
  ['verkoper','customer','product','unit','schedule'],['orderedMicroQuantity','deliveryMicroQuantity']);
export const openOrderCountsByVerkoper = aggregate(openSalesOrders.map(r=>({...r,orderCount:1})),
  ['verkoper','schedule','stage'],['orderCount']);
export const representativeProductCadence = customerProductCadence;
// ---------- Volumes per verkoper: product lines, buyers, prices, like-for-like windows ----------
// Answers questions such as "how many tonnes of Pro Elite does each verkoper sell" and
// "how many calf pens were sold". Lines overlap (Pro Elite is part of milk powder): never add lines up.
export const productLineMembers = Object.fromEntries(productLines.map(l=>[l.key,new Set(l.productIds)]));
const productUnit = Object.fromEntries(productDimension.map(p=>[p.id,p.unitBasis]));
const inLine = line => line==null ? (()=>true) : (r=>!!productLineMembers[line] && productLineMembers[line].has(r.product));
const matches = (row,filters) => Object.entries(filters).every(([field,value])=>Array.isArray(value)?value.includes(row[field]):row[field]===value);
export function queryVolumes({line=null, filters={}, dimensions=['verkoper']}={}) {
  if (line!=null && !productLineMembers[line]) throw new RangeError('Unknown product line '+line);
  const rows=salesFacts.filter(r=>inLine(line)(r)&&matches(r,filters)).map(r=>{const u=productUnit[r.product];return {...r,
    kgRevenueCents:u==='kg'?r.revenueCents:0,kgForPrice:u==='kg'?r.kg:0,pieceRevenueCents:u==='piece'?r.revenueCents:0,microPiecesForPrice:u==='piece'?r.microPieces:0}});
  return aggregate(rows,dimensions,['revenueCents','kg','microPieces','kgRevenueCents','kgForPrice','pieceRevenueCents','microPiecesForPrice']).map(g=>({...g,
    tonnes:g.kg/1000,pieces:g.microPieces/1000000,
    pricePerKgCents:g.kgForPrice?g.kgRevenueCents/g.kgForPrice:null,
    pricePerPieceCents:g.microPiecesForPrice?g.pieceRevenueCents/(g.microPiecesForPrice/1000000):null}));
}
export const volumeByVerkoperLineMonth = productLines.flatMap(l=>queryVolumes({line:l.key,dimensions:['month','verkoper']}).map(r=>({line:l.key,...r})));
export function buyerChanges({line=null, currentMonths, previousMonths, by='verkoper', filters={}}) {
  const unit=line==null?'kg':(productLines.find(l=>l.key===line)||{}).unitBasis, field=unit==='piece'?'microPieces':'kg';
  const buyers=months=>{const q=new Map();for(const r of salesFacts){if(!months.includes(r.month)||!inLine(line)(r)||!matches(r,filters))continue;const k=JSON.stringify([r[by]??null,r.customer]);q.set(k,(q.get(k)||0)+r[field])}
    const out=new Map();for(const [k,v] of q){if(v<=0)continue;const [g,c]=JSON.parse(k);if(!out.has(g))out.set(g,new Set());out.get(g).add(c)}return out};
  const a=buyers(currentMonths),b=buyers(previousMonths);
  return [...new Set([...a.keys(),...b.keys()])].map(g=>{const x=a.get(g)||new Set(),y=b.get(g)||new Set();
    return {[by]:g,buyers:x.size,previousBuyers:y.size,newBuyers:[...x].filter(c=>!y.has(c)),stoppedBuyers:[...y].filter(c=>!x.has(c))}});
}
const knownMonths=new Set(salesByMonth.map(r=>r.month)), portalMonthSet=new Set(metadata.portalMonths);
const daysInMonth=m=>new Date(Date.UTC(+m.slice(0,4),+m.slice(5),0)).getUTCDate();
const shiftMonth=(m,n)=>new Date(Date.UTC(+m.slice(0,4),+m.slice(5)-1+n,1)).toISOString().slice(0,7);
export const partialMonth=(()=>{const m=metadata.ledgerThrough.slice(0,7),d=+metadata.ledgerThrough.slice(8);return d<daysInMonth(m)?{month:m,throughDay:d}:null})();
// Like-for-like comparison months. A partial month is compared on the same days only, and only
// against a month with daily data; otherwise previous is null and reason says why.
export function comparableMonths(currentMonths, mode='previousYear') {
  const n=mode==='previousYear'?12:currentMonths.length, previous=currentMonths.map(m=>shiftMonth(m,-n));
  const missing=previous.filter(m=>!knownMonths.has(m));
  if(missing.length) return {previous:null,throughDay:null,reason:'No data for '+missing.join(', ')};
  const partial=partialMonth&&currentMonths.includes(partialMonth.month);
  if(partial&&portalMonthSet.has(previous[previous.length-1])) return {previous:null,throughDay:null,reason:'Current month is partial and the comparison month has monthly totals only'};
  return {previous,throughDay:partial?partialMonth.throughDay:null,reason:null};
}
// throughDay limits the LAST month of the window to days 1..throughDay (like-for-like partial month).
export function querySalesWindow({months, throughDay=null, filters={}, dimensions=['month']}) {
  const last=months[months.length-1];
  const rows=salesFacts.filter(r=>months.includes(r.month)&&(throughDay==null||r.month!==last||(r.day!==null&&+r.day.slice(8)<=throughDay))&&matches(r,filters));
  return aggregate(rows,dimensions,['revenueCents','kg','microPieces']);
}
// Weekly or monthly digest for any run of days with daily data (Microfas months).
export function periodDigest({from, to, filters={}}) {
  const rows=salesFacts.filter(r=>r.day!==null&&r.day>=from&&r.day<=to&&matches(r,filters));
  const docs=new Map();for(const r of invoiceFacts){if(r.day<from||r.day>to||!matches(r,filters))continue;const k=r.invoice+'|'+r.customer;docs.set(k,(docs.get(k)||0)+r.revenueCents)}
  const byCustomer=aggregate(rows,['customer'],['revenueCents']);
  return {from,to,revenueCents:rows.reduce((s,r)=>s+r.revenueCents,0),kg:rows.reduce((s,r)=>s+r.kg,0),microPieces:rows.reduce((s,r)=>s+r.microPieces,0),
    invoices:[...docs.values()].filter(v=>v>0).length,creditNotes:[...docs.values()].filter(v=>v<0).length,
    newCustomers:customerDimension.filter(c=>c.firstPurchase&&c.firstPurchase.length===10&&c.firstPurchase>=from&&c.firstPurchase<=to&&(!filters.verkoper||c.verkoper===filters.verkoper)).map(c=>c.id),
    netCreditCustomers:byCustomer.filter(r=>r.revenueCents<0),
    byVerkoper:aggregate(rows,['verkoper'],['revenueCents','kg','microPieces']).sort((a,b)=>b.revenueCents-a.revenueCents),
    byProductGroup:aggregate(rows,['productGroup'],['revenueCents','kg','microPieces'])};
}
// Targets vs actual per verkoper (needs static_data/targets.csv; empty otherwise).
export function targetAttainment({months, line='revenue'}) {
  const t=targets.filter(x=>months.includes(x.month)&&x.line===line);if(!t.length)return [];
  const actual=line==='revenue'?querySales({filters:{month:months},dimensions:['verkoper']}):queryVolumes({line,filters:{month:months},dimensions:['verkoper']});
  const act=new Map(actual.map(r=>[r.verkoper,r])),goal=aggregate(t,['verkoper'],['kg','microPieces','revenueCents']);
  return goal.map(g=>{const a=act.get(g.verkoper)||{kg:0,microPieces:0,revenueCents:0},m=line==='revenue'?'revenueCents':(g.kg?'kg':'microPieces');
    return {verkoper:g.verkoper,measure:m,target:g[m],actual:a[m],attainmentPercent:g[m]?a[m]/g[m]*100:null}});
}
// Books and margins. Books are as booked (purchases when bought); margins are estimates over purchase prices.
export function profitAndLossBy({months=null, dimensions=['pnlClass']}={}) {
  return aggregate(profitAndLoss.filter(r=>!months||months.includes(r.month)),dimensions,['amountCents']);
}
export function marginBy({filters={}, dimensions=['verkoper']}={}) {
  return aggregate(marginFacts.filter(r=>matches(r,filters)),dimensions,['revenueCents','kg','costCents']).map(g=>({...g,
    marginCents:g.revenueCents-g.costCents,marginPercent:g.revenueCents?(g.revenueCents-g.costCents)/g.revenueCents*100:null,
    marginPerKgCents:g.kg?(g.revenueCents-g.costCents)/g.kg:null}));
}
export const reorderSignalsByVerkoper = aggregate(reorderSignals.map(r=>({...r,signals:1})),['verkoper'],['signals','monthlyRevenueCents']);

export const salesCapabilities = {
  quantityUnits:{tonnes:'kg / 1000',items:'microPieces / 1000000',
    deliveries:'microQuantity / 1000000, grouped by unit',
    orders:'orderedMicroQuantity / 1000000, grouped by unit'},
  comparisons:'Pass explicit comparable month lists to compareSalesPeriods.',
  dailyCoverage:'Microfas only. Legacy rows have null day/week.',
  attribution:'Microfas uses current representative assignments. Ambiguous assignments have their own group.',
  orderVolumes:'Ordered and delivery fields are source quantities. Their difference has not been certified as outstanding backlog.',
  cadence:'Distinct positive delivery order dates per billing customer and product.',
  productLines:'productLines lists Pro Elite, milk powder, feed, calf pens & hutches, calf housing, calf supplies and Perfect Udder; queryVolumes({line}) gives tonnes, pieces and average price per verkoper, customer, market or month. Curate lines in static_data/product_lines.csv.',
  buyers:'buyerChanges({line,currentMonths,previousMonths}) gives buyers, new buyers and stopped buyers per verkoper (or any dimension).',
  likeForLike:'comparableMonths(months, mode) returns comparison months, or null with a reason; querySalesWindow applies the throughDay cap of a partial month.',
  digest:'periodDigest({from,to}) gives revenue, invoices, credit notes, new customers, net credits and verkoper ranking for any days with daily data.',
  reorders:'reorderSignals lists regular buyers past 1.5x their usual gap, valued per month; see metadata.reorderRule.',
  markets:'salesFacts.market is the customer delivery country; customerDimension holds market, verkoper, terms and first purchase.',
  books:'profitAndLossBy({months,dimensions}) groups every P&L posting by class (Revenue, Purchases, Personnel, Transport, ...), account, product group or month.',
  margins:'marginBy({filters,dimensions}) gives estimated margin per kg over the purchase price list for milk powders, from the first price date.',
  contracts:'contractProgress shows delivered kg against each active contract and how much of the term has passed.',
  targets:'targetAttainment({months,line}) once static_data/targets.csv exists (verkoper,month,line,tonnes,pieces,revenue_eur).',
  costLimits:'Margins cover products with a purchase price only and exclude freight, discounts and stock effects.'
};

"""
SCRIPT_DIR = Path(__file__).resolve().parent


QUALITY_LABELS = {
    "returns": "Return delivery lines (negative quantity)",
    "textLinesExcluded": "Text-only delivery lines removed",
    "orderAfterInvoice": "Order date after invoice date",
    "unsupportedDeliveryUnits": "Delivery lines with unit outside kg/stuk",
    "overpaidInvoices": "Positive invoices overpaid into credit",
    "salesOrdersWithoutLines": "Sales orders without lines",
    "unresolvedPortalCustomer": "Portal customer codes without Microfas match",
    "unresolvedPortalProduct": "Portal product codes without Microfas match",
    "repeatedVatAccountInvoices": "VAT posted twice (absorbed by Tegenrekening dagboeken)",
    "unsupportedOrderUnits": "Order lines with unit outside kg/stuk",
    "unknownCategories": "Categories without a product group",
    "unallocatedPayments": "Unallocated customer payments (no invoice ref)",
    "openOrdersAlreadyInvoiced": "Orders still open in Microfas but already invoiced",
    "deliveredOrdersNotInvoiced": "Orders delivered in full but not yet invoiced",
}


def build_dashboard(data):
    """Compact, dictionary-encoded dataset for the Business Cockpit. Every total is asserted."""
    class Codes:
        def __init__(self): self.ix, self.items = {}, []
        def __call__(self, k):
            if k not in self.ix:
                self.ix[k] = len(self.items); self.items.append(k)
            return self.ix[k]
    CU, PR, VK, CA, MO = Codes(), Codes(), Codes(), Codes(), Codes()
    sales = data["salesFacts"]
    agg = defaultdict(lambda: [0, 0, 0])
    for r in sales:
        key = (r["month"], int(r["day"][8:]) if r["day"] else 0, CU(r["customer"]), PR(r["product"]), VK(r["verkoper"]), CA(r["category"]))
        agg[key][0] += r["revenueCents"]; agg[key][1] += r["kg"]; agg[key][2] += r["microPieces"]
    for m in sorted({k[0] for k in agg}): MO(m)
    facts = {k: [] for k in "mdcpvgrkq"}
    for key in sorted(agg, key=lambda k: (k[0], k[1], k[2], k[3])):
        m, d, c, p, v, g = key
        for col, val in zip("mdcpvg", (MO.ix[m], d, c, p, v, g)): facts[col].append(val)
        for col, val in zip("rkq", agg[key]): facts[col].append(val)
    invoices = [[r["invoice"], MO(r["month"]), int(r["day"][8:]), CU(r["customer"]), GROUP_ORDER.index(r["productGroup"]), r["revenueCents"]] for r in data["invoiceFacts"]]
    ar = [[CU(r["customer"]), r["invoice"], r["day"], r["estimatedDue"], r["grossCents"], r["appliedCents"], r["balanceCents"],
           r["ageing"], r["daysToPay"], 1 if r["overpaid"] else 0,
           r["grossInclVatCents"], r["balanceInclVatCents"], 0 if r["vatBasis"]=="invoice" else 1] for r in data["accountsReceivable"]]
    legacy = defaultdict(int); unalloc = []
    for r in data["otherOpenItems"]:
        if r["reason"] == "legacy":
            legacy[(r["customer"], r["invoice"])] += r["amountCents"]
        else:
            unalloc.append([CU(r["customer"]), r["day"], "Open item", r["amountCents"], r["reason"]])
    legacy_rows = [[CU(c), i, v] for (c, i), v in sorted(legacy.items(), key=lambda t: (str(t[0][0]), str(t[0][1]))) if v]
    okg = defaultdict(lambda: [0, 0, 0])
    for l in data["orderLines"]:
        if (l["unit"] or "").lower() == "kg":
            okg[l["id"]][0] += l["orderedMicroQuantity"]; okg[l["id"]][1] += l["deliveryMicroQuantity"]
        else:
            okg[l["id"]][2] += 1
    orders = [[o["order"], o["day"], CU(o["customer"]) if o["customer"] else -1, o["verkoper"], o["status"], 1 if o["openByStatus"] else 0,
               o["due"], o["schedule"], o["lineCount"], round(okg[o["id"]][0] / 1e6), round(okg[o["id"]][1] / 1e6), okg[o["id"]][2], o["stage"]]
              for o in data["orders"] if o["type"] == "sales"]
    cadence = [[CU(r["customer"]), PR(r["product"]), r["orderDays"], r["lastOrder"], r["medianGapDays"]]
               for r in data["customerProductCadence"] if r["orderDays"] >= REORDER_MIN_ORDERS and r["medianGapDays"]]
    GI = {g: i for i, g in enumerate(GROUP_ORDER)}
    signed = defaultdict(lambda: [0] * 6)
    for r in sales:
        x = signed[(MO.ix[r["month"]], VK(r["verkoper"]), GI[r["productGroup"]], r["market"])]
        x[0] += max(r["revenueCents"], 0); x[1] += min(r["revenueCents"], 0); x[2] += max(r["kg"], 0)
        x[3] += min(r["kg"], 0); x[4] += max(r["microPieces"], 0); x[5] += min(r["microPieces"], 0)
    signed_rows = [[m, v, g, *x, mk] for (m, v, g, mk), x in sorted(signed.items())]
    open_lines = [[l["order"], CU(l["customer"]) if l["customer"] else -1, l["verkoper"], PR(l["product"]), (l["unit"] or "").lower(),
                   l["orderedMicroQuantity"], l["deliveryMicroQuantity"], l["schedule"], l["due"],
                   l["orderedValueCents"], l["deliveredValueCents"], 1 if l["priced"] else 0]
                  for l in data["orderLines"] if l["type"] == "sales" and l["openByStatus"]]
    margin_rows = [[MO(r["month"]), VK(r["verkoper"]), CU(r["customer"]), PR(r["product"]), r["revenueCents"], r["kg"], r["costCents"]] for r in data["marginFacts"]]
    contracts = [[CU(r["customer"]), r["productGroup"], r["contractQuantity"], r["termFrom"], r["termTo"], r["deliveredKg"], r["termElapsedPercent"], r["uncountedMonths"]] for r in data["contractProgress"]]
    reorder = [[CU(r["customer"]), PR(r["product"]), r["orderDays"], r["medianGapDays"], r["lastOrder"], r["daysSinceLastOrder"], r["daysLate"], r["monthlyRevenueCents"]] for r in data["reorderSignals"]]
    pnl = [[r["month"], r["account"], r["pnlClass"], r["productGroup"], r["amountCents"]] for r in data["profitAndLoss"]]
    costs = [[PR(r["product"]), r["validFrom"], r["purchasePricePerKgCents"]] for r in data["productCosts"]]
    exports = {k: len(v) for k, v in data.items() if isinstance(v, list)}
    cdim = {c["id"]: c for c in data["customerDimension"]}
    pdim = {p["id"]: p for p in data["productDimension"]}
    customers = [[cdim[c]["name"], cdim[c]["market"], cdim[c]["verkoper"], cdim[c].get("paymentTermsDays")] if c in cdim else ["Unassigned customer", "Unknown", "Unassigned", None] for c in CU.items]
    pcat = {}
    for p, g in zip(facts["p"], facts["g"]): pcat.setdefault(p, g)
    products = [[pdim[p]["name"] if p in pdim else str(p), pcat.get(i, -1)] for i, p in enumerate(PR.items)]
    lines = [dict(key=l["key"], label=l["label"], products=[PR.ix[p] for p in l["productIds"] if p in PR.ix]) for l in data["productLines"]]
    quality = [dict(check=QUALITY_LABELS.get(q["check"], q["check"]), count=q["count"], amountCents=q["amountCents"]) for q in data["dataQuality"]]
    rec = data["arReconciliation"]
    assert sum(facts["r"]) == sum(r["revenueCents"] for r in sales)
    assert sum(facts["k"]) == sum(r["kg"] for r in sales) and sum(facts["q"]) == sum(r["microPieces"] for r in sales)
    by_month = defaultdict(int)
    for r in sales: by_month[r["month"]] += r["revenueCents"]
    for m, v in by_month.items():
        assert sum(r for mm, r in zip(facts["m"], facts["r"]) if mm == MO.ix[m]) == v, m
    assert sum(a[6] for a in ar) == rec["cohortBalanceCents"]
    assert rec["cohortBalanceCents"] + sum(x[2] for x in legacy_rows) + sum(u[3] for u in unalloc) + rec["vatInOpenItemsCents"] + rec["matchedResidualCents"] == rec["controlCents"]
    assert sum(x[5] for x in invoices) == sum(r["revenueCents"] for r in sales if r["source"] == "ledger")
    meta = data["metadata"]
    return dict(meta=dict(snapshot=meta["snapshot"], ledgerThrough=meta["ledgerThrough"], arStart=meta["accountsReceivableStart"],
                          portalMonths=meta["portalMonths"], schemaVersion=meta["schemaVersion"], booksOpening=meta.get("booksOpening"),
                          unmappedCategories=sorted({c for c in CA.items if c not in PRODUCT_GROUPS})),
                months=MO.items, customers=customers, products=products, verkopers=VK.items,
                categories=[[c, PRODUCT_GROUPS.get(c, "Other")] for c in CA.items], lines=lines,
                facts=facts, qScale=1000000, invoices=invoices, ar=ar, legacy=legacy_rows, unallocated=unalloc,
                recon=rec, orders=orders, cadence=cadence, quality=quality,
                signed=signed_rows, openLines=open_lines, margin=margin_rows, contracts=contracts, reorder=reorder,
                pnl=pnl, costs=costs, targets=data["targets"], exports=exports,
                definitions={k: v for k, v in meta.items() if k.endswith("Definition")})


def write_atomic(dest, writer):
    dest = Path(dest); dest.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf8", dir=dest.parent, delete=False) as out:
        writer(out)
    os.chmod(out.name, 0o644)
    os.replace(out.name, dest)


def download_latest_zip(directory):
    from google.oauth2 import service_account
    from googleapiclient.discovery import build as drive_client
    from googleapiclient.http import MediaIoBaseDownload

    folder = os.environ["DRIVE_FOLDER_ID"]
    credentials = service_account.Credentials.from_service_account_file(
        SCRIPT_DIR / os.environ["GDRIVE_CREDENTIALS_FILE"],
        scopes=["https://www.googleapis.com/auth/drive.readonly"],
    )
    files = drive_client("drive", "v3", credentials=credentials).files()
    token = None
    while True:
        page = files.list(
            q=f"'{folder}' in parents and trashed=false",
            orderBy="modifiedTime desc", pageSize=100, pageToken=token,
            fields="nextPageToken,files(id,name,mimeType)",
            supportsAllDrives=True, includeItemsFromAllDrives=True,
        ).execute(num_retries=3)
        for item in page.get("files", []):
            if not (item["name"].lower().endswith(".zip") or item["mimeType"] in
                    {"application/zip", "application/x-zip-compressed"}):
                continue
            # Keep the export date for snapshot reporting without using a remote path.
            stamp = re.search(r"\d{4}-\d{2}-\d{2}", item["name"])
            target = Path(directory) / ((stamp.group() if stamp else "export") + ".zip")
            request = files.get_media(fileId=item["id"], supportsAllDrives=True)
            with target.open("wb") as stream:
                download = MediaIoBaseDownload(stream, request)
                done = False
                while not done:
                    _, done = download.next_chunk(num_retries=3)
            return target
        token = page.get("nextPageToken")
        if not token:
            raise FileNotFoundError("No ZIP in the configured Drive folder")


if __name__ == "__main__":
    try:
        from dotenv import load_dotenv
    except ImportError:
        pass
    else:
        load_dotenv()
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--zip", default=os.getenv("LOCAL_ZIP_PATH"))
    ap.add_argument("--portal", nargs="*", default=[
        SCRIPT_DIR / "static_data" / name for name in
        ("DT_Portal_Export_2025.xlsx", "DT_Portal_Export_Q1_2026.xlsx")
    ])
    ap.add_argument("--out", default=os.getenv("OUTPUT_PATH") or SCRIPT_DIR.parent / "src/utils/data.js")
    ap.add_argument("--dashboard-out", default=os.getenv("DASHBOARD_OUTPUT"),
                    help="Also write the compact dash.json for the Business Cockpit")
    args = ap.parse_args()
    with tempfile.TemporaryDirectory() as directory:
        archive = args.zip or download_latest_zip(directory)
        dataset = build(archive, args.portal)
    dashboard = build_dashboard(dataset) if args.dashboard_out else None
    def write_module(out):
        for key,values in dataset.items():
            out.write("export const "+key+" = ")
            json.dump(values,out,ensure_ascii=False,separators=(",",":"),allow_nan=False)
            out.write(";\n")
        out.write(JS)
    write_atomic(args.out, write_module)
    if dashboard is not None:
        write_atomic(args.dashboard_out, lambda out: json.dump(dashboard,out,ensure_ascii=False,separators=(",",":"),allow_nan=False))
