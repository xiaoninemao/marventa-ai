"use client";

import { GuardedButton } from "@/components/redesign/GuardedControls";

import { useEffect, useState, type FormEvent } from "react";
import { useI18n } from "@/contexts/i18n_context";
import { useToast } from "@/contexts/toast_context";
import { localizeErrorMessage } from "@/i18n/errors";
import { fetch_project_material_content, update_project_material_content } from "@/services/api_client";
import type { ProjectMaterial } from "@/types/publishing";
import InlineIcon from "@/components/redesign/InlineIcon";
import MaterialRichTextEditor from "./MaterialRichTextEditor";
import { materialCopyDocument } from "@/utils/material_copy_document";
import { ENGLISH_ACTIONS, ENGLISH_PROGRESS, CHINESE_ACTIONS, CHINESE_PROGRESS } from "@/i18n/interaction_copy";

export default function MaterialDocumentPreview({
  material,
  canEdit,
  onClose,
  onSaved,
  onSavingChange,
}: {
  material: ProjectMaterial;
  canEdit: boolean;
  onClose: () => void;
  onSaved: (material: ProjectMaterial) => void;
  onSavingChange: (saving: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const { showError, showSuccess, showWarning } = useToast();
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [html, setHtml] = useState("");
  const [text, setText] = useState("");

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setError("");
    fetch_project_material_content(material.project_id, material.id)
      .then((response) => { if (!cancelled) setContent(response.data.content); })
      .catch((reason: unknown) => {
        if (!cancelled) setError(localizeErrorMessage(
          reason instanceof Error ? reason.message : "Could not load material content", locale,
        ));
      });
    return () => { cancelled = true; };
  }, [material.id, material.project_id, locale, attempt]);

  const startEditing = () => {
    if (!canEdit) { showWarning(t("你没有编辑此文案的权限。", "You do not have permission to edit this copy.")); return; }
    if (error || content === null) {
      showWarning(error
        ? t("文案加载失败，请重试后再编辑。", "Copy failed to load. Retry before editing.")
        : t("正在加载文案，请稍候再编辑。", "Copy is loading. Please wait before editing."));
      return;
    }
    setHtml(content);
    setText("");
    setEditing(true);
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) { showWarning(t("正在处理中，请稍候。", "Please wait for the current operation to finish.")); return; }
    if (!canEdit) { showWarning(t("你没有编辑此文案的权限。", "You do not have permission to edit this copy.")); return; }
    if (!text.trim()) {
      showError(t("请输入文案正文。", "Enter copy content."));
      return;
    }
    if (new TextEncoder().encode(html).length > 1024 * 1024) {
      showError(t("富文本内容过长，请缩短后重试。", "Rich text is too long. Shorten it and try again."));
      return;
    }
    setSaving(true);
    onSavingChange(true);
    try {
      const response = await update_project_material_content(material.project_id, material.id, html);
      onSaved(response.data);
      setEditing(false);
      setContent(null);
      setAttempt((value) => value + 1);
      showSuccess(t("文案已保存", "Copy saved"));
    } catch (reason) {
      showError(localizeErrorMessage(
        reason instanceof Error ? reason.message : "Could not save material copy", locale,
      ));
    } finally {
      setSaving(false);
      onSavingChange(false);
    }
  };

  return (
    <>
      <header>
        <h2 id="material-preview-title" title={material.name}>{material.name}</h2>
        <div className="amp-material-preview-actions">
          {editing ? (
            <>
              <GuardedButton type="button" className="amp-material-preview-action amp-button-cancel" disabled={saving} blockedReason={t("正在处理中，请稍候。", "Please wait for the current operation to finish.")}
                onClick={() => setEditing(false)}>{t(CHINESE_ACTIONS.cancel, ENGLISH_ACTIONS.cancel)}</GuardedButton>
              <GuardedButton type="submit" form="material-copy-edit-form" className="amp-material-preview-action is-primary"
                disabled={saving || !text.trim()} blockedReason={saving ? t("正在处理中，请稍候。", "Please wait for the current operation to finish.") : t("请输入文案正文。", "Enter copy content.")}>
                {saving ? t(CHINESE_PROGRESS.saving, ENGLISH_PROGRESS.saving) : t(CHINESE_ACTIONS.save, ENGLISH_ACTIONS.save)}
              </GuardedButton>
            </>
          ) : canEdit && (
            <GuardedButton type="button" className="amp-material-preview-action"
              disabled={content === null || Boolean(error)} blockedReason={error ? t("文案加载失败，请重试后再编辑。", "Copy failed to load. Retry before editing.") : t("正在加载文案，请稍候再编辑。", "Copy is loading. Please wait before editing.")} onClick={startEditing}>
              {t(CHINESE_ACTIONS.edit, ENGLISH_ACTIONS.edit)}
            </GuardedButton>
          )}
          {!editing && <GuardedButton type="button" className="amp-material-preview-icon" disabled={saving} blockedReason={t("正在处理中，请稍候。", "Please wait for the current operation to finish.")}
            aria-label={t("关闭预览", "Close preview")} onClick={onClose}>
            <InlineIcon name="close" />
          </GuardedButton>}
        </div>
      </header>
      <div className="amp-material-preview-stage">
        <div className="amp-material-document-preview">
          {editing ? (
            <form id="material-copy-edit-form" className="amp-material-copy-edit" onSubmit={save}>
              <MaterialRichTextEditor content={html} disabled={saving}
                blockedReason={t("正在处理中，请稍候。", "Please wait for the current operation to finish.")}
                onChange={(value, plainText) => { setHtml(value); setText(plainText); }} />
            </form>
          ) : error ? (
            <div role="alert" className="amp-material-document-message">
              <p>{error}</p>
              <button type="button" className="amp-button amp-button-secondary"
                onClick={() => setAttempt((value) => value + 1)}>{t(CHINESE_ACTIONS.retry, ENGLISH_ACTIONS.retry)}</button>
            </div>
          ) : content === null ? (
            <p role="status" className="amp-material-document-message">{t(CHINESE_PROGRESS.loading, ENGLISH_PROGRESS.loading)}</p>
          ) : (
            <iframe title={material.name} sandbox=""
              srcDoc={materialCopyDocument(content)} />
          )}
        </div>
      </div>
    </>
  );
}
