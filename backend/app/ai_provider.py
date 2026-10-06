"""Central AI provider routing with explicit product-area overrides."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from openai import OpenAI

from app import config

AIProviderArea = Literal[
    "market_insight",
    "case_library",
    "content_studio",
    "lead_tracking",
]

_PREFIXES: dict[AIProviderArea, str] = {
    "market_insight": "MARKET_INSIGHT_AI",
    "case_library": "CASE_LIBRARY_AI",
    "content_studio": "CONTENT_STUDIO_AI",
    "lead_tracking": "LEAD_TRACKING_AI",
}


class AIProviderConfigurationError(ValueError):
    pass


@dataclass(frozen=True)
class AIProvider:
    area: AIProviderArea
    source: Literal["unified", "override"]
    api_key: str
    base_url: str
    model: str

    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.base_url and self.model)

    def client(
        self,
        *,
        timeout: float | None = None,
        max_retries: int = 0,
    ) -> OpenAI:
        if not self.configured:
            raise AIProviderConfigurationError(
                f"{self.area} AI provider is not configured",
            )
        return OpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
            timeout=timeout,
            max_retries=max_retries,
        )


def get_ai_provider(area: AIProviderArea) -> AIProvider:
    prefix = _PREFIXES[area]
    override_enabled = bool(getattr(config, f"{prefix}_OVERRIDE_ENABLED"))
    if override_enabled:
        provider = AIProvider(
            area=area,
            source="override",
            api_key=str(getattr(config, f"{prefix}_API_KEY")),
            base_url=str(getattr(config, f"{prefix}_BASE_URL")),
            model=str(getattr(config, f"{prefix}_MODEL")),
        )
        if not provider.configured:
            raise AIProviderConfigurationError(
                f"{prefix}_OVERRIDE_ENABLED requires {prefix}_API_KEY, "
                f"{prefix}_BASE_URL, and {prefix}_MODEL",
            )
        return provider
    return AIProvider(
        area=area,
        source="unified",
        api_key=config.AI_API_KEY,
        base_url=config.AI_BASE_URL,
        model=config.AI_MODEL,
    )
