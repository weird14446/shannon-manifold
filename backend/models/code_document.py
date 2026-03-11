from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, func

from database import Base


class CodeDocument(Base):
    __tablename__ = "code_documents"

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    title = Column(String(255), nullable=False)
    path = Column(String(512), nullable=True, index=True)
    module_name = Column(String(512), nullable=True, index=True)
    language = Column(String(32), nullable=False, default="Lean4")
    source_kind = Column(String(64), nullable=False, index=True)
    source_ref_id = Column(Integer, nullable=True, index=True)
    summary_text = Column(Text, nullable=False, default="")
    content = Column(Text, nullable=False, default="")
    sha256 = Column(String(64), nullable=False, index=True)
    is_verified = Column(Boolean, nullable=False, default=False)
    metadata_json = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
