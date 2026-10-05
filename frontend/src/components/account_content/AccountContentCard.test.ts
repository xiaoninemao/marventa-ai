import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "../../contexts/i18n_context.tsx";
import AccountContentCard from "./AccountContentCard.tsx";
import AccountContentPreview from "./AccountContentPreview.tsx";
import type { AccountContentPost } from "../../types/account_content.ts";
import InlineIcon from "../redesign/InlineIcon.tsx";
import AccountContentEmptyState from "./AccountContentEmptyState.tsx";
import AccountContentGallery from "./AccountContentGallery.tsx";

const post: AccountContentPost = {
  id: "post", title: "<b>Untrusted title</b>", cover_url: "", share_url: "",
  content: "<script>Untrusted content</script>\nSecond paragraph",
  published_at: "", media_type: "video", visibility: "accepted",
  statistics: { likes: 0, comments: null, views: 120, shares: null }, plan_id: "plan",
};

test("account content cards escape titles and distinguish platform acceptance from publication", () => {
  const html = renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(AccountContentCard, { post, onOpen: () => {} }),
  ));
  assert.match(html, /Accepted by platform/);
  assert.match(html, /&lt;b&gt;Untrusted title&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>Untrusted title<\/b>/);
});

test("read-only content previews have close X, unknown metrics and retained publication navigation", () => {
  const html = renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(AccountContentPreview, { post, onClose: () => {} }),
  ));
  assert.match(html, /aria-label="Close"/);
  assert.doesNotMatch(html, />Cancel<\/button>|>Confirm<\/button>/);
  assert.match(html, /<dd>0<\/dd>/);
  assert.match(html, /<dd>—<\/dd>/);
  assert.doesNotMatch(html, /Favorites|data-metric="favorites"/);
  assert.deepEqual(Array.from(html.matchAll(/<dt>(.*?)<\/dt>/g), (match) => match[1].replace(/<[^>]*>/g, "")),
    ["Views", "Likes", "Comments", "Shares"]);
  assert.match(html, /not confirmed public visibility/);
  assert.match(html, /href="\/publishing\/plan"/);
});

test("content previews preserve zero and unknown values for the remaining four metrics", () => {
  for (const [value, rendered] of [[128, "128"], [0, "0"], [null, "—"]] as const) {
    const html = renderToStaticMarkup(createElement(I18nProvider, null,
      createElement(AccountContentPreview, {
        post: { ...post, statistics: { ...post.statistics, shares: value } }, onClose: () => {},
      }),
    ));
    assert.match(html, new RegExp(`Shares</dt><dd>${rendered}</dd>`));
  }
});

test("content previews render title and body separately, preserving and escaping body text", () => {
  const html = renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(AccountContentPreview, { post, onClose: () => {} }),
  ));
  assert.match(html, /<h3 class="amp-account-content-preview-title">&lt;b&gt;Untrusted title&lt;\/b&gt;<\/h3>/);
  assert.match(html, /<p>&lt;script&gt;Untrusted content&lt;\/script&gt;\nSecond paragraph<\/p>/);
  assert.doesNotMatch(html, /<script>Untrusted content/);
  const titleOnly = renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(AccountContentPreview, {
      post: { ...post, title: "Unsplit title\nAnother line", content: "", visibility: "published" }, onClose: () => {},
    }),
  ));
  assert.match(titleOnly, /Unsplit title\nAnother line<\/h3>/);
  assert.doesNotMatch(titleOnly, /<p>/);
});

test("content metrics reuse decorative case-library icons without adding actions", () => {
  const html = renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(AccountContentPreview, { post, onClose: () => {} }),
  ));
  const expected = [
    ["views", "media"], ["likes", "heart"], ["comments", "message"], ["shares", "shareForward"],
  ] as const;
  for (const [metric, icon] of expected) {
    const svg = renderToStaticMarkup(createElement(InlineIcon, { name: icon }));
    assert.ok(html.includes(`<div data-metric="${metric}"><dt><span class="amp-account-content-metric-icon">${svg}</span>`));
    assert.match(svg, /aria-hidden="true"/);
  }
  const metrics = html.match(/<dl class="amp-account-content-metrics">([\s\S]*?)<\/dl>/)?.[1];
  assert.ok(metrics);
  assert.doesNotMatch(metrics, /<button|<a\b/);
});

test("account sharing uses a curved forward arrow without replacing the shared network icon", () => {
  const arrow = renderToStaticMarkup(createElement(InlineIcon, { name: "shareForward" }));
  assert.match(arrow, /d="m14 4 8 7-8 7v-4c-5\.5 0-9 1\.8-12 6 0-8 4-13 12-13V4Z"/);
  assert.doesNotMatch(arrow, /<circle/);
  const original = renderToStaticMarkup(createElement(InlineIcon, { name: "share" }));
  assert.equal((original.match(/<circle/g) || []).length, 3);
});

test("multi-image works show ordered thumbnails, navigation and image counts with independent copy", () => {
  const images = ["https://cdn.example.com/first.jpg", "https://cdn.example.com/second.jpg"];
  const galleryPost: AccountContentPost = { ...post, media_type: "image_text", image_urls: images };
  const html = renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(AccountContentPreview, { post: galleryPost, onClose: () => {} }),
  ));
  assert.match(html, /aria-label="Previous image"/);
  assert.match(html, /aria-label="Next image"/);
  assert.match(html, /aria-live="polite">1 \/ 2/);
  assert.match(html, /aria-current="true" aria-label="View image 1"/);
  assert.match(html, /aria-current="false" aria-label="View image 2"/);
  assert.ok(html.indexOf('aria-label="View image 1"') < html.indexOf('aria-label="View image 2"'));
  assert.match(html, /Second paragraph/);
  const card = renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(AccountContentCard, { post: galleryPost, onOpen: () => {} }),
  ));
  assert.match(card, /Gallery \(2 images\)/);
  assert.match(card, /src="https:\/\/cdn\.example\.com\/first\.jpg"/);
});

test("cover-only works remain a single preview without claiming a full gallery", () => {
  const html = renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(AccountContentPreview, {
      post: { ...post, media_type: "image_text", cover_url: "https://cdn.example.com/cover.jpg" }, onClose: () => {},
    }),
  ));
  assert.match(html, /src="https:\/\/cdn\.example\.com\/cover\.jpg"/);
  assert.doesNotMatch(html, /Previous image|Next image|amp-account-content-gallery-thumbnails|aria-live="polite"/);
  const empty = renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(AccountContentGallery, { images: [], title: "Empty" }),
  ));
  assert.equal(empty, "");
});

test("preview metrics sit immediately below media and above copy while published status remains on cards", () => {
  for (const mediaType of ["video", "image_text"] as const) {
    const published: AccountContentPost = {
      ...post, media_type: mediaType, visibility: "published", cover_url: "https://cdn.example.com/cover.jpg",
    };
    const html = renderToStaticMarkup(createElement(I18nProvider, null,
      createElement(AccountContentPreview, { post: published, onClose: () => {} }),
    ));
    assert.ok(html.indexOf('src="https://cdn.example.com/cover.jpg"') < html.indexOf('<dl class="amp-account-content-metrics">'));
    assert.ok(html.indexOf("</dl>") < html.indexOf('<h3 class="amp-account-content-preview-title">'));
    assert.doesNotMatch(html, /amp-account-content-status is-published/);
    const card = renderToStaticMarkup(createElement(I18nProvider, null,
      createElement(AccountContentCard, { post: published, onOpen: () => {} }),
    ));
    assert.match(card, /amp-account-content-status is-published/);
  }
  const reviewing = renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(AccountContentPreview, { post: { ...post, visibility: "reviewing" }, onClose: () => {} }),
  ));
  assert.match(reviewing, /In review/);
});

test("saved videos use native controlled playback without autoplay or treating a share page as media", () => {
  const videoPost: AccountContentPost = {
    ...post, video_url: "http://127.0.0.1:8765/media/clip.mp4", cover_url: "https://cdn.example.com/cover.jpg",
  };
  const html = renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(AccountContentPreview, { post: videoPost, onClose: () => {} }),
  ));
  assert.match(html, /<video[^>]+src="http:\/\/127\.0\.0\.1:8765\/media\/clip\.mp4"/);
  assert.match(html, /poster="https:\/\/cdn\.example\.com\/cover\.jpg"/);
  assert.match(html, /controls="" playsInline="" preload="metadata"/);
  assert.doesNotMatch(html, /autoPlay|autoplay/);
  assert.ok(html.indexOf("</video>") < html.indexOf('<dl class="amp-account-content-metrics">'));
  const coverOnly = renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(AccountContentPreview, {
      post: { ...videoPost, video_url: "", share_url: "https://www.douyin.com/video/1" }, onClose: () => {},
    }),
  ));
  assert.doesNotMatch(coverOnly, /<video/);
  assert.match(coverOnly, /View on platform/);
});

test("official platform playback is opt-in and needs scoped account context, while local video stays native", () => {
  const platformPost: AccountContentPost = {
    ...post, visibility: "published", platform_video_id: "9007199254740993",
    cover_url: "https://cdn.example.com/cover.jpg",
  };
  const props = { post: platformPost, account: { id: "account", project_id: "project" }, onClose: () => {} };
  const html = renderToStaticMarkup(createElement(I18nProvider, null, createElement(AccountContentPreview, props)));
  assert.match(html, /amp-account-content-platform-video/);
  assert.match(html, /Play video/);
  assert.doesNotMatch(html, /<iframe|<video/);
  const withoutAccount = renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(AccountContentPreview, { post: platformPost, onClose: () => {} }),
  ));
  assert.doesNotMatch(withoutAccount, /amp-account-content-platform-video|Play video|<iframe/);
  const local = renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(AccountContentPreview, { ...props, post: { ...platformPost, video_url: "http://localhost:8765/media/clip.mp4" } }),
  ));
  assert.match(local, /<video/);
  assert.doesNotMatch(local, /amp-account-content-platform-video/);
});

test("account content navigation follows Publishing and cursor totals are not fabricated", () => {
  const navigation = readFileSync(new URL("../layout/app_shell.tsx", import.meta.url), "utf8");
  assert.match(navigation, /path: "\/publishing"[^\n]+\n\s*\{ label: "账号内容", labelEn: "Account Content", path: "\/account_content"/);
  const workspace = readFileSync(new URL("../../app/account_content/page.tsx", import.meta.url), "utf8");
  assert.match(workspace, /scope === scope/);
  assert.match(workspace, /postsState\.key === requestKey/);
  assert.match(workspace, /controller\.abort\(\)/);
  assert.doesNotMatch(workspace, /<p className="amp-account-content-explanation">/);
  assert.match(workspace, /Published here/);
});

test("account content uses a thumbnail-and-text panel rather than a video-only icon", () => {
  const html = renderToStaticMarkup(createElement(InlineIcon, { name: "content" }));
  assert.match(html, /<rect x="6" y="6" width="5" height="6"/);
  assert.match(html, /d="M14 7h4M14 11h4M6 16h12"/);
  assert.doesNotMatch(html, /m10 8 6 4-6 4V8Z/);
});

test("account content heading has no refresh action while failed requests remain retryable", () => {
  const workspace = readFileSync(new URL("../../app/account_content/page.tsx", import.meta.url), "utf8");
  const header = workspace.match(/<header className="amp-account-content-heading">([\s\S]*?)<\/header>/)?.[1];
  assert.ok(header);
  assert.doesNotMatch(header, /GuardedButton|ACTIONS\.refresh|name="refresh"/);
  assert.match(workspace, /onClick=\{\(\) => setRefresh\(\(value\) => value \+ 1\)\}/);
});

test("account content requires channel selection and clears account and pagination when switching channels", () => {
  const workspace = readFileSync(new URL("../../app/account_content/page.tsx", import.meta.url), "utf8");
  assert.match(workspace, /currentAccounts\.filter\(\(item\) => item\.platform === platform\)/);
  assert.match(workspace, /channelAccounts\.find\(\(item\) => item\.id === accountId\)/);
  assert.match(workspace, /disabled=\{accountsLoading \|\| !platform \|\| !channelAccounts\.length\}/);
  assert.match(workspace, /setSelection\(\{ scope, platform: value, accountId: "" \}\); resetPages\(\)/);
  assert.ok(workspace.indexOf('ariaLabel={t("选择渠道"') < workspace.indexOf('ariaLabel={t("选择账号"'));
  assert.doesNotMatch(workspace, /content_status === "ready"/);
});

test("content sources use the shared selector and reset pagination on change", () => {
  const workspace = readFileSync(new URL("../../app/account_content/page.tsx", import.meta.url), "utf8");
  assert.match(workspace, /<EnterpriseSelect value=\{source\}/);
  assert.match(workspace, /ariaLabel=\{t\("内容来源", "Content source"\)\}/);
  assert.match(workspace, /setSource\(value\); resetPages\(\)/);
  assert.doesNotMatch(workspace, /role="group" aria-label=\{t\("内容来源"/);
});

test("every account selection resets paging and reloads even when the selected ID is unchanged", () => {
  const workspace = readFileSync(new URL("../../app/account_content/page.tsx", import.meta.url), "utf8");
  assert.match(workspace, /setSelection\(\{ scope, platform, accountId: value \}\);\s*resetPages\(\);\s*setRefresh\(\(revision\) => revision \+ 1\)/);
  assert.match(workspace, /\$\{cursor\}:\$\{refresh\}/);
});

test("account content empty states reuse the workspace module icon, title and description layout", () => {
  const html = renderToStaticMarkup(createElement(AccountContentEmptyState, {
    icon: "user", title: "No connected accounts",
    description: createElement("span", null, "Connect an account in ",
      createElement("a", { href: "/projects", className: "amp-account-content-inline-link" }, "Projects")),
  }));
  assert.match(html, /class="amp-projects-state"/);
  assert.match(html, /class="amp-projects-empty-icon"/);
  assert.match(html, /<strong>No connected accounts<\/strong><p>/);
  assert.match(html, /href="\/projects"/);
  assert.doesNotMatch(html, /amp-dialog-state|amp-empty-state-icon|amp-button|<button/);
  assert.match(html, /<p>[\s\S]*class="amp-account-content-inline-link"[\s\S]*<\/p>/);
});

test("unselected content state guides channel/account selection instead of claiming no connected accounts", () => {
  const workspace = readFileSync(new URL("../../app/account_content/page.tsx", import.meta.url), "utf8");
  const unselected = workspace.match(/: !account \? <AccountContentEmptyState([\s\S]*?)\/>/)?.[1];
  assert.ok(unselected);
  assert.match(unselected, /请选择渠道和账号/);
  assert.match(unselected, /Select a channel and account/);
  assert.doesNotMatch(unselected, /暂无已连接账号|No connected accounts|<Link/);
});

test("account content reuses shared pagination with explicit cursor semantics", () => {
  const workspace = readFileSync(new URL("../../app/account_content/page.tsx", import.meta.url), "utf8");
  assert.match(workspace, /<Pagination mode="cursor"/);
  assert.match(workspace, /pageItems=\{data\.items\.length\}/);
  assert.match(workspace, /visitedPages=\{cursors\.length\}/);
  assert.doesNotMatch(workspace, /amp-account-content-pagination|amp-account-content-page-actions/);
});
