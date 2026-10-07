import type { ProjectMaterial } from "@/types/publishing";

export const MAX_MATERIAL_REFERENCES = 20;
export const MAX_MULTIMODAL_IMAGE_REFERENCES = 5;
export const MAX_MULTIMODAL_VIDEO_REFERENCES = 1;

export function materialReferenceMediaCounts(
  ids: readonly string[],
  materials: readonly ProjectMaterial[],
) {
  const selected = new Set(ids);
  return materials.reduce((counts, material) => {
    if (!selected.has(material.id)) return counts;
    if (material.media_type === "image") counts.images += 1;
    if (material.media_type === "video") counts.videos += 1;
    return counts;
  }, { images: 0, videos: 0 });
}

export function eligibleMaterialReferences(
  materials: readonly ProjectMaterial[],
  projectId: string,
): ProjectMaterial[] {
  const seen = new Set<string>();
  return materials.filter((material) => {
    if (material.node_type !== "file" || material.project_id !== projectId || seen.has(material.id)) return false;
    seen.add(material.id);
    return true;
  });
}

export function materialReferenceSelection(
  ids: readonly string[],
  materials: readonly ProjectMaterial[],
  projectId: string,
) {
  const eligible = new Map(eligibleMaterialReferences(materials, projectId).map((material) => [material.id, material]));
  const unique = [...new Set(ids)];
  return {
    ids: unique.filter((id) => eligible.has(id)),
    missingIds: unique.filter((id) => !eligible.has(id)),
    labels: unique.flatMap((id) => {
      const material = eligible.get(id);
      return material ? [{ id, label: material.name }] : [];
    }),
  };
}
