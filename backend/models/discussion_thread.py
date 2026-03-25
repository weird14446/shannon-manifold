from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Text, func

from database import Base


class DiscussionThread(Base):
    __tablename__ = "discussion_threads"
    __table_args__ = (
        Index("ix_discussion_threads_scope", "scope_type", "scope_key"),
        Index("ix_discussion_threads_anchor", "scope_type", "scope_key", "anchor_type"),
    )

    id = Column(Integer, primary_key=True, index=True)
    scope_type = Column(String(32), nullable=False, index=True)
    scope_key = Column(String(512), nullable=False, index=True)
    anchor_type = Column(String(32), nullable=False, index=True)
    anchor_json = Column(Text, nullable=False, default="{}")
    status = Column(String(16), nullable=False, default="open", server_default="open")
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
