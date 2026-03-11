import os
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote_plus

from dotenv import find_dotenv, load_dotenv

load_dotenv(find_dotenv(usecwd=True))


class Settings:
    def __init__(self) -> None:
        self.chatbot_model = os.getenv("CHATBOT_MODEL", "gpt-4o")
        self.chatbot_provider = os.getenv("CHATBOT_PROVIDER", "mock").strip().lower()
        self.chatbot_api_base_url = os.getenv(
            "CHATBOT_API_BASE_URL", "https://api.openai.com/v1"
        ).rstrip("/")
        self.chatbot_api_key = os.getenv("CHATBOT_API_KEY", "").strip()
        self.chatbot_system_prompt = os.getenv(
            "CHATBOT_SYSTEM_PROMPT",
            (
                "You are Shannon Manifold Oracle, an assistant for formal proofs, theorem"
                " exploration, Lean4, Rocq, and proof debugging. Prefer precise, concise,"
                " technically correct answers. If the user asks for unsupported claims,"
                " clearly say what is uncertain."
            ),
        )
        self.chatbot_temperature = float(os.getenv("CHATBOT_TEMPERATURE", "0.2"))
        self.chatbot_timeout_seconds = float(os.getenv("CHATBOT_TIMEOUT_SECONDS", "45"))
        self.chatbot_max_history_messages = int(
            os.getenv("CHATBOT_MAX_HISTORY_MESSAGES", "12")
        )

        self.mysql_host = os.getenv("MYSQL_HOST", "mysql")
        self.mysql_port = int(os.getenv("MYSQL_PORT", "3306"))
        self.mysql_database = os.getenv("MYSQL_DATABASE")
        self.mysql_user = os.getenv("MYSQL_USER")
        self.mysql_password = os.getenv("MYSQL_PASSWORD")

        self.database_url = os.getenv("DATABASE_URL")
        if not self.database_url:
            self.mysql_database = self._require_env("MYSQL_DATABASE", self.mysql_database)
            self.mysql_user = self._require_env("MYSQL_USER", self.mysql_user)
            self.mysql_password = self._require_env("MYSQL_PASSWORD", self.mysql_password)
            self.database_url = self._build_database_url()

        self.jwt_secret_key = self._require_env("JWT_SECRET_KEY")
        self.jwt_algorithm = os.getenv("JWT_ALGORITHM", "HS256")
        self.jwt_access_token_expire_minutes = int(
            os.getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "60")
        )

        self.proof_upload_dir = Path(
            os.getenv("PROOF_UPLOAD_DIR", "/app/storage/uploads")
        )
        self.proof_artifact_dir = Path(
            os.getenv("PROOF_ARTIFACT_DIR", "/app/storage/artifacts")
        )
        self.lean_workspace_dir = Path(
            os.getenv("LEAN_WORKSPACE_DIR", "/workspace/lean-workspace")
        )
        self.lean_playground_file = os.getenv(
            "LEAN_PLAYGROUND_FILE", "ShannonManifold/Playground.lean"
        ).strip("/")
        self.lean_repository_subdir = os.getenv(
            "LEAN_REPOSITORY_SUBDIR", "lean-workspace"
        ).strip("/")

        self.github_repository_url = os.getenv("GITHUB_REPOSITORY_URL", "").strip()
        self.github_repository_branch = os.getenv(
            "GITHUB_REPOSITORY_BRANCH", "main"
        ).strip()
        self.github_access_token = os.getenv("GITHUB_ACCESS_TOKEN", "").strip()
        self.github_commit_author_name = os.getenv(
            "GITHUB_COMMIT_AUTHOR_NAME", "Shannon Manifold Bot"
        ).strip()
        self.github_commit_author_email = os.getenv(
            "GITHUB_COMMIT_AUTHOR_EMAIL", "bot@shannon-manifold.local"
        ).strip()

        cors_origins = os.getenv(
            "CORS_ORIGINS",
            "http://localhost:5173,http://127.0.0.1:5173",
        )
        self.cors_origins = [origin.strip() for origin in cors_origins.split(",") if origin.strip()]

    def _build_database_url(self) -> str:
        password = quote_plus(self.mysql_password or "")
        return (
            f"mysql+pymysql://{self.mysql_user}:{password}"
            f"@{self.mysql_host}:{self.mysql_port}/{self.mysql_database}"
        )

    def _require_env(self, name: str, value: str | None = None) -> str:
        resolved = value if value is not None else os.getenv(name)
        if resolved:
            return resolved
        raise RuntimeError(f"Missing required environment variable: {name}")


@lru_cache
def get_settings() -> Settings:
    return Settings()
