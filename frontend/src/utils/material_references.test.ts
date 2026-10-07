import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectMaterial } from "../types/publishing.ts";
import {
  eligibleMaterialReferences,
  materialReferenceMediaCounts,
  materialReferenceSelection,
  MAX_MATERIAL_REFERENCES,
  MAX_MULTIMODAL_IMAGE_REFERENCES,
  MAX_MULTIMODAL_VIDEO_REFERENCES,
} from "./material_references.ts";

function material(overrides: Partial<ProjectMaterial> = {}): ProjectMaterial {
  return {
    id: "material-1", project_id: "project", parent_id: "collection", node_type: "file",
    name: "Original copy", media_type: "document", mime_type: "text/html", file_size: 20,
    object_key: "", file_url: "", material_count: 0, image_count: 0, video_count: 0,
    document_count: 0, covers: [], created_by_user_id: "user", creator_name: "User",
    creator_avatar_url: "", created_at: "", updated_at: "", ...overrides,
  };
}

test("references allow only unique individual materials in the current project", () => {
  const image = material({ id: "image", media_type: "image" });
  const video = material({ id: "video", media_type: "video" });
  const copy = material();
  assert.deepEqual(eligibleMaterialReferences([
    image, video, copy, copy, material({ id: "other", project_id: "other-project" }),
    material({ id: "collection", node_type: "collection" }),
  ], "project"), [image, video, copy]);
});

test("selection labels use actual material names and unavailable IDs remain explicit", () => {
  const selected = materialReferenceSelection(
    ["material-1", "missing", "material-1", "foreign"],
    [material(), material({ id: "foreign", project_id: "other-project" })], "project",
  );
  assert.deepEqual(selected.ids, ["material-1"]);
  assert.deepEqual(selected.missingIds, ["missing", "foreign"]);
  assert.deepEqual(selected.labels, [{ id: "material-1", label: "Original copy" }]);
  assert.equal(MAX_MATERIAL_REFERENCES, 20);
});

test("multimodal counts and limits distinguish images, videos and copy", () => {
  const materials = [
    material({ id: "image-1", media_type: "image" }),
    material({ id: "image-2", media_type: "image" }),
    material({ id: "video", media_type: "video" }),
    material({ id: "copy", media_type: "document" }),
  ];
  assert.deepEqual(
    materialReferenceMediaCounts(
      ["image-1", "image-2", "video", "copy", "missing"],
      materials,
    ),
    { images: 2, videos: 1 },
  );
  assert.equal(MAX_MULTIMODAL_IMAGE_REFERENCES, 5);
  assert.equal(MAX_MULTIMODAL_VIDEO_REFERENCES, 1);
});
