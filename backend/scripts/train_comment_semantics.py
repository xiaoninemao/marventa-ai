"""Fine-tune and evaluate a local multi-label Chinese comment classifier.

Input: separate train/validation/test JSONL files. Each row has text and labels;
labels are drawn from comment_semantics.LABELS. Splits must be prepared from
human-annotated real comments, preferably separated by account and time.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import torch
from sklearn.metrics import log_loss, precision_recall_fscore_support
from torch.utils.data import DataLoader
from transformers import AutoModelForSequenceClassification, AutoTokenizer

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.engines.publishing.comment_semantics import LABELS  # noqa: E402


def read_rows(path: Path) -> list[dict]:
    rows = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        row = json.loads(line)
        if (
            not isinstance(row, dict) or not isinstance(row.get("text"), str)
            or not row["text"].strip() or len(row["text"]) > 100_000
            or not isinstance(row.get("labels"), list)
            or any(label not in LABELS for label in row["labels"])
            or len(set(row["labels"])) != len(row["labels"])
        ):
            raise ValueError(f"Invalid annotation in {path.name}:{number}")
        rows.append(row)
    if not rows:
        raise ValueError(f"No annotations in {path}")
    return rows


def vector(row: dict) -> list[float]:
    return [float(label in row["labels"]) for label in LABELS]


def evaluate(model, tokenizer, rows: list[dict]) -> tuple[list[list[float]], list[list[int]]]:
    model.eval()
    predictions = []
    actual = []
    with torch.inference_mode():
        for offset in range(0, len(rows), 16):
            batch = rows[offset:offset + 16]
            tokens = tokenizer(
                [row["text"] for row in batch], padding=True, truncation=True,
                max_length=256, return_tensors="pt",
            )
            predictions.extend(torch.sigmoid(model(**tokens).logits).tolist())
            actual.extend([[int(value) for value in vector(row)] for row in batch])
    return predictions, actual


def choose_thresholds(predictions: list[list[float]], actual: list[list[int]]) -> dict[str, float]:
    result = {}
    for index, label in enumerate(LABELS):
        candidates = []
        truth = [row[index] for row in actual]
        for threshold in (0.5, 0.6, 0.7, 0.8, 0.9, 0.95):
            predicted = [int(row[index] >= threshold) for row in predictions]
            precision, recall, f1, _ = precision_recall_fscore_support(
                truth, predicted, average="binary", zero_division=0,
            )
            if precision >= 0.8:
                candidates.append((f1, recall, threshold))
        result[label] = max(candidates)[2] if candidates else 0.99
    return result


def temperature_scale(probability: float, temperature: float) -> float:
    clipped = max(1e-6, min(1 - 1e-6, probability))
    logit = math.log(clipped / (1 - clipped))
    return 1 / (1 + math.exp(-logit / temperature))


def calibrate(predictions: list[list[float]], actual: list[list[int]]) -> tuple[dict[str, float], list[list[float]]]:
    temperatures: dict[str, float] = {}
    output = [[0.0] * len(LABELS) for _ in predictions]
    for index, label in enumerate(LABELS):
        truth = [row[index] for row in actual]
        if len(set(truth)) < 2:
            temperatures[label] = 1.0
        else:
            choices = []
            for candidate in (0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 5.0):
                calibrated = [temperature_scale(row[index], candidate) for row in predictions]
                choices.append((log_loss(truth, calibrated), candidate))
            temperatures[label] = min(choices)[1]
        for row_index, row in enumerate(predictions):
            output[row_index][index] = temperature_scale(row[index], temperatures[label])
    return temperatures, output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--train", type=Path, required=True)
    parser.add_argument("--validation", type=Path, required=True)
    parser.add_argument("--test", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--base-model", default="hfl/chinese-bert-wwm-ext")
    parser.add_argument("--epochs", type=int, default=3)
    args = parser.parse_args()
    if not 1 <= args.epochs <= 20:
        raise ValueError("epochs must be between 1 and 20")
    train = read_rows(args.train)
    validation = read_rows(args.validation)
    test = read_rows(args.test)
    hashes = []
    for rows in (train, validation, test):
        keys = {hashlib.sha256(row["text"].strip().encode()).hexdigest() for row in rows}
        if any(keys & previous for previous in hashes):
            raise ValueError("The same comment appears in multiple data splits")
        hashes.append(keys)
    tokenizer = AutoTokenizer.from_pretrained(args.base_model)
    model = AutoModelForSequenceClassification.from_pretrained(
        args.base_model, num_labels=len(LABELS), problem_type="multi_label_classification",
        ignore_mismatched_sizes=True,
    )
    optimizer = torch.optim.AdamW(model.parameters(), lr=2e-5)

    def collate(batch: list[dict]) -> dict:
        tokens = tokenizer(
            [row["text"] for row in batch], padding=True, truncation=True,
            max_length=256, return_tensors="pt",
        )
        tokens["labels"] = torch.tensor([vector(row) for row in batch], dtype=torch.float32)
        return tokens

    model.train()
    for epoch in range(args.epochs):
        for batch in DataLoader(train, batch_size=8, shuffle=True, collate_fn=collate):
            optimizer.zero_grad()
            loss = model(**batch).loss
            loss.backward()
            optimizer.step()
        print(f"epoch={epoch + 1} completed", flush=True)
    validation_probabilities, validation_truth = evaluate(model, tokenizer, validation)
    temperatures, validation_probabilities = calibrate(validation_probabilities, validation_truth)
    limits = choose_thresholds(validation_probabilities, validation_truth)
    test_probabilities, test_truth = evaluate(model, tokenizer, test)
    test_probabilities = [
        [temperature_scale(value, temperatures[LABELS[index]]) for index, value in enumerate(row)]
        for row in test_probabilities
    ]
    metrics = {}
    for index, label in enumerate(LABELS):
        truth = [row[index] for row in test_truth]
        predicted = [int(row[index] >= limits[label]) for row in test_probabilities]
        precision, recall, f1, support = precision_recall_fscore_support(
            truth, predicted, average="binary", zero_division=0,
        )
        metrics[label] = {
            "precision": round(float(precision), 4), "recall": round(float(recall), 4),
            "f1": round(float(f1), 4), "support": int(sum(truth)),
        }
    reject_index = LABELS.index("reject_feature")
    request_index = LABELS.index("feature_request")
    rejected = [row for row in range(len(test_truth)) if test_truth[row][reject_index]]
    negation_false_positive_rate = (
        sum(test_probabilities[index][request_index] >= limits["feature_request"] for index in rejected)
        / len(rejected) if rejected else 1.0
    )
    critical = LABELS
    validated = (
        len(test) >= 200 and negation_false_positive_rate <= 0.05
        and all(metrics[label]["support"] >= 20 and metrics[label]["precision"] >= 0.85
                and metrics[label]["recall"] >= 0.7 for label in critical)
    )
    args.output.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(args.output)
    tokenizer.save_pretrained(args.output)
    manifest = {
        "validated": validated, "labels": list(LABELS), "thresholds": limits,
        "temperatures": temperatures,
        "base_model": args.base_model, "split_sizes": {
            "train": len(train), "validation": len(validation), "test": len(test),
        }, "metrics": metrics,
        "negation_false_positive_rate": round(negation_false_positive_rate, 4),
    }
    (args.output / "validation.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8",
    )
    print(json.dumps({"validated": validated, "metrics": metrics}, ensure_ascii=False))


if __name__ == "__main__":
    main()
