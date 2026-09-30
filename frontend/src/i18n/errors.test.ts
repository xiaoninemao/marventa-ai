import test from "node:test";
import assert from "node:assert/strict";
import { apiError, currentInterfaceLocale, localizeErrorMessage } from "./errors.ts";

test("server-side errors default to English without a document", () => {
  assert.equal(typeof document, "undefined");
  assert.equal(currentInterfaceLocale(), "en");
  assert.equal(apiError("组织名称不能为空").message, "Organization name is required");
});

test("browser errors respect supported languages and use English for missing or invalid ones", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  try {
    for (const [lang, expected] of [
      ["zh-CN", "组织名称不能为空"],
      ["en", "Organization name is required"],
      ["", "Organization name is required"],
      ["fr", "Organization name is required"],
    ]) {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: { documentElement: { lang } },
      });
      assert.equal(currentInterfaceLocale(), lang === "zh-CN" ? "zh-CN" : "en");
      assert.equal(apiError("组织名称不能为空").message, expected);
    }
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

test("channel authorization configuration errors are localized", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  try {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { documentElement: { lang: "zh-CN" } },
    });

    assert.equal(
      apiError("xiaohongshu authorization is not configured").message,
      "尚未配置小红书授权，请联系管理员完成开放平台配置",
    );
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

test("copy import and edit errors explain actionable failures in both languages", () => {
  assert.equal(
    localizeErrorMessage("Only the material creator and project managers can edit its content", "zh-CN"),
    "只有素材创建者和项目管理员可以编辑正文",
  );
  const english = "Document could not produce editable content: Copy content is empty";
  const chinese = "文档无法转换为可编辑内容：文案内容不能为空";
  assert.equal(localizeErrorMessage(english, "zh-CN"), chinese);
  assert.equal(localizeErrorMessage(chinese, "en"), english);
  assert.equal(localizeErrorMessage("Could not save material copy", "zh-CN"), "无法保存文案，请重试");
});

test("publication execution failures explain platform limits and uncertain outcomes", () => {
  assert.equal(
    localizeErrorMessage("Douyin image posts support at most 30 images; reduce the images before scheduling again", "zh-CN"),
    "抖音图文最多发布 30 张图片，请减少图片后重新安排",
  );
  assert.equal(
    localizeErrorMessage("Douyin rejected the publishing request (code 28001018)", "zh-CN"),
    "抖音拒绝了发布请求（错误码 28001018）",
  );
  const uncertain = "Douyin rejected the publishing request (code 2100004). Verify the platform before scheduling again; the result may be uncertain";
  assert.equal(localizeErrorMessage(uncertain, "en"), uncertain);
  assert.match(localizeErrorMessage(uncertain, "zh-CN"), /2100004.*结果可能不确定.*检查平台账号/);
  const unavailable = "Xiaohongshu has not opened a verified official creator publishing API; write_notes is listed as planned. This plan was not submitted";
  assert.match(localizeErrorMessage(unavailable, "zh-CN"), /小红书.*规划中.*没有提交/);
});
