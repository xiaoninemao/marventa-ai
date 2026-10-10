import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const experience = readFileSync(
  new URL("./ContentGeneratorExperience.tsx", import.meta.url),
  "utf8",
);
const api = readFileSync(
  new URL("../../services/content_generator_api.ts", import.meta.url),
  "utf8",
);

test("Content Studio uses Agent intent modes instead of the card-generation action", () => {
  assert.match(experience, /\["auto", "shuffle", t\("自动", "Auto"\)/);
  assert.match(experience, /\["explore", "listBullet", t\("计划", "Plan"\)/);
  assert.match(experience, /\["create", "bolt", t\("行动", "Act"\)/);
  assert.match(experience, /role="menuitemradio"/);
  assert.match(experience, /AgentDeliverableWorkspace/);
  assert.doesNotMatch(experience, /amp-agent-mode-chevron/);
  assert.match(experience, /sending \|\| reply_action/);
  assert.match(experience, /t\("正在处理…", "Working…"\)/);
  assert.match(experience, /<InlineIcon name="stop" className="h-5 w-5" \/>/);
  assert.doesNotMatch(experience, /amp-content-agent-timeline|progress_labels/);
  assert.doesNotMatch(experience, /onClick=\{handle_generate\}|t\("生成内容卡片"/);
});

test("chat requests transmit an explicit Agent mode with auto as the default", () => {
  assert.match(api, /agent_mode: "auto" \| "explore" \| "create" = "auto"/);
  assert.match(api, /agent_mode,/);
});

test("message rewriting edits in place with confirm, cancel and outside-click dismissal", () => {
  assert.match(experience, /amp-content-inline-message-edit/);
  assert.match(experience, /t\("确认改写", "Confirm edit"\)/);
  assert.match(experience, /t\("取消改写", "Cancel edit"\)/);
  assert.match(experience, /document\.addEventListener\("pointerdown", dismiss\)/);
  assert.match(experience, /message_edit_ref\.current\?\.contains\(event\.target\)/);
  assert.doesNotMatch(experience, /rewrite-message-title|show_rewrite_modal/);
});

test("reply regeneration is shown only for failed or unanswered latest turns", () => {
  assert.match(experience, /reply_failed \|\| latest_assistant_message_index < 0/);
  assert.match(experience, /can_retry_reply && <GuardedButton/);
  assert.match(experience, /set_reply_failed\(true\)/);
  assert.match(experience, /set_reply_failed\(false\)/);
});

test("message copy precedes edit and reports clipboard success or failure", () => {
  assert.match(experience, /await navigator\.clipboard\.writeText\(content\)/);
  assert.match(experience, /show_success\(\{ zh: "已复制消息", en: "Message copied" \}\)/);
  assert.match(experience, /show_failure\(\{ zh: "复制失败，请重试。", en: "Copy failed\. Please try again\." \}\)/);
  assert.match(experience, /onClick=\{\(\) => void handle_copy_message\(m\.content\)\}/);
  const copy = experience.indexOf('aria-label={t("复制消息", "Copy message")}');
  const edit = experience.indexOf('aria-label={t("改写最新消息", "Edit latest message")}');
  assert.ok(copy >= 0 && copy < edit);
  assert.match(experience.slice(copy, edit), /<InlineIcon name="copy" \/>/);
});

test("Content Studio reconnects durable jobs and offers cooperative cancellation", () => {
  assert.match(experience, /agentStateObserver\.subscribe\(sessionId/);
  assert.doesNotMatch(experience, /fetch_active_agent_job|fetch_agent_progress|wait_for_agent_job|setInterval\([^]*?, (300|2000)\)/);
  assert.match(experience, /unsubscribe\(\)/);
  assert.match(experience, /cancel_agent_job\(session\.id, agent_progress\.job_id\)/);
  assert.match(experience, /t\("停止生成", "Stop generation"\)/);
  assert.match(experience, /operation_epoch_ref\.current/);
  assert.match(experience, /abort\.abort\(\)/);
  assert.match(experience, /res\.data\.agent_job\?\.submitted_message/);
  assert.match(experience, /set_messages\(\[\.\.\.res\.data\.messages, submitted\]\)/);
});
test("Content Studio has no legacy card renderer, editor, quality check or version requests", () => {
  assert.doesNotMatch(experience, /ContentGeneratorCardWorkspace|FlipCard3D|SelectedPlanDetailPanel|show_modify_modal|fetch_versions|modify_card|check_content_quality/);
});

test("draft previews use text-free layered artwork without restoring legacy card functionality", () => {
  assert.match(experience, /<CreationDraftPreview kind=\{item.creation_kind \|\| "image"\}/);
  assert.doesNotMatch(experience, /从一个想法开始|Start with an idea/);
  const css = readFileSync(new URL("../../styles/projects.css", import.meta.url), "utf8");
  assert.match(css, /:is\(:hover, :focus-visible\) \.amp-creation-draft-window/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.amp-redesign \.amp-creation-media-draft > span\s*\{\s*transition: none/);
});

test("creation covers use case-library type badges without duplicate title or output labels", () => {
  const preview = experience.split('<span className="amp-agent-canvas-preview"')[1]?.split(") : (")[0];
  assert.ok(preview);
  assert.doesNotMatch(preview, /<strong|<i>/);
  assert.doesNotMatch(experience, /t\("图文成品", "Image"\)|t\("视频方案", "Video"\)/);
  assert.match(experience, /className="amp-case-type-overlay">\{item\.creation_kind === "video"/);
  assert.match(experience, /t\("视频", "Video"\) : t\("图文", "Image post"\)/);
  const css = readFileSync(new URL("../../styles/projects.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /amp-agent-canvas-preview::after|amp-agent-canvas-preview (?:i|strong)\b/);
});
