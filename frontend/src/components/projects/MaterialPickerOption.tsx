"use client";

import Image from "next/image";
import { useI18n } from "@/contexts/i18n_context";
import type { ProjectMaterial } from "@/types/publishing";
import { GuardedInput } from "@/components/redesign/GuardedControls";
import InlineIcon from "@/components/redesign/InlineIcon";
import MaterialDocumentThumbnail from "./MaterialDocumentThumbnail";

export function MaterialPickerSetCover({ covers, hasMaterials }: {
  covers: ProjectMaterial["covers"];
  hasMaterials: boolean;
}) {
  const { t } = useI18n();
  return (
    <span className="amp-publication-set-cover">
      <span className={`amp-material-collage has-${covers.length}`}>
        {covers.length ? covers.map((cover) => (
          <span key={cover.id} className="amp-material-collage-frame">
            {cover.media_type === "image"
              ? <Image src={cover.file_url} alt="" width={400} height={300}
                  unoptimized className="amp-material-collage-media" />
              : <video src={cover.file_url} muted playsInline preload="metadata"
                  className="amp-material-collage-media" />}
          </span>
        )) : (
          <span className="amp-material-collage-empty">
            <InlineIcon name="collection" />
            <span>{hasMaterials ? t("文案素材集", "Copy collection") : t("暂无素材", "No materials yet")}</span>
          </span>
        )}
      </span>
    </span>
  );
}

export default function MaterialPickerOption({
  material, selected, highlighted = selected, disabled = false, blockedReason, onChange,
  inputType = "checkbox", inputName, description, ariaLabel,
}: {
  material: ProjectMaterial;
  selected: boolean;
  highlighted?: boolean;
  disabled?: boolean;
  blockedReason: string;
  onChange: () => void;
  inputType?: "checkbox" | "radio";
  inputName?: string;
  description?: string;
  ariaLabel?: string;
}) {
  const { t } = useI18n();
  const typeLabel = material.media_type === "document" ? t("文案", "Copy")
    : material.media_type === "video" ? t("视频", "Video") : t("图片", "Image");
  return (
    <label className={`amp-publication-material-option${highlighted ? " is-selected" : ""}`}>
      <div className="amp-publication-material-cover">
        {material.media_type === "document" ? <MaterialDocumentThumbnail material={material} />
          : material.media_type === "video" ? <video src={material.file_url} muted playsInline preload="metadata" />
            : <Image src={material.file_url} alt="" width={320} height={200} unoptimized />}
      </div>
      <span>
        <GuardedInput type={inputType} name={inputName} checked={selected}
          disabled={disabled} blockedReason={blockedReason} onChange={onChange}
          aria-label={ariaLabel ?? t("选择素材：{name}", "Select material: {name}", { name: material.name })} />
        <strong title={material.name}>{material.name}</strong>
      </span>
      <small>{description ?? typeLabel}</small>
    </label>
  );
}
