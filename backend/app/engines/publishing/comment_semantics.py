"""Optional, locally fine-tuned Chinese comment classifier.

No model is downloaded at runtime. A checkpoint is usable only with an explicit
validation manifest produced after in-domain human annotation and evaluation.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

LABELS = (
    "purchase_intent", "feature_request", "negative_feedback",
    "reject_feature", "keep_feature", "sarcasm_ambiguity",
)


class SemanticModelUnavailable(RuntimeError):
    pass


@lru_cache(maxsize=1)
def _load_model(model_path: str):
    path = Path(model_path).expanduser().resolve()
    if not path.is_dir():
        raise SemanticModelUnavailable("Fine-tuned model directory is unavailable")
    try:
        manifest = json.loads((path / "validation.json").read_text(encoding="utf-8"))
        if (
            manifest.get("validated") is not True
            or manifest.get("labels") != list(LABELS)
            or not isinstance(manifest.get("thresholds"), dict)
            or any(not 0.5 <= float(manifest["thresholds"][label]) <= 0.99 for label in LABELS)
            or not isinstance(manifest.get("temperatures"), dict)
            or any(not 0.25 <= float(manifest["temperatures"][label]) <= 10 for label in LABELS)
        ):
            raise ValueError("Invalid model validation manifest")
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        tokenizer = AutoTokenizer.from_pretrained(str(path), local_files_only=True)
        model = AutoModelForSequenceClassification.from_pretrained(str(path), local_files_only=True)
        if model.config.num_labels != len(LABELS):
            raise ValueError("Classifier label count does not match manifest")
        model.eval()
        return tokenizer, model, manifest, torch
    except (OSError, ImportError, KeyError, TypeError, ValueError, RuntimeError) as exc:
        raise SemanticModelUnavailable("Fine-tuned semantic model cannot be loaded") from exc


def classify_comments(contents: list[str], model_path: str) -> list[dict[str, float]]:
    tokenizer, model, manifest, torch = _load_model(model_path)
    try:
        temperatures = torch.tensor([float(manifest["temperatures"][label]) for label in LABELS])
        output: list[dict[str, float]] = []
        with torch.inference_mode():
            for offset in range(0, len(contents), 16):
                batch = tokenizer(
                    contents[offset:offset + 16], padding=True, truncation=True,
                    max_length=256, return_tensors="pt",
                )
                probabilities = torch.sigmoid(model(**batch).logits / temperatures).tolist()
                output.extend([
                    {label: float(value) for label, value in zip(LABELS, row)}
                    for row in probabilities
                ])
        return output
    except (OSError, KeyError, TypeError, ValueError, RuntimeError) as exc:
        raise SemanticModelUnavailable("Fine-tuned semantic model could not classify comments") from exc


def thresholds(model_path: str) -> dict[str, float]:
    try:
        data = json.loads((Path(model_path).expanduser().resolve() / "validation.json").read_text(encoding="utf-8"))
        return {label: float(data["thresholds"][label]) for label in LABELS}
    except (OSError, KeyError, TypeError, ValueError) as exc:
        raise SemanticModelUnavailable("Classifier validation thresholds are unavailable") from exc
