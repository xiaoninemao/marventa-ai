export function hasBriefPrompt(value: string, prompt: string): boolean {
  return value.split(/\r?\n/).some(line => line === prompt);
}
