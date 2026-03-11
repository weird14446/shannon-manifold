from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session
from typing import List

from database import get_db
from models.theorem import Theorem

router = APIRouter(prefix="/theorems", tags=["theorems"])

class TheoremResponse(BaseModel):
    id: int
    title: str
    statement: str
    proof_language: str
    is_verified: bool

    model_config = ConfigDict(from_attributes=True)

@router.get("/", response_model=List[TheoremResponse])
async def get_theorems(db: Session = Depends(get_db)):
    return db.query(Theorem).order_by(Theorem.id.asc()).all()
