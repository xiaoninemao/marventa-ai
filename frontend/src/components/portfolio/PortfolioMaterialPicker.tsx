"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/auth_context";
import { localizeErrorMessage } from "@/i18n/errors";
import { useI18n } from "@/contexts/i18n_context";
import { fetch_project_materials } from "@/services/api_client";
import type { ProjectMaterial } from "@/types/publishing";
import ReferencePickerDialog from "@/components/content_generator/ReferencePickerDialog";
import MaterialPickerOption, { MaterialPickerSetCover } from "@/components/projects/MaterialPickerOption";
import InlineIcon from "@/components/redesign/InlineIcon";
import EmptyStateIcon from "@/components/redesign/EmptyStateIcon";
import { GuardedButton } from "@/components/redesign/GuardedControls";

export default function PortfolioMaterialPicker({ open, projectId, kind, selected, onConfirm, onClose }: {
  open: boolean;
  projectId: string;
  kind: "image" | "video";
  selected: ProjectMaterial[];
  onConfirm: (materials: ProjectMaterial[]) => void;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const [path, setPath] = useState<ProjectMaterial[]>([]);
  const [items, setItems] = useState<ProjectMaterial[]>([]);
  const [picked, setPicked] = useState<ProjectMaterial[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const incoming = useRef(selected);
  useEffect(() => { incoming.current = selected; }, [selected]);
  useEffect(() => {
    if (!open) return;
    setPath([]);
    setPicked(incoming.current.filter(item => item.project_id === projectId && item.media_type === kind));
  }, [open, projectId, kind]);
  const setId = path.at(-1)?.id || "";
  const scope = `${user?.id}:${user?.current_organization?.id}`;
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setItems([]);
    fetch_project_materials(projectId, setId)
      .then(response => {
        if (!response.success || !Array.isArray(response.data)) throw new Error(response.message || "Could not load project materials");
        if (!cancelled) setItems(response.data.filter(item => item.project_id === projectId
          && (item.node_type === "collection" || (item.media_type === kind && Boolean(item.file_url)))));
      })
      .catch(failure => {
        if (!cancelled) setError(localizeErrorMessage(
          failure instanceof Error ? failure.message : "Could not load project materials", locale,
        ));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, projectId, setId, kind, scope, attempt, locale]);

  return (
    <ReferencePickerDialog open={open} title={path.at(-1)?.name || t("项目素材集", "Project material sets")}
      className="amp-portfolio-material-picker" onClose={onClose}
      leading={path.length > 0 && <button type="button" className="amp-project-detail-back"
        aria-label={t("返回素材集", "Back to material sets")} onClick={() => setPath(path.slice(0, -1))}>
        <InlineIcon name="arrowLeft" />
      </button>}>
      <main className="amp-reference-picker-body">
        {loading ? <div className="amp-dialog-state" role="status">{t("加载中", "Loading")}</div>
          : error ? <div className="amp-dialog-state" role="alert"><p>{error}</p>
            <button type="button" className="amp-button amp-button-secondary"
              onClick={() => setAttempt(attempt + 1)}>{t("重试", "Retry")}</button></div>
            : !items.length ? <div className="amp-dialog-state amp-empty-state">
              <EmptyStateIcon name="collection" /><p>{t("暂无可选素材", "No materials available")}</p>
            </div>
              : <div className="amp-publication-picker-grid">{items.map(item => item.node_type === "collection"
                ? <button key={item.id} type="button" className="amp-publication-set-option"
                  onClick={() => setPath([...path, item])}>
                  <MaterialPickerSetCover covers={item.covers} hasMaterials={item.material_count > 0} />
                  <span className="amp-publication-set-copy"><strong title={item.name}>{item.name}</strong>
                    <small>{kind === "video" ? t("{count} 个视频", "{count} videos", { count: item.video_count })
                      : t("{count} 张图片", "{count} images", { count: item.image_count })}</small></span>
                </button>
                : <MaterialPickerOption key={item.id} material={item} selected={picked.some(value => value.id === item.id)}
                  inputType={kind === "video" ? "radio" : "checkbox"} inputName="portfolio-material-selection"
                  blockedReason={t("素材暂不可用", "Material unavailable")}
                  onChange={() => setPicked(current => kind === "video" ? [item]
                    : current.some(value => value.id === item.id) ? current.filter(value => value.id !== item.id) : [...current, item])} />
              )}</div>}
      </main>
      <footer className="amp-reference-picker-footer">
        <span>{t("已选择 {count} 项", "{count} selected", { count: picked.length })}</span>
        <GuardedButton type="button" className="amp-button amp-button-secondary amp-button-cancel"
          blockedReason={t("素材加载中，请稍候", "Materials are loading. Please wait.")}
          onClick={onClose}>{t("取消", "Cancel")}</GuardedButton>
        <GuardedButton type="button" className="amp-button amp-button-primary"
          disabled={loading || Boolean(error) || !picked.length}
          blockedReason={loading ? t("素材加载中，请稍候", "Materials are loading. Please wait.") : error || t("请先选择素材", "Select materials first")}
          onClick={() => { onConfirm(picked); onClose(); }}>{t("添加", "Add")}</GuardedButton>
      </footer>
    </ReferencePickerDialog>
  );
}
