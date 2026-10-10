from __future__ import annotations

import json
import logging
import re
import time
import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field

from openai import OpenAI

from app.ai_provider import AIProvider
from app.engines.content_generator.agent_jobs import (
    check_current_job,
    record_model_timing,
)
from app.engines.content_generator.models import (
    AgentMessageEvent,
    AgentProgressCallback,
)

logger = logging.getLogger(__name__)
model_call_timings: ContextVar[list[dict] | None] = ContextVar("creation_model_call_timings", default=None)
model_clients: ContextVar[dict[AIProvider, OpenAI] | None] = ContextVar("creation_model_clients", default=None)


def creation_client(provider: AIProvider) -> OpenAI:
    clients = model_clients.get()
    if clients is None:
        return provider.client(timeout=180)
    if provider not in clients:
        clients[provider] = provider.client(timeout=180)
    return clients[provider]


@contextmanager
def measure_model_call(kind: str, model: str):
    started = time.monotonic()
    timing = {"kind": kind, "model": model, "first_token_ms": None}
    succeeded = False
    try:
        yield timing
        succeeded = True
    finally:
        timing["elapsed_ms"] = round((time.monotonic() - started) * 1000)
        timing["succeeded"] = succeeded
        timings = model_call_timings.get()
        if timings is not None:
            timings.append(timing)
        logger.info(
            "Creation model call kind=%s model=%s elapsed_ms=%s first_token_ms=%s succeeded=%s",
            kind, model, timing["elapsed_ms"], timing["first_token_ms"], succeeded,
        )
        record_model_timing(timing)

def visible_reply(content: str) -> str:
    text = content.lstrip()
    if not text or ("```json".startswith(text) and text.startswith("`")):
        return ""
    if text.startswith("```json"):
        text = text[7:].lstrip()
    if not text.startswith("{"):
        return "" if text.startswith("```") and not text.startswith("```\n") else content
    depth = 0
    index = 0
    decoder = json.JSONDecoder()
    while index < len(text):
        char = text[index]
        if char == '"':
            try:
                key, size = decoder.raw_decode(text[index:])
            except json.JSONDecodeError:
                return ""
            end = index + size
            previous = text[:index].rstrip()[-1:]
            if depth == 1 and previous in {"{", ","} and key == "reply":
                tail = text[end:].lstrip()
                if not tail.startswith(":"):
                    return ""
                tail = tail[1:].lstrip()
                if not tail.startswith('"'):
                    return ""
                value = tail[1:]
                output = ""
                cursor = 0
                while cursor < len(value):
                    if value[cursor] == '"':
                        return output
                    if value[cursor] != "\\":
                        output += value[cursor]
                        cursor += 1
                        continue
                    if cursor + 1 >= len(value):
                        return output
                    escape = value[cursor:cursor + 2]
                    if escape == "\\u":
                        if cursor + 6 > len(value):
                            return output
                        encoded = value[cursor:cursor + 6]
                        digits = encoded[2:]
                        code = int(digits, 16)
                        if 0xD800 <= code <= 0xDBFF:
                            if cursor + 12 > len(value):
                                return output
                            encoded = value[cursor:cursor + 12]
                            cursor += 12
                        else:
                            cursor += 6
                    else:
                        encoded = escape
                        cursor += 2
                    output += json.loads(f'"{encoded}"')
                return output
            index = end
            continue
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
        index += 1
    return ""


def user_message(content: str) -> str:
    return visible_reply(content).strip()

def context_details(section: str, content: str) -> list[str]:
    if section == "previous_deliverable" and "{" in content:
        data = json.loads(content[content.index("{"):])
        return [data["title"]] if data.get("title") else []
    if section == "plans":
        return [
            data["title"] for line in content.splitlines() if line.strip().startswith("{")
            if (data := json.loads(line)).get("title")
        ]
    pattern = r"^- (?:Product|Title|Material|Name): (.+)$"
    return re.findall(pattern, content, flags=re.MULTILINE)[:20]


@dataclass
class ToolFunction:
    name: str = ""
    arguments: str = ""


@dataclass
class ToolCall:
    id: str = ""
    function: ToolFunction = field(default_factory=ToolFunction)


@dataclass
class AssistantTurn:
    content: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)


class ReplyStreamParser:
    """Decode only the top-level reply while consuming each fragment once."""

    def __init__(self) -> None:
        self.mode = "detect"
        self.prefix = ""
        self.stack: list[str] = []
        self.string_kind = ""
        self.key_parts: list[str] = []
        self.key = ""
        self.expect_key = False
        self.expect_reply = False
        self.escaped = False
        self.unicode_digits: str | None = None
        self.high_surrogate: int | None = None
        self.parts: list[str] = []
        self.done = False
        self.characters_processed = 0

    @property
    def text(self) -> str:
        return "".join(self.parts)

    def feed(self, fragment: str) -> None:
        if self.done or self.mode == "hidden":
            return
        if self.mode == "plain":
            self.parts.append(fragment)
            self.characters_processed += len(fragment)
            return
        if self.mode == "detect":
            self.prefix += fragment
            value = self.prefix.lstrip()
            if not value or ("```json".startswith(value) and value.startswith("`")):
                return
            if value.startswith("```json"):
                value = value[7:].lstrip()
                if not value:
                    return
                if not value.startswith("{"):
                    self.mode = "hidden"
                    return
            if value.startswith("```") and not value.startswith("```\n"):
                self.mode = "hidden"
                return
            if not value.startswith("{"):
                self.mode = "plain"
                self.parts.append(self.prefix)
                self.characters_processed += len(self.prefix)
                self.prefix = ""
                return
            self.mode = "json"
            self.prefix = ""
            fragment = value
        for char in fragment:
            self.characters_processed += 1
            if self.done:
                break
            if self.string_kind == "reply":
                self._reply_character(char)
                continue
            if self.string_kind:
                if self.escaped:
                    if self.string_kind == "key":
                        self.key_parts.append(char)
                    self.escaped = False
                elif char == "\\":
                    if self.string_kind == "key":
                        self.key_parts.append(char)
                    self.escaped = True
                elif char == '"':
                    if self.string_kind == "key":
                        self.key = json.loads('"' + "".join(self.key_parts) + '"')
                        self.expect_key = False
                    self.string_kind = ""
                elif self.string_kind == "key":
                    self.key_parts.append(char)
                continue
            root = len(self.stack) == 1 and self.stack[0] == "{"
            if char == '"':
                self.string_kind = "key" if root and self.expect_key else "reply" if root and self.expect_reply else "skip"
                self.key_parts = []
                self.expect_reply = False
            elif char in "{[":
                self.stack.append(char)
                if len(self.stack) == 1:
                    self.expect_key = True
                self.expect_reply = False
            elif char in "}]":
                if self.stack:
                    self.stack.pop()
            elif root and char == ",":
                self.expect_key = True
                self.expect_reply = False
            elif root and char == ":":
                self.expect_reply = self.key == "reply"
            elif not char.isspace():
                self.expect_reply = False

    def _reply_character(self, char: str) -> None:
        if self.unicode_digits is not None:
            self.unicode_digits += char
            if len(self.unicode_digits) == 4:
                code = int(self.unicode_digits, 16)
                self.unicode_digits = None
                if self.high_surrogate is not None:
                    if not 0xDC00 <= code <= 0xDFFF:
                        raise ValueError("Invalid reply Unicode surrogate pair")
                    self.parts.append(chr(0x10000 + ((self.high_surrogate - 0xD800) << 10) + code - 0xDC00))
                    self.high_surrogate = None
                elif 0xD800 <= code <= 0xDBFF:
                    self.high_surrogate = code
                else:
                    self.parts.append(chr(code))
            return
        if self.escaped:
            self.escaped = False
            if char == "u":
                self.unicode_digits = ""
            else:
                if self.high_surrogate is not None:
                    raise ValueError("Invalid reply Unicode surrogate pair")
                self.parts.append(json.loads('"\\' + char + '"'))
        elif char == "\\":
            self.escaped = True
        elif self.high_surrogate is not None:
            raise ValueError("Invalid reply Unicode surrogate pair")
        elif char == '"':
            self.done = True
        else:
            self.parts.append(char)


def stream_turn(provider, messages: list[dict], *, progress: AgentProgressCallback | None, phase="commentary", call_kind="conversation", **kwargs) -> AssistantTurn:
    with measure_model_call(call_kind, provider.model) as timing:
        return _stream_turn(provider, messages, progress=progress, phase=phase, timing=timing, **kwargs)


def _stream_turn(provider, messages: list[dict], *, progress: AgentProgressCallback | None, phase, timing: dict, **kwargs) -> AssistantTurn:
    started = time.monotonic()
    stream = creation_client(provider).chat.completions.create(
        model=provider.model, messages=messages, stream=True, **kwargs,
    )
    turn = AssistantTurn()
    calls: dict[int, ToolCall] = {}
    event_id = uuid.uuid4().hex
    emitted = ""
    last_emit = 0.0
    last_job_check = 0.0
    parser = ReplyStreamParser()
    content_parts: list[str] = []
    finish_reason = None
    try:
        for chunk in stream:
            now = time.monotonic()
            if now - last_job_check >= 0.25:
                check_current_job()
                last_job_check = now
            if not chunk.choices:
                continue
            choice = chunk.choices[0]
            finish_reason = choice.finish_reason or finish_reason
            delta = choice.delta
            if timing["first_token_ms"] is None and (delta.content or delta.tool_calls):
                timing["first_token_ms"] = round((now - started) * 1000)
            if delta.content:
                content_parts.append(delta.content)
                parser.feed(delta.content)
                if progress and now - last_emit >= 0.2:
                    visible = parser.text
                    if visible != emitted:
                        progress("agent_response", "", AgentMessageEvent(
                            id=event_id, content=visible, streaming=True, phase=phase,
                        ))
                        emitted = visible
                        last_emit = now
            for part in delta.tool_calls or []:
                call = calls.setdefault(part.index, ToolCall())
                call.id += part.id or ""
                if part.function:
                    call.function.name += part.function.name or ""
                    call.function.arguments += part.function.arguments or ""
        check_current_job()
        turn.content = "".join(content_parts)
        if finish_reason == "length":
            raise ValueError("Agent response exceeded the model output limit")
        if not turn.content.strip() and not calls:
            raise ValueError("Agent returned an empty response")
        turn.tool_calls = list(calls.values())
        visible = parser.text.strip()
        if visible and progress:
            progress("agent_response", "", AgentMessageEvent(
                id=event_id, content=visible, phase=phase,
            ))
        return turn
    finally:
        stream.close()


def upsert_event(events: list[dict], event: dict) -> None:
    for index, existing in enumerate(events):
        if existing.get("id") == event["id"]:
            events[index] = event
            return
    events.append(event)
