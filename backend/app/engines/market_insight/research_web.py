"""Bounded public-web tools. Search snippets are discovery, never evidence."""
from __future__ import annotations

import http.client
import ipaddress
import json
import socket
import ssl
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from html.parser import HTMLParser
from queue import Empty, Queue
from typing import Protocol
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx

MAX_PAGE_BYTES = 512_000
MAX_PAGE_CHARS = 4_000
MAX_REDIRECTS = 3
_TRANSITION_NETWORKS = tuple(ipaddress.ip_network(network) for network in (
    "64:ff9b::/96", "64:ff9b:1::/48", "2002::/16", "2001::/32",
))


class WebToolError(ValueError):
    pass


@dataclass(frozen=True)
class SearchHit:
    title: str
    url: str


@dataclass(frozen=True)
class WebPage:
    title: str
    url: str
    text: str


class SearchProvider(Protocol):
    def search(self, query: str, *, timeout: float) -> list[SearchHit]: ...


class TavilySearch:
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.client: httpx.Client | None = None
        self.cancelled = threading.Event()

    def close(self):
        self.cancelled.set()
        if self.client:
            self.client.close()

    def search(self, query: str, *, timeout: float) -> list[SearchHit]:
        # Fixed endpoint, no proxy/environment routing or credential-bearing URLs.
        with httpx.Client(timeout=timeout, trust_env=False, follow_redirects=False) as client:
            self.client = client
            if self.cancelled.is_set():
                raise WebToolError("Search was cancelled")
            with client.stream("POST", "https://api.tavily.com/search", json={
                "api_key": self.api_key, "query": query[:300], "max_results": 5,
                "search_depth": "basic", "include_answer": False, "include_raw_content": False,
            }) as response:
                response.raise_for_status()
                body = bytearray()
                for chunk in response.iter_bytes():
                    if self.cancelled.is_set():
                        raise WebToolError("Search was cancelled")
                    body.extend(chunk)
                    if len(body) > MAX_PAGE_BYTES:
                        raise WebToolError("Search response exceeds size limit")
        data = json.loads(body)
        hits = []
        for item in data.get("results", [])[:5]:
            if isinstance(item, dict) and isinstance(item.get("url"), str):
                hits.append(SearchHit(str(item.get("title", ""))[:200], item["url"][:2048]))
        return hits


def public_url(url: str) -> tuple[str, str, int, str]:
    if not isinstance(url, str) or len(url) > 2048 or any(ord(c) < 33 for c in url):
        raise WebToolError("Invalid public URL")
    parts = urlsplit(url)
    if parts.scheme not in {"http", "https"} or not parts.hostname or parts.username or parts.password:
        raise WebToolError("Only public HTTP(S) URLs without credentials are allowed")
    try:
        host = parts.hostname.encode("idna").decode("ascii")
        port = parts.port or (443 if parts.scheme == "https" else 80)
    except (ValueError, UnicodeError) as exc:
        raise WebToolError("Invalid public host") from exc
    if port not in {80, 443} or "\\" in url or "%" in host:
        raise WebToolError("Only standard public web ports are allowed")
    authority = f"[{host}]" if ":" in host else host
    if parts.port:
        authority += f":{port}"
    canonical = urlunsplit((parts.scheme, authority, parts.path or "/", parts.query, ""))
    return canonical, host, port, parts.scheme


def resolve_public(host: str, port: int, timeout: float = 3) -> list[tuple]:
    # libc DNS may otherwise block beyond the request deadline. A daemon resolver
    # has no HTTP access; the caller never connects after timeout or cancellation.
    results: Queue = Queue(maxsize=1)

    def resolve():
        try:
            results.put(socket.getaddrinfo(host, port, type=socket.SOCK_STREAM))
        except Exception as exc:  # noqa: BLE001 -- Relay DNS errors across the bounded thread.
            results.put(exc)

    threading.Thread(target=resolve, daemon=True).start()
    try:
        addresses = results.get(timeout=timeout)
    except Empty as exc:
        raise TimeoutError("DNS lookup deadline exceeded") from exc
    if isinstance(addresses, Exception):
        raise addresses
    if not addresses:
        raise WebToolError("Host has no public addresses")
    for _, _, _, _, address in addresses:
        ip = ipaddress.ip_address(address[0])
        if (not ip.is_global or ip.is_multicast
                or isinstance(ip, ipaddress.IPv6Address)
                and (ip.ipv4_mapped is not None or any(ip in network for network in _TRANSITION_NETWORKS))):
            raise WebToolError("Non-public DNS address refused")
    return addresses


class _PinnedConnection(http.client.HTTPConnection):
    def __init__(self, host: str, port: int, address: tuple, scheme: str, timeout: float):
        super().__init__(host, port, timeout=timeout)
        self.address = address
        self.scheme = scheme
        self.connected_socket: socket.socket | None = None
        self.aborted = threading.Event()

    def connect(self):
        family, socktype, proto, _, sockaddr = self.address
        sock = socket.socket(family, socktype, proto)
        self.connected_socket = sock
        try:
            if self.aborted.is_set():
                raise TimeoutError("Connection deadline exceeded")
            sock.settimeout(self.timeout)
            sock.connect(sockaddr)  # Connect to the validated numeric IP, never re-resolve.
            if self.scheme == "https":
                sock = ssl.create_default_context().wrap_socket(sock, server_hostname=self.host)
                self.connected_socket = sock
            self.sock = sock
        except BaseException:
            sock.close()
            raise

    def abort(self):
        self.aborted.set()
        if self.connected_socket:
            try:
                self.connected_socket.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            self.connected_socket.close()


class _TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.hidden = 0
        self.in_title = False
        self.title: list[str] = []
        self.text: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "noscript", "svg", "iframe", "template"}:
            self.hidden += 1
        if tag == "title":
            self.in_title = True

    def handle_endtag(self, tag):
        if tag in {"script", "style", "noscript", "svg", "iframe", "template"}:
            self.hidden = max(0, self.hidden - 1)
        if tag == "title":
            self.in_title = False

    def handle_data(self, data):
        if not self.hidden:
            self.text.append(data)
            if self.in_title:
                self.title.append(data)


def fetch_public_page(
    url: str, *, timeout: float = 15, guard: Callable[[], None] = lambda: None,
) -> WebPage:
    end = time.monotonic() + min(timeout, 20)
    for hop in range(MAX_REDIRECTS + 1):
        guard()
        canonical, host, port, scheme = public_url(url)
        remaining = end - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("Page deadline exceeded")
        addresses = resolve_public(host, port, timeout=min(3, remaining))
        guard()
        remaining = end - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("Page deadline exceeded")
        conn = _PinnedConnection(host, port, addresses[0], scheme, remaining)
        watchdog = threading.Timer(remaining, conn.abort)
        watchdog.daemon = True
        watchdog.start()
        try:
            parts = urlsplit(canonical)
            conn.request("GET", urlunsplit(("", "", parts.path, parts.query, "")), headers={
                "Host": parts.netloc, "User-Agent": "MarventaResearch/1.0",
                "Accept": "text/html,text/plain", "Accept-Encoding": "identity",
            })
            response = conn.getresponse()
            if response.status in {301, 302, 303, 307, 308}:
                location = response.getheader("Location")
                if not location or hop == MAX_REDIRECTS:
                    raise WebToolError("Redirect limit exceeded")
                url = urljoin(canonical, location)
                continue
            if response.status != 200:
                raise WebToolError("Page returned non-success status")
            content_type = response.getheader("Content-Type", "").split(";", 1)[0].strip().lower()
            if content_type not in {"text/html", "text/plain", "application/xhtml+xml"}:
                raise WebToolError("Unsupported webpage content type")
            if response.getheader("Content-Encoding", "identity").lower() != "identity":
                raise WebToolError("Compressed pages are not accepted")
            length = response.getheader("Content-Length")
            if length and int(length) > MAX_PAGE_BYTES:
                raise WebToolError("Page exceeds size limit")
            body = bytearray()
            while True:
                guard()
                remaining = end - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError("Page deadline exceeded")
                if conn.sock:
                    conn.sock.settimeout(remaining)
                chunk = response.read1(min(16_384, MAX_PAGE_BYTES + 1 - len(body)))
                if not chunk:
                    break
                body.extend(chunk)
                if len(body) > MAX_PAGE_BYTES:
                    raise WebToolError("Page exceeds size limit")
            decoded = body.decode("utf-8", errors="replace")
            if content_type == "text/plain":
                text, title = decoded, host
            else:
                parser = _TextExtractor()
                parser.feed(decoded)
                text, title = " ".join(parser.text), " ".join(parser.title) or host
            text = " ".join("".join(c for c in text if c.isprintable() or c.isspace()).split())
            if not text:
                raise WebToolError("Page contains no readable text")
            return WebPage(title[:200], canonical, text[:MAX_PAGE_CHARS])
        finally:
            watchdog.cancel()
            conn.close()
    raise WebToolError("Redirect limit exceeded")
