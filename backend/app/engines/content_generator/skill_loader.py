"""Load concise marketing skills into Content Studio model instructions."""

from functools import lru_cache
from pathlib import Path
import re
from typing import Literal


SkillStage = Literal["chat", "plan", "action"]
_SKILLS_DIR = Path(__file__).resolve().parent / "skills"
_STAGE_SKILLS: dict[SkillStage, tuple[str, ...]] = {
    "chat": ("marventa-marketing-brief",),
    "plan": (
        "marventa-marketing-brief",
        "marventa-social-storytelling",
    ),
    "action": (
        "marventa-marketing-brief",
        "marventa-social-storytelling",
        "marventa-conversion-copy",
        "marventa-copy-edit",
    ),
}

_PLATFORM_MENTIONS = re.compile(
    r"小红书|xiaohongshu|\bxhs\b|抖音|douyin|微博|weibo|快手|kuaishou|哔哩哔哩|bilibili|视频号|公众号|wechat",
    re.IGNORECASE,
)


def _latest_platform(messages: list[dict] | None) -> str:
    for message in reversed(messages or []):
        if message.get("role") != "user":
            continue
        content = message.get("content")
        if not isinstance(content, str):
            continue
        mentions = list(_PLATFORM_MENTIONS.finditer(content))
        if mentions:
            return "xiaohongshu" if mentions[-1].group().lower() in {
                "小红书", "xiaohongshu", "xhs",
            } else "other"
    return ""


@lru_cache(maxsize=8)
def _skill_instructions(name: str) -> str:
    source = (_SKILLS_DIR / name / "SKILL.md").read_text(encoding="utf-8")
    if not source.startswith("---\n"):
        raise ValueError(f"Marketing skill {name} has no frontmatter")
    body = source.split("---", 2)[2].strip()
    return body.split("Source inspiration:", 1)[0].strip()


def writing_skill_for(
    preference_keys: list[str] | None,
    *,
    stage: SkillStage = "action",
    messages: list[dict] | None = None,
    creation_kind: Literal["image", "video"] = "image",
) -> str:
    """Select small, trusted instructions for the current creation stage."""
    names = list(_STAGE_SKILLS[stage])
    keys = set(preference_keys or [])
    platform = _latest_platform(messages)
    if platform == "xiaohongshu" or (not platform and "xiaohongshu" in keys):
        is_xiaohongshu = True
    else:
        is_xiaohongshu = False
    if is_xiaohongshu and creation_kind == "image" and "short_video" not in keys:
        names.append("marventa-xiaohongshu-copy")
    return "\n\nMarketing skills:\n" + "\n\n".join(
        _skill_instructions(name) for name in names
    )
