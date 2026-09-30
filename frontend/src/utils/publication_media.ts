export type PublicationMediaMode = "image_text" | "video";

export function validatePublicationMediaFiles(mode: PublicationMediaMode, currentCount: number, names: string[]): void {
  const allowed = mode === "video" ? /\.(mp4|mov|webm|m4v)$/i : /\.(jpg|jpeg|png|gif|webp)$/i;
  if (names.some((name) => !allowed.test(name))) {
    throw new Error(mode === "video" ? "Video mode only accepts video" : "Image-text mode only accepts images");
  }
  if (mode === "video" && currentCount + names.length > 1) {
    throw new Error("Only one video is allowed");
  }
}

export function movePublicationImage(ids: string[], id: string, direction: -1 | 1): string[] {
  const index = ids.indexOf(id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ids.length) return ids;
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function insertPublicationImage(ids: string[], id: string, slot: number): string[] {
  const from = ids.indexOf(id);
  if (from < 0 || !Number.isInteger(slot) || slot < 0 || slot > ids.length) return ids;
  const to = slot > from ? slot - 1 : slot;
  if (from === to) return ids;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}
