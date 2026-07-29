from datetime import datetime
from sqlalchemy import Column, DateTime, ForeignKey, Integer, Numeric, String, Text
from core.database import Base


class PrintJob(Base):
    __tablename__ = "print_jobs"
    id = Column(Integer, primary_key=True)
    date_time = Column(DateTime, nullable=False, default=datetime.now, index=True)
    service_type = Column(String(20), nullable=False)  # bw|color|scan
    quantity = Column(Integer, nullable=False, default=1)
    unit_price = Column(Numeric(18, 2), nullable=False, default=0)
    total_amount = Column(Numeric(18, 2), nullable=False, default=0)
    notes = Column(Text, default="")
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)


class PrinterCounter(Base):
    __tablename__ = "printer_counters"
    id = Column(Integer, primary_key=True)
    recorded_at = Column(DateTime, nullable=False, default=datetime.now, index=True)
    bw_total = Column(Integer, nullable=False, default=0)
    color_total = Column(Integer, nullable=False, default=0)
    scan_total = Column(Integer, nullable=False, default=0)
    notes = Column(Text, default="")
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
