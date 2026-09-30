// Jira team-managed software templates for `createProject` (ERD 7.8, FR-092).
// The ONE place these keys live. They are taken from ERD 7.8 and are NOT
// verified against Atlassian's documentation or a live site (no web access when
// they were written): re-verify against Atlassian's `POST /rest/api/3/project`
// documentation ("projectTemplateKey") before relying on them. Both templates
// contain the Epic and Story issue types the export (ERD 7.4) needs.
export const JIRA_PROJECT_TYPE_KEY = 'software';

export const JIRA_PROJECT_TEMPLATE_KEYS = {
  scrum: 'com.pyxis.greenhopper.jira:gh-simplified-agility-scrum',
  kanban: 'com.pyxis.greenhopper.jira:gh-simplified-agility-kanban',
} as const;

export type JiraProjectTemplate = keyof typeof JIRA_PROJECT_TEMPLATE_KEYS;
