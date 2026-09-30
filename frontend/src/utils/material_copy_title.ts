export function materialCopyTitle(text: string): string {
  const firstLine = text.split(/\r\n?|\n|\u2028|\u2029/u)
    .map((line) => line.trim())
    .find(Boolean) ?? "";
  const sentence = firstLine.match(/^.*?(?:[。！？]|[.!?](?=\s|$))/u)?.[0] ?? firstLine;
  const title = sentence
    .replace(/\p{Cc}/gu, " ")
    .replace(/\//g, "\uFF0F")
    .replace(/\\/g, "\uFF3C")
    .replace(/\s+/gu, " ")
    .trim();
  const characters = Array.from(title);
  return characters.length > 120 ? `${characters.slice(0, 119).join("")}\u2026` : title;
}
