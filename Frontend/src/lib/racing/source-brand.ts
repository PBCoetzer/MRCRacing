const internalProviderPattern = /(hermes|ollama|qwen|local[-_ ]?llm)/i;

export function professionalSourceName(sourceName: string | null | undefined) {
  const source = sourceName?.trim();

  if (!source || internalProviderPattern.test(source)) {
    return "Influx Technologies";
  }

  return source
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function professionalProviderLabel(provider: string | null | undefined) {
  const value = provider?.trim();

  if (!value || internalProviderPattern.test(value)) {
    return "Influx Server verification";
  }

  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\s+/g, " ");
}

export function publicSourceUrl(
  sourceName: string | null | undefined,
  sourceUrl: string | null | undefined,
) {
  if (
    !sourceUrl?.startsWith("https://") ||
    internalProviderPattern.test(sourceName ?? "") ||
    internalProviderPattern.test(sourceUrl)
  ) {
    return null;
  }

  return sourceUrl;
}
