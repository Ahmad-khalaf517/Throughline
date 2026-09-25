import { createHash } from 'node:crypto';

export const SEMANTIC_HASH_VERSION = 1;

export type ItemType =
  'requirement' | 'architecture_decision' | 'ui_requirement' | 'epic' | 'story';

type JsonObject = Record<string, unknown>;

function object(value: unknown, name: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as JsonObject;
}

function normalizeText(value: string, structured = false): string {
  const normalized = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (structured) return normalized;
  return normalized
    .toLowerCase()
    .replace(/[.!?]+(?=\s|$)/g, '')
    .trim();
}

function canonicalize(value: unknown, structured = false, sortArrays = false): unknown {
  if (typeof value === 'string') return normalizeText(value, structured);
  if (Array.isArray(value)) {
    const values = value.map((entry) => canonicalize(entry, structured));
    return sortArrays
      ? values.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      : values;
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as JsonObject)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [
          key,
          canonicalize(
            entry,
            structured || key === 'value' || key === 'structuredBehavior',
            key === 'acceptanceCriteria' || key === 'significantTradeoffs' || key === 'teamSkills',
          ),
        ]),
    );
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  throw new Error('Semantic payload contains an unsupported value');
}

function selected(payload: JsonObject, fields: readonly string[]): JsonObject {
  return Object.fromEntries(fields.map((field) => [field, payload[field] ?? null]));
}

export function semanticProjection(
  itemType: ItemType,
  payload: unknown,
  upstreamIds: string[] = [],
): JsonObject {
  const item = object(payload, 'Item payload');
  let projection: JsonObject;

  switch (itemType) {
    case 'requirement':
      projection = selected(item, [
        'type',
        'actor',
        'behavior',
        'constraints',
        'acceptanceCriteria',
      ]);
      if (item.type === 'constraint') {
        projection.dimension = item.dimension ?? null;
        projection.value = item.value ?? null;
      }
      break;
    case 'architecture_decision':
      projection = selected(item, [
        'decision',
        'technologyOrApproach',
        'constraints',
        'significantTradeoffs',
      ]);
      break;
    case 'ui_requirement':
      projection = selected(item, [
        'screenOrFlow',
        'interactionRequirement',
        'responsiveConstraints',
        'accessibilityConstraints',
      ]);
      break;
    case 'story':
      projection = selected(item, [
        'userValueStatement',
        'acceptanceCriteria',
        'structuredBehavior',
      ]);
      break;
    case 'epic':
      projection = selected(item, ['title', 'scopeStatement']);
      break;
  }

  if (
    itemType === 'architecture_decision' ||
    itemType === 'ui_requirement' ||
    itemType === 'story'
  ) {
    projection.upstreamItemVersionIds = [...new Set(upstreamIds)].sort();
  } else if (upstreamIds.length > 0) {
    throw new Error(`${itemType} cannot have upstream dependencies`);
  }

  return Object.fromEntries(
    Object.entries(projection)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [
        key,
        canonicalize(
          value,
          key === 'value' || key === 'structuredBehavior' || key === 'upstreamItemVersionIds',
          key === 'acceptanceCriteria' ||
            key === 'significantTradeoffs' ||
            key === 'constraints' ||
            key === 'upstreamItemVersionIds',
        ),
      ]),
  );
}

export function semanticHash(
  itemType: ItemType,
  payload: unknown,
  upstreamIds: string[] = [],
): string {
  return createHash('sha256')
    .update(JSON.stringify(semanticProjection(itemType, payload, upstreamIds)))
    .digest('hex');
}

export function contentOnlyProjection(itemType: ItemType, payload: unknown): JsonObject {
  const projection = semanticProjection(itemType, payload);
  delete projection.upstreamItemVersionIds;
  return projection;
}
