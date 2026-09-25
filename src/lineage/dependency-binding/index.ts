export type SourceVersionMember = {
  sourceVersionId: string;
  artifactId: string;
  projectId: string;
  status: string;
  logicalItemId: string | null;
  itemVersionId: string | null;
  displayKey: string | null;
};

export function bindUpstreamRefs(opts: {
  members: SourceVersionMember[];
  candidates: { upstreamRefs: string[] }[];
}): Map<string, string> {
  const keys = new Set(opts.candidates.flatMap((candidate) => candidate.upstreamRefs));
  if (!keys.size) return new Map();
  const projects = new Set(opts.members.map((member) => member.projectId));
  if (projects.size > 1) throw new Error('Context source versions cross projects');
  if (opts.members.some((member) => !['approved', 'superseded'].includes(member.status))) {
    throw new Error('Context source version was never approved');
  }
  const bound = new Map<string, string>();
  for (const member of opts.members) {
    if (!member.displayKey || !member.itemVersionId || !keys.has(member.displayKey)) continue;
    const previous = bound.get(member.displayKey);
    if (previous && previous !== member.itemVersionId) {
      throw new Error(`Ambiguous upstream reference: ${member.displayKey}`);
    }
    bound.set(member.displayKey, member.itemVersionId);
  }
  for (const key of keys) {
    if (!bound.has(key)) throw new Error(`Unresolved upstream reference: ${key}`);
  }
  return bound;
}

export function checkFreshness(opts: {
  approvedVersionId: string | null;
  baseVersionId: string | null;
  boundUpstream: Map<string, string>;
  currentItemVersionIds: Set<string>;
}): { stale: true; reason: 'base_changed' | 'dependency_superseded' } | { stale: false } {
  if (opts.approvedVersionId !== opts.baseVersionId) {
    return { stale: true, reason: 'base_changed' };
  }
  for (const itemVersionId of opts.boundUpstream.values()) {
    if (!opts.currentItemVersionIds.has(itemVersionId)) {
      return { stale: true, reason: 'dependency_superseded' };
    }
  }
  return { stale: false };
}
