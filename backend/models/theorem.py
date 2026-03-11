from sqlalchemy import Boolean, Column, Integer, String, Text

from database import Base

class Theorem(Base):
    __tablename__ = "theorems"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), index=True, nullable=False)
    statement = Column(Text, nullable=False)
    proof_language = Column(String(64), nullable=False)  # e.g., 'Lean4', 'Rocq'
    is_verified = Column(Boolean, default=False)
    content = Column(Text)  # The actual proof or notes
