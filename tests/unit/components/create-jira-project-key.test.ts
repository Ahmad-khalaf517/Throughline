import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Regression (SCRUM-104): `<CreateJiraProject key={cloudId} ...>` remounted the
// form whenever cloudId changed - it starts as '' and becomes the site id when the
// site list arrives - so a name typed before that was silently reset to the
// Throughline project's name (the prefill) and the wrong Jira project got created.
// The form must keep its state across site/list loads; cloudId is only read at
// submit. There is no component test infrastructure, so this reads the source.
const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('CreateJiraProject is never remounted by a site change', () => {
  it('the <CreateJiraProject element has no key= prop', () => {
    const element = /<CreateJiraProject\b[\s\S]*?\/>/.exec(
      read('src/components/external/target-pickers.tsx'),
    );
    expect(element).not.toBeNull();
    expect(element![0]).not.toMatch(/\bkey\s*=/);
  });

  it('the form takes defaultName as an initial value only (no effect re-initialises state)', () => {
    const form = read('src/components/external/create-jira-project.tsx');
    expect(form).not.toMatch(/useEffect/);
    expect(form).toMatch(/useState\(defaultName\)/);
  });
});
