from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, func

from database import Base


class CodeChunk(Base):
    __tablename__ = "code_chunks"

    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("code_documents.id"), nullable=False, index=True)
    owner_id = Column(Integer, nullable=True, index=True)
    vector_id = Column(String(128), nullable=False, unique=True, index=True)
    chunk_index = Column(Integer, nullable=False)
    chunk_kind = Column(String(32), nullable=False, default="module")
    symbol_name = Column(String(255), nullable=True, index=True)
    start_line = Column(Integer, nullable=False, default=1)
    end_line = Column(Integer, nullable=False, default=1)
    chunk_text = Column(Text, nullable=False, default="")
    search_text = Column(Text, nullable=False, default="")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
