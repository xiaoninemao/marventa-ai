import socket
import unittest
from unittest.mock import MagicMock, patch

from app.engines.market_insight import research_web as web


def address(ip="93.184.216.34"):
    return (socket.AF_INET6 if ":" in ip else socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 443))


class WebSafetyTests(unittest.TestCase):
    def test_url_rejects_credentials_protocols_ports_and_ambiguous_hosts(self):
        for url in (
            "file:///etc/passwd", "ftp://example.com/a", "https://user:pass@example.com",
            "https://example.com:8080", "https://example.com\\@127.0.0.1/",
            "https://[fe80::1%25en0]/", "https://example.com/\nsecret",
        ):
            with self.subTest(url=url), self.assertRaises(web.WebToolError):
                web.public_url(url)
        self.assertEqual(web.public_url("https://example.com/test#fragment")[0], "https://example.com/test")

    def test_all_dns_answers_must_be_public_including_mapped_addresses(self):
        for ip in ("127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "fc00::1",
                   "224.0.0.1", "::ffff:93.184.216.34", "100.64.0.1", "0.0.0.0",
                   "64:ff9b::7f00:1", "2002:7f00:1::1"):
            with self.subTest(ip=ip), patch.object(web.socket, "getaddrinfo", return_value=[
                address(), address(ip),
            ]), self.assertRaises(web.WebToolError):
                web.resolve_public("example.com", 443)

    def test_dns_timeout_is_bounded(self):
        from threading import Event

        release = Event()
        def resolve(*args, **kwargs):
            release.wait(1)
            return [address()]
        try:
            with patch.object(web.socket, "getaddrinfo", side_effect=resolve), self.assertRaises(TimeoutError):
                web.resolve_public("example.com", 443, timeout=0.01)
        finally:
            release.set()

    def test_connection_pins_ip_and_uses_original_tls_hostname(self):
        sock = MagicMock()
        context = MagicMock()
        with patch.object(web.socket, "socket", return_value=sock), patch.object(
            web.ssl, "create_default_context", return_value=context,
        ), patch.object(web.socket, "getaddrinfo", side_effect=AssertionError("Rebinding resolution")):
            connection = web._PinnedConnection("example.com", 443, address(), "https", 5)
            connection.connect()
        sock.connect.assert_called_once_with(("93.184.216.34", 443))
        context.wrap_socket.assert_called_once_with(sock, server_hostname="example.com")

    def fetch(self, responses, url="https://example.com"):
        connections = []
        for response in responses:
            conn = MagicMock()
            conn.getresponse.return_value = response
            connections.append(conn)
        def dns(host, port, **kwargs):
            if host == "127.0.0.1":
                raise web.WebToolError("private")
            return [address()]
        with patch.object(web, "resolve_public", side_effect=dns), patch.object(
            web, "_PinnedConnection", side_effect=connections,
        ) as factory:
            return web.fetch_public_page(url), factory, connections

    @staticmethod
    def response(body=b"<title>Example</title><p>Actual quote.</p>", headers=None, status=200):
        headers = {"Content-Type": "text/html", **(headers or {})}
        response = MagicMock(status=status)
        response.getheader.side_effect = lambda name, default=None: headers.get(name, default)
        response.read1.side_effect = [body, b""]
        return response

    def test_html_strips_script_style_and_normalizes_text(self):
        page, _, connections = self.fetch([self.response(
            b"<title>Example</title><script>SECRET()</script><style>hidden</style>"
            b"<p>Actual   quote.</p><iframe>injected</iframe>",
        )])
        self.assertEqual(page.url, "https://example.com/")
        self.assertEqual(page.title, "Example")
        self.assertEqual(page.text, "Example Actual quote.")
        connections[0].close.assert_called_once()

    def test_redirect_target_revalidated_before_connecting(self):
        with self.assertRaises(web.WebToolError):
            self.fetch([self.response(headers={"Location": "http://127.0.0.1/"}, status=302)])

    def test_public_redirect_records_actual_final_url(self):
        page, factory, _ = self.fetch([
            self.response(headers={"Location": "https://other.example/final"}, status=302),
            self.response(),
        ])
        self.assertEqual(page.url, "https://other.example/final")
        self.assertEqual(factory.call_count, 2)

    def test_size_type_compression_status_and_redirect_limits(self):
        failures = [
            [self.response(headers={"Content-Length": str(web.MAX_PAGE_BYTES + 1)})],
            [self.response(b"x" * (web.MAX_PAGE_BYTES + 1))],
            [self.response(headers={"Content-Type": "application/pdf"})],
            [self.response(headers={"Content-Encoding": "gzip"})],
            [self.response(status=403)],
            [self.response(headers={"Location": "/next"}, status=302) for _ in range(4)],
            [self.response(b"<script>only script</script>")],
        ]
        for responses in failures:
            with self.subTest(responses=len(responses)), self.assertRaises(web.WebToolError):
                self.fetch(responses)

    def test_guard_stops_request_before_dns(self):
        with patch.object(web, "resolve_public") as resolver, self.assertRaises(RuntimeError):
            web.fetch_public_page("https://example.com", guard=lambda: (_ for _ in ()).throw(RuntimeError("lost")))
        resolver.assert_not_called()

    def test_tavily_uses_fixed_endpoint_and_bounded_discovery_only(self):
        response = MagicMock()
        response.iter_bytes.return_value = [
            b'{"results":[{"title":"A","url":"https://example.com","content":"untrusted snippet"}]}',
        ]
        client = MagicMock()
        client.stream.return_value.__enter__.return_value = response
        with patch.object(web.httpx, "Client") as factory:
            factory.return_value.__enter__.return_value = client
            hits = web.TavilySearch("fake-key").search("public software", timeout=5)
        self.assertEqual(hits, [web.SearchHit("A", "https://example.com")])
        args = client.stream.call_args
        self.assertEqual(args.args[:2], ("POST", "https://api.tavily.com/search"))
        self.assertFalse(args.kwargs["json"]["include_raw_content"])
        self.assertFalse(factory.call_args.kwargs["trust_env"])


if __name__ == "__main__":
    unittest.main()
