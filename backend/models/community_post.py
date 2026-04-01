from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, func

from database import Base


class CommunityPost(Base):
    __tablename__ = "community_posts"

    id = Column(Integer, primary_key=True, index=True)
    author_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    slug = Column(String(255), nullable=False, unique=True, index=True)
    summary = Column(Text, nullable=False, default="")
    content_markdown = Column(Text, nullable=False, default="")
    category = Column(String(32), nullable=False, index=True)
    tags_json = Column(Text, nullable=False, default="[]")
    status = Column(String(16), nullable=False, default="draft", server_default="draft", index=True)
    is_featured = Column(Boolean, nullable=False, default=False, server_default="0", index=True)
    published_at = Column(DateTime(timezone=True), nullable=True)
    primary_artifact_type = Column(String(32), nullable=True, index=True)
    primary_artifact_ref = Column(String(512), nullable=True, index=True)
    related_artifacts_json = Column(Text, nullable=False, default="[]")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
