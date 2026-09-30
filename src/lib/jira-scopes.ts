// The one definition of the Atlassian scope that lets the app create a Jira
// project (round 17, UC-S11, FR-092). Atlassian's scope reference: creating a
// project is a Jira administration action, `manage:jira-configuration` - NOT
// `manage:jira-project` (which only edits settings of existing projects). Shared
// by the OAuth scope string, the create-project pre-check and the UI hints so it
// cannot drift again.
export const JIRA_CREATE_PROJECT_SCOPE = 'manage:jira-configuration';
