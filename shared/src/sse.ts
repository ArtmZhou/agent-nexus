export function encodeSseEvent(id: number, event: string, data: unknown): string {
  const body = typeof data === "string" ? data : JSON.stringify(data);
  const lines = body.split(/\r?\n/u).map((line) => `data: ${line}`).join("\n");
  return `id: ${id}\nevent: ${event}\n${lines}\n\n`;
}
