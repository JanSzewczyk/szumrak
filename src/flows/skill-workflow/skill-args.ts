const INPUT_PLACEHOLDER_PATTERN = /\{\{\s*inputs\.([a-z][a-z0-9_]*)\s*}}/g;

/** Input names referenced by the `{{inputs.<name>}}` placeholders in `template`. */
export function listInputPlaceholders(template: string): Array<string> {
  return [...template.matchAll(INPUT_PLACEHOLDER_PATTERN)].map((match) => match[1]);
}

/** `{{inputs.<name>}}` → value; an optional input that wasn't given renders as an empty string. */
export function renderSkillArgs(template: string, inputs: Record<string, string>): string {
  return template.replace(INPUT_PLACEHOLDER_PATTERN, (_, name: string) => inputs[name] ?? "").trim();
}
