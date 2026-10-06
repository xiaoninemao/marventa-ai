import json
import time
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app import config
from app.engines.market_insight import ai_analyzer, storage
from app.engines.market_insight import research_agent as agent
from app.engines.market_insight.models import (
    AIAnalysis,
    InsightResearch,
    ParsedDocument,
)
from app.engines.market_insight.research_web import SearchHit, WebPage
from tests import test_market_insight_recovery as recovery_tests
from tests import test_project_memberships as membership_tests


def completion(content=None, calls=None):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content, tool_calls=calls))])


def tool(name, arguments, call_id="call-1"):
    return SimpleNamespace(id=call_id, function=SimpleNamespace(name=name, arguments=json.dumps(arguments)))


def payload():
    return {
        "product_name": "Private product", "product_summary": "A document-based summary.",
        "research": {
            "sources": [{"id": "fake", "url": "https://fabricated.example"}],
            "status": "completed",
            "claims": [
                {"id": "c1", "text": "Competitor says it has a free plan.", "kind": "fact",
                 "source_ids": ["web-1"], "quote": "Free plan available."},
                {"id": "c2", "text": "Private product may compete on deployment.", "kind": "inference",
                 "source_ids": ["document-1", "web-2"], "quote": ""},
            ],
            "competitors": [{"name": "Competitor", "comparison": "Offers a free plan; deployment differs.",
                             "source_ids": ["document-1", "web-1"]}],
        },
    }


class ResearchAgentTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.object(config, "INSIGHT_RESEARCH_ENABLED", False))
        self.document = ParsedDocument(
            title="SECRET PRODUCT NAME", source_type="markdown",
            raw_text="SECRET UPLOADED RAW CONTENT with PRIVATE tokens.",
        )
        self.analysis = AIAnalysis(product_name="Private product", product_category="marketing",
                                   product_summary="Document summary")
        self.provider = MagicMock()
        self.provider.search.return_value = [
            SearchHit("A", "https://a.example"), SearchHit("B", "https://b.example"),
        ]
        self.reader = MagicMock(side_effect=lambda url, **kwargs: WebPage(
            "Competitor", url + "/final", "Free plan available. Deployment is cloud hosted.",
        ))
        self.client = MagicMock()
        self.ai_provider = SimpleNamespace(configured=True, model="test-model")
        self.enterContext(patch.object(
            agent,
            "get_ai_provider",
            return_value=self.ai_provider,
        ))

    def run_research(self, responses):
        self.client.chat.completions.create.side_effect = responses
        return agent.research_analysis(self.document, self.analysis, self.client, locale="en",
                                       provider=self.provider, reader=self.reader)

    def happy_responses(self, synthesis=None):
        return [
            completion(calls=[tool("search", {"query": "marketing software competitors"})]),
            completion(calls=[
                tool("read_webpage", {"url": "https://a.example"}, "read-1"),
                tool("read_webpage", {"url": "https://b.example"}, "read-2"),
            ]),
            completion("Sufficient public evidence."),
            completion(json.dumps(synthesis or payload())),
        ]

    def test_adaptive_success_real_sources_quote_provenance_and_locale(self):
        result = self.run_research(self.happy_responses())
        self.assertEqual(result.research.status, "completed")
        self.assertEqual([source.id for source in result.research.sources], ["document-1", "web-1", "web-2"])
        self.assertEqual(result.research.sources[1].url, "https://a.example/final")
        self.assertNotIn("fabricated", result.model_dump_json())
        self.assertEqual(result.research.claims[0].quote, "Free plan available.")
        self.assertIsNotNone(result.research.searched_at)
        synthesis = self.client.chat.completions.create.call_args_list[-1].kwargs
        self.assertNotIn("tools", synthesis)
        self.assertIn("requested output language is English", synthesis["messages"][0]["content"])
        self.assertIn(agent.PROVENANCE_LIMITATION, result.research.limitations)

    def test_analyzer_wires_document_summary_public_tools_and_preserved_summary_fields(self):
        self.client.chat.completions.create.side_effect = [
            completion(json.dumps({"product_name": "Private product", "product_category": "marketing",
                                   "product_summary": "Document summary", "strengths": ["From upload"]})),
            *self.happy_responses(),
        ]
        def research(document, summary, client, *, locale, provider):
            return agent.research_analysis(document, summary, client, locale=locale,
                                           provider=provider, reader=self.reader)
        with patch.object(ai_analyzer, "get_ai_provider", return_value=self.ai_provider), patch.object(
            ai_analyzer, "_get_case_ai_client", return_value=self.client,
        ), patch.object(
            ai_analyzer, "_get_research_ai_client", return_value=self.client,
        ), patch.object(ai_analyzer, "configured_provider", return_value=(self.provider, "")), patch.object(
            ai_analyzer, "research_analysis", side_effect=research,
        ):
            result = ai_analyzer.analyze_document(self.document, locale="en")
        self.assertEqual(result.ai_analysis.research.status, "completed")
        self.assertEqual(result.ai_analysis.strengths, ["From upload"])
        self.assertEqual(result.ai_model, "test-model")
        self.assertEqual(self.provider.search.call_count, 1)

    def test_document_summary_does_not_create_research_client_when_public_research_is_unavailable(self):
        for enabled, key in ((False, ""), (True, "")):
            with self.subTest(enabled=enabled), patch.object(config, "INSIGHT_RESEARCH_ENABLED", enabled), \
                    patch.object(config, "TAVILY_API_KEY", key), \
                    patch.object(ai_analyzer, "get_ai_provider", return_value=self.ai_provider), \
                    patch.object(ai_analyzer, "_has_case_ai_provider", return_value=True), \
                    patch.object(ai_analyzer, "_analyze_text", return_value=self.analysis.model_copy(deep=True)), \
                    patch.object(ai_analyzer, "_get_case_ai_client") as analysis_client, \
                    patch.object(ai_analyzer, "_get_research_ai_client") as research_client:
                result = ai_analyzer.analyze_document(self.document, locale="en")
                analysis_client.assert_not_called()
                research_client.assert_not_called()
                self.assertEqual(result.ai_analysis.product_summary, "Document summary")
                self.assertEqual(result.ai_analysis.research.status, "unavailable")
                self.assertEqual(result.ai_model, "test-model")
        self.provider.search.assert_not_called()
        self.reader.assert_not_called()

    def test_tool_context_and_search_never_contain_private_document(self):
        snapshots = []
        responses = iter(self.happy_responses())
        def model(**kwargs):
            snapshots.append(json.dumps(kwargs["messages"]))
            return next(responses)
        self.client.chat.completions.create.side_effect = model
        agent.research_analysis(self.document, self.analysis, self.client, locale="zh-CN",
                                provider=self.provider, reader=self.reader)
        for text in snapshots[:-1]:
            self.assertNotIn("SECRET", text)
            self.assertNotIn("Private product", text)
        self.assertIn("SECRET UPLOADED", snapshots[-1])
        self.assertNotIn("SECRET", str(self.provider.search.call_args_list))

    def test_search_queries_are_closed_vocabulary_even_if_model_supplies_secrets_or_urls(self):
        for requested in (
            "SECRET PRIVATE NAME pricing api_key=abcdef",
            "https://user:password@example.com/private",
            "SECRET UPLOADED RAW CONTENT deployment features",
        ):
            with self.subTest(requested=requested):
                query = agent.public_query(agent.public_topic("marketing SECRET"), requested)
                self.assertNotIn("SECRET", query)
                self.assertNotIn("PRIVATE", query)
                self.assertNotIn("password", query)
                self.assertNotIn("abcdef", query)
                self.assertNotIn("https", query)
                self.assertTrue(query.startswith("marketing software "))
        self.run_research([
            completion(calls=[tool("search", {"query": "SECRET private product pricing api_key=abcdef"})]),
            completion("Done"),
        ])
        self.assertEqual(self.provider.search.call_args.args[0], "marketing software pricing")

    def test_not_configured_disabled_and_unsupported_never_call_external_tools(self):
        for enabled, provider, key in ((False, "tavily", "fake"), (True, "tavily", ""),
                                       (True, "other", "fake")):
            with self.subTest(enabled=enabled, provider=provider), \
                    patch.object(config, "INSIGHT_RESEARCH_ENABLED", enabled), \
                    patch.object(config, "INSIGHT_SEARCH_PROVIDER", provider), \
                    patch.object(config, "TAVILY_API_KEY", key), patch.object(agent, "TavilySearch") as adapter:
                result = agent.research_analysis(self.document, self.analysis, self.client, locale="en")
                self.assertEqual(result.research.status, "unavailable")
                self.assertIsNone(result.research.searched_at)
                adapter.assert_not_called()
        self.client.chat.completions.create.assert_not_called()

    def test_invalid_references_quotes_and_competitor_refs_are_discarded(self):
        bad = payload()
        bad["research"]["claims"][0]["quote"] = "A nonexistent price claim."
        bad["research"]["claims"][1]["source_ids"] = ["fake"]
        bad["research"]["competitors"][0]["source_ids"] = ["fake"]
        result = self.run_research(self.happy_responses(bad))
        self.assertEqual(result.research.status, "partial")
        self.assertEqual(result.research.claims, [])
        self.assertEqual(result.research.competitors, [])
        self.assertIn("discarded", " ".join(result.research.limitations))

    def test_completed_requires_real_web_pages_and_a_literal_cited_public_claim(self):
        for claims, competitors in (
            ([], []),
            ([{"id": "doc", "text": "Document statement", "kind": "fact",
               "source_ids": ["document-1"], "quote": "SECRET UPLOADED RAW CONTENT"}],
             payload()["research"]["competitors"]),
            ([{"id": "inference", "text": "Hypothesis", "kind": "inference",
               "source_ids": ["web-1"], "quote": ""}],
             payload()["research"]["competitors"]),
        ):
            with self.subTest(claims=claims):
                synthesis = payload()
                synthesis["research"]["claims"] = claims
                synthesis["research"]["competitors"] = competitors
                result = self.run_research(self.happy_responses(synthesis))
                self.assertEqual(result.research.status, "partial")
                self.assertIn("No public-web statement", " ".join(result.research.limitations))
        result = self.run_research([
            completion(calls=[tool("search", {"query": "competitors"})]),
            completion("Search snippets are sufficient."),
        ])
        self.assertEqual(result.research.status, "unavailable")
        self.assertFalse(any(source.kind == "web" for source in result.research.sources))

    def test_facts_require_quote_inferences_require_references_and_duplicate_ids_rejected(self):
        bad = payload()
        bad["research"]["claims"][0]["quote"] = ""
        bad["research"]["claims"].append(bad["research"]["claims"][1].copy())
        result = self.run_research(self.happy_responses(bad))
        self.assertEqual(result.research.status, "partial")
        self.assertEqual(len(result.research.claims), 1)

    def test_synthesis_invalid_json_retains_original_summary_as_partial(self):
        for raw in ('{"product_name":"x",}', json.dumps(payload())[:-1] + ',"unused":NaN}'):
            with self.subTest(raw=raw):
                responses = self.happy_responses()
                responses[-1] = completion(raw)
                result = self.run_research(responses)
                self.assertEqual(result.research.status, "partial")
                self.assertEqual(result.product_summary, "Document summary")
                self.assertEqual(result.research.claims, [])
                self.assertIn("synthesis failed", " ".join(result.research.limitations))

    def test_model_unsupported_or_empty_tool_response_is_explicit_unavailable(self):
        for response in (ValueError("SECRET provider body"), completion()):
            with self.subTest(response=type(response).__name__):
                result = self.run_research([response])
                self.assertEqual(result.research.status, "unavailable")
                self.assertIn("tool calling unavailable", " ".join(result.research.limitations))
                self.assertNotIn("SECRET provider", result.model_dump_json())
        self.provider.search.assert_not_called()

    def test_read_only_search_result_urls_no_model_fabricated_sources(self):
        result = self.run_research([
            completion(calls=[tool("read_webpage", {"url": "https://made-up.example"})]),
            completion("Done"),
        ])
        self.reader.assert_not_called()
        self.assertEqual(result.research.status, "unavailable")
        self.assertEqual(len(result.research.sources), 1)

    def test_provider_errors_report_unavailable_and_no_fake_sources(self):
        self.provider.search.side_effect = RuntimeError("SECRET KEY")
        result = self.run_research([
            completion(calls=[tool("search", {"query": "software"})]), completion("Done"),
        ])
        self.assertEqual(result.research.status, "unavailable")
        self.assertNotIn("SECRET KEY", result.model_dump_json())

    def test_search_and_read_caps_even_when_model_repeats_tools(self):
        calls = [tool("search", {"query": "public competitors"}, f"search-{i}") for i in range(8)]
        result = self.run_research([completion(calls=calls), completion("Done")])
        self.assertEqual(self.provider.search.call_count, 6)
        self.assertEqual(result.research.status, "unavailable")
        self.provider.reset_mock()
        self.provider.search.return_value = [SearchHit(str(i), f"https://page-{i}.example") for i in range(5)]
        responses = [completion(calls=[tool("search", {"query": "software"})])]
        responses += [completion(calls=[tool("read_webpage", {"url": f"https://page-{i % 5}.example"}, f"read-{i}")])
                      for i in range(10)]
        responses.append(completion("Done"))
        result = self.run_research(responses)
        self.assertLessEqual(self.reader.call_count, agent.MAX_READS)
        self.assertEqual(result.research.status, "partial")
        requested = sum(call.kwargs["max_tokens"] for call in self.client.chat.completions.create.call_args_list)
        # The previous separate search-only run consumed 2,048 requested tokens.
        self.assertLessEqual(requested - 2048, agent.MAX_OUTPUT_TOKENS)

    def test_read_budget_exactly_twelve_with_no_extra_outgoing_reads(self):
        responses = []
        for batch in range(3):
            urls = [f"https://p-{batch}-{i}.example" for i in range(5)]
            responses.extend([
                completion(calls=[tool("search", {"query": "public software"}, f"search-{batch}")]),
                completion(calls=[tool("read_webpage", {"url": url}, f"read-{batch}-{i}")
                                  for i, url in enumerate(urls)]),
            ])
        self.provider.search.side_effect = [
            [SearchHit("Page", f"https://p-{batch}-{i}.example") for i in range(5)] for batch in range(3)
        ]
        responses.extend([completion("Done"), completion(json.dumps(payload()))])
        result = self.run_research(responses)
        self.assertEqual(self.reader.call_count, 12)
        self.assertEqual(len(result.research.sources), 13)
        self.assertEqual(result.research.status, "partial")

    def test_deadline_before_model_and_lease_loss_after_search_stop_outgoing_work(self):
        self.document._analysis_deadline = time.monotonic() - 1
        result = self.run_research([])
        self.assertEqual(result.research.status, "unavailable")
        self.client.chat.completions.create.assert_not_called()
        self.document._analysis_deadline = None
        lost = False
        def guard():
            if lost:
                raise agent.AnalysisCancelled("lease lost")
        def search(*args, **kwargs):
            nonlocal lost
            lost = True
            return [SearchHit("A", "https://a.example")]
        self.document._analysis_guard = guard
        self.provider.search.side_effect = search
        with self.assertRaises(agent.AnalysisCancelled):
            self.run_research([completion(calls=[tool("search", {"query": "public"})])])
        self.reader.assert_not_called()
        self.assertEqual(self.client.chat.completions.create.call_count, 1)

    def test_no_longer_live_guard_prevents_initial_summary_model_call(self):
        self.document._analysis_guard = lambda: (_ for _ in ()).throw(agent.AnalysisCancelled("lost"))
        with patch.object(ai_analyzer, "get_ai_provider", return_value=self.ai_provider), patch.object(
            ai_analyzer, "_get_case_ai_client", return_value=self.client,
        ), patch.object(
            ai_analyzer, "_get_research_ai_client", return_value=self.client,
        ), self.assertRaises(agent.AnalysisCancelled):
            ai_analyzer.analyze_document(self.document)
        self.client.chat.completions.create.assert_not_called()

    def test_bad_summary_json_is_failure_not_empty_success(self):
        for text in ('{"product_name":"x",}', "not JSON", "[]", "{}", '{"strengths":[]}',
                     '{"product_name":"X","unused":NaN}', '{"product_name":"X","unused":Infinity}',
                     '{"product_name":"X","product_name":"Y"}'):
            with self.subTest(text=text), self.assertRaises(ValueError):
                ai_analyzer._parse_json_response(text)

    def test_optional_contract_reads_old_json_without_migration(self):
        self.assertIsNone(AIAnalysis.model_validate_json('{"product_name":"Old"}').research)

    def test_wall_clock_timeout_cancels_hung_model_io(self):
        import threading

        release = threading.Event()
        cancelled = MagicMock(side_effect=release.set)
        try:
            with self.assertRaises(TimeoutError):
                agent.bounded_call(lambda: release.wait(2), timeout=0.01, guard=lambda: None,
                                   cancel=cancelled)
        finally:
            release.set()
        cancelled.assert_called_once()

    def test_context_budget_drops_complete_tool_groups_not_orphan_messages(self):
        messages = [
            {"role": "system", "content": "Research"},
            {"role": "user", "content": "Public category"},
            {"role": "assistant", "content": None, "tool_calls": [{"id": "a"}]},
            {"role": "tool", "tool_call_id": "a", "content": "x" * agent.MAX_CONTEXT_BYTES},
            {"role": "assistant", "content": None, "tool_calls": [{"id": "b"}]},
            {"role": "tool", "tool_call_id": "b", "content": "Latest evidence"},
        ]
        bounded = agent._planning_context(messages)
        self.assertEqual([message["role"] for message in bounded], ["system", "user", "assistant", "tool"])
        self.assertEqual(bounded[-1]["tool_call_id"], "b")


class ResearchPersistenceTests(unittest.TestCase):
    setUp = recovery_tests.MarketInsightRecoveryTests.setUp
    save = recovery_tests.MarketInsightRecoveryTests.save
    row = recovery_tests.MarketInsightRecoveryTests.row

    def test_research_persists_and_api_json_remains_backward_compatible(self):
        doc, record = self.save()
        analysis = AIAnalysis(product_name="Research", research=InsightResearch(status="partial",
                              limitations=["Insufficient evidence"]))
        self.assertTrue(storage.finish_analysis(record.id, doc._analysis_attempt_id, analysis))
        self.assertEqual(storage.get_insight(record.id).ai_analysis, analysis)
        self.assertEqual(storage.list_history(self.owner["id"])[0].ai_analysis.research.status, "partial")

    def test_edit_preserves_only_stored_sources_and_invalidates_status(self):
        previous = AIAnalysis(product_name="Before", research=InsightResearch(status="completed",
                              sources=[agent._source("document-1", "Original", "Original source")]))
        _, record = self.save(status="completed", analysis=previous)
        incoming = AIAnalysis(product_name="After", research=InsightResearch(status="completed",
                              sources=[agent._source("fake", "Forged", "Invented", "https://fake.example")]))
        updated = storage.update_insight(record.id, incoming, self.owner["id"])
        self.assertEqual(updated.ai_analysis.research.status, "edited")
        self.assertEqual(updated.ai_analysis.research.sources, previous.research.sources)
        self.assertNotIn("fake.example", updated.model_dump_json())
        # Omitting research from a legacy client must not silently discard previous provenance.
        updated = storage.update_insight(record.id, AIAnalysis(product_name="Again"), self.owner["id"])
        self.assertEqual(len(updated.ai_analysis.research.sources), 1)

    def test_manual_cannot_fabricate_verified_research_and_rename_invalidates(self):
        analysis = AIAnalysis(product_name="Manual", research=InsightResearch(status="completed",
                              sources=[agent._source("fake", "Fake", "Unretrieved", "https://fake.example")]))
        record = storage.save_manual_insight(analysis, self.owner["id"], self.project.id)
        self.assertIsNone(record.ai_analysis.research)
        connection = storage._get_conn()
        try:
            connection.execute("UPDATE insights SET ai_analysis = ? WHERE id = ?",
                               (analysis.model_dump_json(), record.id))
            connection.commit()
        finally:
            connection.close()
        self.assertIsNone(storage.get_insight(record.id).ai_analysis.research)
        updated = storage.update_insight(record.id, analysis, self.owner["id"])
        self.assertIsNone(updated.ai_analysis.research)
        renamed_manual = storage.rename_insight(record.id, "Manual renamed", self.owner["id"])
        self.assertIsNone(renamed_manual.ai_analysis.research)
        previous = AIAnalysis(product_name="Automated", research=InsightResearch(status="completed"))
        _, automatic = self.save(status="completed", analysis=previous)
        renamed = storage.rename_insight(automatic.id, "New display title", self.owner["id"])
        self.assertEqual(renamed.ai_analysis.research.status, "edited")

    def test_analyzing_record_cannot_be_edited_and_overwritten_by_live_worker(self):
        _, record = self.save()
        with self.assertRaises(storage.InsightRetryNotAllowed):
            storage.update_insight(record.id, AIAnalysis(product_name="Manual"), self.owner["id"])


class ResearchApiTests(unittest.TestCase):
    setUp = membership_tests.ProjectMembershipTests.setUp
    headers = staticmethod(membership_tests.ProjectMembershipTests.headers)

    def test_api_history_and_edit_preserve_research_but_never_trust_incoming_verification(self):
        analysis = AIAnalysis(product_name="Public evidence", research=InsightResearch(
            status="completed", sources=[agent._source("document-1", "Uploaded", "Original text")],
        ))
        document = ParsedDocument(title="Uploaded", source_type="markdown", ai_analysis=analysis)
        record = storage.save_insight(document, "upload.md", 10, self.owner["id"], self.project.id, "completed")
        detail = self.client.get(f"/api/v1/market_insight/history/{record.id}",
                                 headers=self.headers(self.owner["id"]))
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertEqual(detail.json()["data"]["ai_analysis"]["research"]["status"], "completed")
        request = {"ai_analysis": {"product_name": "Edited", "research": {
            "status": "completed", "sources": [agent._source("fake", "Forged", "Fake", "https://fake.example").model_dump()],
        }}}
        edited = self.client.put(f"/api/v1/market_insight/history/{record.id}",
                                headers=self.headers(self.owner["id"]), json=request)
        self.assertEqual(edited.status_code, 200, edited.text)
        research = edited.json()["data"]["ai_analysis"]["research"]
        self.assertEqual(research["status"], "edited")
        self.assertEqual(research["sources"][0]["id"], "document-1")
        self.assertNotIn("fake.example", edited.text)

    def test_manual_api_cannot_promote_client_supplied_research_to_completed(self):
        response = self.client.post("/api/v1/market_insight/manual", headers=self.headers(self.owner["id"]),
                                    json={"project_id": self.project.id, "ai_analysis": {
                                        "product_name": "Manual", "research": {"status": "completed"},
                                    }})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIsNone(response.json()["data"]["ai_analysis"]["research"])

    def test_manual_ai_retry_is_rejected_without_provider_calls(self):
        analysis = AIAnalysis(product_name="Manual", research=InsightResearch(status="completed"))
        record = storage.save_manual_insight(analysis, self.owner["id"], self.project.id)
        response = self.client.post(f"/api/v1/market_insight/history/{record.id}/retry",
                                    headers=self.headers(self.owner["id"]))
        self.assertEqual(response.status_code, 409, response.text)
        document = ParsedDocument(title="Manual", source_type="manual", ai_analysis=analysis)
        with patch.object(ai_analyzer, "_get_case_ai_client") as provider, patch.object(
            ai_analyzer, "_get_research_ai_client",
        ) as research_provider:
            result = ai_analyzer.analyze_document(document)
        provider.assert_not_called()
        research_provider.assert_not_called()
        self.assertIsNone(result.ai_analysis.research)


if __name__ == "__main__":
    unittest.main()
