"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useI18n } from "@/contexts/i18n_context";
import { useToast } from "@/contexts/toast_context";
import { localizeErrorMessage } from "@/i18n/errors";
import { fetch_project_material_content, update_project_material_content } from "@/services/api_client";
import type { ProjectMaterial } from "@/types/publishing";
import InlineIcon from "@/components/redesign/InlineIcon";
import MaterialRichTextEditor from "./MaterialRichTextEditor";
import { materialCopyDocument } from "@/utils/material_copy_document";

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
  const { showError, showSuccess } = useToast();
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
    if (content === null || !canEdit) return;
    setHtml(content);
    setText("");
    setEditing(true);
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || !canEdit) return;
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
              <button type="button" className="amp-material-preview-action" disabled={saving}
                onClick={() => setEditing(false)}>{t("取消", "Cancel")}</button>
              <button type="submit" form="material-copy-edit-form" className="amp-material-preview-action is-primary"
                disabled={saving || !text.trim()}>
                {saving ? t("保存中...", "Saving...") : t("保存", "Save")}
              </button>
            </>
          ) : canEdit && (
            <button type="button" className="amp-material-preview-action"
              disabled={content === null || Boolean(error)} onClick={startEditing}>
              {t("编辑", "Edit")}
            </button>
          )}
          <button type="button" className="amp-material-preview-icon" disabled={saving}
            aria-label={t("关闭预览", "Close preview")} onClick={onClose}>
            <InlineIcon name="close" />
          </button>
        </div>
      </header>
      <div className="amp-material-preview-stage">
        <div className="amp-material-document-preview">
          {editing ? (
            <form id="material-copy-edit-form" className="amp-material-copy-edit" onSubmit={save}>
              <MaterialRichTextEditor content={html} disabled={saving}
                onChange={(value, plainText) => { setHtml(value); setText(plainText); }} />
            </form>
          ) : error ? (
            <div role="alert" className="amp-material-document-message">
              <p>{error}</p>
              <button type="button" className="amp-button amp-button-secondary"
                onClick={() => setAttempt((value) => value + 1)}>{t("重试", "Retry")}</button>
            </div>
          ) : content === null ? (
            <p role="status" className="amp-material-document-message">{t("正在加载文案...", "Loading copy...")}</p>
          ) : (
            <iframe title={material.name} sandbox=""
              srcDoc={materialCopyDocument(content)} />
          )}
        </div>
      </div>
    </>
  );
}
