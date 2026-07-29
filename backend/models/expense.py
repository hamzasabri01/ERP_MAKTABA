"""models/expense.py"""
from sqlalchemy import Column, Integer, String, Numeric, DateTime, Text, ForeignKey
from datetime import datetime
from core.database import Base


class Expense(Base):
    __tablename__ = "expenses"
    id             = Column(Integer, primary_key=True, autoincrement=True)
    date           = Column(DateTime, default=datetime.now, nullable=False)
    category       = Column(String(100), default="Général")
    description    = Column(String(255), nullable=False)
    amount         = Column(Numeric(18, 2), default=0, nullable=False)
    payment_method = Column(String(50), default="Espèce")
    reference      = Column(String(100), default="")
    notes          = Column(Text, default="")
    user_id        = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at     = Column(DateTime, default=datetime.now)

    CATEGORIES = [
        "Loyer", "Salaires", "Fournitures", "Transport",
        "Marketing", "Maintenance", "Taxes & Impôts",
        "Énergie (eau/élec)", "Communication",
        "Papier impression", "Toner / Encre", "Maintenance imprimante", "Autre",
    ]
