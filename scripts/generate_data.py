# =============================================================================
# DairyTop — data.js generator
# Replaces Microsoft Fabric notebook. Runs in GitHub Actions.
# Sources:
#   PART1 → static_data/DT_Portal_Export_*.xlsx + derived live data
#   PART2 → stat.csv (from zip)
#   PART3 → derived invoice_audit_live from raw CSVs
#   PART4 → fin_boeking type-10 (AR / Debtor Management)
# =============================================================================

import os
import io
import json
import zipfile
import re
import unicodedata
from dotenv import load_dotenv
from datetime import datetime
from collections import defaultdict

import pandas as pd
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

# ─── CONFIG ──────────────────────────────────────────────────────────────────
load_dotenv()
DRIVE_FOLDER_ID    = os.environ["DRIVE_FOLDER_ID"]
GDRIVE_CREDENTIALS = os.environ.get("GDRIVE_CREDENTIALS", "local")

SCRIPTS_DIR     = os.path.dirname(os.path.abspath(__file__))
STATIC_DATA_DIR = os.path.join(SCRIPTS_DIR, "static_data")
OUTPUT_PATH     = os.path.join(SCRIPTS_DIR, "..", "src", "utils", "data.js")

STATIC_XLSX = [
    os.path.join(STATIC_DATA_DIR, "DT_Portal_Export_2025.xlsx"),
    os.path.join(STATIC_DATA_DIR, "DT_Portal_Export_Q1_2026.xlsx"),
]
STATIC_JS_PATH  = os.path.join(STATIC_DATA_DIR, "static.js")
REL_V_VERT_PATH = os.path.join(STATIC_DATA_DIR, "rel_v_vert.csv")

TONNAGE_CATS = {"Melkpoeder", "Veevoeders", "Aanvullende Veevoeders"}

FACTOR_MAP = {1: 1, 2: 100, 4: 5, 5: 20, 6: 25}

MONTH_NAMES = {1:"Jan",2:"Feb",3:"Mar",4:"Apr",5:"May",6:"Jun",
               7:"Jul",8:"Aug",9:"Sep",10:"Oct",11:"Nov",12:"Dec"}

XLSX_COL_MAP = {
    "Klant":        "customer_name",
    "Verkoper":     "salesman_name",
    "Omschrijving": "product_name",
    "Artikelgroep": "product_group",
    "Totaalbedrag": "Revenue",
    "Tonnage":      "Tonnage",
    "Aantal":       "Aantal",
    "Factuurmaand": "invoice_month",
    "Factuurjaar":  "invoice_year",
    "Factuurdatum": "factuur_datum",
}

# ─── GOOGLE DRIVE ────────────────────────────────────────────────────────────
def get_drive_service():
    creds_file = os.path.join(
        SCRIPTS_DIR,
        os.environ["GDRIVE_CREDENTIALS_FILE"]
    )
    with open(creds_file, "r") as f:
        creds_info = json.load(f)
    creds = service_account.Credentials.from_service_account_info(
        creds_info,
        scopes=["https://www.googleapis.com/auth/drive.readonly"]
    )
    return build("drive", "v3", credentials=creds)


def download_latest_zip(service):
    results = service.files().list(
        q=f"'{DRIVE_FOLDER_ID}' in parents and (mimeType='application/zip' or mimeType='application/x-zip-compressed' or name contains '.zip') and trashed=false",
        orderBy="modifiedTime desc",
        pageSize=1,
        fields="files(id,name,modifiedTime)"
    ).execute()
    files = results.get("files", [])
    if not files:
        raise FileNotFoundError("No zip found in the Drive folder.")
    f = files[0]
    print(f"  → Downloading: {f['name']}  (modified {f['modifiedTime']})")
    req = service.files().get_media(fileId=f["id"])
    buf = io.BytesIO()
    dl  = MediaIoBaseDownload(buf, req)
    done = False
    while not done:
        _, done = dl.next_chunk()
    buf.seek(0)
    return buf


def extract_zip(zip_buf):
    tables = {}
    with zipfile.ZipFile(zip_buf) as zf:
        for name in zf.namelist():
            if not name.endswith(".csv"):
                continue
            base = os.path.splitext(os.path.basename(name))[0].lower()
            tbl  = re.sub(r'_\d{4}-\d{2}-\d{2}$', '', base)
            with zf.open(name) as f:
                try:
                    tables[tbl] = pd.read_csv(f, encoding="utf-8",  low_memory=False)
                except UnicodeDecodeError:
                    tables[tbl] = pd.read_csv(f, encoding="latin-1", low_memory=False)
    print(f"  → Tables extracted: {len(tables)}")
    return tables


# ─── HELPERS ─────────────────────────────────────────────────────────────────

def js_escape(v: object) -> str:
    s = str(v)
    # Remove control characters but keep unicode letters
    s = "".join(c for c in s if not unicodedata.category(c).startswith("C"))
    return (
        s
        .replace("\\", "\\\\")
        .replace("'",  "\\'")
        .replace('"',  '\\"')
    )


def row_to_js(r: pd.Series, cols) -> str:
    parts = []
    for js_key, src_col, fmt in cols:
        v = r[src_col]
        if fmt == "s":
            parts.append(f"{js_key}:'{js_escape(v)}'")
        elif fmt == "i":
            raw = float(v) if pd.notna(v) else 0.0
            parts.append(f"{js_key}:{int(round(raw))}")
        else:
            parts.append(f"{js_key}:{v}")
    return "{" + ",".join(parts) + "}"


def build_export(name: str, df: pd.DataFrame, cols) -> str:
    body = ",\n  ".join(row_to_js(r, cols) for _, r in df.iterrows())
    return f"export const {name} = [\n  {body}\n];"


def fn(n) -> str:
    if isinstance(n, float):
        return str(int(n)) if n == int(n) else str(n)
    return str(n)


def _add_time_dims(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["month_label"] = (
        df["invoice_month"].map(MONTH_NAMES)
        + " "
        + df["invoice_year"].astype(str).str[-2:]
    )
    df["day_label"]  = df["factuur_datum"].dt.strftime("%d/%m/%y")
    df["day_iso"]    = df["factuur_datum"].dt.strftime("%Y-%m-%d")
    iso              = df["factuur_datum"].dt.isocalendar()
    df["iso_year"]   = pd.to_numeric(iso["year"],  errors="coerce")
    df["iso_week"]   = pd.to_numeric(iso["week"],  errors="coerce")
    df["week_label"] = (
        "W" + df["iso_week"].astype("Int64").astype(str).str.zfill(2)
        + " " + df["iso_year"].astype("Int64").astype(str).str[-2:]
    )
    df["week_start"] = (
        df["factuur_datum"]
        - pd.to_timedelta(df["factuur_datum"].dt.weekday, unit="D")
    ).dt.normalize()
    return df


# ─── LOAD EXCEL FILES ────────────────────────────────────────────────────────

def load_static_excel() -> pd.DataFrame:
    frames = []
    for path in STATIC_XLSX:
        xls = pd.ExcelFile(path)
        for sheet in xls.sheet_names:
            frames.append(xls.parse(sheet))
    df = pd.concat(frames, ignore_index=True)
    df = df.rename(columns=XLSX_COL_MAP)
    return df


# ─── PART 1 ──────────────────────────────────────────────────────────────────

def build_part1(pdf_xlsx: pd.DataFrame, df_live: pd.DataFrame) -> str:
    """
    PART1: concat xlsx (2025 + Q1 2026) with live (Apr-Oct 26).
    For the live period:
      - Revenue = line_rev_delivered_excl  (per-line, matches Fabric legacy)
      - Aantal  = 0                        (Fabric showed 0 for live period)
    """

    src = pdf_xlsx.copy()

    if not df_live.empty:
        live = df_live.copy()
        live = live.rename(columns={
            "salesman":                "salesman_name",
            "line_rev_delivered_excl": "Revenue",
        })
        live["Aantal"]        = 0   # ← Fabric showed qty=0 for live period
        live["invoice_month"] = live["factuur_datum"].dt.month
        live["invoice_year"]  = live["factuur_datum"].dt.year

        common = [c for c in src.columns if c in live.columns]
        pdf_src = pd.concat([src, live[common]], ignore_index=True)
    else:
        pdf_src = src

    # ── Type coercion ─────────────────────────────────────────────────────────
    pdf_src["Revenue"]       = pd.to_numeric(pdf_src["Revenue"],       errors="coerce").fillna(0)
    pdf_src["Aantal"]        = pd.to_numeric(pdf_src["Aantal"],        errors="coerce").fillna(0)
    pdf_src["invoice_month"] = pd.to_numeric(pdf_src["invoice_month"], errors="coerce")
    pdf_src["invoice_year"]  = pd.to_numeric(pdf_src["invoice_year"],  errors="coerce")
    pdf_src = pdf_src.dropna(subset=["invoice_year", "invoice_month"]).copy()
    pdf_src["invoice_year"]  = pdf_src["invoice_year"].astype(int)
    pdf_src["invoice_month"] = pdf_src["invoice_month"].astype(int)

    for col in ["customer_name", "salesman_name", "product_name", "product_group"]:
        pdf_src[col] = pdf_src[col].fillna("Unknown").astype(str).str.strip()

    pdf_src["factuur_datum"] = pd.to_datetime(pdf_src.get("factuur_datum"), errors="coerce")

    # ── Time dimensions ───────────────────────────────────────────────────────
    pdf_src   = _add_time_dims(pdf_src)
    pdf_dated = pdf_src.dropna(subset=["factuur_datum"]).copy()

    # ── Aggregations ──────────────────────────────────────────────────────────
    monthly = (
        pdf_src.groupby(["invoice_year", "invoice_month", "month_label"], as_index=False)
        .agg(rev=("Revenue", "sum"), orders=("Revenue", "size"))
        .sort_values(["invoice_year", "invoice_month"])
    )
    salesreps = (
        pdf_src.groupby(["salesman_name", "month_label"], as_index=False)
        .agg(rev=("Revenue", "sum"), qty=("Aantal", "sum"), orders=("Revenue", "size"))
        .sort_values("rev", ascending=False)
    )

    for col in ["customer_name", "salesman_name", "product_name", "product_group"]:
        pdf_src[col] = pdf_src[col].fillna("Unknown").astype(str).str.strip()

    customers = (
        pdf_src.groupby(["customer_name", "month_label"], as_index=False)
        .agg(rev=("Revenue", "sum"), orders=("Revenue", "size"))
    )
    customers = customers[customers["customer_name"] != "Unknown"]
    customers = customers.sort_values("rev", ascending=False)

    products = (
        pdf_src.groupby(["product_name", "month_label"], as_index=False)
        .agg(rev=("Revenue", "sum"), qty=("Aantal", "sum"), orders=("Revenue", "size"))
        .sort_values("rev", ascending=False)
    )
    categories = (
        pdf_src.groupby(["product_group", "month_label"], as_index=False)
        .agg(rev=("Revenue", "sum"), orders=("Revenue", "size"))
        .sort_values("rev", ascending=False)
    )
    unique_customers = (
        pdf_src["customer_name"].dropna()
        .loc[lambda s: s.str.strip() != ""].nunique()
    )

    monthly_js    = "export const monthly = [\n  " + ",\n  ".join(
        row_to_js(r, [("m","month_label","s"),("rev","rev","i"),("orders","orders","i")])
        for _, r in monthly.iterrows()) + "\n];"
    salesreps_js  = "export const salesreps = [\n  " + ",\n  ".join(
        row_to_js(r, [("n","salesman_name","s"),("m","month_label","s"),("rev","rev","i"),("qty","qty","i"),("orders","orders","i")])
        for _, r in salesreps.iterrows()) + "\n];"
    customers_js  = "export const customers = [\n  " + ",\n  ".join(
        row_to_js(r, [("n","customer_name","s"),("m","month_label","s"),("rev","rev","i"),("orders","orders","i")])
        for _, r in customers.iterrows()) + "\n];"
    products_js   = "export const products = [\n  " + ",\n  ".join(
        row_to_js(r, [("n","product_name","s"),("m","month_label","s"),("rev","rev","i"),("qty","qty","i"),("orders","orders","i")])
        for _, r in products.iterrows()) + "\n];"
    categories_js = "export const categories = [\n  " + ",\n  ".join(
        row_to_js(r, [("n","product_group","s"),("m","month_label","s"),("rev","rev","i"),("orders","orders","i")])
        for _, r in categories.iterrows()) + "\n];"

    if pdf_dated.empty:
        dw = {k: f"export const {k} = [];" for k in [
            "daily","weekly","salesrepsDaily","salesrepsWeekly",
            "customersDaily","customersWeekly","productsDaily","productsWeekly",
            "categoriesDaily","categoriesWeekly"
        ]}
    else:
        daily   = (pdf_dated.groupby(["day_iso","day_label"], as_index=False)
                   .agg(rev=("Revenue","sum"), orders=("Revenue","size")).sort_values("day_iso"))
        weekly  = (pdf_dated.groupby(["iso_year","iso_week","week_label"], as_index=False)
                   .agg(rev=("Revenue","sum"), orders=("Revenue","size"), week_start=("week_start","min"))
                   .sort_values(["iso_year","iso_week"]))
        weekly["week_end"]     = weekly["week_start"] + pd.Timedelta(days=6)
        weekly["week_start_s"] = weekly["week_start"].dt.strftime("%d/%m/%y")
        weekly["week_end_s"]   = weekly["week_end"].dt.strftime("%d/%m/%y")

        sr_daily  = (pdf_dated.groupby(["salesman_name","day_iso","day_label"], as_index=False)
                     .agg(rev=("Revenue","sum"), qty=("Aantal","sum"), orders=("Revenue","size")).sort_values(["salesman_name","day_iso"]))
        sr_weekly = (pdf_dated.groupby(["salesman_name","iso_year","iso_week","week_label"], as_index=False)
                     .agg(rev=("Revenue","sum"), qty=("Aantal","sum"), orders=("Revenue","size")).sort_values(["salesman_name","iso_year","iso_week"]))
        cu_daily  = (pdf_dated.groupby(["customer_name","day_iso","day_label"], as_index=False)
                     .agg(rev=("Revenue","sum"), orders=("Revenue","size")).sort_values(["customer_name","day_iso"]))
        cu_weekly = (pdf_dated.groupby(["customer_name","iso_year","iso_week","week_label"], as_index=False)
                     .agg(rev=("Revenue","sum"), orders=("Revenue","size")).sort_values(["customer_name","iso_year","iso_week"]))
        pr_daily  = (pdf_dated.groupby(["product_name","day_iso","day_label"], as_index=False)
                     .agg(rev=("Revenue","sum"), qty=("Aantal","sum"), orders=("Revenue","size")).sort_values(["product_name","day_iso"]))
        pr_weekly = (pdf_dated.groupby(["product_name","iso_year","iso_week","week_label"], as_index=False)
                     .agg(rev=("Revenue","sum"), qty=("Aantal","sum"), orders=("Revenue","size")).sort_values(["product_name","iso_year","iso_week"]))
        ca_daily  = (pdf_dated.groupby(["product_group","day_iso","day_label"], as_index=False)
                     .agg(rev=("Revenue","sum"), orders=("Revenue","size")).sort_values(["product_group","day_iso"]))
        ca_weekly = (pdf_dated.groupby(["product_group","iso_year","iso_week","week_label"], as_index=False)
                     .agg(rev=("Revenue","sum"), orders=("Revenue","size")).sort_values(["product_group","iso_year","iso_week"]))

        dw = {
            "daily":            build_export("daily", daily, [("d","day_label","s"),("iso","day_iso","s"),("rev","rev","i"),("orders","orders","i")]),
            "weekly":           build_export("weekly", weekly, [("w","week_label","s"),("start","week_start_s","s"),("end","week_end_s","s"),("rev","rev","i"),("orders","orders","i")]),
            "salesrepsDaily":   build_export("salesrepsDaily", sr_daily, [("n","salesman_name","s"),("d","day_label","s"),("iso","day_iso","s"),("rev","rev","i"),("qty","qty","i"),("orders","orders","i")]),
            "salesrepsWeekly":  build_export("salesrepsWeekly", sr_weekly, [("n","salesman_name","s"),("w","week_label","s"),("rev","rev","i"),("qty","qty","i"),("orders","orders","i")]),
            "customersDaily":   build_export("customersDaily", cu_daily, [("n","customer_name","s"),("d","day_label","s"),("iso","day_iso","s"),("rev","rev","i"),("orders","orders","i")]),
            "customersWeekly":  build_export("customersWeekly", cu_weekly, [("n","customer_name","s"),("w","week_label","s"),("rev","rev","i"),("orders","orders","i")]),
            "productsDaily":    build_export("productsDaily", pr_daily, [("n","product_name","s"),("d","day_label","s"),("iso","day_iso","s"),("rev","rev","i"),("qty","qty","i"),("orders","orders","i")]),
            "productsWeekly":   build_export("productsWeekly", pr_weekly, [("n","product_name","s"),("w","week_label","s"),("rev","rev","i"),("qty","qty","i"),("orders","orders","i")]),
            "categoriesDaily":  build_export("categoriesDaily", ca_daily, [("n","product_group","s"),("d","day_label","s"),("iso","day_iso","s"),("rev","rev","i"),("orders","orders","i")]),
            "categoriesWeekly": build_export("categoriesWeekly", ca_weekly, [("n","product_group","s"),("w","week_label","s"),("rev","rev","i"),("orders","orders","i")]),
        }

    mfd   = pdf_dated["factuur_datum"].max() if not pdf_dated.empty else None
    mfd_s = mfd.strftime("%d/%m/%Y") if pd.notna(mfd) else "No data"

    return "\n\n".join([
        monthly_js, salesreps_js, customers_js, products_js, categories_js,
        dw["daily"], dw["weekly"],
        dw["salesrepsDaily"], dw["salesrepsWeekly"],
        dw["customersDaily"], dw["customersWeekly"],
        dw["productsDaily"],  dw["productsWeekly"],
        dw["categoriesDaily"], dw["categoriesWeekly"],
        f"export const totalClients = {unique_customers};",
        f"export const lastUpdated = '{datetime.now().strftime('%d/%m/%Y')}';",
        f"export const maxFactuurDatum = '{mfd_s}';",
    ])


# ─── PART 2 ──────────────────────────────────────────────────────────────────

def build_part2(tables: dict) -> str:
    stat = tables.get("stat")
    if stat is None:
        print("  ⚠ No stat table found — PART2 will use zeroes")
        return "\n".join([
            "// ── Open Order KPIs ──",
            "export const openOrderValueFuture = 273604;",
            "export const openOrderValuePresent = 0;",
            "export const projectedMTD = 0;",
            "export const turnoverMTD = 0;",
            "export const openOrderValueMTD = 0;",
        ])

    stat = stat.copy()

    for col in ["bestel_aantal","aflever_aantal","prijs","algkort","betkort",
                "beskort","blokkeren","id_art_prijskode"]:
        if col in stat.columns:
            stat[col] = pd.to_numeric(stat[col], errors="coerce").fillna(0)
    for col in ["wens_datum","factuur_datum"]:
        if col in stat.columns:
            stat[col] = pd.to_datetime(stat[col], errors="coerce")

    stat["Factor"]   = stat["id_art_prijskode"].map(FACTOR_MAP).fillna(1).replace(0, 1)
    stat["open_qty"] = stat["bestel_aantal"] - stat["aflever_aantal"]

    unit_val = (
        stat["prijs"]
        - stat.get("algkort", pd.Series(0, index=stat.index)).fillna(0)
        - stat.get("betkort", pd.Series(0, index=stat.index)).fillna(0)
        - stat.get("beskort", pd.Series(0, index=stat.index)).fillna(0)
    )
    stat["line_val"] = unit_val * (stat["open_qty"]        / stat["Factor"])
    stat["rev_line"] = unit_val * (stat["aflever_aantal"]  / stat["Factor"])

    today       = pd.Timestamp.today().normalize()
    month_start = today.replace(day=1)
    not_blocked = stat["blokkeren"].fillna(0) == 0
    is_open     = stat["open_qty"] > 0

    present_val = float(
        stat.loc[is_open & (stat["wens_datum"] <= today) & not_blocked, "line_val"].sum() or 0
    )
    mtd_mask = (
        is_open & not_blocked
        & (stat["bestel_aantal"] > 0)
        & (stat["aflever_aantal"] >= 0)
        & (stat["wens_datum"] <= today)
        & (stat["wens_datum"] >= month_start)
    )
    mtd_open_val    = float(stat.loc[mtd_mask, "line_val"].sum() or 0)
    revenue_mtd_val = float(
        stat.loc[stat["factuur_datum"].dt.month == today.month, "rev_line"].sum() or 0
    )
    projected_mtd = mtd_open_val + revenue_mtd_val

    return "\n".join([
        "// ── Open Order KPIs ──",
        "export const openOrderValueFuture = 273604;",
        f"export const openOrderValuePresent = {round(present_val)};",
        f"export const projectedMTD = {round(projected_mtd)};",
        f"export const turnoverMTD = {round(revenue_mtd_val)};",
        f"export const openOrderValueMTD = {round(mtd_open_val)};",
    ])


# ─── DERIVE invoice_audit_live ────────────────────────────────────────────────

def derive_invoice_audit_live(tables: dict) -> pd.DataFrame:
    if "stat" not in tables:
        raise KeyError("stat.csv is required but not found in the zip.")

    df = tables["stat"].copy()

    if "blokkeren" in df.columns:
        df["blokkeren"] = pd.to_numeric(df["blokkeren"], errors="coerce").fillna(0)
        df = df[df["blokkeren"] == 0].copy()

    for col in ["prijs","algkort","betkort","beskort","bestel_aantal","aflever_aantal"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

    df["factuur_datum"] = pd.to_datetime(df.get("factuur_datum"), errors="coerce")

    for col in ["id_rel__fac","id_art","id_art_prijskode","id_alg_btwkode"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    # ── Customer name ─────────────────────────────────────────────────────────
    if "rel" in tables:
        rel = tables["rel"][["id","naam_volledig"]].copy()
        rel["id"] = pd.to_numeric(rel["id"], errors="coerce")
        rel = rel.rename(columns={"id":"_rel_id","naam_volledig":"customer_name"})
        df = df.merge(rel, left_on="id_rel__fac", right_on="_rel_id", how="left")
    else:
        df["customer_name"] = "Unknown"

    # ── Product + group ───────────────────────────────────────────────────────
    if "art" in tables:
        art = tables["art"][["id","naam_volledig","id_art_artikelgroep"]].copy()
        art["id"]                 = pd.to_numeric(art["id"],                 errors="coerce")
        art["id_art_artikelgroep"]= pd.to_numeric(art["id_art_artikelgroep"],errors="coerce")
        art = art.rename(columns={"id":"_art_id","naam_volledig":"product_name"})
        if "art_artikelgroep" in tables:
            grp = tables["art_artikelgroep"][["id","naam"]].copy()
            grp["id"] = pd.to_numeric(grp["id"], errors="coerce")
            grp = grp.rename(columns={"id":"_grp_id","naam":"product_group"})
            art = art.merge(grp, left_on="id_art_artikelgroep", right_on="_grp_id", how="left")
        else:
            art["product_group"] = "Unknown"
        df = df.merge(art[["_art_id","product_name","product_group"]],
                      left_on="id_art", right_on="_art_id", how="left")
    else:
        df["product_name"]  = "Unknown"
        df["product_group"] = "Unknown"

    # ── Pricing factor ────────────────────────────────────────────────────────
    if "art_prijskode" in tables:
        pk = tables["art_prijskode"][["id","factor"]].copy()
        pk["id"]     = pd.to_numeric(pk["id"],     errors="coerce")
        pk["factor"] = pd.to_numeric(pk["factor"], errors="coerce").fillna(1).replace(0, 1)
        pk = pk.rename(columns={"id":"_pk_id"})
        df = df.merge(pk, left_on="id_art_prijskode", right_on="_pk_id", how="left")
        df["factor"] = df["factor"].fillna(1).replace(0, 1)
    else:
        df["factor"] = 1

    # ── VAT ───────────────────────────────────────────────────────────────────
    if "alg_btwkode" in tables:
        vat = tables["alg_btwkode"][["id","perc"]].copy()
        vat["id"]   = pd.to_numeric(vat["id"],   errors="coerce")
        vat["perc"] = pd.to_numeric(vat["perc"], errors="coerce").fillna(0)
        vat = vat.rename(columns={"id":"_vat_id"})
        df = df.merge(vat, left_on="id_alg_btwkode", right_on="_vat_id", how="left")
        df["perc"] = df["perc"].fillna(0)
    else:
        df["perc"] = 0

    # ── Salesman via rel_v_vert ───────────────────────────────────────────────
    # Priority: 1) ZIP tables["rel_v_vert"]  (date-suffix stripped automatically)
    #           2) static_data/rel_v_vert.csv (fallback for old exports)
    #           3) rel table naam_volledig     (last resort)
    rvv_path = REL_V_VERT_PATH
    if "rel_k_rel__vert" in tables:
        bridge = tables["rel_k_rel__vert"].copy()
        bridge["id_rel"]       = pd.to_numeric(bridge["id_rel"],       errors="coerce")
        bridge["id_rel__vert"] = pd.to_numeric(bridge["id_rel__vert"], errors="coerce")
        bridge = bridge.sort_values("id").groupby("id_rel").first().reset_index()

        if "rel_v_vert" in tables:
            # ← NEW: ZIP export takes priority (rel_v_vert_YYYY-MM-DD.csv)
            rvv = tables["rel_v_vert"].copy()
            rvv["id"] = pd.to_numeric(rvv["id"], errors="coerce")
            rvv = rvv[["id","naam_volledig"]].rename(
                columns={"id":"_rep_id","naam_volledig":"salesman"}
            )
            print("  → Salesman lookup: using rel_v_vert from ZIP")
        elif os.path.exists(rvv_path):
            # ← Fallback: static CSV
            rvv = pd.read_csv(rvv_path)
            rvv["id"] = pd.to_numeric(rvv["id"], errors="coerce")
            rvv = rvv[["id","naam_volledig"]].rename(
                columns={"id":"_rep_id","naam_volledig":"salesman"}
            )
            print("  → Salesman lookup: using static rel_v_vert.csv")
        else:
            # ← Last resort: rel table
            rvv = tables["rel"][["id","naam_volledig"]].copy()
            rvv["id"] = pd.to_numeric(rvv["id"], errors="coerce")
            rvv = rvv.rename(columns={"id":"_rep_id","naam_volledig":"salesman"})
            print("  ⚠ rel_v_vert not in ZIP and static CSV not found — falling back to rel table")

        bridge = bridge.merge(rvv, left_on="id_rel__vert", right_on="_rep_id", how="left")
        df = df.merge(bridge[["id_rel","salesman"]], left_on="id_rel__fac", right_on="id_rel", how="left")
    else:
        df["salesman"] = "Unknown"

    # ── Fill string nulls ─────────────────────────────────────────────────────
    for col in ["customer_name","product_name","product_group","salesman"]:
        df[col] = df[col].fillna("Unknown").astype(str).str.strip()

    # ── Revenue calculation ───────────────────────────────────────────────────
    unit_val = (
        df["prijs"]
        - df.get("algkort", pd.Series(0, index=df.index)).fillna(0)
        - df.get("betkort", pd.Series(0, index=df.index)).fillna(0)
        - df.get("beskort", pd.Series(0, index=df.index)).fillna(0)
    )
    df["line_rev_delivered_excl"] = unit_val * (df["aflever_aantal"] / df["factor"])

    # invoice_total = sum of all line revenues on same invoice (matches Fabric's OVER PARTITION BY factuur_nr)
    if "factuur_nr" in df.columns:
        df["invoice_total_delivered_excl_vat"] = (
            df.groupby("factuur_nr")["line_rev_delivered_excl"].transform("sum")
        )
    else:
        df["invoice_total_delivered_excl_vat"] = df["line_rev_delivered_excl"]

    if "order_nr" not in df.columns:
        df["order_nr"] = range(len(df))

    return df


# ─── PART 3 ──────────────────────────────────────────────────────────────────

def build_part3(df_live: pd.DataFrame) -> str:
    """
    PART3: salesmanCategorySales, tonnagePerSalesman, totalTonnageByCategory.
    Uses invoice_total_delivered_excl_vat grouped by order_nr — matches Fabric exactly.
    """
    df = df_live.copy()
    df["factuur_datum"] = pd.to_datetime(df.get("factuur_datum"), errors="coerce")
    df = df[df["factuur_datum"].notna()].copy()

    df["Factuur_Year"]        = df["factuur_datum"].dt.year.astype(int)
    df["Factuur_Month"]       = df["factuur_datum"].dt.month.astype(int)
    df["Factuur_Month_Label"] = (
        df["factuur_datum"].dt.strftime("%b")
        + " "
        + df["factuur_datum"].dt.strftime("%y")
    )
    df["Factuur_Day"] = df["factuur_datum"].dt.strftime("%Y-%m-%d")
    df["Day_Label"]   = df["factuur_datum"].dt.strftime("%d/%m/%y")
    iso = df["factuur_datum"].dt.isocalendar()
    df["IsoYear"]    = iso["year"].astype("Int64")
    df["IsoWeek"]    = iso["week"].astype("Int64")
    df["Week_Label"] = (
        "W" + df["IsoWeek"].astype(str).str.zfill(2)
        + " " + df["IsoYear"].astype(str).str[-2:]
    )

    for col in ["salesman","product_group"]:
        df[col] = df[col].fillna("").astype(str).str.strip().replace("", "Unknown")

    df["aflever_aantal"]                   = pd.to_numeric(df["aflever_aantal"],                   errors="coerce").fillna(0)
    df["invoice_total_delivered_excl_vat"] = pd.to_numeric(df["invoice_total_delivered_excl_vat"], errors="coerce").fillna(0)

    # Group by order_nr — matches Fabric's method exactly
    grp = (
        df.groupby(["salesman","product_group","Factuur_Year","Factuur_Month","Factuur_Month_Label","order_nr"])
        .agg(qty=("aflever_aantal","sum"), rev=("invoice_total_delivered_excl_vat","sum"))
        .reset_index()
    )
    grp["Factuur_Year"]  = grp["Factuur_Year"].astype(int)
    grp["Factuur_Month"] = grp["Factuur_Month"].astype(int)

    month_pairs = (
        grp[["Factuur_Year","Factuur_Month","Factuur_Month_Label"]]
        .drop_duplicates()
        .sort_values(["Factuur_Year","Factuur_Month"])
        .values.tolist()
    )
    month_order  = [(int(y), int(m)) for y, m, _ in month_pairs]
    month_labels = {(int(y), int(m)): lbl for y, m, lbl in month_pairs}

    scm: dict = defaultdict(lambda: {"rev": 0.0, "qty": 0.0, "orders": set()})
    for _, row in grp.iterrows():
        key = (row["salesman"], row["product_group"], int(row["Factuur_Year"]), int(row["Factuur_Month"]))
        scm[key]["rev"]    += row["rev"]
        scm[key]["qty"]    += row["qty"]
        scm[key]["orders"].add(row["order_nr"])

    sc_keys = sorted({(s, c) for (s, c, y, m) in scm})

    salesmanCategorySales = []
    for s, c in sc_keys:
        tr, tq, to = 0.0, 0.0, set()
        ml = []
        for y, m in month_order:
            k = (s, c, y, m)
            if k in scm:
                d = scm[k]
                qty_v = d["qty"]
                ml.append({
                    "m":      month_labels[(y, m)],
                    "rev":    round(d["rev"]),
                    "qty":    int(qty_v) if qty_v == int(qty_v) else qty_v,
                    "orders": len(d["orders"]),
                })
                tr += d["rev"]; tq += d["qty"]; to |= d["orders"]
        tqi = int(tq) if tq == int(tq) else tq
        salesmanCategorySales.append({
            "salesman": s, "category": c,
            "rev": round(tr), "qty": tqi, "orders": len(to), "monthly": ml,
        })

    # ── Tonnage per salesman ──────────────────────────────────────────────────
    tonnagePerSalesman = []
    for e in salesmanCategorySales:
        if e["category"] not in TONNAGE_CATS:
            continue
        ml = [{"m": md["m"], "tonnage": round(md["qty"] / 1000, 2), "revenue": md["rev"]}
              for md in e["monthly"]]
        tonnagePerSalesman.append({
            "salesman": e["salesman"], "category": e["category"],
            "tonnage":  round(e["qty"] / 1000, 2),
            "revenue":  e["rev"], "orders": e["orders"], "monthly": ml,
        })
    cat_ord = {"Aanvullende Veevoeders": 0, "Melkpoeder": 1, "Veevoeders": 2}
    tonnagePerSalesman.sort(key=lambda x: (cat_ord.get(x["category"], 99), -x["tonnage"]))

    # ── Total tonnage by category ─────────────────────────────────────────────
    cm: dict = defaultdict(lambda: {"rev": 0.0, "qty": 0.0, "orders": set()})
    for _, row in grp.iterrows():
        if row["product_group"] not in TONNAGE_CATS:
            continue
        key = (row["product_group"], int(row["Factuur_Year"]), int(row["Factuur_Month"]))
        cm[key]["rev"] += row["rev"]; cm[key]["qty"] += row["qty"]; cm[key]["orders"].add(row["order_nr"])

    totalTonnageByCategory = []
    for cat in ["Aanvullende Veevoeders", "Melkpoeder", "Veevoeders"]:
        tr, tq, to = 0.0, 0.0, set()
        ml = []
        for y, m in month_order:
            key = (cat, y, m)
            if key in cm:
                d = cm[key]
                ml.append({"m": month_labels[(y, m)], "tonnage": round(d["qty"] / 1000, 2),
                           "revenue": round(d["rev"]), "orders": len(d["orders"])})
                tr += d["rev"]; tq += d["qty"]; to |= d["orders"]
        totalTonnageByCategory.append({
            "category": cat, "tonnage": round(tq / 1000, 2),
            "revenue": round(tr), "orders": len(to), "monthly": ml,
        })

    # ── Daily / weekly tonnage by category ───────────────────────────────────
    df_t = df[df["product_group"].isin(TONNAGE_CATS)].copy()

    live_day = (
        df_t.groupby(["product_group","Factuur_Day","Day_Label"])
        .agg(qty=("aflever_aantal","sum"), rev=("invoice_total_delivered_excl_vat","sum"))
        .reset_index().sort_values(["product_group","Factuur_Day"])
    )
    live_week = (
        df_t.groupby(["product_group","IsoYear","IsoWeek","Week_Label"])
        .agg(qty=("aflever_aantal","sum"), rev=("invoice_total_delivered_excl_vat","sum"))
        .reset_index().sort_values(["product_group","IsoYear","IsoWeek"])
    )

    # ── Assemble JS ───────────────────────────────────────────────────────────
    lines = ["export const salesmanCategorySales = ["]
    for e in salesmanCategorySales:
        ml = ", ".join(
            f"{{m:'{m['m']}',rev:{fn(m['rev'])},qty:{fn(m['qty'])},orders:{m['orders']}}}"
            for m in e["monthly"]
        )
        lines.append(
            f"  {{salesman:'{js_escape(e['salesman'])}',category:'{js_escape(e['category'])}',"
            f"rev:{fn(e['rev'])},qty:{fn(e['qty'])},orders:{e['orders']},monthly:[{ml}]}},"
        )
    lines.append("]\n")

    lines.append("export const tonnagePerSalesman = [")
    for e in tonnagePerSalesman:
        ml = ", ".join(
            f"{{m:'{m['m']}',tonnage:{fn(m['tonnage'])},revenue:{fn(m['revenue'])}}}"
            for m in e["monthly"]
        )
        lines.append(
            f"  {{salesman:'{js_escape(e['salesman'])}',category:'{js_escape(e['category'])}',"
            f"tonnage:{fn(e['tonnage'])},revenue:{fn(e['revenue'])},orders:{e['orders']},monthly:[{ml}]}},"
        )
    lines.append("]\n")

    lines.append("export const totalTonnageByCategory = [")
    for e in totalTonnageByCategory:
        ml = ", ".join(
            f"{{m:'{m['m']}',tonnage:{fn(m['tonnage'])},revenue:{fn(m['revenue'])},orders:{m['orders']}}}"
            for m in e["monthly"]
        )
        lines.append(
            f"  {{category:'{e['category']}',tonnage:{fn(e['tonnage'])},revenue:{fn(e['revenue'])},orders:{e['orders']},monthly:[{ml}]}},"
        )
    lines.append("]\n")

    lines.append("export const tonnageDailyByCategory = [")
    for _, r in live_day.iterrows():
        tv = round((r["qty"] or 0) / 1000, 2)
        lines.append(
            f"  {{category:'{r['product_group']}',d:'{r['Day_Label']}',"
            f"iso:'{r['Factuur_Day']}',tonnage:{fn(tv)},revenue:{round(r['rev'] or 0)}}},"
        )
    lines.append("]\n")

    lines.append("export const tonnageWeeklyByCategory = [")
    for _, r in live_week.iterrows():
        tv = round((r["qty"] or 0) / 1000, 2)
        lines.append(
            f"  {{category:'{r['product_group']}',w:'{r['Week_Label']}',"
            f"tonnage:{fn(tv)},revenue:{round(r['rev'] or 0)}}},"
        )
    lines.append("]")

    return "\n".join(lines)


# ─── PART 4: DEBTOR MANAGEMENT ───────────────────────────────────────────────

def build_part4(tables: dict) -> str:
    """
    PART4: Accounts Receivable / Debtor Management
    Source: fin_boeking WHERE id_gen_fin_boeking_type = 10 (Afnemer)
            joined with rel for customer code + name

    Exports:
      debtorAsOf             – snapshot date string (max AR datum)
      debtorKPI              – single KPI object
      debtorAgeing           – 6-bucket ageing array (0-30/31-60/61-90/91-180/>180/Settled)
      debtorTrendlineCohort  – % still unpaid at >30/>60/>90d, grouped by invoice cohort month
      debtorTrendlineSnapshot– % of open AR >30/>60/>90d old, monthly AR-quality snapshot
      debtorCustomers        – one row per customer with open balance (scorecard + risk)
      debtorOpenItems        – one row per open invoice (for customer drillthrough)
      debtorQuarterlyYearly  – quarterly + yearly payment performance
    """

    _NULL = "\n\n".join([
        "// ── PART 4: Debtor Management — fin_boeking not available ──",
        "export const debtorAsOf = null;",
        "export const debtorKPI = null;",
        "export const debtorAgeing = [];",
        "export const debtorTrendlineCohort = [];",
        "export const debtorTrendlineSnapshot = [];",
        "export const debtorCustomers = [];",
        "export const debtorOpenItems = [];",
        "export const debtorQuarterlyYearly = [];",
    ])

    fb  = tables.get("fin_boeking")
    rel = tables.get("rel")

    if fb is None:
        print("  ⚠ fin_boeking not found — PART4 (Debtors) skipped")
        return _NULL

    # ── Type coercions ────────────────────────────────────────────────────────
    fb = fb.copy()
    fb["datum"]                   = pd.to_datetime(fb["datum"],                   errors="coerce")
    fb["bedrag"]                  = pd.to_numeric(fb["bedrag"],                   errors="coerce").fillna(0)
    fb["id_rel"]                  = pd.to_numeric(fb["id_rel"],                   errors="coerce")
    fb["id_gen_fin_boeking_type"] = pd.to_numeric(fb["id_gen_fin_boeking_type"],  errors="coerce")

    # ── AR filter: type 10 (Afnemer), not reversed, has invoice number ────────
    rec_ok = fb["rec_status"].isna() if "rec_status" in fb.columns else pd.Series(True, index=fb.index)
    ar = fb[
        (fb["id_gen_fin_boeking_type"] == 10)
        & rec_ok
        & fb["factuur_nr"].notna()
    ].copy()

    if ar.empty:
        print("  ⚠ No AR rows (type 10) found — PART4 skipped")
        return _NULL

    # ── Snapshot date = latest AR posting date ────────────────────────────────
    as_of     = ar["datum"].max()
    as_of_str = as_of.strftime("%Y-%m-%d") if pd.notna(as_of) else "Unknown"
    print(f"  → AR snapshot: {as_of_str}  ({len(ar):,} postings)")

    # ── Step 1: per-invoice payment info (from credit postings) ───────────────
    ar_credits = ar[ar["bedrag"] < 0].copy()
    pay_info = (
        ar_credits.groupby(["id_rel", "factuur_nr"])
        .agg(
            first_payment_date=("datum", "min"),
            last_payment_date=("datum",  "max"),
            payment_count=("datum",      "count"),
        )
        .reset_index()
    )

    # ── Step 2: per-invoice invoiced amount (from debit postings) ─────────────
    ar_debits = ar[ar["bedrag"] > 0].copy()
    invoiced_info = (
        ar_debits.groupby(["id_rel", "factuur_nr"])
        .agg(invoiced=("bedrag", "sum"))
        .reset_index()
    )

    # ── Step 3: master invoice-level AR (net open amount) ─────────────────────
    inv = (
        ar.groupby(["id_rel", "factuur_nr"])
        .agg(
            invoice_date=("datum", "min"),
            open_amount=("bedrag", "sum"),
        )
        .reset_index()
    )
    inv = inv.merge(pay_info,      on=["id_rel", "factuur_nr"], how="left")
    inv = inv.merge(invoiced_info, on=["id_rel", "factuur_nr"], how="left")
    inv["invoiced"] = inv["invoiced"].fillna(0)

    # ── Step 4: age and bucket ────────────────────────────────────────────────
    inv["days_outstanding"] = (as_of - inv["invoice_date"]).dt.days.clip(lower=0).fillna(0).astype(int)

    def _bucket(row):
        if abs(row["open_amount"]) < 0.01:
            return "Settled"
        d = row["days_outstanding"]
        if d <= 30:  return "0-30"
        if d <= 60:  return "31-60"
        if d <= 90:  return "61-90"
        if d <= 180: return "91-180"
        return ">180"

    inv["ageing_bucket"] = inv.apply(_bucket, axis=1)

    # ── Step 5: join customer code + name from rel ────────────────────────────
    if rel is not None:
        rel_cols = [c for c in ["id","kode","naam_volledig"] if c in rel.columns]
        rel_c = rel[rel_cols].copy()
        rel_c["id"] = pd.to_numeric(rel_c["id"], errors="coerce")
        rename_map = {"id": "_rel_id"}
        if "kode"          in rel_c.columns: rename_map["kode"]          = "customer_code"
        if "naam_volledig" in rel_c.columns: rename_map["naam_volledig"] = "customer_name"
        rel_c = rel_c.rename(columns=rename_map)
        inv = inv.merge(rel_c, left_on="id_rel", right_on="_rel_id", how="left")
    else:
        inv["customer_code"] = inv["id_rel"].astype(str)
        inv["customer_name"] = "Unknown"

    inv["customer_code"] = inv["customer_code"].fillna("").astype(str).str.strip().replace("", "Unknown")
    inv["customer_name"] = inv["customer_name"].fillna("").astype(str).str.strip().replace("", "Unknown")

    # Non-payer flag (name contains Dutch "does not pay / do not deliver" markers)
    inv["non_payer"] = inv["customer_name"].str.lower().str.contains(
        r"betaalt niet|betaald niet|niet leveren", na=False
    )

    # ── Convenience subset: only invoices with a positive open balance ─────────
    open_inv = inv[inv["open_amount"] > 0.005].copy()

    # ═══════════════════════════════════════════════════════════════════════════
    # Export 1 — debtorKPI
    # ═══════════════════════════════════════════════════════════════════════════
    total_value = float(open_inv["open_amount"].sum())
    over_30_val = float(open_inv.loc[open_inv["days_outstanding"] > 30,  "open_amount"].sum())
    over_90_val = float(open_inv.loc[open_inv["days_outstanding"] > 90,  "open_amount"].sum())
    pct_over_30 = round(over_30_val / total_value * 100, 1) if total_value > 0 else 0.0
    pct_over_90 = round(over_90_val / total_value * 100, 1) if total_value > 0 else 0.0

    kpi_js = (
        f"export const debtorKPI = {{\n"
        f"  asOf:'{as_of_str}',\n"
        f"  totalDebtorValue:{round(total_value)},\n"
        f"  over30:{round(over_30_val)},\n"
        f"  pctOver30:{pct_over_30},\n"
        f"  over90:{round(over_90_val)},\n"
        f"  pctOver90:{pct_over_90},\n"
        f"  openInvoiceCount:{len(open_inv)},\n"
        f"  customerCount:{int(open_inv['id_rel'].nunique())}\n"
        f"}};"
    )

    # ═══════════════════════════════════════════════════════════════════════════
    # Export 2 — debtorAgeing
    # ═══════════════════════════════════════════════════════════════════════════
    bucket_order = ["0-30", "31-60", "61-90", "91-180", ">180", "Settled"]
    ageing_rows  = []
    for b in bucket_order:
        mask = inv["ageing_bucket"] == b
        val  = float(inv.loc[mask, "open_amount"].sum())
        cnt  = int(mask.sum())
        pct  = round(val / total_value * 100, 1) if total_value > 0 and b != "Settled" else 0.0
        ageing_rows.append(f"  {{bucket:'{b}',value:{round(val)},count:{cnt},pct:{pct}}}")
    ageing_js = "export const debtorAgeing = [\n" + ",\n".join(ageing_rows) + "\n];"

    # ═══════════════════════════════════════════════════════════════════════════
    # Export 3a — debtorTrendlineCohort
    # For invoices issued in month M: % of that month's invoiced value still
    # unpaid at >30 / >60 / >90 days past invoice date (at current snapshot).
    # ═══════════════════════════════════════════════════════════════════════════
    inv["_inv_ym"]    = inv["invoice_date"].dt.to_period("M")
    inv["_inv_label"] = inv["invoice_date"].dt.strftime("%b %y")

    cohort_rows = []
    for (ym, label), grp in inv.groupby(["_inv_ym", "_inv_label"]):
        total_inv = float(grp["invoiced"].sum())
        if total_inv < 1.0:
            continue
        # Only open invoices contribute to the "still unpaid" numerator
        open_grp = grp[grp["open_amount"] > 0.005]
        p30 = round(float(open_grp.loc[open_grp["days_outstanding"] > 30,  "invoiced"].sum()) / total_inv * 100, 1)
        p60 = round(float(open_grp.loc[open_grp["days_outstanding"] > 60,  "invoiced"].sum()) / total_inv * 100, 1)
        p90 = round(float(open_grp.loc[open_grp["days_outstanding"] > 90,  "invoiced"].sum()) / total_inv * 100, 1)
        sort_key = str(ym)
        cohort_rows.append((sort_key, f"  {{month:'{js_escape(label)}',pct30:{p30},pct60:{p60},pct90:{p90}}}"))

    cohort_rows.sort(key=lambda x: x[0])
    trendline_cohort_js = (
        "export const debtorTrendlineCohort = [\n"
        + ",\n".join(r[1] for r in cohort_rows)
        + "\n];"
    )

    # ═══════════════════════════════════════════════════════════════════════════
    # Export 3b — debtorTrendlineSnapshot
    # For each calendar month end (last 18 months): of all AR open at that
    # point, what % is >30 / >60 / >90 days old?
    # ═══════════════════════════════════════════════════════════════════════════
    ar["_ar_ym"] = ar["datum"].dt.to_period("M")
    all_months   = sorted(ar["_ar_ym"].dropna().unique())
    snap_months  = all_months[-18:]  # cap at 18 months to keep run time bounded

    snap_rows = []
    for snap_month in snap_months:
        snap_end = snap_month.end_time.normalize()
        ar_snap  = ar[ar["datum"] <= snap_end]
        if ar_snap.empty:
            continue
        inv_snap = (
            ar_snap.groupby(["id_rel", "factuur_nr"])
            .agg(invoice_date=("datum", "min"), open_amount=("bedrag", "sum"))
            .reset_index()
        )
        inv_snap["days"] = (snap_end - inv_snap["invoice_date"]).dt.days.clip(lower=0)
        open_snap = inv_snap[inv_snap["open_amount"] > 0.005]
        total_s   = float(open_snap["open_amount"].sum())
        if total_s < 1.0:
            continue
        p30 = round(float(open_snap.loc[open_snap["days"] > 30,  "open_amount"].sum()) / total_s * 100, 1)
        p60 = round(float(open_snap.loc[open_snap["days"] > 60,  "open_amount"].sum()) / total_s * 100, 1)
        p90 = round(float(open_snap.loc[open_snap["days"] > 90,  "open_amount"].sum()) / total_s * 100, 1)
        label = snap_month.strftime("%b %y")
        snap_rows.append(f"  {{month:'{label}',pct30:{p30},pct60:{p60},pct90:{p90}}}")

    trendline_snapshot_js = (
        "export const debtorTrendlineSnapshot = [\n"
        + ",\n".join(snap_rows)
        + "\n];"
    )

    # ═══════════════════════════════════════════════════════════════════════════
    # Export 4 — debtorCustomers
    # One row per customer that has at least one open invoice.
    # ═══════════════════════════════════════════════════════════════════════════

    # Average days to first payment (across ALL invoices, not just open ones)
    with_payment = inv[inv["first_payment_date"].notna()].copy()
    with_payment["days_to_pay"] = (
        (with_payment["first_payment_date"] - with_payment["invoice_date"]).dt.days.clip(lower=0)
    )
    avg_pay_by_cust = (
        with_payment.groupby("id_rel")["days_to_pay"]
        .mean()
        .round(0)
        .astype(int)
        .rename("avg_days_to_pay")
    )

    # Last payment date per customer
    last_pay_by_cust = (
        inv[inv["last_payment_date"].notna()]
        .groupby("id_rel")["last_payment_date"]
        .max()
        .rename("last_payment")
    )

    # Open invoice summary per customer
    open_cust = (
        open_inv.groupby(["id_rel", "customer_code", "customer_name"])
        .agg(
            open_invoices=("factuur_nr",       "count"),
            open_value=("open_amount",          "sum"),
            oldest_invoice=("invoice_date",     "min"),
            age_of_oldest=("days_outstanding",  "max"),
            non_payer=("non_payer",             "any"),
        )
        .reset_index()
    )

    open_cust = open_cust.merge(avg_pay_by_cust,  on="id_rel", how="left")
    open_cust = open_cust.merge(last_pay_by_cust, on="id_rel", how="left")
    open_cust["avg_days_to_pay"] = open_cust["avg_days_to_pay"].fillna(0).astype(int)

    def _risk(age):
        if age <= 30:  return "A"
        if age <= 60:  return "B"
        if age <= 90:  return "C"
        return "D"

    open_cust["risk"] = open_cust["age_of_oldest"].apply(_risk)
    open_cust = open_cust.sort_values("open_value", ascending=False)

    cust_rows = []
    for _, r in open_cust.iterrows():
        oldest_s   = r["oldest_invoice"].strftime("%Y-%m-%d") if pd.notna(r["oldest_invoice"])  else ""
        last_pay_s = r["last_payment"].strftime("%Y-%m-%d")   if pd.notna(r.get("last_payment")) else ""
        np_flag    = "Y" if r["non_payer"] else "N"
        cust_rows.append(
            f"  {{code:'{js_escape(r['customer_code'])}',name:'{js_escape(r['customer_name'])}',"
            f"openInvoices:{int(r['open_invoices'])},openValue:{round(r['open_value'])},"
            f"avgDaysToPay:{int(r['avg_days_to_pay'])},oldestInvoice:'{oldest_s}',"
            f"ageOfOldest:{int(r['age_of_oldest'])},lastPayment:'{last_pay_s}',"
            f"risk:'{r['risk']}',nonPayer:'{np_flag}'}}"
        )

    customers_js = "export const debtorCustomers = [\n" + ",\n".join(cust_rows) + "\n];"

    # ═══════════════════════════════════════════════════════════════════════════
    # Export 5 — debtorOpenItems
    # One row per open invoice — used for the customer-drillthrough view.
    # ═══════════════════════════════════════════════════════════════════════════
    open_items = open_inv.sort_values(["customer_code", "invoice_date"]).copy()

    item_rows = []
    for _, r in open_items.iterrows():
        inv_date_s = r["invoice_date"].strftime("%Y-%m-%d") if pd.notna(r["invoice_date"]) else ""
        item_rows.append(
            f"  {{code:'{js_escape(r['customer_code'])}',name:'{js_escape(r['customer_name'])}',"
            f"invoiceNr:'{js_escape(str(r['factuur_nr']))}',invoiceDate:'{inv_date_s}',"
            f"openAmount:{round(r['open_amount'])},daysOutstanding:{int(r['days_outstanding'])},"
            f"bucket:'{r['ageing_bucket']}'}}"
        )

    items_js = "export const debtorOpenItems = [\n" + ",\n".join(item_rows) + "\n];"

    # ═══════════════════════════════════════════════════════════════════════════
    # Export 6 — debtorQuarterlyYearly
    # Avg days to first payment + % paid within 30 days, by quarter and year.
    # ═══════════════════════════════════════════════════════════════════════════
    paid_inv = inv[inv["first_payment_date"].notna()].copy()
    paid_inv["days_to_pay"] = (
        (paid_inv["first_payment_date"] - paid_inv["invoice_date"]).dt.days.clip(lower=0)
    )
    paid_inv["_inv_q"] = paid_inv["invoice_date"].dt.to_period("Q")
    paid_inv["_inv_y"] = paid_inv["invoice_date"].dt.year

    qy_rows = []

    # Quarterly rows
    for period, grp in paid_inv.groupby("_inv_q"):
        avg_d = round(float(grp["days_to_pay"].mean()), 1)
        pct30 = round(float((grp["days_to_pay"] <= 30).mean()) * 100, 1)
        cnt   = int(len(grp))
        label = str(period).replace("Q", "-Q")   # "2025Q1" → "2025-Q1"
        sort_key = str(period) + "_Q"
        qy_rows.append((sort_key, f"  {{period:'{label}',type:'Q',avgDays:{avg_d},pct30:{pct30},invoiceCount:{cnt}}}"))

    # Yearly rows
    for year, grp in paid_inv.groupby("_inv_y"):
        avg_d = round(float(grp["days_to_pay"].mean()), 1)
        pct30 = round(float((grp["days_to_pay"] <= 30).mean()) * 100, 1)
        cnt   = int(len(grp))
        sort_key = f"{year}Q5_Y"   # sorts after Q4 for the same year
        qy_rows.append((sort_key, f"  {{period:'{year}',type:'Y',avgDays:{avg_d},pct30:{pct30},invoiceCount:{cnt}}}"))

    qy_rows.sort(key=lambda x: x[0])
    qy_js = "export const debtorQuarterlyYearly = [\n" + ",\n".join(r[1] for r in qy_rows) + "\n];"

    # ── Summary print ─────────────────────────────────────────────────────────
    print(
        f"  → Debtors: {len(open_inv):,} open invoices | "
        f"{int(open_inv['id_rel'].nunique())} customers | "
        f"AR = €{total_value:,.0f}"
    )

    return "\n\n".join([
        "// ── PART 4: Debtor Management ──",
        f"export const debtorAsOf = '{as_of_str}';",
        kpi_js,
        ageing_js,
        trendline_cohort_js,
        trendline_snapshot_js,
        customers_js,
        items_js,
        qy_js,
    ])


# ─── MAIN ────────────────────────────────────────────────────────────────────

def main():
    print("=== DairyTop data.js generator ===\n")

    print("[1/6] Connecting to Google Drive...")
    service = get_drive_service()

    print("[2/6] Downloading latest zip...")
    zip_buf = download_latest_zip(service)

    print("[3/6] Extracting zip...")
    tables = extract_zip(zip_buf)

    print("[4/6] Loading static Excel files...")
    pdf_xlsx = load_static_excel()
    print(f"  → Rows loaded from xlsx: {len(pdf_xlsx)}")

    print("[5/6] Deriving invoice_audit_live...")
    df_live = derive_invoice_audit_live(tables)
    print(f"  → Live rows derived: {len(df_live)}")

    print("[6/6] Building data.js (PART1-4)...")
    part1 = build_part1(pdf_xlsx, df_live)
    part2 = build_part2(tables)
    part3 = build_part3(df_live)
    part4 = build_part4(tables)

    with open(STATIC_JS_PATH, "r", encoding="utf-8") as f:
        static_js = f.read()

    final = (
        f"// Auto-generated on {datetime.now().strftime('%Y-%m-%d %H:%M UTC')}\n"
        "// Do not edit manually — re-run the GitHub Action instead.\n\n"
        + part1   + "\n\n"
        + part2   + "\n\n"
        + part3   + "\n\n"
        + part4   + "\n\n"
        + static_js + "\n"
    )

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        f.write(final)

    print(f"\n✅ Done — {len(final)//1024} KB written to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
