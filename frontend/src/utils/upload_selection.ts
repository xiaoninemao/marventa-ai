export function selectUploadFiles(current: File[], incoming: File[], limit: number) {
  const files = [...current];
  const duplicates: string[] = [];
  let limitExceeded = false;
  for (const file of incoming) {
    if (files.some((existing) => existing.name === file.name
      && existing.size === file.size
      && existing.lastModified === file.lastModified)) {
      duplicates.push(file.name);
    } else if (files.length >= limit) {
      limitExceeded = true;
    } else {
      files.push(file);
    }
  }
  return { files, duplicates, limitExceeded };
}
