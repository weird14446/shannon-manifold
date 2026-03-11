from sqlalchemy.orm import Session

from models.theorem import Theorem


def seed_database(db: Session) -> None:
    # Legacy theorem demos are no longer used. The dashboard now surfaces uploaded proofs.
    db.query(Theorem).delete()
    db.commit()
