from sqlalchemy import Column, Integer, String, Text, Boolean
from sqlalchemy.orm import declarative_base

Base = declarative_base()

class Theorem(Base):
    __tablename__ = "theorems"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, index=True)
    statement = Column(Text)
    proof_language = Column(String) # e.g., 'Lean4', 'Rocq'
    is_verified = Column(Boolean, default=False)
    content = Column(Text) # The actual proof or notes
