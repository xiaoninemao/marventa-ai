"""Account-wide comment trends from verified daily snapshots.

Themes use one optional, locally configured BERTopic model. The other overview
figures remain available when there is not enough text to discover themes.
"""

from __future__ import annotations

import hashlib
import logging
import re
import threading
from collections import Counter
from datetime import date, datetime, timedelta
from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field

from app.config import LEAD_OPINION_EMBEDDING_MODEL_PATH, LEAD_TRACKING_TIMEZONE
from app.engines.publishing import storage
from app.engines.publishing.account_content import _scoped_account
from app.engines.publishing.daily_comment_report import (
    TOPICS,
    _demo_preview_allowed,
    _topic_names,
)
from app.engines.publishing.lead_identity import lead_account_key_from_row

logger = logging.getLogger(__name__)
THEME_MIN_UNIQUE_TEXTS = 30
THEME_TRAIN_LIMIT = 1200
THEME_TOPICS = (
    ("采购与试用", "产品价格报价、购买套餐、申请试用和采购流程"),
    ("报表与数据", "查看数据报表和图表、导出 Excel、分析营销效果"),
    ("系统对接", "CRM API 系统对接、线索同步和集成"),
    ("企业配置", "团队成员权限、审批、私有化部署和单点登录"),
    ("使用体验", "页面加载速度、系统稳定性和操作体验"),
    ("上手服务", "产品演示、使用教程、培训和客服支持"),
)
STOP_WORDS = frozenset({
    "这个", "那个", "这些", "那些", "我们", "你们", "他们", "一个", "一下", "现在",
    "目前", "这次", "可以", "还是", "就是", "已经", "还有", "以及", "的话", "什么",
    "怎么", "为什么", "一下子", "感觉", "真的", "有点", "一下", "这样", "那样",
})
TERM_ALIASES = {
    "crm": "CRM", "客户管理": "CRM", "客户关系管理": "CRM",
    "excel": "报表导出", "表格导出": "报表导出", "导出报表": "报表导出",
    "报价单": "报价", "费用": "价格", "收费": "价格",
    "产品演示": "演示", "demo": "演示", "试用版": "试用",
    "单点登录": "SSO", "sso": "SSO",
}
QUESTION_CUES = ("如何", "怎么", "为何", "为什么", "是否", "能否", "能不能", "可不可以", "多少钱", "哪里")
DEMAND_CUES = ("希望", "建议", "需要", "增加", "新增", "最好", "期待支持", "能不能", "可不可以", "请保留")
REJECT_CUES = ("不需要", "没必要", "不用增加", "不要增加", "不希望增加", "无需")
KEEP_CUES = ("不要删除", "不要取消", "不希望去掉", "希望保留", "请保留")
POSITIVE_CUES = ("好用", "方便", "顺畅", "清楚", "满意", "不错", "喜欢", "靠谱", "省时间", "有帮助", "很棒")
NEGATIVE_CUES = ("不好用", "太慢", "卡顿", "闪退", "失败", "报错", "不方便", "失望", "糟糕", "太贵", "很难", "无法使用", "不能用", "加载慢")
AMBIGUOUS_CUES = ("呵呵", "可真", "绝了", "真是太棒了呢")
SENTIMENT_ORDER = ("positive", "neutral", "negative", "uncertain")
_theme_cache: dict[tuple[str, str, str], tuple[dict[str, int], dict[int, str], dict[int, list[tuple[str, float]]]]] = {}
_theme_cache_lock = threading.Lock()
_theme_compute_lock = threading.Lock()


class OpinionDailyPoint(BaseModel):
    date: str
    comments: int | None = None
    negative_percent: float | None = None


class OpinionShare(BaseModel):
    key: str
    label: str
    count: int
    percent: float


class OpinionWord(BaseModel):
    word: str
    weight: float


class OpinionKeywordCluster(BaseModel):
    key: str
    label: str
    count: int
    percent: float
    keywords: list[str] = Field(default_factory=list)


class OpinionOverview(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: str = "unavailable"
    period_days: int
    start_date: str
    end_date: str
    timezone: str = LEAD_TRACKING_TIMEZONE
    is_simulated: bool = False
    covered_days: int = 0
    incomplete_days: int = 0
    comments_collected: int = 0
    distinct_users: int = 0
    last_synced_at: str = ""
    daily: list[OpinionDailyPoint] = Field(default_factory=list)
    question_percent: float = 0
    demand_percent: float = 0
    sentiments: list[OpinionShare] = Field(default_factory=list)
    themes: list[OpinionShare] = Field(default_factory=list)
    words: list[OpinionWord] = Field(default_factory=list)
    keyword_clusters: list[OpinionKeywordCluster] = Field(default_factory=list)
    theme_status: str = "insufficient_data"


def _percent(value: int, total: int) -> float:
    return round(100 * value / total, 1) if total else 0.0


def _is_question(content: str) -> bool:
    text = content.casefold()
    return "?" in text or "？" in text or any(cue in text for cue in QUESTION_CUES)


def _is_demand(content: str) -> bool:
    text = content.casefold()
    if any(cue in text for cue in KEEP_CUES):
        return True
    if any(cue in text for cue in REJECT_CUES):
        return False
    return any(cue in text for cue in DEMAND_CUES)


def _sentiment(content: str) -> str:
    text = content.casefold()
    if any(cue in text for cue in AMBIGUOUS_CUES):
        return "uncertain"
    # Refusing a feature is a stance, not necessarily negative sentiment.
    if any(cue in text for cue in REJECT_CUES + KEEP_CUES):
        return "neutral"
    negative = any(cue in text for cue in NEGATIVE_CUES)
    positive = any(cue in text for cue in POSITIVE_CUES) and not any(
        cue in text for cue in ("不好用", "不方便", "不喜欢", "不满意")
    )
    if "不喜欢" in text or "不满意" in text:
        negative = True
    if positive and negative:
        return "uncertain"
    return "negative" if negative else "positive" if positive else "neutral"


def _canonical_word(value: str) -> str:
    word = value.strip().casefold()
    return TERM_ALIASES.get(word, value.strip())


def _tokens(content: str) -> list[str]:
    import jieba

    return [word for raw in jieba.lcut(content) if (word := _canonical_word(raw))
            and (len(word) >= 2 or word in {"不", "没"})
            and word.casefold() not in STOP_WORDS
            and not re.fullmatch(r"[\W_0-9]+", word)]


@lru_cache(maxsize=2)
def _embedding_model(model_path: str):
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(model_path, local_files_only=True,
                               model_kwargs={"low_cpu_mem_usage": False})


def _discover_themes(
    account_key: str, rows: list[dict], model_path: str,
) -> tuple[dict[str, int], dict[int, str], dict[int, list[tuple[str, float]]]]:
    """Fit once per 30-day snapshot and assign every collected comment."""
    if not Path(model_path).is_dir():
        raise FileNotFoundError("A local opinion embedding model directory is required")
    signature = hashlib.sha256("\n".join(
        f"{row['comment_id']}\0{row['content']}" for row in rows
    ).encode("utf-8")).hexdigest()
    cache_key = (account_key, model_path, signature)
    with _theme_cache_lock:
        if cache_key in _theme_cache:
            return _theme_cache[cache_key]

    from bertopic import BERTopic
    from bertopic.vectorizers import ClassTfidfTransformer
    from hdbscan import HDBSCAN
    from sklearn.decomposition import PCA
    from sklearn.feature_extraction.text import CountVectorizer

    unique_texts = list(dict.fromkeys(
        text for row in rows if (text := str(row["content"]).strip())
    ))
    if len(unique_texts) < THEME_MIN_UNIQUE_TEXTS:
        return {}, {}, {}
    training = sorted(unique_texts, key=lambda value: hashlib.sha256(value.encode("utf-8")).digest())[:THEME_TRAIN_LIMIT]
    embedding_model = _embedding_model(model_path)
    embeddings = embedding_model.encode(training, show_progress_bar=False)
    model = BERTopic(
        embedding_model=embedding_model,
        zeroshot_topic_list=[description for _, description in THEME_TOPICS],
        zeroshot_min_similarity=0.4,
        umap_model=PCA(n_components=5, random_state=42),
        hdbscan_model=HDBSCAN(min_cluster_size=5, min_samples=2, prediction_data=True),
        vectorizer_model=CountVectorizer(
            tokenizer=_tokens, token_pattern=None, lowercase=False, ngram_range=(1, 2), max_df=0.98,
        ),
        ctfidf_model=ClassTfidfTransformer(reduce_frequent_words=True),
        calculate_probabilities=False,
    )
    trained_ids, _ = model.fit_transform(training, embeddings=embeddings)
    by_text = dict(zip(training, (int(value) for value in trained_ids), strict=True))
    remaining = [text for text in unique_texts if text not in by_text]
    for offset in range(0, len(remaining), 256):
        batch = remaining[offset:offset + 256]
        batch_embeddings = embedding_model.encode(batch, show_progress_bar=False)
        ids, _ = model.transform(batch, embeddings=batch_embeddings)
        by_text.update(zip(batch, (int(value) for value in ids), strict=True))
    assignments = {str(row["comment_id"]): by_text.get(str(row["content"]).strip(), -1) for row in rows}
    words = {topic: [(str(word), float(weight)) for word, weight in model.get_topic(topic)[:5]]
             for topic in set(by_text.values()) if topic >= 0 and model.get_topic(topic)}
    description_names = {description: name for name, description in THEME_TOPICS}
    labels = {topic: description_names[model.topic_labels_[topic]]
              for topic in words if model.topic_labels_.get(topic) in description_names}
    result = (assignments, labels, words)
    with _theme_cache_lock:
        if len(_theme_cache) >= 8:
            _theme_cache.pop(next(iter(_theme_cache)))
        _theme_cache[cache_key] = result
    return result


def get_opinion_overview(
    user_id: str, project_id: str, account_id: str, period_days: int = 7,
) -> OpinionOverview:
    if period_days not in (7, 30):
        raise ValueError("Opinion period must be 7 or 30 days")
    account = _scoped_account(user_id, project_id, account_id)
    key = lead_account_key_from_row(account)
    end = datetime.now(ZoneInfo(LEAD_TRACKING_TIMEZONE)).date() - timedelta(days=1)
    start = end - timedelta(days=period_days - 1)
    training_start = end - timedelta(days=29)
    allow_demo = _demo_preview_allowed(account)
    runs, rows = _opinion_evidence(account, training_start.isoformat(), end.isoformat())
    return _overview_from_evidence(key, runs, rows, period_days, start, end, allow_demo)


def _opinion_evidence(account: dict, training_start: str, end: str) -> tuple[list[dict], list[dict]]:
    key = lead_account_key_from_row(account)
    allow_demo = _demo_preview_allowed(account)
    with storage._get_conn() as conn:
        runs = [dict(row) for row in conn.execute(
            """SELECT local_date, status, limited, is_simulated, last_synced_at
               FROM lead_tracking_account_comment_runs
               WHERE account_key = ? AND local_date BETWEEN ? AND ?
                 AND is_simulated = ? ORDER BY local_date""",
            (key, training_start, end, int(allow_demo)),
        ).fetchall()]
        rows = [dict(row) for row in conn.execute(
            """SELECT comment.local_date, comment.comment_id, comment.comment_user_id,
                      comment.item_id, comment.content
               FROM lead_tracking_account_comments comment
               JOIN lead_tracking_account_comment_runs run
                 ON run.account_key = comment.account_key AND run.local_date = comment.local_date
               WHERE comment.account_key = ? AND comment.local_date BETWEEN ? AND ?
                 AND run.is_simulated = ? AND run.status IN ('completed', 'partial')
               ORDER BY comment.local_date DESC, comment.comment_id""",
            (key, training_start, end, int(allow_demo)),
        ).fetchall()]
    return runs, rows


def _overview_from_evidence(
    key: str, runs: list[dict], rows: list[dict], period_days: int,
    start: date, end: date, allow_demo: bool,
) -> OpinionOverview:
    # A provider may return the same comment on a later sync. Count it once.
    unique = {row["comment_id"]: row for row in reversed(rows)}
    rows = list(unique.values())
    selected = [row for row in rows if row["local_date"] >= start.isoformat()]
    selected_runs = {row["local_date"]: row for row in runs if row["local_date"] >= start.isoformat()
                     and row["status"] in ("completed", "partial")}
    result = OpinionOverview(
        status="completed" if selected_runs else "unavailable",
        period_days=period_days, start_date=start.isoformat(), end_date=end.isoformat(),
        is_simulated=allow_demo and bool(selected_runs),
        covered_days=len(selected_runs),
        incomplete_days=sum(row["status"] == "partial" or bool(row["limited"]) for row in selected_runs.values()),
        comments_collected=len(selected),
        distinct_users=len({row["comment_user_id"] for row in selected if row["comment_user_id"]}),
        last_synced_at=max((row["last_synced_at"] for row in selected_runs.values()), default=""),
    )
    if not selected_runs:
        return result
    counts = Counter(row["local_date"] for row in selected)
    moods = {row["comment_id"]: _sentiment(row["content"]) for row in selected}
    negative_by_date = Counter(row["local_date"] for row in selected if moods[row["comment_id"]] == "negative")
    for offset in range(period_days):
        day = (start + timedelta(days=offset)).isoformat()
        result.daily.append(OpinionDailyPoint(
            date=day,
            comments=counts[day] if day in selected_runs else None,
            negative_percent=_percent(negative_by_date[day], counts[day]) if counts[day] else None,
        ))
    total = len(selected)
    result.question_percent = _percent(sum(_is_question(row["content"]) for row in selected), total)
    result.demand_percent = _percent(sum(_is_demand(row["content"]) for row in selected), total)
    mood_counts = Counter(moods.values())
    mood_labels = {"positive": "正向", "neutral": "中性", "negative": "负向", "uncertain": "待复核"}
    result.sentiments = [OpinionShare(
        key=key_name, label=mood_labels[key_name], count=mood_counts[key_name],
        percent=_percent(mood_counts[key_name], total),
    ) for key_name in SENTIMENT_ORDER]

    if allow_demo and selected_runs and all(run["is_simulated"] for run in selected_runs.values()):
        grouped = Counter((_topic_names(row["content"], []) or ["其他"])[0] for row in selected)
        result.theme_status = "ready" if grouped else "insufficient_data"
        word_counts: Counter[str] = Counter()
        for index, (label, count) in enumerate(grouped.most_common(6)):
            keywords = Counter(
                word for row in selected for word in TOPICS.get(label, ())
                if word in row["content"].lower()
            )
            result.themes.append(OpinionShare(
                key=str(index), label=label, count=count, percent=_percent(count, total),
            ))
            result.keyword_clusters.append(OpinionKeywordCluster(
                key=str(index), label=label, count=count, percent=_percent(count, total),
                keywords=[word for word, _ in keywords.most_common(4)],
            ))
            word_counts.update(keywords)
        peak = max(word_counts.values(), default=0)
        result.words = [OpinionWord(word=word, weight=round(count / peak, 3))
                        for word, count in word_counts.most_common(12) if peak]
        return result

    texts = {text for row in rows if (text := str(row["content"]).strip())}
    if len(texts) < THEME_MIN_UNIQUE_TEXTS:
        result.theme_status = "insufficient_data"
    elif not LEAD_OPINION_EMBEDDING_MODEL_PATH:
        result.theme_status = "unavailable"
    else:
        try:
            with _theme_compute_lock:
                assignments, labels, topic_words = _discover_themes(
                    key, rows, LEAD_OPINION_EMBEDDING_MODEL_PATH,
                )
            grouped = Counter(assignments.get(row["comment_id"], -1) for row in selected)
            result.theme_status = "ready" if labels else "insufficient_data"
            if labels:
                leading = [(topic, count) for topic, count in grouped.most_common()
                           if topic >= 0 and topic in labels][:5]
                result.themes = [OpinionShare(
                    key=str(topic), label=labels[topic], count=count, percent=_percent(count, total),
                ) for topic, count in leading]
                result.keyword_clusters = [OpinionKeywordCluster(
                    key=str(topic), label=labels[topic], count=count, percent=_percent(count, total),
                    keywords=list(dict.fromkeys(_canonical_word(word)
                        for word, _ in topic_words.get(topic, []) if word))[:4],
                ) for topic, count in leading]
                leading_ids = {topic for topic, _ in leading}
                unclassified = sum(count for topic, count in grouped.items() if topic not in leading_ids)
                if unclassified:
                    result.themes.append(OpinionShare(
                        key="other", label="其他", count=unclassified, percent=_percent(unclassified, total),
                    ))
                word_weights: Counter[str] = Counter()
                for topic, count in grouped.items():
                    if topic not in labels:
                        continue
                    for word, weight in topic_words.get(topic, []):
                        word_weights[_canonical_word(word)] += count * weight
                peak = max(word_weights.values(), default=0)
                result.words = [OpinionWord(word=word, weight=round(weight / peak, 3))
                                for word, weight in word_weights.most_common(12) if peak]
        except Exception:
            logger.exception("Account opinion topic extraction failed for %s", key)
            result.theme_status = "unavailable"
    return result
