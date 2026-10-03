"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import { useToast } from "@/contexts/toast_context";
import { localizeErrorMessage } from "@/i18n/errors";
import { CHINESE_ACTIONS, CHINESE_PROGRESS, ENGLISH_ACTIONS, ENGLISH_PROGRESS } from "@/i18n/interaction_copy";
import { fetch_project_materials } from "@/services/api_client";
import type { ProjectMaterial } from "@/types/publishing";
import type { RefLabel } from "./ReferencePanel";
import InlineIcon from "@/components/redesign/InlineIcon";
import EmptyStateIcon from "@/components/redesign/EmptyStateIcon";
import { GuardedButton } from "@/components/redesign/GuardedControls";
import MaterialPickerOption, { MaterialPickerSetCover } from "@/components/projects/MaterialPickerOption";
import { eligibleMaterialReferences, materialReferenceSelection, MAX_MATERIAL_REFERENCES } from "@/utils/material_references";
import ReferencePickerDialog from "./ReferencePickerDialog";

interface MaterialGroup {
  id: string;
  name: string;
  materials: ProjectMaterial[];
  covers: ProjectMaterial["covers"];
}

export default function MaterialReferencePicker({
  open, projectId, selectedIds, onConfirm, onClose,
}: {
  open: boolean;
  projectId: string;
  selectedIds: string[];
  selectedLabels: RefLabel[];
  onConfirm: (ids: string[], labels: RefLabel[]) => void;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const { showWarning } = useToast();
  const [groups, setGroups] = useState<MaterialGroup[]>([]);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [missingCount, setMissingCount] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const incomingIds = useRef(selectedIds);
  const scope = `${user?.id}:${user?.current_organization?.id ?? user?.default_organization?.id}`;

  useEffect(() => {
    incomingIds.current = selectedIds;
  }, [selectedIds]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setGroups([]);
    setGroupId(null);
    setPicked([...new Set(incomingIds.current)]);
    setMissingCount(0);
    setError("");
    setLoading(true);
    const load = async () => {
      if (!projectId) throw new Error(t("请先选择项目。", "Select a project first."));
      const root = await fetch_project_materials(projectId);
      if (!root.success) throw new Error(root.message || "Could not load project materials");
      const collections = root.data.filter((material) => material.node_type === "collection");
      const children = await Promise.all(collections.map(async (collection) => {
        const response = await fetch_project_materials(projectId, collection.id);
        if (!response.success) throw new Error(response.message || "Could not load project materials");
        return {
          id: collection.id,
          name: collection.name,
          materials: eligibleMaterialReferences(response.data, projectId),
          covers: collection.covers,
        };
      }));
      const rootFiles = eligibleMaterialReferences(root.data, projectId);
      const result: MaterialGroup[] = rootFiles.length
        ? [{ id: "", name: t("项目素材", "Project materials"), materials: rootFiles,
            covers: rootFiles.flatMap((material) => material.media_type === "document" ? [] : [{
              id: material.id, media_type: material.media_type,
              object_key: material.object_key, file_url: material.file_url,
            }]).slice(0, 3) }, ...children]
        : children;
      if (!active) return;
      const allMaterials = result.flatMap((group) => group.materials);
      const selection = materialReferenceSelection(incomingIds.current, allMaterials, projectId);
      setGroups(result);
      setPicked(selection.ids);
      setMissingCount(selection.missingIds.length);
    };
    void load().catch((failure: unknown) => {
      if (active) setError(localizeErrorMessage(
        failure instanceof Error ? failure.message : "Could not load project materials", locale,
      ));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, projectId, scope, attempt, locale, t]);

  const group = groups.find((item) => item.id === groupId);

  const toggle = (material: ProjectMaterial) => {
    if (picked.includes(material.id)) {
      setPicked((current) => current.filter((id) => id !== material.id));
    } else if (picked.length >= MAX_MATERIAL_REFERENCES) {
      showWarning(t("每次最多引用 {count} 个素材。", "Reference up to {count} materials per message.", { count: MAX_MATERIAL_REFERENCES }));
    } else {
      setPicked((current) => [...current, material.id]);
    }
  };

  const confirm = () => {
    if (loading || error) {
      showWarning(loading ? t("素材加载中，请稍候。", "Materials are loading.") : error);
      return;
    }
    if (picked.length > MAX_MATERIAL_REFERENCES) {
      showWarning(t("每次最多引用 {count} 个素材。", "Reference up to {count} materials per message.", { count: MAX_MATERIAL_REFERENCES }));
      return;
    }
    const selection = materialReferenceSelection(picked, groups.flatMap((group) => group.materials), projectId);
    if (selection.missingIds.length) {
      showWarning(t("部分素材已不可用，请重新选择。", "Some materials are unavailable. Select them again."));
      return;
    }
    onConfirm(selection.ids, selection.labels);
    onClose();
  };

  return (
    <ReferencePickerDialog open={open} title={group?.name ?? t("引用素材", "Reference materials")}
      className="amp-material-reference-dialog" onClose={onClose}
      leading={group && <button type="button" className="amp-project-detail-back"
        aria-label={t("返回素材集", "Back to material sets")} onClick={() => setGroupId(null)}>
        <InlineIcon name="arrowLeft" />
      </button>}>
      <main className="amp-reference-picker-body">
        {loading ? (
          <div className="amp-dialog-state" role="status">{t(CHINESE_PROGRESS.loading, ENGLISH_PROGRESS.loading)}</div>
        ) : error ? (
          <div className="amp-dialog-state" role="alert">
            <p>{error}</p>
            <button type="button" className="amp-button amp-button-secondary"
              onClick={() => setAttempt((current) => current + 1)}>{t(CHINESE_ACTIONS.retry, ENGLISH_ACTIONS.retry)}</button>
          </div>
        ) : !groups.length || (group && !group.materials.length) ? (
          <div className="amp-dialog-state amp-empty-state">
            <EmptyStateIcon name="collection" />
            <p>{group ? t("暂无可选素材", "No materials available") : t("暂无素材集", "No material sets available")}</p>
          </div>
        ) : (
          <>
            {missingCount > 0 && <p className="amp-material-reference-warning" role="status">
              {t("{count} 个已选素材已删除或不可访问，请确认新的选择。", "{count} selected materials were deleted or are inaccessible. Confirm a new selection.", { count: missingCount })}
            </p>}
            {!group ? (
              <div className="amp-publication-picker-grid">
                {groups.map((item) => (
                  <button key={item.id} type="button" className="amp-publication-set-option"
                    aria-label={t("选择素材集：{name}", "Choose material set: {name}", { name: item.name })}
                    onClick={() => setGroupId(item.id)}>
                    <MaterialPickerSetCover covers={item.covers} hasMaterials={item.materials.length > 0} />
                    <span className="amp-publication-set-copy">
                      <strong title={item.name}>{item.name}</strong>
                      <small>{t("{count} 个素材", "{count} materials", { count: item.materials.length })}</small>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="amp-publication-picker-grid">
                {group.materials.map((material) => {
                  const selected = picked.includes(material.id);
                  const atLimit = !selected && picked.length >= MAX_MATERIAL_REFERENCES;
                  return (
                    <MaterialPickerOption key={material.id} material={material} selected={selected}
                      ariaLabel={t("引用素材：{name}", "Reference material: {name}", { name: material.name })}
                      disabled={atLimit}
                      blockedReason={t("每次最多引用 {count} 个素材。", "Reference up to {count} materials per message.", { count: MAX_MATERIAL_REFERENCES })}
                      onChange={() => toggle(material)} />
                  );
                })}
              </div>
            )}
          </>
        )}
      </main>
      <footer className="amp-reference-picker-footer">
        <span>{t("已选 {count} 个", "{count} selected", { count: picked.length })}</span>
        <button type="button" className="amp-button amp-button-secondary amp-button-cancel" onClick={onClose}>
          {t(CHINESE_ACTIONS.cancel, ENGLISH_ACTIONS.cancel)}
        </button>
        <GuardedButton type="button" className="amp-button amp-button-primary"
          disabled={loading || Boolean(error)} blockedReason={loading ? t("素材加载中，请稍候。", "Materials are loading.") : error}
          onClick={confirm}>{t(CHINESE_ACTIONS.confirm, ENGLISH_ACTIONS.confirm)}</GuardedButton>
      </footer>
    </ReferencePickerDialog>
  );
}
