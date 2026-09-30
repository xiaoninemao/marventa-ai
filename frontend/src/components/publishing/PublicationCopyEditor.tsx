"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/contexts/i18n_context";
import { useToast } from "@/contexts/toast_context";
import { localizeErrorMessage } from "@/i18n/errors";
import { fetch_publication_copy, update_publication_copy } from "@/services/api_client";
import type { PublicationContent } from "@/types/publishing";
import InlineIcon from "@/components/redesign/InlineIcon";
import { autosaveIsBusy, DebouncedAutosave, type AutosaveState } from "@/utils/debounced_autosave";

type CopyDraft = { title: string; content: string; tags: string[] };

export default function PublicationCopyEditor({
  planId, editable, disabled, sources, importedCopy, onPick, onPreview, onRemove, onChanged, onBusyChange,
}: {
  planId: string;
  editable: boolean;
  disabled: boolean;
  sources: PublicationContent[];
  importedCopy: { title: string; content: string } | null;
  onPick: () => void;
  onPreview: (item: PublicationContent) => void;
  onRemove: (item: PublicationContent) => void;
  onChanged: () => Promise<void>;
  onBusyChange: (value: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const { showError } = useToast();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const draft = useRef<CopyDraft>({ title: "", content: "", tags: [] });
  const autosave = useRef<DebouncedAutosave<CopyDraft> | null>(null);
  const writable = useRef(editable);
  const callbacks = useRef({ onChanged, onBusyChange, showError });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [saveState, setSaveState] = useState<AutosaveState>("idle");
  const [saveError, setSaveError] = useState("");
  const busy = autosaveIsBusy(saveState, editable);
  const unsaved = saveState === "pending" || saveState === "saving" || saveState === "error";
  const locked = disabled || !editable || loading || Boolean(error);

  useEffect(() => {
    writable.current = editable;
    autosave.current?.setWritable(editable);
  }, [editable]);

  useEffect(() => {
    if (saveState !== "saved") return;
    const timer = setTimeout(() => setSaveState("idle"), 2000);
    return () => clearTimeout(timer);
  }, [saveState]);

  useEffect(() => {
    callbacks.current = { onChanged, onBusyChange, showError };
  }, [onChanged, onBusyChange, showError]);

  useEffect(() => {
    callbacks.current.onBusyChange(busy);
  }, [busy]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(""); setSaveError(""); setSaveState("idle");
    const saver = new DebouncedAutosave<CopyDraft>(async (value) => {
      const response = await update_publication_copy(planId, value.title.trim(), value.content, value.tags);
      if (!Array.isArray(response.data.tags)) throw new Error("Publication copy response is outdated. Refresh and try again.");
      if (!cancelled) await callbacks.current.onChanged();
    }, (state) => {
      if (cancelled) return;
      setSaveState(state);
      if (state !== "error") setSaveError("");
    }, (reason) => {
      const message = localizeErrorMessage(
        reason instanceof Error ? reason.message : "Could not save publication copy", locale,
      );
      if (!cancelled) setSaveError(message);
      callbacks.current.showError(message);
    });
    autosave.current = saver;
    saver.setWritable(writable.current);
    void fetch_publication_copy(planId).then(({ data }) => {
      if (cancelled) return;
      if (!Array.isArray(data.tags)) throw new Error("Publication copy response is outdated. Refresh and try again.");
      draft.current = { title: data.title, content: data.content, tags: data.tags };
      setTitle(data.title); setText(data.content);
    }).catch((reason: unknown) => {
      if (!cancelled) setError(localizeErrorMessage(
        reason instanceof Error ? reason.message : "Could not load publication copy", locale,
      ));
    }).finally(() => { if (!cancelled) setLoading(false); });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!saver.hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      cancelled = true;
      window.removeEventListener("beforeunload", beforeUnload);
      saver.setWritable(writable.current);
      if (writable.current) saver.resume();
      void saver.flush();
      callbacks.current.onBusyChange(false);
      if (autosave.current === saver) autosave.current = null;
    };
  }, [planId, locale, attempt]);

  useEffect(() => {
    if (!importedCopy || !writable.current) return;
    setTitle(importedCopy.title);
    setText(importedCopy.content);
    draft.current = { ...draft.current, ...importedCopy };
    autosave.current?.queue(draft.current);
  }, [importedCopy]);
  const change = (key: "title" | "content", value: string) => {
    if (locked) return;
    if (key === "title") setTitle(value);
    else setText(value);
    draft.current = { ...draft.current, [key]: value };
    autosave.current?.queue(draft.current);
  };
  return (
    <section className="amp-publication-copy-section" aria-labelledby="publication-copy-heading">
      <header className="amp-publication-section-header">
        <h2 id="publication-copy-heading">{t("文案", "Copy")}</h2>
        {saveState !== "idle" && saveState !== "error" && <small role="status">
          {unsaved ? (!editable ? t("修改尚未保存", "Changes not saved") : t("自动保存中…", "Autosaving…")) : t("已自动保存", "Autosaved")}
        </small>}
        {editable && <div className="amp-publication-content-actions">
          <button type="button" className="amp-button amp-button-secondary" disabled={locked || busy} onClick={onPick}>
            <InlineIcon name="collection" />{t("从素材集选择", "Choose materials")}</button>
        </div>}
      </header>
      {loading ? <div className="amp-publication-content-empty" role="status">{t("加载中…", "Loading…")}</div>
        : error ? <div className="amp-publication-content-empty" role="alert"><p>{error}</p>
          <button type="button" className="amp-button amp-button-secondary" onClick={() => setAttempt((value) => value + 1)}>{t("重试", "Retry")}</button></div>
          : <div className="amp-publication-copy-fields">
            {!editable && unsaved && <p role="alert">
              {t("计划已锁定，未保存的文案仍保留在此页面。请复制备份后再离开。",
                "This plan is locked. Unsaved copy is retained on this page; copy it to a backup before leaving.")}
            </p>}
            {saveError && <div role="alert" className="amp-publication-copy-save-error">
              <span>{t("自动保存失败，修改尚未保存：{message}", "Autosave failed; changes are not saved: {message}", { message: saveError })}</span>
              <button type="button" className="amp-button amp-button-secondary" disabled={locked || busy}
                onClick={() => { void autosave.current?.flush(); }}>{t("重试", "Retry")}</button>
            </div>}
            <label><span>{t("标题", "Title")}</span>
              <input className="amp-workspace-control" maxLength={255} value={title} readOnly={!editable} disabled={disabled || loading || Boolean(error)}
                placeholder={t("输入发布标题", "Enter a publication title")}
                onChange={(event) => change("title", event.target.value)}
                onBlur={() => { void autosave.current?.flush(); }}
                onCompositionStart={() => autosave.current?.pause()}
                onCompositionEnd={(event) => { change("title", event.currentTarget.value); autosave.current?.resume(); }} /></label>
            <label className="amp-publication-copy-body">
              <span>{t("正文", "Body")}</span>
              <textarea className="amp-workspace-control" value={text} readOnly={!editable} disabled={disabled || loading || Boolean(error)}
                aria-label={t("文案正文", "Copy content")}
                placeholder={t("输入发布正文，支持换行和 emoji", "Enter copy with line breaks and emoji")}
                onChange={(event) => change("content", event.target.value)}
                onBlur={() => { void autosave.current?.flush(); }}
                onCompositionStart={() => autosave.current?.pause()}
                onCompositionEnd={(event) => { change("content", event.currentTarget.value); autosave.current?.resume(); }} />
            </label>
            {sources.length > 0 && <div className="amp-publication-copy-sources">
              <h3>{t("导入的文案", "Imported copy")}</h3>
              {sources.map((item) => <div key={item.id}>
                <button type="button" className="amp-publication-copy-source-name" title={item.name}
                  onClick={() => onPreview(item)}>{item.name}</button>
                {editable && <>
                  <button type="button" disabled={locked || busy} className="amp-member-action-more"
                    aria-label={t("移除：{name}", "Remove: {name}", { name: item.name })} onClick={() => onRemove(item)}>
                    <InlineIcon name="close" /></button>
                </>}
              </div>)}
            </div>}
          </div>}
    </section>
  );
}
