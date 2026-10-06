import math
import os
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

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
# All AI features use this provider unless their explicit override switch is on.
# CASE_AI_* remains an environment-only compatibility fallback.
AI_API_KEY = _env("AI_API_KEY", _env("CASE_AI_API_KEY"))
AI_BASE_URL = _env(
    "AI_BASE_URL",
    _env(
        "CASE_AI_BASE_URL",
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
    ),
)
AI_MODEL = _env("AI_MODEL", _env("CASE_AI_MODEL", "qwen3.8-flash"))

MARKET_INSIGHT_AI_OVERRIDE_ENABLED = _env(
    "MARKET_INSIGHT_AI_OVERRIDE_ENABLED", "false",
).lower() == "true"
MARKET_INSIGHT_AI_API_KEY = _env("MARKET_INSIGHT_AI_API_KEY")
MARKET_INSIGHT_AI_BASE_URL = _env("MARKET_INSIGHT_AI_BASE_URL")
MARKET_INSIGHT_AI_MODEL = _env("MARKET_INSIGHT_AI_MODEL")

CASE_LIBRARY_AI_OVERRIDE_ENABLED = _env(
    "CASE_LIBRARY_AI_OVERRIDE_ENABLED", "false",
).lower() == "true"
CASE_LIBRARY_AI_API_KEY = _env(
    "CASE_LIBRARY_AI_API_KEY",
    _env("CASE_ANALYSIS_AI_API_KEY"),
)
CASE_LIBRARY_AI_BASE_URL = _env(
    "CASE_LIBRARY_AI_BASE_URL",
    _env("CASE_ANALYSIS_AI_BASE_URL"),
)
CASE_LIBRARY_AI_MODEL = _env(
    "CASE_LIBRARY_AI_MODEL",
    _env("CASE_ANALYSIS_AI_MODEL"),
)

CONTENT_STUDIO_AI_OVERRIDE_ENABLED = _env(
    "CONTENT_STUDIO_AI_OVERRIDE_ENABLED", "false",
).lower() == "true"
CONTENT_STUDIO_AI_API_KEY = _env("CONTENT_STUDIO_AI_API_KEY")
CONTENT_STUDIO_AI_BASE_URL = _env("CONTENT_STUDIO_AI_BASE_URL")
CONTENT_STUDIO_AI_MODEL = _env("CONTENT_STUDIO_AI_MODEL")

LEAD_TRACKING_AI_OVERRIDE_ENABLED = _env(
    "LEAD_TRACKING_AI_OVERRIDE_ENABLED", "false",
).lower() == "true"
LEAD_TRACKING_AI_API_KEY = _env("LEAD_TRACKING_AI_API_KEY")
LEAD_TRACKING_AI_BASE_URL = _env("LEAD_TRACKING_AI_BASE_URL")
LEAD_TRACKING_AI_MODEL = _env("LEAD_TRACKING_AI_MODEL")

# Public market research is opt-in and never falls back to another provider.
INSIGHT_RESEARCH_ENABLED = _env("INSIGHT_RESEARCH_ENABLED", "false").lower() == "true"
INSIGHT_SEARCH_PROVIDER = _env("INSIGHT_SEARCH_PROVIDER", "tavily").lower()
TAVILY_API_KEY = _env("TAVILY_API_KEY")

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
DOUYIN_CHANNEL_SCOPES = _env("DOUYIN_CHANNEL_SCOPES", "user_info")
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
LEAD_TRACKING_SYNC_ENABLED = _env("LEAD_TRACKING_SYNC_ENABLED", "false").lower() == "true"
LEAD_TRACKING_TIMEZONE = _env("LEAD_TRACKING_TIMEZONE", "Asia/Shanghai")
LEAD_TRACKING_REQUIRED_SCOPE = _env("LEAD_TRACKING_REQUIRED_SCOPE", "item.comment")
LEAD_TRACKING_ANALYSIS_MODE = _env("LEAD_TRACKING_ANALYSIS_MODE", "rules").lower()
LEAD_TRACKING_AI_BATCH_SIZE = int(_env("LEAD_TRACKING_AI_BATCH_SIZE", "10"))
LEAD_TRACKING_AI_TIMEOUT_SECONDS = float(
    _env("LEAD_TRACKING_AI_TIMEOUT_SECONDS", "90"),
)
try:
    ZoneInfo(LEAD_TRACKING_TIMEZONE)
except ZoneInfoNotFoundError as exc:
    raise ValueError("LEAD_TRACKING_TIMEZONE must be a valid IANA timezone") from exc
if not LEAD_TRACKING_REQUIRED_SCOPE or any(char.isspace() for char in LEAD_TRACKING_REQUIRED_SCOPE):
    raise ValueError("LEAD_TRACKING_REQUIRED_SCOPE must be one OAuth scope")
if LEAD_TRACKING_ANALYSIS_MODE not in {"rules", "ai"}:
    raise ValueError("LEAD_TRACKING_ANALYSIS_MODE must be rules or ai")
if not 1 <= LEAD_TRACKING_AI_BATCH_SIZE <= 50:
    raise ValueError("LEAD_TRACKING_AI_BATCH_SIZE must be between 1 and 50")
if (
    not math.isfinite(LEAD_TRACKING_AI_TIMEOUT_SECONDS)
    or not 10 <= LEAD_TRACKING_AI_TIMEOUT_SECONDS <= 180
):
    raise ValueError(
        "LEAD_TRACKING_AI_TIMEOUT_SECONDS must be between 10 and 180",
    )

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
