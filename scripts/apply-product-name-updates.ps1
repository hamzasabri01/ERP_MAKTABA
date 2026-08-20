[CmdletBinding()]
param(
  [string]$Database = "",
  [string]$MappingFile = "",
  [switch]$WhatIfOnly
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
if ([string]::IsNullOrWhiteSpace($Database)) {
  $Database = Join-Path $Root "backend\proerp.db"
}
if ([string]::IsNullOrWhiteSpace($MappingFile)) {
  $MappingFile = Join-Path $Root "data\product_name_updates_2026_08.tsv"
}

$RootVenvPython = Join-Path $Root ".venv\Scripts\python.exe"
$BackendVenvPython = Join-Path $Root "backend\venv\Scripts\python.exe"
$Python = if (Test-Path -LiteralPath $RootVenvPython -PathType Leaf) {
  $RootVenvPython
} elseif (Test-Path -LiteralPath $BackendVenvPython -PathType Leaf) {
  $BackendVenvPython
} else {
  "python"
}

if (-not (Test-Path -LiteralPath $Database -PathType Leaf)) {
  throw "Base de donnees introuvable: $Database"
}
if (-not (Test-Path -LiteralPath $MappingFile -PathType Leaf)) {
  throw "Fichier des noms introuvable: $MappingFile"
}

$BackupRoot = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "LibrarySabri\product-name-backups"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupDir = Join-Path $BackupRoot $Stamp
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$BackupDb = Join-Path $BackupDir "proerp-before-product-name-update.db"
$Report = Join-Path $BackupDir "product-name-update-report.json"

$PythonCode = @'
import csv
import json
import sqlite3
import sys
from pathlib import Path

database = Path(sys.argv[1])
mapping_file = Path(sys.argv[2])
backup_db = Path(sys.argv[3])
report_file = Path(sys.argv[4])
dry_run = sys.argv[5] == "1"

rows = []
with mapping_file.open("r", encoding="utf-8-sig", newline="") as stream:
    reader = csv.reader(stream, delimiter="\t")
    for line_no, row in enumerate(reader, start=1):
        if not row or not "".join(row).strip():
            continue
        if len(row) < 2:
            raise SystemExit(f"Ligne {line_no}: code/nom manquant")
        code = str(row[0]).strip()
        name = str(row[1]).strip()
        if not code or not name:
            raise SystemExit(f"Ligne {line_no}: code/nom vide")
        rows.append((code, name))

duplicates = sorted({code for code, _ in rows if [c for c, _n in rows].count(code) > 1})
if duplicates:
    raise SystemExit("Codes dupliques dans le fichier: " + ", ".join(duplicates))

source = sqlite3.connect(str(database))
source.row_factory = sqlite3.Row
try:
    integrity = source.execute("PRAGMA integrity_check").fetchone()[0]
    if integrity != "ok":
        raise SystemExit(f"Integrity check failed before update: {integrity}")
    with sqlite3.connect(str(backup_db)) as backup:
        source.backup(backup)
finally:
    source.close()

conn = sqlite3.connect(str(database))
conn.row_factory = sqlite3.Row
try:
    before = {
        row["code"]: dict(row)
        for row in conn.execute(
            "SELECT code, name, purchase_price, sale_price, stock_quantity, min_stock, barcode, product_type, is_active FROM products"
        )
    }
    updated = []
    unchanged = []
    missing = []
    for code, new_name in rows:
        product = before.get(code)
        if not product:
            missing.append({"code": code, "new_name": new_name})
            continue
        if str(product["name"] or "") == new_name:
            unchanged.append({"code": code, "name": new_name})
            continue
        updated.append({"code": code, "old_name": product["name"], "new_name": new_name})

    if not dry_run:
        conn.execute("BEGIN IMMEDIATE")
        for item in updated:
            conn.execute(
                "UPDATE products SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE code = ?",
                (item["new_name"], item["code"]),
            )
        after = {
            row["code"]: dict(row)
            for row in conn.execute(
                "SELECT code, name, purchase_price, sale_price, stock_quantity, min_stock, barcode, product_type, is_active FROM products"
            )
        }
        protected_columns = ["purchase_price", "sale_price", "stock_quantity", "min_stock", "barcode", "product_type", "is_active"]
        violations = []
        for code, old in before.items():
            new = after.get(code)
            if not new:
                violations.append({"code": code, "error": "product disappeared"})
                continue
            for column in protected_columns:
                if str(old[column]) != str(new[column]):
                    violations.append({"code": code, "column": column, "before": old[column], "after": new[column]})
        if violations:
            conn.rollback()
            raise SystemExit("Protection failed: non-name product data changed: " + json.dumps(violations, ensure_ascii=False))
        conn.commit()

    report = {
        "dry_run": dry_run,
        "database": str(database),
        "backup": str(backup_db),
        "mapping_file": str(mapping_file),
        "requested": len(rows),
        "updated": len(updated),
        "unchanged": len(unchanged),
        "missing": len(missing),
        "updated_items": updated,
        "missing_items": missing,
    }
    report_file.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: report[k] for k in ["requested", "updated", "unchanged", "missing", "backup"]}, ensure_ascii=False))
finally:
    conn.close()
'@

$TempScript = Join-Path $BackupDir "apply-product-name-updates.py"
[IO.File]::WriteAllText($TempScript, $PythonCode, [Text.UTF8Encoding]::new($false))

$Dry = if ($WhatIfOnly) { "1" } else { "0" }
& $Python $TempScript $Database $MappingFile $BackupDb $Report $Dry
if ($LASTEXITCODE -ne 0) {
  throw "La mise a jour des noms a echoue. Backup: $BackupDir"
}

Write-Host "[OK] Noms produits traites. Rapport: $Report" -ForegroundColor Green
if ($WhatIfOnly) {
  Write-Host "[INFO] Mode test seulement: aucun nom n'a ete modifie." -ForegroundColor Yellow
}
