"""api/routes/categories.py"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from core.database import get_db
from core.security import get_current_user
from models.product import Category
from api.schemas import CategoryCreate, CategoryOut

router = APIRouter()

@router.get("", response_model=List[CategoryOut])
def list_categories(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return db.query(Category).order_by(Category.name).all()

@router.post("", response_model=CategoryOut, status_code=201)
def create_category(body: CategoryCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    c = Category(**body.model_dump())
    db.add(c)
    db.commit()
    db.refresh(c)
    return c

@router.put("/{cid}", response_model=CategoryOut)
def update_category(cid: int, body: CategoryCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    c = db.query(Category).filter(Category.id == cid).first()
    if not c: raise HTTPException(404, "Catégorie non trouvée")
    c.name = body.name
    c.description = body.description
    db.commit()
    return c

@router.delete("/{cid}")
def delete_category(cid: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    c = db.query(Category).filter(Category.id == cid).first()
    if not c: raise HTTPException(404, "Catégorie non trouvée")
    db.delete(c)
    db.commit()
    return {"ok": True}
