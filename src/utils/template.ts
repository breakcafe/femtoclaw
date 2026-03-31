/**
 * Simple mustache-style template renderer.
 * Replaces {{var}} with values from the context object.
 * Undefined variables are left as empty strings.
 */
export function renderTemplate(
  template: string,
  context: Record<string, string | undefined>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    return context[key] ?? '';
  });
}
