"use client";

import { useEffect, useRef, useState } from "react";
import { publicationReadOnly } from "@/utils/publication_lifecycle";
import { createPortal } from "react-dom";
import { useI18n } from "@/contexts/i18n_context";
import { ENGLISH_ACTIONS, ENGLISH_PROGRESS, CHINESE_ACTIONS, CHINESE_PROGRESS } from "@/i18n/interaction_copy";
import { useToast } from "@/contexts/toast_context";
import { localizeErrorMessage } from "@/i18n/errors";
import InlineIcon from "@/components/redesign/InlineIcon";
import { GuardedButton } from "@/components/redesign/GuardedControls";
import EmptyStateIcon from "@/components/redesign/EmptyStateIcon";
import DeleteConfirmDialog from "@/components/redesign/DeleteConfirmDialog";
import MaterialPickerOption, { MaterialPickerSetCover } from "@/components/projects/MaterialPickerOption";
import PublicationContentMedia from "./PublicationContentMedia";
import PublicationCopyEditor from "./PublicationCopyEditor";
import PublicationImageGallery from "./PublicationImageGallery";
import {
  fetch_publication_contents, upload_publication_content, import_publication_materials,
  delete_publication_content, fetch_project_materials,
  update_publication_plan, reorder_publication_images,
  fetch_project_material_content,
} from "@/services/api_client";
import type { PublicationPlan, PublicationContent, ProjectMaterial } from "@/types/publishing";
import { validatePublicationMediaFiles, type PublicationMediaMode } from "@/utils/publication_media";
import { useDropdownMenu } from "@/hooks/use_dropdown_menu";

export default function PublicationContentPanel({ plan, editable, disabled, onChanged, onBusyChange }: {
  plan: PublicationPlan;
  editable: boolean;
  disabled: boolean;
  onChanged: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const { showError, showSuccess } = useToast();
  const [items, setItems] = useState<PublicationContent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLDialogElement>(null);
  const preview = useRef<HTMLDialogElement>(null);
  const [previewItem, setPreviewItem] = useState<PublicationContent | null>(null);
  const [pendingRemove, setPendingRemove] = useState<PublicationContent | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<"media" | "document">("media");
  const [importedCopy, setImportedCopy] = useState<{ title: string; content: string } | null>(null);
  const [selectedCopy, setSelectedCopy] = useState<ProjectMaterial | null>(null);
  const [sets, setSets] = useState<ProjectMaterial[]>([]);
  const [setId, setSetId] = useState("");
  const [materials, setMaterials] = useState<ProjectMaterial[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState("");
  const [pickerAttempt, setPickerAttempt] = useState(0);
  const [mediaMode, setMediaMode] = useState<PublicationMediaMode>(plan.media_mode || "image_text");
  const media = items.filter((item) => item.media_type !== "document");
  const invalidMedia = media.some((item) => item.media_type !== (mediaMode === "video" ? "video" : "image"))
    || (mediaMode === "video" && media.length > 1);
  const mediaFull = mediaMode === "video" && media.length >= 1;
  const selectionLimit = pickerMode === "document" || mediaMode === "video" ? 1 : Infinity;
  const mutationsAllowed = editable && !publicationReadOnly(plan.status);
  const allowed = useRef(mutationsAllowed);
  useEffect(() => { allowed.current = mutationsAllowed; }, [mutationsAllowed]);
  const locked = busy || copyBusy || disabled || !mutationsAllowed;
  const busyReason = t("内容正在保存或上传，请稍候。", "Content is being saved or uploaded. Please wait.");
  const lockReason = busy || copyBusy ? busyReason : disabled
    ? t("发布设置正在保存，请稍候。", "Publication settings are being saved. Please wait.")
    : plan.status === "published" ? t("已发布的计划不能修改内容。", "Published plans cannot change content.")
      : plan.status === "publishing" ? t("正在发布，不能修改媒体或文案。", "Publishing is in progress; media and copy cannot change.")
        : !editable ? t("仅计划创建者和项目管理员可以修改内容。", "Only the plan creator and project managers can edit content.")
          : loading ? t("内容正在加载，请稍候。", "Content is loading. Please wait.")
            : error ? t("内容加载失败，请先重试。", "Content failed to load. Retry first.") : busyReason;
  const {
    open: mediaMenuOpen, position: mediaMenuPosition, triggerRef: mediaTriggerRef,
    menuRef: mediaMenuRef, menuId: mediaMenuId, toggleMenu: toggleMediaMenu,
    closeMenu: closeMediaMenu, handleTriggerKeyDown, handleMenuKeyDown,
  } = useDropdownMenu(2);
  const addingMediaDisabled = locked || loading || Boolean(error) || mediaFull || invalidMedia;
  const addingReason = locked || loading || error ? lockReason : invalidMedia
    ? t("请先移除与当前发布类型不匹配的媒体。", "Remove media incompatible with the current publication type first.")
    : t("视频发布只能添加一个视频，请先移除当前视频。", "Video publications allow one video. Remove the current video first.");
  const mediaLabel = (type: PublicationContent["media_type"]) =>
    type === "image" ? t("图片", "Image") : type === "video" ? t("视频", "Video") : t("文案", "Copy");
  const message = (reason: unknown, fallback: string) =>
    localizeErrorMessage(reason instanceof Error ? reason.message : fallback, locale);

  useEffect(() => {
    onBusyChange(busy || copyBusy);
  }, [busy, copyBusy, onBusyChange]);

  useEffect(() => {
    if (plan.media_mode) setMediaMode(plan.media_mode);
  }, [plan.media_mode]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void fetch_publication_contents(plan.id)
      .then((response) => { if (!cancelled) setItems(response.data); })
      .catch((reason: unknown) => {
        if (!cancelled) setError(localizeErrorMessage(
          reason instanceof Error ? reason.message : "Could not load publication content", locale,
        ));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [plan.id, locale, attempt]);

  useEffect(() => {
    if (!pickerOpen) return;
    let cancelled = false;
    setPickerLoading(true);
    setPickerError("");
    void fetch_project_materials(plan.project_id, setId)
      .then((response) => {
        if (cancelled) return;
        if (setId) setMaterials(response.data);
        else setSets(response.data);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setPickerError(localizeErrorMessage(
          reason instanceof Error ? reason.message : "Could not load project materials", locale,
        ));
      })
      .finally(() => { if (!cancelled) setPickerLoading(false); });
    return () => { cancelled = true; };
  }, [pickerOpen, setId, plan.project_id, pickerAttempt, locale]);

  const setWorking = (value: boolean) => { setBusy(value); };
  const refreshPlan = async () => {
    try { await onChanged(); }
    catch (reason) { showError(message(reason, "Could not load publication plan")); }
  };
  const upload = async (files: File[]) => {
    if (!files.length) return;
    if (addingMediaDisabled) { showError(addingReason); return; }
    try {
      if (invalidMedia) throw new Error("Remove incompatible media before adding more");
      validatePublicationMediaFiles(mediaMode, media.length, files.map((file) => file.name));
    } catch (reason) {
      showError(message(reason, "Unsupported project material type"));
      return;
    }
    setWorking(true);
    let completed = 0;
    try {
      for (const file of files) {
        if (!allowed.current) throw new Error("This plan is read-only. Remaining uploads were stopped.");
        setProgress(t("正在添加 {current}/{total}：{name}", `${ENGLISH_PROGRESS.adding} {current}/{total}: {name}`, {
          current: completed + 1, total: files.length, name: file.name,
        }));
        const response = await upload_publication_content(plan.id, file);
        setItems((current) => [...current, response.data]);
        completed += 1;
      }
      showSuccess(t("已添加 {count} 项内容", "{count} content items added", { count: completed }));
    } catch (reason) {
      showError(t("已添加 {count} 项，其余未完成：{reason}", "{count} items added; remaining uploads stopped: {reason}", {
        count: completed, reason: message(reason, "Could not upload publication content"),
      }));
    } finally {
      if (completed) await refreshPlan();
      setProgress("");
      setWorking(false);
    }
  };
  const addSelected = async () => {
    if (locked || !selected.size) { showError(locked ? lockReason : t("请先选择素材。", "Select materials first.")); return; }
    if (pickerMode === "document") {
      if (selected.size !== 1 || !selectedCopy || !selected.has(selectedCopy.id)) {
        showError(t("请选择一项文案", "Select one copy item"));
        return;
      }
      setWorking(true);
      try {
        const response = await fetch_project_material_content(plan.project_id, selectedCopy.id, "text");
        if (!allowed.current) { showError(t("计划已锁定，未导入文案。", "The plan is locked; copy was not imported.")); return; }
        if (response.data.format !== "text") throw new Error("Could not load material content");
        setImportedCopy({
          title: Array.from(selectedCopy.name).slice(0, 255).join(""),
          content: response.data.content,
        });
        picker.current?.close();
        setPickerOpen(false);
        setSelected(new Set());
        setSelectedCopy(null);
        showSuccess(t("已填入标题和正文，将自动保存", "Title and body filled; autosave will keep the changes."));
      } catch (reason) {
        showError(message(reason, "Could not load material content"));
      } finally { setWorking(false); }
      return;
    }
    if (pickerMode === "media" && (invalidMedia || (mediaMode === "video" && selected.size + media.length > 1))) {
      showError(t("视频只能添加一个，请先移除当前媒体。", "Only one video is allowed. Remove the current media first."));
      return;
    }
    setWorking(true);
    let completed = 0;
    try {
      const ids = [...selected];
      for (let offset = 0; offset < ids.length; offset += 10) {
        if (!allowed.current) throw new Error("This plan is read-only. Remaining imports were stopped.");
        const batch = ids.slice(offset, offset + 10);
        const response = await import_publication_materials(plan.id, batch);
        setItems((current) => [...current, ...response.data]);
        completed += response.data.length;
        setSelected((current) => {
          const remaining = new Set(current);
          batch.forEach((id) => remaining.delete(id));
          return remaining;
        });
      }
      picker.current?.close();
      setPickerOpen(false);
      setSelected(new Set());
      showSuccess(t("素材已添加到计划", "Materials added to the plan"));
    } catch (reason) {
      showError(t(
        "已添加 {count} 项，其余未完成：{reason}",
        "{count} items added; remaining imports stopped: {reason}",
        { count: completed, reason: message(reason, "Could not add project materials") },
      ));
    } finally {
      if (completed) await refreshPlan();
      setWorking(false);
    }
  };
  const remove = async () => {
    if (locked) { showError(lockReason); return; }
    if (!pendingRemove) return;
    setWorking(true);
    try {
      await delete_publication_content(plan.id, pendingRemove.id);
      setItems((current) => current.filter((item) => item.id !== pendingRemove.id));
      setPendingRemove(null);
      await refreshPlan();
      showSuccess(t("内容已移除", "Content removed"));
    } catch (reason) { showError(message(reason, "Could not remove publication content")); }
    finally { setWorking(false); }
  };
  const openPicker = (mode: "media" | "document") => {
    if (locked || (mode === "media" && addingMediaDisabled)) {
      showError(mode === "media" ? addingReason : lockReason); return;
    }
    setPickerMode(mode);
    setSelectedCopy(null);
    setSetId(""); setSelected(new Set()); setPickerOpen(true);
    picker.current?.showModal();
  };
  const changeMediaMode = async (mode: PublicationMediaMode) => {
    if (locked || loading || error) { showError(lockReason); return; }
    if (mode === mediaMode) return;
    if (media.some((item) => item.media_type !== (mode === "video" ? "video" : "image"))
      || (mode === "video" && media.length > 1)) {
      showError(t("请先移除当前媒体，再切换发布类型。", "Remove the current media before switching the publication type."));
      return;
    }
    setWorking(true);
    try {
      const response = await update_publication_plan(plan.id, { media_mode: mode });
      setMediaMode(response.data.media_mode);
      await refreshPlan();
    } catch (reason) { showError(message(reason, "Could not update publication plan")); }
    finally { setWorking(false); }
  };
  const reorderImages = async (ids: string[]) => {
    if (locked || invalidMedia || mediaMode !== "image_text") {
      showError(locked ? lockReason : t("只有匹配图片类型的媒体可以排序。", "Only compatible image media can be reordered.")); return;
    }
    setWorking(true);
    try {
      const response = await reorder_publication_images(plan.id, ids);
      setItems(response.data);
      showSuccess(t("图片顺序已保存", "Image order saved"));
    } catch (reason) { showError(message(reason, "Could not reorder publication images")); }
    finally { setWorking(false); }
  };
  const sourceIds = new Set(items.map((item) => item.source_material_id).filter(Boolean));
  const candidates = (setId ? materials : sets).filter((item) =>
    !setId || (pickerMode === "document" ? item.media_type === "document"
      : item.media_type === (mediaMode === "video" ? "video" : "image")));

  return (
    <div className="amp-publication-composer">
    <section className="amp-publication-content-section" aria-label={t("媒体", "Media")}>
      <header className="amp-publication-section-header">
        <div className="amp-publication-media-mode" role="group" aria-label={t("发布类型", "Publication type")}>
          <GuardedButton blockedReason={lockReason} type="button" aria-pressed={mediaMode === "image_text"} disabled={locked || loading || Boolean(error)}
            onClick={() => void changeMediaMode("image_text")}>{t("图片", "Images")}</GuardedButton>
          <GuardedButton blockedReason={lockReason} type="button" aria-pressed={mediaMode === "video"} disabled={locked || loading || Boolean(error)}
            onClick={() => void changeMediaMode("video")}>{t("视频", "Video")}</GuardedButton>
        </div>
        {editable && <div className="amp-publication-content-actions">
          <GuardedButton blockedReason={addingReason} ref={mediaTriggerRef} type="button" className="amp-button amp-button-secondary"
            disabled={addingMediaDisabled}
            aria-haspopup="menu" aria-expanded={mediaMenuOpen}
            aria-controls={mediaMenuOpen ? mediaMenuId : undefined}
            onKeyDown={(event) => {
              if (addingMediaDisabled) { if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); showError(addingReason); } return; }
              handleTriggerKeyDown(event);
            }}
            onClick={() => toggleMediaMenu()}>
            {t(CHINESE_ACTIONS.add, ENGLISH_ACTIONS.add)}
            <InlineIcon name="chevronRight" className="amp-publication-add-chevron" />
          </GuardedButton>
          {mediaMenuOpen && createPortal(
            <div ref={mediaMenuRef} id={mediaMenuId} role="menu"
              aria-label={t("添加媒体", "Add media")}
              className="amp-redesign amp-publication-add-menu"
              style={mediaMenuPosition} onKeyDown={handleMenuKeyDown}>
              <GuardedButton blockedReason={addingReason} type="button" role="menuitem" tabIndex={-1} disabled={addingMediaDisabled}
                onClick={() => {
                  closeMediaMenu();
                  openPicker("media");
                }}>
                <InlineIcon name="collection" />{t(CHINESE_ACTIONS.select, ENGLISH_ACTIONS.select)}
              </GuardedButton>
              <GuardedButton blockedReason={addingReason} type="button" role="menuitem" tabIndex={-1} disabled={addingMediaDisabled}
                onClick={() => {
                  closeMediaMenu();
                  fileInput.current?.click();
                }}>
                <InlineIcon name="upload" />{t(CHINESE_ACTIONS.upload, ENGLISH_ACTIONS.upload)}
              </GuardedButton>
            </div>,
            document.body,
          )}
          <input ref={fileInput} type="file" hidden multiple={mediaMode === "image_text"} disabled={locked || mediaFull || invalidMedia}
            accept={mediaMode === "video" ? ".mp4,.mov,.webm,.m4v" : ".jpg,.jpeg,.png,.gif,.webp"}
            onChange={(event) => {
              const files = Array.from(event.target.files || []);
              event.currentTarget.value = "";
              void upload(files);
            }} />
        </div>}
      </header>
      {invalidMedia && <p className="amp-publication-content-progress" role="alert">{t(
        "已有媒体与当前类型不一致，请移除不匹配的媒体后继续。",
        "Existing media does not match this type. Remove incompatible items to continue.",
      )}</p>}
      {progress && <p className="amp-publication-content-progress" role="status">{progress}</p>}
      {loading ? <div className="amp-publication-content-empty" role="status">{t(CHINESE_PROGRESS.loading, ENGLISH_PROGRESS.loading)}</div>
        : error ? <div className="amp-publication-content-empty" role="alert"><p>{error}</p>
          <button className="amp-button amp-button-secondary" onClick={() => setAttempt((value) => value + 1)}>{t(CHINESE_ACTIONS.retry, ENGLISH_ACTIONS.retry)}</button>
        </div>
        : !media.length ? <div className="amp-publication-content-empty">
          <InlineIcon name={mediaMode === "video" ? "video" : "image"} />
          <strong>{mediaMode === "video" ? t("添加一个视频", "Add one video") : t("添加图片", "Add images")}</strong>
        </div>
        : mediaMode === "image_text" && !invalidMedia ? (
          <PublicationImageGallery items={media} editable={editable} disabled={locked} blockedReason={lockReason}
            onReorder={reorderImages} onRemove={setPendingRemove}
            onPreview={(item) => { setPreviewItem(item); preview.current?.showModal(); }} />
        ) : mediaMode === "video" && !invalidMedia && media.length === 1 ? (
          <div className="amp-publication-video-stage">
            <article className="amp-publication-video-card">
              <div className="amp-publication-video-player">
                <PublicationContentMedia key={media[0].id} item={media[0]} expanded />
              </div>
              <div className="amp-publication-content-caption">
                <div><strong title={media[0].name}>{media[0].name}</strong>
                  <small>{media[0].source_material_id
                    ? t("来自素材集", "From materials")
                    : t("直接上传", "Uploaded")}</small></div>
                {editable && <GuardedButton blockedReason={lockReason} type="button" className="amp-member-action-more" disabled={locked}
                  aria-label={t("移除：{name}", "Remove: {name}", { name: media[0].name })}
                  onClick={() => setPendingRemove(media[0])}><InlineIcon name="trash" /></GuardedButton>}
              </div>
            </article>
          </div>
        ) : <div className="amp-publication-content-grid">
          {media.map((item, index) => (
            <article key={item.id} className="amp-publication-content-card">
              <div className="amp-publication-content-cover">
                <PublicationContentMedia item={item} />
                <span className="amp-case-type-overlay">{item.media_type === "image"
                  ? t("图片 {index}", "Image {index}", { index: index + 1 }) : mediaLabel(item.media_type)}</span>
                <button type="button" className="amp-publication-content-open"
                  aria-label={t("预览：{name}", "Preview: {name}", { name: item.name })}
                  onClick={() => { setPreviewItem(item); preview.current?.showModal(); }} />
              </div>
              <div className="amp-publication-content-caption">
                <div><strong title={item.name}>{item.name}</strong>
                  <small>{item.source_material_id ? t("来自素材集", "From materials") : t("直接上传", "Uploaded")}</small></div>
                {editable && <GuardedButton blockedReason={lockReason} type="button" className="amp-member-action-more" disabled={locked}
                  aria-label={t("移除：{name}", "Remove: {name}", { name: item.name })}
                  onClick={() => setPendingRemove(item)}><InlineIcon name="trash" /></GuardedButton>}
              </div>
            </article>
          ))}
        </div>}
      <dialog ref={picker} className="amp-material-preview-dialog amp-publication-picker m-auto w-[calc(100%_-_32px)] max-w-3xl bg-white backdrop:bg-slate-950/40"
        aria-labelledby="publication-picker-title" onClose={() => setPickerOpen(false)}
        onCancel={(event) => { if (busy) { event.preventDefault(); showError(busyReason); } }}>
        <header>
          <div className="amp-publication-picker-title">
            {setId && <GuardedButton blockedReason={busyReason} type="button" className="amp-project-detail-back"
              aria-label={t("返回素材集", "Back to material sets")}
              disabled={busy} onClick={() => setSetId("")}>
              <InlineIcon name="arrowLeft" />
            </GuardedButton>}
            <h2 id="publication-picker-title">
              {setId
                ? sets.find((set) => set.id === setId)?.name
                : t("项目素材集", "Project material sets")}
            </h2>
          </div>
        </header>
        <div className="amp-publication-picker-body">
          {pickerLoading ? <div className="amp-dialog-state" role="status">{t(CHINESE_PROGRESS.loading, ENGLISH_PROGRESS.loading)}</div>
            : pickerError ? <div className="amp-dialog-state" role="alert"><p>{pickerError}</p>
              <button type="button" className="amp-button amp-button-secondary" onClick={() => setPickerAttempt((value) => value + 1)}>{t(CHINESE_ACTIONS.retry, ENGLISH_ACTIONS.retry)}</button></div>
              : !candidates.length ? <div className="amp-dialog-state amp-empty-state">
                <EmptyStateIcon name="collection" />
                <p>{t("暂无可选素材", "No materials available")}</p>
              </div>
                : <div className="amp-publication-picker-grid">{candidates.map((material) => !setId ? (
                  <GuardedButton blockedReason={busyReason} key={material.id} type="button" className="amp-publication-set-option" disabled={busy}
                    onClick={() => setSetId(material.id)}>
                    <MaterialPickerSetCover covers={material.covers} hasMaterials={material.material_count > 0} />
                    <span className="amp-publication-set-copy">
                      <strong title={material.name}>{material.name}</strong>
                      <small>{pickerMode === "document"
                        ? t("{count} 个文案", "{count} copy items", { count: material.document_count })
                        : mediaMode === "video"
                          ? t("{count} 个视频", "{count} videos", { count: material.video_count })
                          : t("{count} 张图片", "{count} images", { count: material.image_count })}</small>
                    </span>
                  </GuardedButton>
                ) : (
                  <MaterialPickerOption key={material.id} material={material}
                      inputType={pickerMode === "document" ? "radio" : "checkbox"}
                      blockedReason={locked ? lockReason : t("此素材已添加到计划，不能重复添加。", "This material is already in the plan and cannot be added again.")}
                      inputName={pickerMode === "document" ? "publication-copy-material" : undefined}
                      selected={selected.has(material.id) || (pickerMode !== "document" && sourceIds.has(material.id))}
                      highlighted={selected.has(material.id)}
                      disabled={locked || (pickerMode !== "document" && sourceIds.has(material.id))}
                      description={pickerMode !== "document" && sourceIds.has(material.id) ? t("已添加", "Already added") : mediaLabel(material.media_type)}
                      onChange={() => {
                        if (pickerMode === "document") {
                          setSelected(new Set([material.id]));
                          setSelectedCopy(material);
                          return;
                        }
                        if (!selected.has(material.id) && selected.size >= selectionLimit) {
                          showError(t(
                            "每次最多选择 {count} 个素材",
                            "Select up to {count} materials at a time",
                            { count: selectionLimit },
                          ));
                          return;
                        }
                        setSelected((current) => {
                          const next = new Set(current);
                          if (next.has(material.id)) next.delete(material.id);
                          else next.add(material.id);
                          return next;
                        });
                      }} />
                ))}</div>}
        </div>
        <footer><span>{Number.isFinite(selectionLimit)
          ? t("已选择 {count}/{limit} 项", "{count}/{limit} selected", { count: selected.size, limit: selectionLimit })
          : t("已选择 {count} 项", "{count} selected", { count: selected.size })}</span>
          <GuardedButton blockedReason={busyReason} type="button" className="amp-button amp-button-secondary amp-button-cancel" disabled={busy}
            onClick={() => picker.current?.close()}>{t(CHINESE_ACTIONS.cancel, ENGLISH_ACTIONS.cancel)}</GuardedButton>
          <GuardedButton blockedReason={locked ? lockReason : t("请先选择素材。", "Select materials first.")} type="button" className="amp-button amp-button-primary" disabled={locked || !selected.size}
            onClick={() => void addSelected()}>{busy ? t("添加中…", pickerMode === "document" ? ENGLISH_PROGRESS.importing : ENGLISH_PROGRESS.adding)
              : pickerMode === "document" ? t(CHINESE_ACTIONS.import, ENGLISH_ACTIONS.import) : t(CHINESE_ACTIONS.add, ENGLISH_ACTIONS.add)}</GuardedButton></footer>
      </dialog>
      <dialog ref={preview} className="amp-material-preview-dialog m-auto w-[calc(100%_-_32px)] max-w-5xl bg-white backdrop:bg-slate-950/70"
        aria-labelledby="publication-content-preview-title" onClose={() => setPreviewItem(null)}>
        {previewItem && <><header><h2 id="publication-content-preview-title">{previewItem.name}</h2>
          <button type="button" className="amp-material-preview-icon" aria-label={t("关闭预览", "Close preview")}
            onClick={() => preview.current?.close()}><InlineIcon name="close" /></button></header>
          <div className="amp-material-preview-stage"><PublicationContentMedia key={previewItem.id} item={previewItem} expanded /></div></>}
      </dialog>
      <DeleteConfirmDialog open={Boolean(pendingRemove)} title={t("移除发布内容", "Remove publication content")}
        message={t("仅移除本计划中的“{name}”，不会删除素材集原件。", "Remove “{name}” from this plan only. Original materials are not deleted.", { name: pendingRemove?.name || "" })
          + (plan.status === "scheduled" && (plan.content_count === 1
            || (mediaMode === "video" && pendingRemove?.media_type === "video")) ? t(
            "移除后计划不再满足发布条件，将恢复为草稿并清除发布时间。",
            " Removing this item leaves the plan incomplete, returns it to draft, and clears the publish time.",
          ) : "")}
        cancelLabel={t(CHINESE_ACTIONS.cancel, ENGLISH_ACTIONS.cancel)} confirmLabel={t(CHINESE_ACTIONS.remove, ENGLISH_ACTIONS.remove)} busyLabel={t(CHINESE_PROGRESS.removing, ENGLISH_PROGRESS.removing)}
        busy={busy} onCancel={() => setPendingRemove(null)} onConfirm={() => void remove()} />
    </section>
    <PublicationCopyEditor planId={plan.id} editable={mutationsAllowed} disabled={busy || disabled || loading || Boolean(error)} blockedReason={lockReason}
      importedCopy={importedCopy}
      sources={items.filter((item) => item.media_type === "document")} onChanged={onChanged}
      onBusyChange={setCopyBusy}
      onPick={() => openPicker("document")}
      onPreview={(item) => { setPreviewItem(item); preview.current?.showModal(); }}
      onRemove={setPendingRemove} />
    </div>
  );
}
