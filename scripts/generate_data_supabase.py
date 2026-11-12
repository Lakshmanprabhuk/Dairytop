# =============================================================================
# DairyTop — Supabase data writer (TRIAL / PARALLEL)
# Reads the same Google Drive data as generate_data.py but writes to Supabase
# instead of data.js.  Does NOT touch data.js or the git repo at all.
#
# Run: python scripts/generate_data_supabase.py
# Requires env vars (or .env):
#   DRIVE_FOLDER_ID, GDRIVE_CREDENTIALS_FILE, SUPABASE_URL, SUPABASE_SERVICE_KEY
#
# Table: public.data_snapshots  (key TEXT PK, data JSONB, updated_at TIMESTAMPTZ)
# =============================================================================

import os
import re
import io
import json
import zipfile
from datetime import datetime
from collections import defaultdict

import pandas as pd
from dotenv import load_dotenv
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

load_dotenv()

# ─── CONFIG ──────────────────────────────────────────────────────────────────
DRIVE_FOLDER_ID    = os.environ["DRIVE_FOLDER_ID"]
SUPABASE_URL       = os.environ["SUPABASE_URL"]       # https://xxxx.supabase.co
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

SCRIPTS_DIR     = os.path.dirname(os.path.abspath(__file__))
STATIC_DATA_DIR = os.path.join(SCRIPTS_DIR, "static_data")
STATIC_XLSX = [
    os.path.join(STATIC_DATA_DIR, "DT_Portal_Export_2025.xlsx"),
    os.path.join(STATIC_DATA_DIR, "DT_Portal_Export_Q1_2026.xlsx"),
]
REL_V_VERT_PATH = os.path.join(STATIC_DATA_DIR, "rel_v_vert.csv")

TONNAGE_CATS = {"Melkpoeder", "Veevoeders", "Aanvullende Veevoeders"}
FACTOR_MAP   = {1: 1, 2: 100, 4: 5, 5: 20, 6: 25}

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
    creds_file = os.path.join(SCRIPTS_DIR, os.environ["GDRIVE_CREDENTIALS_FILE"])
    with open(creds_file) as f:
        creds_info = json.load(f)
    creds = service_account.Credentials.from_service_account_info(
        creds_info, scopes=["https://www.googleapis.com/auth/drive.readonly"])
    return build("drive", "v3", credentials=creds)

def download_latest_zip(service):
    results = service.files().list(
        q=f"'{DRIVE_FOLDER_ID}' in parents and (mimeType='application/zip' or name contains '.zip') and trashed=false",
        orderBy="modifiedTime desc", pageSize=1,
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
    with zipfile.ZipFile(zip_buf) as z:
        for name in z.namelist():
            if not name.endswith(".csv"):
                continue
            base = os.path.splitext(os.path.basename(name))[0].lower()
            # Strip date suffix so "stat_2026-10-30" → "stat" (same as generate_data.py)
            tbl = re.sub(r'_\d{4}-\d{2}-\d{2}$', '', base)
            with z.open(name) as f:
                try:
                    tables[tbl] = pd.read_csv(f, encoding="utf-8", low_memory=False)
                except UnicodeDecodeError:
                    try:
                        tables[tbl] = pd.read_csv(f, encoding="latin-1", low_memory=False)
                    except Exception:
                        pass
    print(f"  → Tables extracted: {len(tables)} (keys: {sorted(tables.keys())[:10]}...)")
    return tables

def load_static_excel():
    frames = []
    for path in STATIC_XLSX:
        if not os.path.exists(path):
            continue
        df = pd.read_excel(path, dtype=str)
        df = df.rename(columns={k: v for k, v in XLSX_COL_MAP.items() if k in df.columns})
        frames.append(df)
    if not frames:
        raise FileNotFoundError("No static Excel files found.")
    return pd.concat(frames, ignore_index=True)

# ─── HELPERS ─────────────────────────────────────────────────────────────────
def _add_time_dims(df):
    df = df.copy()
    df["factuur_datum"] = pd.to_datetime(df.get("factuur_datum"), errors="coerce")
    dated = df[df["factuur_datum"].notna()].copy()
    if dated.empty:
        df["day_iso"] = None; df["day_label"] = None
        df["iso_year"] = None; df["iso_week"] = None
        df["week_label"] = None; df["week_start_s"] = None; df["week_end_s"] = None
        return df
    iso = dated["factuur_datum"].dt.isocalendar()
    dated["day_iso"]     = dated["factuur_datum"].dt.strftime("%Y-%m-%d")
    dated["day_label"]   = dated["factuur_datum"].dt.strftime("%d/%m/%y")
    dated["iso_year"]    = iso["year"].astype("Int64")
    dated["iso_week"]    = iso["week"].astype("Int64")
    dated["week_label"]  = "W" + iso["week"].astype(str).str.zfill(2) + " " + iso["year"].astype(str).str[-2:]
    week_start = dated["factuur_datum"] - pd.to_timedelta(dated["factuur_datum"].dt.dayofweek, unit="D")
    dated["week_start_s"] = week_start.dt.strftime("%d/%m/%y")
    dated["week_end_s"]   = (week_start + pd.Timedelta(days=6)).dt.strftime("%d/%m/%y")
    df = df.copy()
    for col in ["day_iso","day_label","iso_year","iso_week","week_label","week_start_s","week_end_s"]:
        df[col] = None
    df.loc[dated.index, [c for c in dated.columns if c in df.columns]] = dated
    return df

def df_to_dicts(df, cols):
    """Convert a DataFrame to a list of dicts with only specified columns."""
    result = []
    for _, row in df.iterrows():
        d = {}
        for key, col in cols:
            v = row.get(col)
            if pd.isna(v) if not isinstance(v, str) else False:
                v = None
            elif isinstance(v, (pd.Int64Dtype, pd.core.arrays.integer._IntegerDtype)):
                v = int(v)
            elif hasattr(v, 'item'):
                v = v.item()
            d[key] = v
        result.append(d)
    return result

# ─── DERIVE LIVE DATA ────────────────────────────────────────────────────────
def derive_invoice_audit_live(tables):
    if "stat" not in tables:
        print("  ⚠ stat.csv not found in zip — live data skipped (only xlsx history will be used)")
        return pd.DataFrame()

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
        art["id"]                  = pd.to_numeric(art["id"],                  errors="coerce")
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
        pk["id"]     = pd.to_numeric(pk["id"],     errors="coerce")
        pk["factor"] = pd.to_numeric(pk["factor"], errors="coerce").fillna(1).replace(0, 1)
        pk = pk.rename(columns={"id":"_pk_id"})
        df = df.merge(pk, left_on="id_art_prijskode", right_on="_pk_id", how="left")
        df["factor"] = df["factor"].fillna(1).replace(0, 1)
    else:
        df["factor"] = 1

    # ── Salesman via rel_v_vert ───────────────────────────────────────────────
    # Priority: 1) ZIP tables["rel_v_vert"]  (date-suffix stripped automatically)
    #           2) static_data/rel_v_vert.csv (fallback for old exports)
    #           3) rel table naam_volledig     (last resort)
    if "rel_k_rel__vert" in tables:
        bridge = tables["rel_k_rel__vert"].copy()
        bridge["id_rel"]       = pd.to_numeric(bridge["id_rel"],       errors="coerce")
        bridge["id_rel__vert"] = pd.to_numeric(bridge["id_rel__vert"], errors="coerce")
        bridge = bridge.sort_values("id").groupby("id_rel").first().reset_index()

        if "rel_v_vert" in tables:
            rvv = tables["rel_v_vert"].copy()
            rvv["id"] = pd.to_numeric(rvv["id"], errors="coerce")
            rvv = rvv[["id","naam_volledig"]].rename(columns={"id":"_rep_id","naam_volledig":"salesman"})
            print("  → Salesman lookup: using rel_v_vert from ZIP")
        elif os.path.exists(REL_V_VERT_PATH):
            rvv = pd.read_csv(REL_V_VERT_PATH)
            rvv["id"] = pd.to_numeric(rvv["id"], errors="coerce")
            rvv = rvv[["id","naam_volledig"]].rename(columns={"id":"_rep_id","naam_volledig":"salesman"})
            print("  → Salesman lookup: using static rel_v_vert.csv")
        else:
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

    # ── Revenue ───────────────────────────────────────────────────────────────
    unit_val = (
        df["prijs"]
        - df.get("algkort", pd.Series(0, index=df.index)).fillna(0)
        - df.get("betkort", pd.Series(0, index=df.index)).fillna(0)
        - df.get("beskort", pd.Series(0, index=df.index)).fillna(0)
    )
    df["line_rev_delivered_excl"] = unit_val * (df["aflever_aantal"] / df["factor"])

    # invoice_total = sum of all line revenues on same invoice
    if "factuur_nr" in df.columns:
        df["invoice_total_delivered_excl_vat"] = (
            df.groupby("factuur_nr")["line_rev_delivered_excl"].transform("sum")
        )
    else:
        df["invoice_total_delivered_excl_vat"] = df["line_rev_delivered_excl"]

    if "order_nr" not in df.columns:
        df["order_nr"] = range(len(df))

    df = df[df["factuur_datum"].notna()].copy()
    print(f"  → Live rows derived: {len(df)}")
    return df

# ─── PART 1: Sales aggregations ──────────────────────────────────────────────
def build_part1_data(pdf_xlsx, df_live):
    src = pdf_xlsx.copy()
    if not df_live.empty:
        live = df_live.rename(columns={
            "salesman": "salesman_name",
            "line_rev_delivered_excl": "Revenue",
        })
        live["Aantal"]        = 0
        live["invoice_month"] = live["factuur_datum"].dt.month
        live["invoice_year"]  = live["factuur_datum"].dt.year
        common = [c for c in src.columns if c in live.columns]
        pdf_src = pd.concat([src, live[common]], ignore_index=True)
    else:
        pdf_src = src

    pdf_src["Revenue"]       = pd.to_numeric(pdf_src["Revenue"],       errors="coerce").fillna(0)
    pdf_src["Aantal"]        = pd.to_numeric(pdf_src["Aantal"],        errors="coerce").fillna(0)
    pdf_src["invoice_month"] = pd.to_numeric(pdf_src["invoice_month"], errors="coerce")
    pdf_src["invoice_year"]  = pd.to_numeric(pdf_src["invoice_year"],  errors="coerce")
    pdf_src = pdf_src.dropna(subset=["invoice_year","invoice_month"]).copy()
    pdf_src["invoice_year"]  = pdf_src["invoice_year"].astype(int)
    pdf_src["invoice_month"] = pdf_src["invoice_month"].astype(int)
    for col in ["customer_name","salesman_name","product_name","product_group"]:
        pdf_src[col] = pdf_src[col].fillna("Unknown").astype(str).str.strip()
    pdf_src["factuur_datum"] = pd.to_datetime(pdf_src.get("factuur_datum"), errors="coerce")
    pdf_src   = _add_time_dims(pdf_src)
    pdf_dated = pdf_src[pdf_src["factuur_datum"].notna()].copy()

    def label(y, m):
        month_abbr = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
        return f"{month_abbr[m-1]} {str(y)[-2:]}"

    monthly = (
        pdf_src.groupby(["invoice_year","invoice_month"], as_index=False)
        .agg(rev=("Revenue","sum"), orders=("Revenue","size"))
        .sort_values(["invoice_year","invoice_month"])
    )
    monthly["month_label"] = monthly.apply(lambda r: label(int(r.invoice_year), int(r.invoice_month)), axis=1)

    salesreps = (
        pdf_src.groupby(["salesman_name","invoice_year","invoice_month"], as_index=False)
        .agg(rev=("Revenue","sum"), qty=("Aantal","sum"), orders=("Revenue","size"))
        .sort_values("rev", ascending=False)
    )
    salesreps["month_label"] = salesreps.apply(lambda r: label(int(r.invoice_year), int(r.invoice_month)), axis=1)

    customers = (
        pdf_src.groupby(["customer_name","invoice_year","invoice_month"], as_index=False)
        .agg(rev=("Revenue","sum"), qty=("Aantal","sum"), orders=("Revenue","size"))
        .sort_values("rev", ascending=False)
    )
    customers["month_label"] = customers.apply(lambda r: label(int(r.invoice_year), int(r.invoice_month)), axis=1)

    products = (
        pdf_src.groupby(["product_name","invoice_year","invoice_month"], as_index=False)
        .agg(rev=("Revenue","sum"), qty=("Aantal","sum"), orders=("Revenue","size"))
        .sort_values("rev", ascending=False)
    )
    products["month_label"] = products.apply(lambda r: label(int(r.invoice_year), int(r.invoice_month)), axis=1)

    categories = (
        pdf_src.groupby(["product_group","invoice_year","invoice_month"], as_index=False)
        .agg(rev=("Revenue","sum"), orders=("Revenue","size"))
        .sort_values("rev", ascending=False)
    )
    categories["month_label"] = categories.apply(lambda r: label(int(r.invoice_year), int(r.invoice_month)), axis=1)

    unique_customers = int(pdf_src["customer_name"].nunique())
    mfd              = pdf_dated["factuur_datum"].max() if not pdf_dated.empty else None
    mfd_s            = mfd.strftime("%d/%m/%Y") if pd.notna(mfd) else "No data"

    # Daily / weekly aggregations (require dated rows)
    daily = pd.DataFrame()
    weekly = pd.DataFrame()
    sr_daily = sr_weekly = cu_daily = cu_weekly = pd.DataFrame()
    pr_daily = pr_weekly = ca_daily = ca_weekly = pd.DataFrame()

    if not pdf_dated.empty:
        daily  = (pdf_dated.groupby(["day_iso","day_label"], as_index=False)
                  .agg(rev=("Revenue","sum"), orders=("Revenue","size")).sort_values("day_iso"))
        weekly = (pdf_dated.groupby(["iso_year","iso_week","week_label","week_start_s","week_end_s"], as_index=False)
                  .agg(rev=("Revenue","sum"), orders=("Revenue","size")).sort_values(["iso_year","iso_week"]))
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

    def safe_rows(df):
        if df.empty:
            return []
        return df.apply(
            lambda r: {k: (int(v) if isinstance(v, (float, pd.Int64Dtype)) and v == int(v)
                           else (None if pd.isna(v) else v))
                       for k, v in r.items()},
            axis=1
        ).tolist()

    def frame_to_list(df):
        if df.empty:
            return []
        out = []
        for _, row in df.iterrows():
            d = {}
            for k, v in row.items():
                if hasattr(v, 'item'):
                    v = v.item()
                if isinstance(v, float) and v == int(v):
                    v = int(v)
                try:
                    if pd.isna(v):
                        v = None
                except Exception:
                    pass
                d[k] = v
            out.append(d)
        return out

    return {
        "monthly":          frame_to_list(monthly[["invoice_year","invoice_month","month_label","rev","orders"]]),
        "salesreps":        frame_to_list(salesreps[["salesman_name","month_label","rev","qty","orders"]]),
        "customers":        frame_to_list(customers[["customer_name","month_label","rev","qty","orders"]]),
        "products":         frame_to_list(products[["product_name","month_label","rev","qty","orders"]]),
        "categories":       frame_to_list(categories[["product_group","month_label","rev","orders"]]),
        "daily":            frame_to_list(daily[["day_label","day_iso","rev","orders"]] if not daily.empty else daily),
        "weekly":           frame_to_list(weekly[["week_label","week_start_s","week_end_s","rev","orders"]] if not weekly.empty else weekly),
        "salesrepsDaily":   frame_to_list(sr_daily[["salesman_name","day_label","day_iso","rev","qty","orders"]] if not sr_daily.empty else sr_daily),
        "salesrepsWeekly":  frame_to_list(sr_weekly[["salesman_name","week_label","rev","qty","orders"]] if not sr_weekly.empty else sr_weekly),
        "customersDaily":   frame_to_list(cu_daily[["customer_name","day_label","day_iso","rev","orders"]] if not cu_daily.empty else cu_daily),
        "customersWeekly":  frame_to_list(cu_weekly[["customer_name","week_label","rev","orders"]] if not cu_weekly.empty else cu_weekly),
        "productsDaily":    frame_to_list(pr_daily[["product_name","day_label","day_iso","rev","qty","orders"]] if not pr_daily.empty else pr_daily),
        "productsWeekly":   frame_to_list(pr_weekly[["product_name","week_label","rev","qty","orders"]] if not pr_weekly.empty else pr_weekly),
        "categoriesDaily":  frame_to_list(ca_daily[["product_group","day_label","day_iso","rev","orders"]] if not ca_daily.empty else ca_daily),
        "categoriesWeekly": frame_to_list(ca_weekly[["product_group","week_label","rev","orders"]] if not ca_weekly.empty else ca_weekly),
        "_kpi_partial": {
            "totalClients":   unique_customers,
            "lastUpdated":    datetime.now().strftime("%d/%m/%Y"),
            "maxFactuurDatum": mfd_s,
        },
    }

# ─── PART 2: Open order KPIs ─────────────────────────────────────────────────
def build_part2_data(tables):
    stat = tables.get("stat")
    if stat is None:
        return {"openOrderValueFuture": 273604, "openOrderValuePresent": 0,
                "projectedMTD": 0, "turnoverMTD": 0, "openOrderValueMTD": 0}
    stat = stat.copy()
    for col in ["bestel_aantal","aflever_aantal","prijs","algkort","betkort","beskort","blokkeren","id_art_prijskode"]:
        if col in stat.columns:
            stat[col] = pd.to_numeric(stat[col], errors="coerce").fillna(0)
    for col in ["wens_datum","factuur_datum"]:
        if col in stat.columns:
            stat[col] = pd.to_datetime(stat[col], errors="coerce")
    stat["Factor"]   = stat["id_art_prijskode"].map(FACTOR_MAP).fillna(1).replace(0, 1)
    stat["open_qty"] = stat["bestel_aantal"] - stat["aflever_aantal"]
    for col in ["algkort","betkort","beskort"]:
        if col not in stat.columns:
            stat[col] = 0
    unit_val        = stat["prijs"] - stat["algkort"].fillna(0) - stat["betkort"].fillna(0) - stat["beskort"].fillna(0)
    stat["line_val"] = unit_val * (stat["open_qty"]       / stat["Factor"])
    stat["rev_line"] = unit_val * (stat["aflever_aantal"] / stat["Factor"])
    today       = pd.Timestamp.today().normalize()
    month_start = today.replace(day=1)
    not_blocked = stat["blokkeren"].fillna(0) == 0
    is_open     = stat["open_qty"] > 0
    present_val = float(stat.loc[is_open & (stat["wens_datum"] <= today) & not_blocked, "line_val"].sum() or 0)
    mtd_mask    = (is_open & not_blocked & (stat["bestel_aantal"] > 0) & (stat["aflever_aantal"] >= 0)
                   & (stat["wens_datum"] <= today) & (stat["wens_datum"] >= month_start))
    mtd_open_val    = float(stat.loc[mtd_mask, "line_val"].sum() or 0)
    revenue_mtd_val = float(stat.loc[stat["factuur_datum"].dt.month == today.month, "rev_line"].sum() or 0)
    return {
        "openOrderValueFuture":  273604,
        "openOrderValuePresent": round(present_val),
        "projectedMTD":          round(mtd_open_val + revenue_mtd_val),
        "turnoverMTD":           round(revenue_mtd_val),
        "openOrderValueMTD":     round(mtd_open_val),
    }

# ─── PART 3: Tonnage / salesman-category ─────────────────────────────────────
def build_part3_data(df_live):
    df = df_live.copy()
    df["factuur_datum"] = pd.to_datetime(df.get("factuur_datum"), errors="coerce")
    df = df[df["factuur_datum"].notna()].copy()
    if df.empty:
        return {
            "salesmanCategorySales": [], "tonnagePerSalesman": [],
            "totalTonnageByCategory": [], "tonnageDailyByCategory": [],
            "tonnageWeeklyByCategory": [],
        }
    df["Factuur_Year"]  = df["factuur_datum"].dt.year.astype(int)
    df["Factuur_Month"] = df["factuur_datum"].dt.month.astype(int)
    df["Factuur_Month_Label"] = df["factuur_datum"].dt.strftime("%b") + " " + df["factuur_datum"].dt.strftime("%y")
    df["Factuur_Day"]  = df["factuur_datum"].dt.strftime("%Y-%m-%d")
    df["Day_Label"]    = df["factuur_datum"].dt.strftime("%d/%m/%y")
    iso = df["factuur_datum"].dt.isocalendar()
    df["IsoYear"]    = iso["year"].astype("Int64")
    df["IsoWeek"]    = iso["week"].astype("Int64")
    df["Week_Label"] = "W" + df["IsoWeek"].astype(str).str.zfill(2) + " " + df["IsoYear"].astype(str).str[-2:]
    for col in ["salesman","product_group"]:
        df[col] = df[col].fillna("").astype(str).str.strip().replace("", "Unknown")
    df["aflever_aantal"]                   = pd.to_numeric(df["aflever_aantal"],                   errors="coerce").fillna(0)
    df["invoice_total_delivered_excl_vat"] = pd.to_numeric(df["invoice_total_delivered_excl_vat"], errors="coerce").fillna(0)

    grp = (
        df.groupby(["salesman","product_group","Factuur_Year","Factuur_Month","Factuur_Month_Label","order_nr"])
        .agg(qty=("aflever_aantal","sum"), rev=("invoice_total_delivered_excl_vat","sum"))
        .reset_index()
    )
    month_pairs  = (grp[["Factuur_Year","Factuur_Month","Factuur_Month_Label"]]
                    .drop_duplicates().sort_values(["Factuur_Year","Factuur_Month"]).values.tolist())
    month_order  = [(int(y), int(m)) for y, m, _ in month_pairs]
    month_labels = {(int(y), int(m)): lbl for y, m, lbl in month_pairs}

    scm = defaultdict(lambda: {"rev": 0.0, "qty": 0.0, "orders": set()})
    for _, row in grp.iterrows():
        key = (row["salesman"], row["product_group"], int(row["Factuur_Year"]), int(row["Factuur_Month"]))
        scm[key]["rev"] += row["rev"]; scm[key]["qty"] += row["qty"]; scm[key]["orders"].add(row["order_nr"])

    sc_keys = sorted({(s, c) for (s, c, y, m) in scm})
    salesmanCategorySales = []
    for s, c in sc_keys:
        tr, tq, to = 0.0, 0.0, set()
        ml = []
        for y, m in month_order:
            k = (s, c, y, m)
            if k in scm:
                d = scm[k]
                ml.append({"m": month_labels[(y, m)], "rev": round(d["rev"]), "qty": round(d["qty"], 2), "orders": len(d["orders"])})
                tr += d["rev"]; tq += d["qty"]; to |= d["orders"]
        salesmanCategorySales.append({"salesman": s, "category": c, "rev": round(tr), "qty": round(tq, 2), "orders": len(to), "monthly": ml})

    tonnagePerSalesman = []
    for e in salesmanCategorySales:
        if e["category"] not in TONNAGE_CATS:
            continue
        ml = [{"m": md["m"], "tonnage": round(md["qty"] / 1000, 2), "revenue": md["rev"]} for md in e["monthly"]]
        tonnagePerSalesman.append({"salesman": e["salesman"], "category": e["category"],
                                    "tonnage": round(e["qty"] / 1000, 2), "revenue": e["rev"],
                                    "orders": e["orders"], "monthly": ml})
    cat_ord = {"Aanvullende Veevoeders": 0, "Melkpoeder": 1, "Veevoeders": 2}
    tonnagePerSalesman.sort(key=lambda x: (cat_ord.get(x["category"], 99), -x["tonnage"]))

    cm = defaultdict(lambda: {"rev": 0.0, "qty": 0.0, "orders": set()})
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
                ml.append({"m": month_labels[(y, m)], "tonnage": round(d["qty"] / 1000, 2), "revenue": round(d["rev"]), "orders": len(d["orders"])})
                tr += d["rev"]; tq += d["qty"]; to |= d["orders"]
        totalTonnageByCategory.append({"category": cat, "tonnage": round(tq / 1000, 2), "revenue": round(tr), "orders": len(to), "monthly": ml})

    df_t     = df[df["product_group"].isin(TONNAGE_CATS)].copy()
    live_day = (df_t.groupby(["product_group","Factuur_Day","Day_Label"])
                .agg(qty=("aflever_aantal","sum"), rev=("invoice_total_delivered_excl_vat","sum"))
                .reset_index().sort_values(["product_group","Factuur_Day"]))
    live_week = (df_t.groupby(["product_group","IsoYear","IsoWeek","Week_Label"])
                 .agg(qty=("aflever_aantal","sum"), rev=("invoice_total_delivered_excl_vat","sum"))
                 .reset_index().sort_values(["product_group","IsoYear","IsoWeek"]))

    tonnageDailyByCategory = [
        {"category": r["product_group"], "d": r["Day_Label"], "iso": r["Factuur_Day"],
         "tonnage": round((r["qty"] or 0) / 1000, 2), "revenue": round(r["rev"] or 0)}
        for _, r in live_day.iterrows()
    ]
    tonnageWeeklyByCategory = [
        {"category": r["product_group"], "w": r["Week_Label"],
         "tonnage": round((r["qty"] or 0) / 1000, 2), "revenue": round(r["rev"] or 0)}
        for _, r in live_week.iterrows()
    ]

    return {
        "salesmanCategorySales":   salesmanCategorySales,
        "tonnagePerSalesman":      tonnagePerSalesman,
        "totalTonnageByCategory":  totalTonnageByCategory,
        "tonnageDailyByCategory":  tonnageDailyByCategory,
        "tonnageWeeklyByCategory": tonnageWeeklyByCategory,
    }

# ─── PART 4: Debtor management ───────────────────────────────────────────────
def build_part4_data(tables):
    null_result = {
        "debtorAsOf": "", "debtorKPI": {}, "debtorAgeing": [],
        "debtorTrendlineCohort": [], "debtorTrendlineSnapshot": [],
        "debtorCustomers": [], "debtorOpenItems": [], "debtorQuarterlyYearly": [],
    }
    fb  = tables.get("fin_boeking")
    rel = tables.get("rel")
    if fb is None:
        print("  ⚠ fin_boeking not found — PART4 (Debtors) skipped")
        return null_result
    fb = fb.copy()
    fb["datum"]                   = pd.to_datetime(fb["datum"],                   errors="coerce")
    fb["bedrag"]                  = pd.to_numeric(fb["bedrag"],                   errors="coerce").fillna(0)
    fb["id_rel"]                  = pd.to_numeric(fb["id_rel"],                   errors="coerce")
    fb["id_gen_fin_boeking_type"] = pd.to_numeric(fb["id_gen_fin_boeking_type"],  errors="coerce")
    rec_ok = fb["rec_status"].isna() if "rec_status" in fb.columns else pd.Series(True, index=fb.index)
    ar = fb[(fb["id_gen_fin_boeking_type"] == 10) & rec_ok & fb["factuur_nr"].notna()].copy()
    if ar.empty:
        print("  ⚠ No AR rows (type 10) found — PART4 skipped")
        return null_result
    as_of     = ar["datum"].max()
    as_of_str = as_of.strftime("%Y-%m-%d") if pd.notna(as_of) else "Unknown"
    print(f"  → AR snapshot: {as_of_str}  ({len(ar):,} postings)")

    # ── Compute debtorKPI natively (mirrors generate_data.py logic) ──────────────
    try:
        inv = (
            ar.groupby(["id_rel", "factuur_nr"])
            .agg(invoice_date=("datum", "min"), open_amount=("bedrag", "sum"))
            .reset_index()
        )
        inv["days_outstanding"] = (
            (as_of - inv["invoice_date"]).dt.days.clip(lower=0).fillna(0).astype(int)
        )
        open_inv = inv[inv["open_amount"] > 0.005].copy()
        total_value = float(open_inv["open_amount"].sum())
        over_30_val = float(open_inv.loc[open_inv["days_outstanding"] > 30, "open_amount"].sum())
        over_90_val = float(open_inv.loc[open_inv["days_outstanding"] > 90, "open_amount"].sum())
        pct_over_30 = round(over_30_val / total_value * 100, 1) if total_value > 0 else 0.0
        pct_over_90 = round(over_90_val / total_value * 100, 1) if total_value > 0 else 0.0
        debtor_kpi = {
            "asOf":               as_of_str,
            "totalDebtorValue":   round(total_value),
            "over30":             round(over_30_val),
            "pctOver30":          pct_over_30,
            "over90":             round(over_90_val),
            "pctOver90":          pct_over_90,
            "openInvoiceCount":   len(open_inv),
            "customerCount":      int(open_inv["id_rel"].nunique()),
        }
        print(f"  → Debtors: {len(open_inv):,} open invoices | "
              f"{int(open_inv['id_rel'].nunique()):,} customers | "
              f"AR = €{round(total_value):,}")
        return {
            "debtorAsOf":              as_of_str,
            "debtorKPI":               debtor_kpi,
            "debtorAgeing":            [],
            "debtorTrendlineCohort":   [],
            "debtorTrendlineSnapshot": [],
            "debtorCustomers":         [],
            "debtorOpenItems":         [],
            "debtorQuarterlyYearly":   [],
        }
    except Exception as e:
        print(f"  ⚠ PART4 KPI computation failed: {e} — using nulls")
        return null_result

# ─── SUPABASE UPSERT ─────────────────────────────────────────────────────────
def supabase_upsert(snapshots: dict):
    """
    Upsert each key→data pair to dairytop.data_snapshots via Supabase REST API.
    Uses the service role key (bypasses RLS).
    """
    import urllib.request
    import urllib.error

    url     = f"{SUPABASE_URL}/rest/v1/data_snapshots"
    headers = {
        "apikey":          SUPABASE_SERVICE_KEY,
        "Authorization":   f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type":    "application/json",
        "Prefer":          "resolution=merge-duplicates",  # ON CONFLICT DO UPDATE
    }
    # Batch all rows in one request (Supabase supports array upsert)
    rows = [
        {"key": k, "data": v}
        for k, v in snapshots.items()
    ]
    body = json.dumps(rows).encode("utf-8")
    req  = urllib.request.Request(
        url + "?on_conflict=key",
        data=body, headers=headers, method="POST"
    )
    # Table is now in public schema — no Accept-Profile / Content-Profile needed
    try:
        with urllib.request.urlopen(req) as resp:
            status = resp.status
            print(f"  → Supabase upsert: HTTP {status}  ({len(rows)} keys)")
    except urllib.error.HTTPError as e:
        body_text = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Supabase upsert failed: HTTP {e.code}  {body_text}")

# ─── MAIN ────────────────────────────────────────────────────────────────────
def main():
    print("=== DairyTop → Supabase writer ===\n")

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

    print("[6/6] Building all datasets...")
    p1 = build_part1_data(pdf_xlsx, df_live)
    p2 = build_part2_data(tables)
    p3 = build_part3_data(df_live)
    p4 = build_part4_data(tables)

    kpi = {**p1.pop("_kpi_partial"), **p2}

    snapshots = {
        # PART 1 arrays
        "monthly":            p1["monthly"],
        "salesreps":          p1["salesreps"],
        "customers":          p1["customers"],
        "products":           p1["products"],
        "categories":         p1["categories"],
        "daily":              p1["daily"],
        "weekly":             p1["weekly"],
        "salesrepsDaily":     p1["salesrepsDaily"],
        "salesrepsWeekly":    p1["salesrepsWeekly"],
        "customersDaily":     p1["customersDaily"],
        "customersWeekly":    p1["customersWeekly"],
        "productsDaily":      p1["productsDaily"],
        "productsWeekly":     p1["productsWeekly"],
        "categoriesDaily":    p1["categoriesDaily"],
        "categoriesWeekly":   p1["categoriesWeekly"],
        # KPI scalars grouped (code.gs destructures with Object.assign)
        "kpi":                kpi,
        # PART 3 tonnage
        "salesmanCategorySales":   p3["salesmanCategorySales"],
        "tonnagePerSalesman":      p3["tonnagePerSalesman"],
        "totalTonnageByCategory":  p3["totalTonnageByCategory"],
        "tonnageDailyByCategory":  p3["tonnageDailyByCategory"],
        "tonnageWeeklyByCategory": p3["tonnageWeeklyByCategory"],
        # PART 4 debtor
        "debtorKPI":               p4["debtorKPI"],
        "debtorAgeing":            p4["debtorAgeing"],
        "debtorTrendlineCohort":   p4["debtorTrendlineCohort"],
        "debtorTrendlineSnapshot": p4["debtorTrendlineSnapshot"],
        "debtorCustomers":         p4["debtorCustomers"],
        "debtorOpenItems":         p4["debtorOpenItems"],
        "debtorQuarterlyYearly":   p4["debtorQuarterlyYearly"],
        "debtorAsOf":              {"value": p4["debtorAsOf"]},
    }

    total_rows = sum(len(v) if isinstance(v, list) else 1 for v in snapshots.values())
    print(f"  → Prepared {len(snapshots)} snapshot keys  (~{total_rows} total data rows)")

    print("\n[→] Upserting to Supabase dairytop.data_snapshots...")
    supabase_upsert(snapshots)

    print(f"\n✅ Done — {len(snapshots)} keys written to Supabase at {datetime.now().strftime('%Y-%m-%d %H:%M')}")

if __name__ == "__main__":
    main()