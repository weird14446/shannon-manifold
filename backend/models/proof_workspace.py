from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, func

from database import Base


class ProofWorkspace(Base):
    __tablename__ = "proof_workspaces"

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    source_kind = Column(String(32), nullable=False, default="manual")
    source_filename = Column(String(255))
    pdf_path = Column(String(512))
    source_text = Column(Text, nullable=False, default="")
    extracted_text = Column(Text, nullable=False, default="")
    lean4_code = Column(Text, nullable=False, default="")
    rocq_code = Column(Text, nullable=False, default="")
    status = Column(String(32), nullable=False, default="ready")
    agent_trace_json = Column(Text, nullable=False, default="[]")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
