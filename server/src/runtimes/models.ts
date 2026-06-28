import type { RuntimeModelOption } from "@agent-nexus/shared";

export function modelOption(id: string, label = id): RuntimeModelOption {
  return { id, label };
}

export function withDefaultModel(models: RuntimeModelOption[], defaultModel?: string): RuntimeModelOption[] {
  if (!defaultModel) return models;
  const defaultOption = modelOption(defaultModel);
  return [defaultOption, ...models.filter((model) => model.id !== defaultModel)];
}

export function parseLineModels(stdout: string): RuntimeModelOption[] | null {
  const models = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((id) => modelOption(id));

  return models.length > 0 ? models : null;
}
