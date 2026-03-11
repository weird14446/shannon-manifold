from sqlalchemy.orm import Session

from models.theorem import Theorem

DEFAULT_THEOREMS = [
    {
        "title": "Pythagorean Theorem",
        "statement": (
            "In a right-angled triangle, the square of the hypotenuse side "
            "is equal to the sum of squares of the other two sides."
        ),
        "proof_language": "Lean4",
        "is_verified": True,
        "content": "Formalized in Lean4.",
    },
    {
        "title": "Fermat's Last Theorem (n=3)",
        "statement": (
            "There are no positive integers x, y, and z such that "
            "x^3 + y^3 = z^3."
        ),
        "proof_language": "Rocq",
        "is_verified": True,
        "content": "Formalized in Rocq.",
    },
]


def seed_database(db: Session) -> None:
    existing_theorem = db.query(Theorem.id).first()
    if existing_theorem is not None:
        return

    db.add_all(Theorem(**theorem) for theorem in DEFAULT_THEOREMS)
    db.commit()
