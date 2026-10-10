"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import { useToast } from "@/contexts/toast_context";
import InlineIcon from "@/components/redesign/InlineIcon";
import { GuardedButton } from "@/components/redesign/GuardedControls";
import DeleteConfirmDialog from "@/components/redesign/DeleteConfirmDialog";
import PortfolioProjectSidebar from "@/components/portfolio/PortfolioProjectSidebar";
import PortfolioWorkView from "@/components/portfolio/PortfolioWorkView";
import PortfolioMaterialPicker from "@/components/portfolio/PortfolioMaterialPicker";
import { fetch_content_projects, fetch_script, save_portfolio_edit, update_script } from "@/services/api_client";
import type { PortfolioMedia, PortfolioScript } from "@/types/portfolio";
import type { ContentProject, ProjectMaterial } from "@/types/publishing";

type DraftMedia = PortfolioMedia & { file?: File; material?: ProjectMaterial };
interface WorkDraft {
  work: PortfolioScript;
  media: DraftMedia[];
  tagsText: string;
}

export default function PortfolioDetailPage() {
  const { scriptId } = useParams<{ scriptId: string }>();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { t } = useI18n();
  const { showError, showSuccess } = useToast();
  const [work, setWork] = useState<PortfolioScript | null>(null);
  const [projects, setProjects] = useState<ContentProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<WorkDraft | null>(null);
  const [materialPickerOpen, setMaterialPickerOpen] = useState(false);
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);
  const materialGap = useRef(0);
  const uploadUrls = useRef(new Set<string>());
  const activeId = useRef(scriptId);
  useLayoutEffect(() => { activeId.current = scriptId; }, [scriptId]);
  const releaseUploads = () => {
    for (const url of uploadUrls.current) URL.revokeObjectURL(url);
    uploadUrls.current.clear();
  };
  useEffect(() => {
    const urls = uploadUrls.current;
    setDraft(null);
    setMaterialPickerOpen(false);
    setPendingRemoveId(null);
    return () => { for (const url of urls) URL.revokeObjectURL(url); urls.clear(); };
  }, [scriptId]);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/");
  }, [authLoading, router, user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    setWork(null);
    Promise.all([fetch_script(scriptId), fetch_content_projects()])
      .then(([response, projectResponse]) => {
        if (cancelled) return;
        setProjects(projectResponse.data);
        setWork(response.data);
      })
      .catch(error => {
        if (!cancelled) showError(error instanceof Error ? error.message : t("加载作品失败", "Could not load work"));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scriptId, user, showError, t]);

  const reorder = async (ids: string[]) => {
    if (!work || saving) return;
    if (draft) {
      const byId = new Map(draft.media.map(item => [item.id, item]));
      const reordered = ids.map(id => byId.get(id));
      if (reordered.some(item => !item) || ids.length !== draft.media.length || new Set(ids).size !== ids.length) {
        showError(t("图片顺序无效，请重试", "Invalid image order. Please try again."));
        return;
      }
      setDraft({ ...draft, media: reordered.filter((item): item is DraftMedia => Boolean(item)) });
      return;
    }
    setSaving(true);
    try {
      const response = await update_script(work.id, { media_order: ids, expected_updated_at: work.updated_at });
      if (activeId.current !== work.id) return;
      if (!response.success) throw new Error(response.message);
      setWork(response.data);
      showSuccess(t("图片顺序已保存", "Image order saved"));
    } catch (error) {
      showError(error instanceof Error ? error.message : t("保存顺序失败", "Could not save order"));
    } finally {
      setSaving(false);
    }
  };

  const upload = (files: File[], gap: number) => {
    if (!work || saving || !files.length) return;
    const uploadDraft: WorkDraft = draft || { work: { ...work }, media: [...(work.media || [])], tagsText: (work.tags || []).join(", ") };
    const video = uploadDraft.work.media_kind === "video";
    if (video && uploadDraft.media.length > 0) {
      showError(t("请先删除现有视频，再添加新视频", "Remove the existing video before adding a new one."));
      return;
    }
    const allowed = video ? /\.(mp4|mov|webm|m4v)$/i : /\.(jpg|jpeg|png|gif|webp)$/i;
    if (files.some(file => !allowed.test(file.name)) || (video && files.length !== 1)) {
      showError(video ? t("请选择一个视频文件", "Select one video file") : t("请选择 JPG、PNG、GIF 或 WebP 图片", "Select JPG, PNG, GIF or WebP images"));
      return;
    }
    const added = files.map(file => {
      const url = URL.createObjectURL(file);
      uploadUrls.current.add(url);
      return { id: `upload:${crypto.randomUUID()}`, file, name: file.name,
        media_type: video ? "video" as const : "image" as const, mime_type: file.type,
        object_key: "", file_url: url };
    });
    const index = Math.max(0, Math.min(gap, uploadDraft.media.length));
    setDraft({ ...uploadDraft, media: video ? added : [...uploadDraft.media.slice(0, index), ...added, ...uploadDraft.media.slice(index)] });
  };

  const removeMedia = (id: string) => {
    if (!draft || saving) return;
    const item = draft.media.find(media => media.id === id);
    if (item?.file) {
      URL.revokeObjectURL(item.file_url);
      uploadUrls.current.delete(item.file_url);
    }
    setDraft({ ...draft, media: draft.media.filter(item => item.id !== id) });
  };

  const chooseMaterials = (selected: ProjectMaterial[]) => {
    if (!work || saving) return;
    const materialDraft: WorkDraft = draft || { work: { ...work }, media: [...(work.media || [])], tagsText: (work.tags || []).join(", ") };
    const kind = materialDraft.work.media_kind || "image";
    if (kind === "video" && materialDraft.media.length > 0) {
      showError(t("请先删除现有视频，再添加新视频", "Remove the existing video before adding a new one."));
      return;
    }
    if (selected.some(item => item.project_id !== materialDraft.work.project_id || item.media_type !== kind)
      || (kind === "video" && selected.length !== 1)) {
      showError(t("素材类型或所属项目不匹配，请重新选择", "Material type or project does not match. Select again."));
      return;
    }
    const pickedIds = new Set(selected.map(item => item.id));
    const kept = materialDraft.media.filter(item => !item.material || pickedIds.has(item.material.id));
    const existingIds = new Set(kept.flatMap(item => item.material ? [item.material.id] : []));
    const added = selected.filter(item => kind === "video" || !existingIds.has(item.id)).map(material => ({
      id: `material:${material.id}`, material, name: material.name, media_type: kind,
      object_key: material.object_key, mime_type: material.mime_type, file_url: material.file_url,
    }));
    const gap = materialDraft.media.slice(0, materialGap.current)
      .filter(item => !item.material || pickedIds.has(item.material.id)).length;
    setDraft({ ...materialDraft, media: kind === "video" ? added : [...kept.slice(0, gap), ...added, ...kept.slice(gap)] });
  };

  const saveEdit = async () => {
    if (!draft || !work || saving) return;
    const added = draft.media.filter(item => item.file);
    const uploadIndex = new Map(added.map((item, index) => [item.id, index]));
    const files = added.flatMap(item => item.file ? [item.file] : []);
    setSaving(true);
    try {
      const metadata = {
        title: draft.work.title, content: draft.work.content,
        tags: draft.tagsText.split(/[,，\n]/).map(tag => tag.trim()).filter(Boolean),
        media_ids: draft.media.map(item => item.file ? `upload:${uploadIndex.get(item.id)}`
          : item.material ? `material:${item.material.id}` : item.id),
      };
      const response = await save_portfolio_edit(work.id, { ...metadata, expected_updated_at: draft.work.updated_at }, files);
      if (activeId.current !== work.id) return;
      if (!response.success) throw new Error(response.message);
      setWork(response.data);
      setDraft(null);
      setMaterialPickerOpen(false);
      setPendingRemoveId(null);
      releaseUploads();
      showSuccess(t("作品已保存", "Work saved"));
    } catch (error) {
      showError(error instanceof Error ? error.message : t("无法保存作品", "Could not save work"));
    } finally {
      setSaving(false);
    }
  };

  if (loading || authLoading) return <div className="amp-page-state" role="status">{t("加载中", "Loading")}</div>;
  if (!user) return null;
  if (!work) return <div className="amp-page-state">{t("无法加载作品，请刷新重试", "Could not load work. Reload to retry.")}</div>;
  const editable = work.user_id === user.id || ["owner", "admin"].includes(work.project_role);
  const pendingRemove = draft?.media.find(item => item.id === pendingRemoveId);
  const workView = <PortfolioWorkView work={draft ? { ...draft.work, media: draft.media } : work}
    editable={editable} saving={saving} editing={Boolean(draft)} tagsText={draft?.tagsText || ""}
    onReorder={ids => void reorder(ids)} onUpload={upload} onRemove={setPendingRemoveId}
    onPickMaterials={gap => { materialGap.current = gap; setMaterialPickerOpen(true); }}
    onTextChange={(field, value) => setDraft(current => current ? { ...current, work: { ...current.work, [field]: value } } : current)}
    onTagsChange={value => setDraft(current => current ? { ...current, tagsText: value } : current)} />;
  return (
    <div className="amp-project-detail-layout amp-portfolio-detail-layout">
      <PortfolioProjectSidebar projects={projects} selectedProjectId={work.project_id} />
      <main className="amp-project-detail-main">
        <header className="amp-project-detail-header">
          <div className="amp-project-detail-title">
            <Link href={`/portfolio?project=${encodeURIComponent(work.project_id)}`} className="amp-project-detail-back"
              aria-label={t("返回作品列表", "Back to portfolio")}><InlineIcon name="arrowLeft" /></Link>
            <div>
              <h1>{work.name || t("未命名作品", "Untitled work")}</h1>
              <p><Link href={`/projects/${encodeURIComponent(work.project_id)}`}>{work.project_title}</Link></p>
            </div>
          </div>
          {(work.status === "completed" || work.status === "draft") && <div className="amp-insight-edit-actions">
            {draft ? <>
              <GuardedButton type="button" className="amp-button amp-button-secondary amp-button-cancel"
                disabled={saving} blockedReason={t("正在保存作品，请稍候", "Work is being saved. Please wait.")}
                onClick={() => {
                  setDraft(null); setMaterialPickerOpen(false); setPendingRemoveId(null); releaseUploads();
                }}>{t("取消", "Cancel")}</GuardedButton>
              <GuardedButton type="submit" form="portfolio-edit-form" className="amp-button amp-button-primary"
                disabled={saving} blockedReason={t("正在保存作品，请稍候", "Work is being saved. Please wait.")}
                >{saving ? t("保存中", "Saving") : t("保存", "Save")}</GuardedButton>
            </> : <GuardedButton type="button" className="amp-button amp-button-secondary"
              disabled={!editable || saving}
              blockedReason={!editable ? t("仅作品创建者和项目管理员可编辑", "Only the creator and project managers can edit this work")
                : t("正在保存作品，请稍候", "Work is being saved. Please wait.")}
              onClick={() => setDraft({ work: { ...work }, media: [...(work.media || [])], tagsText: (work.tags || []).join(", ") })}>
              <InlineIcon name="edit" className="h-4 w-4" />{t("编辑", "Edit")}
            </GuardedButton>}
          </div>}
        </header>
        {work.status === "failed" ? <div className="amp-projects-state">{t("作品保存失败，请返回创作重试", "Work could not be saved. Return to creation to retry.")}</div>
          : work.status === "generating" ? <div className="amp-projects-state" role="status">{t("旧作品正在处理中", "Legacy work is processing")}</div>
            : draft ? <form id="portfolio-edit-form" className="amp-portfolio-edit-form"
              onSubmit={event => { event.preventDefault(); void saveEdit(); }}>{workView}</form> : workView}
        {editable && <PortfolioMaterialPicker open={materialPickerOpen} projectId={work.project_id}
          kind={work.media_kind || "image"}
          selected={draft?.media.flatMap(item => item.material ? [item.material] : []) || []}
          onConfirm={chooseMaterials} onClose={() => setMaterialPickerOpen(false)} />}
        <DeleteConfirmDialog open={Boolean(pendingRemove)}
          title={pendingRemove?.media_type === "video" ? t("删除视频", "Delete video") : t("删除图片", "Delete image")}
          message={t("确认移除“{name}”？移除后需保存作品才会生效。",
            "Remove “{name}”? The removal takes effect only after saving the work.", { name: pendingRemove?.name || "" })}
          cancelLabel={t("取消", "Cancel")} confirmLabel={t("删除", "Delete")}
          busyLabel={t("处理中", "Processing")} busy={saving}
          blockedReason={t("正在保存作品，请稍候", "Work is being saved. Please wait.")}
          onCancel={() => setPendingRemoveId(null)}
          onConfirm={() => {
            if (pendingRemove) removeMedia(pendingRemove.id);
            setPendingRemoveId(null);
          }} />
      </main>
    </div>
  );
}
