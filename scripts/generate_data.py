# =============================================================================
# DairyTop — data.js generator
# Replaces Microsoft Fabric notebook. Runs in GitHub Actions.
# Sources:
#   PART1 → static_data/DT_Portal_Export_*.xlsx  (never changes)
#   PART2 → stat.csv  (from zip on Google Drive)
#   PART3 → derived invoice_audit_live from raw CSVs in zip
# =============================================================================

import os
import io
import json
import zipfile
from datetime import datetime
from collections import defaultdict

import pandas as pd
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

# ─── CONFIG ──────────────────────────────────────────────────────────────────

DRIVE_FOLDER_ID    = os.environ["DRIVE_FOLDER_ID"]
GDRIVE_CREDENTIALS = os.environ["GDRIVE_CREDENTIALS"]

SCRIPTS_DIR     = os.path.dirname(os.path.abspath(__file__))
STATIC_DATA_DIR = os.path.join(SCRIPTS_DIR, "static_data")
OUTPUT_PATH     = os.path.join(SCRIPTS_DIR, "..", "src", "utils", "data.js")

STATIC_XLSX = [
    os.path.join(STATIC_DATA_DIR, "DT_Portal_Export_2025.xlsx"),
    os.path.join(STATIC_DATA_DIR, "DT_Portal_Export_Q1_2026.xlsx"),
]
STATIC_JS_PATH = os.path.join(STATIC_DATA_DIR, "static.js")

TONNAGE_CATS = {"Melkpoeder", "Veevoeders", "Aanvullende Veevoeders"}

FACTOR_MAP = {1: 1, 2: 100, 4: 5, 5: 20, 6: 25}


# ─── GOOGLE DRIVE ────────────────────────────────────────────────────────────

def get_drive_service():
    creds_info = json.loads(GDRIVE_CREDENTIALS)
    creds = service_account.Credentials.from_service_account_info(
        creds_info,
        scopes=["https://www.googleapis.com/auth/drive.readonly"]
    )
    return build("drive", "v3", credentials=creds)


def download_latest_zip(service):
    results = service.files().list(
        q=f"'{DRIVE_FOLDER_ID}' in parents and mimeType='application/zip' and trashed=false",
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
    dl = MediaIoBaseDownload(buf, req)
    done = False
    while not done:
        _, done = dl.next_chunk()
    buf.seek(0)
    return buf


def extract_zip(zip_buf):
    """Return dict of {table_name_lower: DataFrame} for every CSV in the zip."""
    tables = {}
    with zipfile.ZipFile(zip_buf) as zf:
        for name in zf.namelist():
            if not name.endswith(".csv"):
                continue
            tbl = os.path.splitext(os.path.basename(name))[0].lower()
            with zf.open(name) as f:
                try:
                    tables[tbl] = pd.read_csv(f, encoding="utf-8",  low_memory=False)
                except UnicodeDecodeError:
                    tables[tbl] = pd.read_csv(f, encoding="latin-1", low_memory=False)
    print(f"  → Tables extracted: {sorted(tables.keys())}")
    return tables


# ─── HELPERS ─────────────────────────────────────────────────────────────────

def js_escape(v: object) -> str:
    return (
        str(v)
        .replace("\\", "\\\\")
        .replace("'",  "\\'")
        .replace("\n", " ")
        .replace("\r", " ")
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
    """Format number for PART3 JS: drop unnecessary .0"""
    if isinstance(n, float):
        return str(int(n)) if n == int(n) else str(n)
    return str(n)


# ─── PART 1 — Static xlsx → monthly/daily/weekly KPIs ───────────────────────

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

MONTH_NAMES = {1:"Jan",2:"Feb",3:"Mar",4:"Apr",5:"May",6:"Jun",
               7:"Jul",8:"Aug",9:"Sep",10:"Oct",11:"Nov",12:"Dec"}


def load_static_excel() -> pd.DataFrame:
    frames = []
    for path in STATIC_XLSX:
        xls = pd.ExcelFile(path)
        df  = xls.parse(xls.sheet_names[0])
        frames.append(df)
    raw = pd.concat(frames, ignore_index=True)
    raw = raw.rename(columns=XLSX_COL_MAP)

    raw["Revenue"]       = pd.to_numeric(raw["Revenue"],       errors="coerce").fillna(0)
    raw["Aantal"]        = pd.to_numeric(raw["Aantal"],        errors="coerce").fillna(0)
    raw["invoice_month"] = pd.to_numeric(raw["invoice_month"], errors="coerce")
    raw["invoice_year"]  = pd.to_numeric(raw["invoice_year"],  errors="coerce")
    raw = raw.dropna(subset=["invoice_year", "invoice_month"]).copy()
    raw["invoice_year"]  = raw["invoice_year"].astype(int)
    raw["invoice_month"] = raw["invoice_month"].astype(int)

    for col in ["customer_name", "salesman_name", "product_name", "product_group"]:
        raw[col] = raw[col].fillna("Unknown").astype(str).str.strip()

    raw["factuur_datum"] = pd.to_datetime(raw.get("factuur_datum"), errors="coerce")
    return raw


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
    df["iso_year"]   = pd.to_numeric(iso["year"], errors="coerce")
    df["iso_week"]   = pd.to_numeric(iso["week"], errors="coerce")
    df["week_label"] = (
        "W" + df["iso_week"].astype("Int64").astype(str).str.zfill(2)
        + " " + df["iso_year"].astype("Int64").astype(str).str[-2:]
    )
    df["week_start"] = (
        df["factuur_datum"]
        - pd.to_timedelta(df["factuur_datum"].dt.weekday, unit="D")
    ).dt.normalize()
    return df


def build_part1(pdf_src: pd.DataFrame) -> str:
    pdf_src  = _add_time_dims(pdf_src)
    pdf_dated = pdf_src.dropna(subset=["factuur_datum"]).copy()

    # ── Monthly aggregations ──────────────────────────────────────────────────
    monthly = (
        pdf_src.groupby(["invoice_year","invoice_month","month_label"], as_index=False)
        .agg(rev=("Revenue","sum"), orders=("Revenue","size"))
        .sort_values(["invoice_year","invoice_month"])
    )
    salesreps = (
        pdf_src.groupby(["salesman_name","month_label"], as_index=False)
        .agg(rev=("Revenue","sum"), qty=("Aantal","sum"), orders=("Revenue","size"))
        .sort_values("rev", ascending=False)
    )
    customers = (
        pdf_src.groupby(["customer_name","month_label"], as_index=False)
        .agg(rev=("Revenue","sum"), orders=("Revenue","size"))
        .sort_values("rev", ascending=False)
    )
    products = (
        pdf_src.groupby(["product_name","month_label"], as_index=False)
        .agg(rev=("Revenue","sum"), qty=("Aantal","sum"), orders=("Revenue","size"))
        .sort_values("rev", ascending=False)
    )
    categories = (
        pdf_src.groupby(["product_group","month_label"], as_index=False)
        .agg(rev=("Revenue","sum"), orders=("Revenue","size"))
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

    # ── Day / Week (only if dates exist in xlsx) ──────────────────────────────
    if pdf_dated.empty:
        day_week_exports = {k: f"export const {k} = [];" for k in [
            "daily","weekly","salesrepsDaily","salesrepsWeekly",
            "customersDaily","customersWeekly","productsDaily","productsWeekly",
            "categoriesDaily","categoriesWeekly"
        ]}
    else:
        daily = (pdf_dated.groupby(["day_iso","day_label"], as_index=False)
                 .agg(rev=("Revenue","sum"), orders=("Revenue","size")).sort_values("day_iso"))
        weekly = (pdf_dated.groupby(["iso_year","iso_week","week_label"], as_index=False)
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

        day_week_exports = {
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
        day_week_exports["daily"], day_week_exports["weekly"],
        day_week_exports["salesrepsDaily"], day_week_exports["salesrepsWeekly"],
        day_week_exports["customersDaily"], day_week_exports["customersWeekly"],
        day_week_exports["productsDaily"],  day_week_exports["productsWeekly"],
        day_week_exports["categoriesDaily"],day_week_exports["categoriesWeekly"],
        f"export const totalClients = {unique_customers};",
        f"export const lastUpdated = '{datetime.now().strftime('%d/%m/%Y')}';",
        f"export const maxFactuurDatum = '{mfd_s}';",
    ])


# ─── PART 2 — Open Order KPIs (from stat.csv in zip) ────────────────────────

def build_part2(tables: dict) -> str:
    stat = tables.get("stat")
    if stat is None:
        print("  ⚠ stat.csv not found — PART2 will use zeroes")
        return "\n".join([
            "// ── Open Order KPIs ──",
            "export const openOrderValueFuture = 273604;",
            "export const openOrderValuePresent = 0;",
            "export const projectedMTD = 0;",
            "export const turnoverMTD = 0;",
            "export const openOrderValueMTD = 0;",
        ])

    stat = stat.copy()

    # Numeric coerce
    for col in ["bestel_aantal","aflever_aantal","prijs","algkort","betkort","beskort","blokkeren","id_art_prijskode"]:
        if col in stat.columns:
            stat[col] = pd.to_numeric(stat[col], errors="coerce").fillna(0)
    for col in ["wens_datum","factuur_datum"]:
        if col in stat.columns:
            stat[col] = pd.to_datetime(stat[col], errors="coerce")

    stat["Factor"] = stat["id_art_prijskode"].map(FACTOR_MAP).fillna(1).replace(0, 1)
    stat["open_qty"] = stat["bestel_aantal"] - stat["aflever_aantal"]

    unit_val = (
        stat["prijs"]
        - stat.get("algkort", pd.Series(0, index=stat.index)).fillna(0)
        - stat.get("betkort", pd.Series(0, index=stat.index)).fillna(0)
        - stat.get("beskort", pd.Series(0, index=stat.index)).fillna(0)
    )
    stat["line_val"] = unit_val * (stat["open_qty"] / stat["Factor"])
    stat["rev_line"] = unit_val * (stat["aflever_aantal"] / stat["Factor"])

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
    projected_mtd   = mtd_open_val + revenue_mtd_val

    return "\n".join([
        "// ── Open Order KPIs ──",
        "export const openOrderValueFuture = 273604;",
        f"export const openOrderValuePresent = {round(present_val)};",
        f"export const projectedMTD = {round(projected_mtd)};",
        f"export const turnoverMTD = {round(revenue_mtd_val)};",
        f"export const openOrderValueMTD = {round(mtd_open_val)};",
    ])


# ─── DERIVE invoice_audit_live from raw CSVs ─────────────────────────────────

def _safe_numeric_id(df: pd.DataFrame, col: str) -> pd.DataFrame:
    if col in df.columns:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    return df


def derive_invoice_audit_live(tables: dict) -> pd.DataFrame:
    """Replicate the Invoice_Audit_live SparkSQL query in pandas."""
    if "stat" not in tables:
        raise KeyError("stat.csv is required but not found in the zip.")

    df = tables["stat"].copy()

    # Filter blocked
    if "blokkeren" in df.columns:
        df["blokkeren"] = pd.to_numeric(df["blokkeren"], errors="coerce").fillna(0)
        df = df[df["blokkeren"] == 0].copy()

    for col in ["prijs","algkort","betkort","beskort","bestel_aantal","aflever_aantal"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

    df["factuur_datum"] = pd.to_datetime(df.get("factuur_datum"), errors="coerce")
    df = _safe_numeric_id(df, "id_rel__fac")
    df = _safe_numeric_id(df, "id_art")
    df = _safe_numeric_id(df, "id_art_prijskode")
    df = _safe_numeric_id(df, "id_alg_btwkode")

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
        art["id"] = pd.to_numeric(art["id"], errors="coerce")
        art["id_art_artikelgroep"] = pd.to_numeric(art["id_art_artikelgroep"], errors="coerce")
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
        pk["id"] = pd.to_numeric(pk["id"], errors="coerce")
        pk["factor"] = pd.to_numeric(pk["factor"], errors="coerce").fillna(1).replace(0, 1)
        pk = pk.rename(columns={"id":"_pk_id"})
        df = df.merge(pk, left_on="id_art_prijskode", right_on="_pk_id", how="left")
        df["factor"] = df["factor"].fillna(1).replace(0, 1)
    else:
        df["factor"] = 1

    # ── VAT ───────────────────────────────────────────────────────────────────
    if "alg_btwkode" in tables:
        vat = tables["alg_btwkode"][["id","perc"]].copy()
        vat["id"] = pd.to_numeric(vat["id"], errors="coerce")
        vat["perc"] = pd.to_numeric(vat["perc"], errors="coerce").fillna(0)
        vat = vat.rename(columns={"id":"_vat_id"})
        df = df.merge(vat, left_on="id_alg_btwkode", right_on="_vat_id", how="left")
        df["perc"] = df["perc"].fillna(0)
    else:
        df["perc"] = 0

    # ── Salesman via bridge ───────────────────────────────────────────────────
    if "rel_k_rel__vert" in tables and "rel_v_vert" in tables:
        rkr = tables["rel_k_rel__vert"].copy()
        rkr["id"]         = pd.to_numeric(rkr["id"],         errors="coerce")
        rkr["id_rel"]     = pd.to_numeric(rkr["id_rel"],     errors="coerce")
        rkr["id_rel__vert"] = pd.to_numeric(rkr["id_rel__vert"], errors="coerce")
        # First row per customer (lowest id = original logic)
        bridge = (rkr.sort_values("id")
                     .groupby("id_rel")
                     .first()
                     .reset_index()[["id_rel","id_rel__vert"]])

        rep = tables["rel_v_vert"][["id","naam_volledig"]].copy()
        rep["id"] = pd.to_numeric(rep["id"], errors="coerce")
        rep = rep.rename(columns={"id":"_rep_id","naam_volledig":"salesman"})

        df = df.merge(bridge, left_on="id_rel__fac", right_on="id_rel", how="left")
        df = df.merge(rep,    left_on="id_rel__vert", right_on="_rep_id", how="left")
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

    # Invoice-level total (replicates OVER(PARTITION BY factuur_nr))
    if "factuur_nr" in df.columns:
        df["invoice_total_delivered_excl_vat"] = (
            df.groupby("factuur_nr")["line_rev_delivered_excl"].transform("sum")
        )
    else:
        df["invoice_total_delivered_excl_vat"] = df["line_rev_delivered_excl"]

    if "order_nr" not in df.columns:
        df["order_nr"] = range(len(df))

    return df


# ─── PART 3 — Tonnage / salesman-category (from derived invoice_audit_live) ──

def build_part3(df_live: pd.DataFrame) -> str:
    df = df_live.copy()
    df["factuur_datum"] = pd.to_datetime(df.get("factuur_datum"), errors="coerce")
    df = df[df["factuur_datum"].notna()].copy()

    df["Factuur_Year"]        = df["factuur_datum"].dt.year.astype(int)
    df["Factuur_Month"]       = df["factuur_datum"].dt.month.astype(int)
    df["Factuur_Month_Label"] = df["factuur_datum"].dt.strftime("%b") + " " + df["factuur_datum"].dt.strftime("%y")
    df["Factuur_Day"]         = df["factuur_datum"].dt.strftime("%Y-%m-%d")
    df["Day_Label"]           = df["factuur_datum"].dt.strftime("%d/%m/%y")
    iso = df["factuur_datum"].dt.isocalendar()
    df["IsoYear"]     = iso["year"].astype("Int64")
    df["IsoWeek"]     = iso["week"].astype("Int64")
    df["Week_Label"]  = "W" + df["IsoWeek"].astype(str).str.zfill(2) + " " + df["IsoYear"].astype(str).str[-2:]

    for col in ["salesman","product_group"]:
        df[col] = df[col].fillna("").astype(str).str.strip().replace("", "Unknown")
    df["aflever_aantal"]                  = pd.to_numeric(df["aflever_aantal"], errors="coerce").fillna(0)
    df["invoice_total_delivered_excl_vat"] = pd.to_numeric(df["invoice_total_delivered_excl_vat"], errors="coerce").fillna(0)

    # Group by salesman / category / year / month / order_nr
    grp = (
        df.groupby(["salesman","product_group","Factuur_Year","Factuur_Month","Factuur_Month_Label","order_nr"])
        .agg(qty=("aflever_aantal","sum"), rev=("invoice_total_delivered_excl_vat","sum"))
        .reset_index()
    )
    grp["Factuur_Year"]  = grp["Factuur_Year"].astype(int)
    grp["Factuur_Month"] = grp["Factuur_Month"].astype(int)

    # Month order for consistent series
    month_pairs = (
        grp[["Factuur_Year","Factuur_Month","Factuur_Month_Label"]]
        .drop_duplicates()
        .sort_values(["Factuur_Year","Factuur_Month"])
        .values.tolist()
    )
    month_order  = [(int(y), int(m)) for y, m, _ in month_pairs]
    month_labels = {(int(y), int(m)): lbl for y, m, lbl in month_pairs}

    # Salesman × category × month accumulator
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
                ml.append({"m": month_labels[(y,m)], "rev": round(d["rev"]),
                            "qty": int(qty_v) if qty_v == int(qty_v) else qty_v,
                            "orders": len(d["orders"])})
                tr += d["rev"]; tq += d["qty"]; to |= d["orders"]
        tqi = int(tq) if tq == int(tq) else tq
        salesmanCategorySales.append({"salesman":s,"category":c,"rev":round(tr),"qty":tqi,"orders":len(to),"monthly":ml})

    # Tonnage per salesman
    tonnagePerSalesman = []
    for e in salesmanCategorySales:
        if e["category"] not in TONNAGE_CATS:
            continue
        ml = [{"m": md["m"], "tonnage": round(md["qty"]/1000, 2), "revenue": md["rev"]} for md in e["monthly"]]
        tonnagePerSalesman.append({
            "salesman": e["salesman"], "category": e["category"],
            "tonnage": round(e["qty"]/1000, 2), "revenue": e["rev"],
            "orders": e["orders"], "monthly": ml
        })
    cat_ord = {"Aanvullende Veevoeders": 0, "Melkpoeder": 1, "Veevoeders": 2}
    tonnagePerSalesman.sort(key=lambda x: (cat_ord.get(x["category"], 99), -x["tonnage"]))

    # Total tonnage by category
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
                ml.append({"m": month_labels[(y,m)], "tonnage": round(d["qty"]/1000,2),
                            "revenue": round(d["rev"]), "orders": len(d["orders"])})
                tr += d["rev"]; tq += d["qty"]; to |= d["orders"]
        totalTonnageByCategory.append({"category":cat,"tonnage":round(tq/1000,2),"revenue":round(tr),"orders":len(to),"monthly":ml})

    # ── Assemble JS ───────────────────────────────────────────────────────────
    lines = ["export const salesmanCategorySales = ["]
    for e in salesmanCategorySales:
        ml = ", ".join(f"{{m:'{m['m']}',rev:{fn(m['rev'])},qty:{fn(m['qty'])},orders:{m['orders']}}}" for m in e["monthly"])
        lines.append(f"  {{salesman:'{js_escape(e['salesman'])}',category:'{js_escape(e['category'])}',rev:{fn(e['rev'])},qty:{fn(e['qty'])},orders:{e['orders']},monthly:[{ml}]}},")
    lines.append("]\n")

    lines.append("export const tonnagePerSalesman = [")
    for e in tonnagePerSalesman:
        ml = ", ".join(f"{{m:'{m['m']}',tonnage:{fn(m['tonnage'])},revenue:{fn(m['revenue'])}}}" for m in e["monthly"])
        lines.append(f"  {{salesman:'{js_escape(e['salesman'])}',category:'{js_escape(e['category'])}',tonnage:{fn(e['tonnage'])},revenue:{fn(e['revenue'])},orders:{e['orders']},monthly:[{ml}]}},")
    lines.append("]\n")

    lines.append("export const totalTonnageByCategory = [")
    for e in totalTonnageByCategory:
        ml = ", ".join(f"{{m:'{m['m']}',tonnage:{fn(m['tonnage'])},revenue:{fn(m['revenue'])},orders:{m['orders']}}}" for m in e["monthly"])
        lines.append(f"  {{category:'{e['category']}',tonnage:{fn(e['tonnage'])},revenue:{fn(e['revenue'])},orders:{e['orders']},monthly:[{ml}]}},")
    lines.append("]")

    # Daily / weekly tonnage by category
    df_t = df[df["product_group"].isin(TONNAGE_CATS)].copy()

    live_day = (df_t.groupby(["product_group","Factuur_Day","Day_Label"])
                .agg(qty=("aflever_aantal","sum"), rev=("invoice_total_delivered_excl_vat","sum"))
                .reset_index().sort_values(["product_group","Factuur_Day"]))
    lines.append("\nexport const tonnageDailyByCategory = [")
    for _, r in live_day.iterrows():
        tv = round((r["qty"] or 0)/1000, 2)
        lines.append(f"  {{category:'{r['product_group']}',d:'{r['Day_Label']}',iso:'{r['Factuur_Day']}',tonnage:{fn(tv)},revenue:{round(r['rev'] or 0)}}},")
    lines.append("]\n")

    live_week = (df_t.groupby(["product_group","IsoYear","IsoWeek","Week_Label"])
                 .agg(qty=("aflever_aantal","sum"), rev=("invoice_total_delivered_excl_vat","sum"))
                 .reset_index().sort_values(["product_group","IsoYear","IsoWeek"]))
    lines.append("export const tonnageWeeklyByCategory = [")
    for _, r in live_week.iterrows():
        tv = round((r["qty"] or 0)/1000, 2)
        lines.append(f"  {{category:'{r['product_group']}',w:'{r['Week_Label']}',tonnage:{fn(tv)},revenue:{round(r['rev'] or 0)}}},")
    lines.append("]")

    return "\n".join(lines)


# ─── MAIN ─────────────────────────────────────────────────────────────────────

def main():
    print("=== DairyTop data.js generator ===\n")

    print("[1/6] Connecting to Google Drive...")
    service = get_drive_service()

    print("[2/6] Downloading latest zip...")
    zip_buf = download_latest_zip(service)

    print("[3/6] Extracting zip...")
    tables = extract_zip(zip_buf)

    print("[4/6] Loading static Excel files...")
    pdf_src = load_static_excel()
    print(f"  → Rows loaded: {len(pdf_src)}")

    print("[5/6] Deriving invoice_audit_live from raw CSVs...")
    df_live = derive_invoice_audit_live(tables)
    print(f"  → Rows derived: {len(df_live)}")

    print("[6/6] Building data.js...")
    part1 = build_part1(pdf_src)
    part2 = build_part2(tables)
    part3 = build_part3(df_live)

    with open(STATIC_JS_PATH, "r", encoding="utf-8") as f:
        static_js = f.read()

    final = (
        f"// Auto-generated on {datetime.now().strftime('%Y-%m-%d %H:%M UTC')}\n"
        "// Do not edit manually — re-run the GitHub Action instead.\n\n"
        + part1   + "\n\n"
        + part2   + "\n\n"
        + part3   + "\n\n"
        + static_js + "\n"
    )

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        f.write(final)

    print(f"\n✅ Done — {len(final)//1024} KB written to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()