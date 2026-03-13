/**
 * Deep camelCase converter for objects from Python → NestJS pipeline.
 * NestJS's default serialization only shallow-converts top-level keys.
 * Nested fields from Python (e.g., is_actually_favorable, health_vitality)
 * need recursive conversion.
 */
export function deepCamelCase(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(deepCamelCase);
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const camelKey = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      result[camelKey] = deepCamelCase(value);
    }
    return result;
  }
  return obj;
}
