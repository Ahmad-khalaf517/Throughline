export { matchAndPersistItems, type Candidate } from './matcher';
export {
  resolveDisplayKeys,
  getSourceVersionMembers,
  getDisplayKeysByItemVersionId,
  getItemVersionProjectIds,
  getCurrentItemVersionIds,
  getUpstreamDependencies,
} from './references';
export { copyMembership } from './copy-membership';
export {
  rebindDraftItem,
  ItemEditError,
  type RebindDiff,
  type RebindDraftItemResult,
} from './rebind';
export {
  semanticHash,
  semanticProjection,
  contentOnlyProjection,
  SEMANTIC_HASH_VERSION,
  type ItemType,
} from './projection';
