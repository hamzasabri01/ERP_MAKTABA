"""api/routes/system.py"""
from pathlib import Path
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from core.config import BASE_DIR
from core.database import DB_PATH, get_db
from core.security import get_current_user

router = APIRouter()


@router.get("/health")
def system_health(db: Session = Depends(get_db), user=Depends(get_current_user)):
    tables = {}
    for table in ["products", "sales", "purchases", "clients", "suppliers", "stock_movements", "payments"]:
        try:
            tables[table] = db.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar() or 0
        except Exception:
            tables[table] = None

    db_file = Path(DB_PATH)
    backup_dir = BASE_DIR / "backups"
    return {
        "status": "ok",
        "database_path": str(db_file),
        "database_size_mb": round(db_file.stat().st_size / 1024 / 1024, 2) if db_file.exists() else 0,
        "backup_count": len(list(backup_dir.glob("*.zip"))) if backup_dir.exists() else 0,
        "tables": tables,
    }
