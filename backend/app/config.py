import math
import os

from dotenv import load_dotenv

load_dotenv(override=True)


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()

APP_NAME = os.getenv("APP_NAME", "ai_marketing_platform")
DEBUG = os.getenv("DEBUG", "true").lower() == "true"
MAX_UPLOAD_SIZE_MB = int(os.getenv("MAX_UPLOAD_SIZE_MB", "50"))
MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024
FRONTEND_ORIGINS = [
    origin.strip()
    for origin in os.getenv("FRONTEND_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    if origin.strip()
]

# ---- LLM Providers ----
# Global AI configuration used by market insight and content generation.
# Change only these CASE_AI_* values when switching providers.
CASE_AI_API_KEY = _env("CASE_AI_API_KEY")
CASE_AI_BASE_URL = _env("CASE_AI_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
CASE_AI_MODEL = _env("CASE_AI_MODEL", "qwen3.8-flash")

# Provider-independent configuration for case library analysis.
CASE_ANALYSIS_AI_API_KEY = _env("CASE_ANALYSIS_AI_API_KEY")
CASE_ANALYSIS_AI_BASE_URL = _env("CASE_ANALYSIS_AI_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
CASE_ANALYSIS_AI_MODEL = _env("CASE_ANALYSIS_AI_MODEL", "qwen3.8-flash")

# Card Modification AI inherits the same provider unless explicitly overridden.
MODIFY_CARD_AI_API_KEY = _env("MODIFY_CARD_AI_API_KEY", CASE_AI_API_KEY) or CASE_AI_API_KEY
MODIFY_CARD_AI_BASE_URL = _env("MODIFY_CARD_AI_BASE_URL", CASE_AI_BASE_URL) or CASE_AI_BASE_URL
MODIFY_CARD_AI_MODEL = _env("MODIFY_CARD_AI_MODEL", CASE_AI_MODEL) or CASE_AI_MODEL

# ---- Database ----
DB_PATH = os.getenv("DB_PATH", os.path.join(os.path.dirname(__file__), "..", "data", "market_insight.db"))
DATABASE_URL = _env("DATABASE_URL")

# ---- Auth ----
JWT_SECRET = os.getenv("JWT_SECRET", "change-me-in-production-use-a-random-string")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "1440"))
ENABLE_DEMO_USER = os.getenv("ENABLE_DEMO_USER", "false").lower() == "true"
DEMO_USERNAME = _env("DEMO_USERNAME", "demo")
DEMO_PASSWORD = _env("DEMO_PASSWORD")
DEMO_EMAIL = _env("DEMO_EMAIL", "demo@local.dev")

# ---- Channel Authorization ----
# Each URL contains the provider-specific client and callback parameters.
# The API appends a short-lived, signed state parameter before redirecting.
CHANNEL_CREDENTIAL_ENCRYPTION_KEY = _env("CHANNEL_CREDENTIAL_ENCRYPTION_KEY")
DOUYIN_CHANNEL_CLIENT_KEY = _env("DOUYIN_CHANNEL_CLIENT_KEY")
DOUYIN_CHANNEL_CLIENT_SECRET = _env("DOUYIN_CHANNEL_CLIENT_SECRET")
DOUYIN_CHANNEL_REDIRECT_URI = _env("DOUYIN_CHANNEL_REDIRECT_URI")
XIAOHONGSHU_CHANNEL_APP_ID = _env("XIAOHONGSHU_CHANNEL_APP_ID")
XIAOHONGSHU_CHANNEL_APP_SECRET = _env("XIAOHONGSHU_CHANNEL_APP_SECRET")
XIAOHONGSHU_CHANNEL_CLIENT_NAME = _env(
    "XIAOHONGSHU_CHANNEL_CLIENT_NAME", "Marventa AI",
)
FRONTEND_BASE_URL = _env("FRONTEND_BASE_URL", "http://127.0.0.1:3000")
PUBLISHING_SCHEDULER_ENABLED = _env("PUBLISHING_SCHEDULER_ENABLED", "false").lower() == "true"
PUBLISHING_POLL_SECONDS = float(_env("PUBLISHING_POLL_SECONDS", "10"))
if not math.isfinite(PUBLISHING_POLL_SECONDS) or PUBLISHING_POLL_SECONDS < 1:
    raise ValueError("PUBLISHING_POLL_SECONDS must be at least 1")

# ---- File Handling ----
ALLOWED_DOCUMENT_TYPES = {
    "text/markdown": "markdown",
    "text/x-markdown": "markdown",
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/octet-stream": None,
}

ALLOWED_EXTENSIONS = {".md", ".markdown", ".pdf", ".docx"}

# ---- Media Storage ----
MEDIA_ROOT = os.path.join(os.path.dirname(__file__), "..", "data", "media")
MEDIA_STORAGE_BACKEND = _env("MEDIA_STORAGE_BACKEND", "local").lower()
MEDIA_S3_BUCKET = _env("MEDIA_S3_BUCKET")
MEDIA_S3_PREFIX = _env("MEDIA_S3_PREFIX")
MEDIA_S3_REGION = _env("MEDIA_S3_REGION", "auto")
MEDIA_S3_ENDPOINT_URL = _env("MEDIA_S3_ENDPOINT_URL")
MEDIA_S3_ACCESS_KEY_ID = _env("MEDIA_S3_ACCESS_KEY_ID")
MEDIA_S3_SECRET_ACCESS_KEY = _env("MEDIA_S3_SECRET_ACCESS_KEY")
MEDIA_S3_ADDRESSING_STYLE = _env("MEDIA_S3_ADDRESSING_STYLE", "path")
MEDIA_S3_PUBLIC_BASE_URL = _env("MEDIA_S3_PUBLIC_BASE_URL")
MEDIA_S3_PRESIGNED_TTL_SECONDS = int(
    _env("MEDIA_S3_PRESIGNED_TTL_SECONDS", "900"),
)
ALLOWED_VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm", ".m4v"}
ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
MAX_VIDEO_SIZE_MB = int(os.getenv("MAX_VIDEO_SIZE_MB", "100"))
MAX_IMAGE_SIZE_MB = int(os.getenv("MAX_IMAGE_SIZE_MB", "10"))
MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_MB * 1024 * 1024
MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024
