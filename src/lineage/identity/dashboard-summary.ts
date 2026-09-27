function field(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Short copy from stored item content; unknown shapes have no invented title. */
export function dashboardItemSummary(itemType: string, payload: unknown) {
  switch (itemType) {
    case 'requirement':
      return { title: field(payload, 'behavior'), narrative: null };
    case 'architecture_decision':
      return { title: field(payload, 'title'), narrative: field(payload, 'decision') };
    case 'ui_requirement':
      return {
        title: field(payload, 'screenOrFlow'),
        narrative: field(payload, 'interactionRequirement'),
      };
    case 'epic':
      return { title: field(payload, 'title'), narrative: field(payload, 'scopeStatement') };
    case 'story':
      return {
        title: field(payload, 'userValueStatement'),
        narrative: field(payload, 'structuredBehavior'),
      };
    default:
      return { title: null, narrative: null };
  }
}
