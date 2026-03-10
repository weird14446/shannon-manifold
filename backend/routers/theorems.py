from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Optional

router = APIRouter(prefix="/theorems", tags=["theorems"])

class TheoremResponse(BaseModel):
    id: int
    title: str
    statement: str
    proof_language: str
    is_verified: bool

    class Config:
        from_attributes = True

# Mock data
MOCK_THEOREMS = [
    {
        "id": 1,
        "title": "Pythagorean Theorem",
        "statement": "In a right-angled triangle, the square of the hypotenuse side is equal to the sum of squares of the other two sides.",
        "proof_language": "Lean4",
        "is_verified": True
    },
    {
        "id": 2,
        "title": "Fermat's Last Theorem (n=3)",
        "statement": "There are no positive integers x, y, and z such that x^3 + y^3 = z^3.",
        "proof_language": "Rocq",
        "is_verified": True
    }
]

@router.get("/", response_model=List[TheoremResponse])
async def get_theorems():
    return MOCK_THEOREMS
