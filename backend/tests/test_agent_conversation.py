import json
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.engines.content_generator.agent_conversation import (
    ReplyStreamParser,
    stream_turn,
    visible_reply,
)


class ConversationTests(unittest.TestCase):
    def test_incremental_parser_preserves_reply_at_every_fragment_boundary(self):
        samples = [
            '{"handoff":"SECRET","reply":"Hello\\nWorld\\"quote","title":"PRIVATE"}',
            '{"nested":[{"reply":"SECRET"}],"reply":"\\u4e2d\\u6587\\ud83d\\ude00"}',
            '```json\n{"title":"SECRET","reply":"Ready"}\n```',
            'Natural conversational text.',
        ]
        for sample in samples:
            for width in (1, 2, 5, 13):
                with self.subTest(sample=sample, width=width):
                    parser = ReplyStreamParser()
                    for index in range(0, len(sample), width):
                        parser.feed(sample[index:index + width])
                        self.assertNotIn("SECRET", parser.text)
                        self.assertNotIn("PRIVATE", parser.text)
                    self.assertEqual(parser.text, visible_reply(sample))

    def test_incremental_parser_work_is_bounded_by_input_length(self):
        sample = json.dumps({"handoff": "hidden" * 10000, "reply": "Shown" * 4000})
        parser = ReplyStreamParser()
        for index in range(0, len(sample), 7):
            parser.feed(sample[index:index + 7])
        self.assertEqual(parser.text, "Shown" * 4000)
        self.assertLessEqual(parser.characters_processed, len(sample))

    def test_incomplete_json_unicode_and_fences_never_expose_metadata(self):
        for sample in ('```jso', '{"handoff":"PRIVATE"}', '{"reply":"\\ud83d', '{"reply":"\\u4e'):
            parser = ReplyStreamParser()
            for char in sample:
                parser.feed(char)
            self.assertEqual(parser.text, "")

    def test_partial_json_reveals_reply_only_and_preserves_escaped_text(self):
        self.assertEqual(visible_reply('{"handoff":"SECRET","reply":"Hello'), "Hello")
        self.assertEqual(visible_reply('{"title":"SECRET","reply":"First\\nSecond\\"quote'), 'First\nSecond"quote')
        self.assertEqual(visible_reply('{"handoff":"reply","reply":"Visible"}'), "Visible")
        self.assertEqual(visible_reply('{"handoff":"SECRET"}'), "")
        self.assertEqual(visible_reply("```jso"), "")
        self.assertEqual(visible_reply('{"reply":"\\u4e2d\\u6587\\ud83d\\ude00"}'), "中文😀")
        self.assertEqual(visible_reply('{"reply":"\\ud83d'), "")
        self.assertEqual(visible_reply("I will inspect the selected image."), "I will inspect the selected image.")

    def test_reply_is_emitted_before_the_model_finishes_and_hidden_handoff_never_leaks(self):
        updates = []
        provider = MagicMock(model="model")

        class Stream:
            closed = False

            def __iter__(self):
                yield SimpleNamespace(choices=[SimpleNamespace(
                    delta=SimpleNamespace(content='{"reply":"I will inspect', tool_calls=[]), finish_reason=None,
                )])
                assert any(event.content == "I will inspect" and event.streaming for event in updates)
                yield SimpleNamespace(choices=[SimpleNamespace(
                    delta=SimpleNamespace(content=' the image.","handoff":"PRIVATE"}', tool_calls=[]),
                    finish_reason="stop",
                )])

            def close(self):
                self.closed = True

        stream = Stream()
        provider.client.return_value.chat.completions.create.return_value = stream
        result = stream_turn(provider, [], progress=lambda stage, message, event: updates.append(event))
        self.assertIn("PRIVATE", result.content)
        self.assertEqual(updates[-1].content, "I will inspect the image.")
        self.assertFalse(updates[-1].streaming)
        self.assertTrue(stream.closed)
        self.assertTrue(all("PRIVATE" not in event.content and "handoff" not in event.content for event in updates))
        self.assertTrue(provider.client.return_value.chat.completions.create.call_args.kwargs["stream"])

    def test_length_limited_model_output_is_not_repaired_into_a_success(self):
        provider = MagicMock(model="model")
        stream = MagicMock()
        stream.__iter__.return_value = iter([SimpleNamespace(choices=[SimpleNamespace(
            delta=SimpleNamespace(content=json.dumps({"reply": "Partial"}), tool_calls=[]),
            finish_reason="length",
        )])])
        provider.client.return_value.chat.completions.create.return_value = stream
        with self.assertRaisesRegex(ValueError, "output limit"):
            stream_turn(provider, [], progress=None)
        stream.close.assert_called_once()

    def test_dense_token_stream_throttles_job_checks_and_closes_stream(self):
        provider = MagicMock(model="model")
        stream = MagicMock()
        stream.__iter__.return_value = iter([
            SimpleNamespace(choices=[SimpleNamespace(
                delta=SimpleNamespace(content="a", tool_calls=[]), finish_reason=None,
            )]) for _ in range(1000)
        ])
        provider.client.return_value.chat.completions.create.return_value = stream
        with patch("app.engines.content_generator.agent_conversation.time.monotonic", return_value=1.0), patch(
            "app.engines.content_generator.agent_conversation.check_current_job",
        ) as check:
            result = stream_turn(provider, [], progress=None)
        self.assertEqual(result.content, "a" * 1000)
        self.assertEqual(check.call_count, 2)
        stream.close.assert_called_once()
