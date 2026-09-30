import { describe, expect, it } from 'vitest';
import {
  availableActions,
  canCreateJiraProjects,
  canSubmitCreate,
  describeCreateSummary,
  describeCreatedNotice,
  describeCreateToggle,
  deriveProjectKey,
  describeCreateProjectError,
  describeJiraSite,
  describeProjectCreationHint,
  jiraProjectsListHref,
  validateProjectKeyInput,
  connectionAfterWriteError,
  connectStartHref,
  describeConnectionSteps,
  describeConnectionStatus,
  describeDisconnectResult,
  describeNeedsReconnect,
  describeStitchConnectError,
  describeTargetError,
  isSafeReturnTo,
  isWriteWithheld,
  readConnectionsBanner,
  summarizeIntegrations,
} from '@/lib/connections-ui';
import type { ConnectionDTO } from '@/lib/serialize';

function dto(status: ConnectionDTO['status'], displayName: string | null = 'ada'): ConnectionDTO {
  return { provider: 'github', status, displayName, scopes: [], connectedAt: null, site: null };
}

describe('describeConnectionStatus / availableActions', () => {
  it('names the connected account and offers only Disconnect', () => {
    expect(describeConnectionStatus(dto('active'))).toMatchObject({
      tone: 'connected',
      label: 'Connected as ada',
    });
    expect(availableActions('active')).toEqual(['disconnect']);
  });

  it('shows needs_reauth and revoked as Needs reconnect with reconnect + disconnect', () => {
    for (const status of ['needs_reauth', 'revoked'] as const) {
      expect(describeConnectionStatus(dto(status))).toMatchObject({
        tone: 'attention',
        label: 'Needs reconnect',
      });
      expect(availableActions(status)).toEqual(['reconnect', 'disconnect']);
    }
  });

  it('shows none as Not connected with only Connect', () => {
    expect(describeConnectionStatus(dto('none', null))).toMatchObject({
      tone: 'none',
      label: 'Not connected',
    });
    expect(availableActions('none')).toEqual(['connect']);
  });
});

describe('connect links', () => {
  it('encodes a relative returnTo and refuses anything off-site', () => {
    expect(connectStartHref('jira', '/projects/p1/outputs/jira')).toBe(
      '/api/connections/jira/start?returnTo=%2Fprojects%2Fp1%2Foutputs%2Fjira',
    );
    expect(connectStartHref('github', 'https://evil.example')).toBe(
      '/api/connections/github/start',
    );
    expect(connectStartHref('github', '//evil.example')).toBe('/api/connections/github/start');
    expect(connectStartHref('github')).toBe('/api/connections/github/start');
    expect(isSafeReturnTo('/a\\b')).toBe(false);
  });
});

describe('describeDisconnectResult', () => {
  it('distinguishes revoked, not confirmed, and no revocation API', () => {
    expect(describeDisconnectResult('github', true)).toContain('Access revoked at GitHub');
    expect(describeDisconnectResult('jira', false)).toContain('did not confirm');
    expect(describeDisconnectResult('stitch', null)).toContain('offers no way to revoke');
  });
});

describe('readConnectionsBanner', () => {
  it('accepts only allowlisted values and never echoes query text', () => {
    expect(readConnectionsBanner({ connected: 'jira' })).toEqual({
      kind: 'success',
      message: 'Jira connected.',
    });
    expect(readConnectionsBanner({ error: 'access_denied' })?.kind).toBe('error');
    expect(readConnectionsBanner({ connected: '<script>alert(1)</script>' })).toBeNull();
    expect(readConnectionsBanner({ error: 'constructor' })).toBeNull();
    expect(readConnectionsBanner({ error: '<b>x</b>' })).toBeNull();
    expect(readConnectionsBanner({})).toBeNull();
  });

  it('prefers the error and takes the first of repeated params', () => {
    expect(readConnectionsBanner({ connected: 'github', error: 'invalid_state' })?.kind).toBe(
      'error',
    );
    expect(readConnectionsBanner({ connected: ['github', 'x'] })?.message).toBe(
      'GitHub connected.',
    );
  });
});

describe('describeStitchConnectError', () => {
  it('uses the fixed rejected copy and never a raw body', () => {
    expect(describeStitchConnectError('PROVIDER_KEY_REJECTED')).toBe('That key was rejected');
    expect(describeStitchConnectError('SOMETHING_ELSE')).toBe(
      'Could not save the key. Please try again.',
    );
  });
});

const ACTIVE = { status: 'active', targetReady: true, accountName: 'octo' } as const;

function statuses(
  provider: 'github' | 'jira' | 'stitch',
  connection: Parameters<typeof describeConnectionSteps>[1],
) {
  return describeConnectionSteps(provider, connection).map((step) => step.status);
}

describe('describeConnectionSteps (FR-089)', () => {
  it('not connected: step 1 is current, the rest are locked and say why', () => {
    const steps = describeConnectionSteps('github', {
      status: 'none',
      targetReady: false,
      accountName: null,
    });
    expect(steps.map((step) => step.label)).toEqual([
      'Connect GitHub',
      'Review & name the repository',
      'Create repository',
    ]);
    expect(steps.map((step) => step.status)).toEqual(['current', 'locked', 'locked']);
    expect(steps[1]!.lockedReason).toBe('Connect GitHub first');
    expect(steps[2]!.lockedReason).toBe('Connect GitHub first');
    expect(steps[0]!.lockedReason).toBeNull();
  });

  it('an absent connection block counts as not connected', () => {
    expect(statuses('stitch', null)).toEqual(['current', 'locked', 'locked']);
    expect(statuses('jira', undefined)).toEqual(['current', 'locked', 'locked']);
  });

  it('a lapsed connection is not connected: reconnect is the current step', () => {
    for (const status of ['needs_reauth', 'revoked'] as const) {
      expect(statuses('github', { status, targetReady: true, accountName: 'octo' })).toEqual([
        'current',
        'locked',
        'locked',
      ]);
    }
  });

  it('GitHub and Stitch: connected means review is current and the write is available', () => {
    expect(statuses('github', ACTIVE)).toEqual(['done', 'current', 'ready']);
    expect(statuses('stitch', ACTIVE)).toEqual(['done', 'current', 'ready']);
    expect(describeConnectionSteps('stitch', ACTIVE).map((step) => step.label)).toEqual([
      'Connect Stitch',
      'Review prompt',
      'Generate',
    ]);
  });

  it('Jira: connected without a saved site + project keeps the export locked and says why', () => {
    const steps = describeConnectionSteps('jira', { ...ACTIVE, targetReady: false });
    expect(steps.map((step) => step.status)).toEqual(['done', 'current', 'locked']);
    expect(steps[2]!.lockedReason).toBe('Choose a site and project first');
    expect(steps.map((step) => step.label)).toEqual([
      'Connect Jira',
      'Choose site and project',
      'Export backlog',
    ]);
  });

  it('Jira: connected with a saved target finishes step 2 and makes the export current', () => {
    expect(statuses('jira', ACTIVE)).toEqual(['done', 'done', 'current']);
  });

  it('takes an explicit targetReady over the connection block', () => {
    expect(
      describeConnectionSteps('jira', { ...ACTIVE, targetReady: false }, true).map(
        (step) => step.status,
      ),
    ).toEqual(['done', 'done', 'current']);
  });
});

describe('isWriteWithheld', () => {
  it('is false for an active, target-ready connection or an absent block', () => {
    expect(isWriteWithheld(ACTIVE)).toBe(false);
    expect(isWriteWithheld(undefined)).toBe(false);
    expect(isWriteWithheld(null)).toBe(false);
  });

  it('is true until connected (and, for Jira, until the target is saved)', () => {
    expect(isWriteWithheld({ status: 'none', targetReady: false, accountName: null })).toBe(true);
    expect(isWriteWithheld({ status: 'revoked', targetReady: true, accountName: null })).toBe(true);
    expect(isWriteWithheld({ ...ACTIVE, targetReady: false })).toBe(true);
  });
});

describe('connectionAfterWriteError', () => {
  it('folds a 409 from a write into the connection state', () => {
    expect(connectionAfterWriteError('CONNECTION_REQUIRED', ACTIVE)).toEqual({
      status: 'none',
      targetReady: true,
      accountName: null,
    });
    expect(connectionAfterWriteError('RECONNECT_REQUIRED', ACTIVE)).toEqual({
      status: 'needs_reauth',
      targetReady: true,
      accountName: 'octo',
    });
    expect(connectionAfterWriteError('TARGET_REQUIRED', ACTIVE)).toEqual({
      status: 'active',
      targetReady: false,
      accountName: 'octo',
    });
    expect(connectionAfterWriteError('NAME_TAKEN_BY_OTHER', ACTIVE)).toBeNull();
  });
});

describe('summarizeIntegrations (header hint)', () => {
  it('shows no attention when all three are connected', () => {
    expect(summarizeIntegrations(['active', 'active', 'active'])).toMatchObject({
      connected: 3,
      total: 3,
      needsReconnect: 0,
      attention: false,
      hint: '3 of 3 connected',
    });
  });

  it('counts connected ones and flags the rest', () => {
    expect(summarizeIntegrations(['active', 'none', 'none'])).toMatchObject({
      connected: 1,
      attention: true,
      hint: '1 of 3 connected',
    });
    expect(summarizeIntegrations([])).toMatchObject({ connected: 0, attention: true });
  });

  it('says a lapsed integration needs reconnecting', () => {
    expect(summarizeIntegrations(['active', 'needs_reauth', 'none'])).toMatchObject({
      needsReconnect: 1,
      attention: true,
      hint: '1 integration needs reconnecting',
    });
    expect(summarizeIntegrations(['revoked', 'needs_reauth', 'active']).hint).toBe(
      '2 integrations need reconnecting',
    );
  });
});

describe('describeNeedsReconnect (FR-090)', () => {
  it('is null when nothing needs reconnecting', () => {
    expect(describeNeedsReconnect(null)).toBeNull();
    expect(describeNeedsReconnect(undefined)).toBeNull();
  });

  it('carries the DTO reason without failure wording', () => {
    const legacy = describeNeedsReconnect({
      provider: 'jira',
      reason: 'legacy_credential_missing',
    });
    expect(legacy).toMatchObject({ label: 'Reconnect required', provider: 'jira' });
    expect(legacy?.reason).toBe('legacy credential missing');
    expect(
      describeNeedsReconnect({ provider: 'github', reason: 'different_account' })?.reason,
    ).toContain('different account');
    expect(legacy?.label.toLowerCase()).not.toContain('fail');
  });
});

describe('describeTargetError', () => {
  it('maps each target code to its own kind', () => {
    expect(describeTargetError('TARGET_REQUIRED').kind).toBe('required');
    expect(describeTargetError('TARGET_LOCKED')).toMatchObject({ kind: 'locked' });
    expect(describeTargetError('TARGET_LOCKED').message).toContain('already exists');
    expect(describeTargetError('TARGET_NOT_ACCESSIBLE').kind).toBe('not_accessible');
    expect(describeTargetError('CONNECTION_REQUIRED').kind).toBe('connection');
    expect(describeTargetError(undefined).kind).toBe('other');
  });
});

describe('Jira site display and project creation (FR-092)', () => {
  it('links the site only when it is an https *.atlassian.net address', () => {
    expect(describeJiraSite({ name: 'Acme', url: 'https://acme.atlassian.net' })).toEqual({
      name: 'Acme',
      url: 'https://acme.atlassian.net',
      href: 'https://acme.atlassian.net',
    });
    for (const url of [
      'http://acme.atlassian.net',
      'https://evil.example',
      'https://atlassian.net.evil.example',
      'javascript:alert(1)',
      'https://user:pw@acme.atlassian.net',
      'not a url',
      '',
    ]) {
      expect(describeJiraSite({ name: 'Acme', url })?.href).toBeNull();
    }
    expect(describeJiraSite(null)).toBeNull();
    expect(describeJiraSite({ name: '', url: '' })).toBeNull();
  });

  it('builds the Open Jira link from a safe site URL only', () => {
    expect(jiraProjectsListHref('https://acme.atlassian.net/')).toBe(
      'https://acme.atlassian.net/jira/projects',
    );
    expect(jiraProjectsListHref('https://evil.example')).toBeNull();
    expect(jiraProjectsListHref(null)).toBeNull();
  });

  it('reads project-creation permission from the granted scopes', () => {
    expect(canCreateJiraProjects(['read:jira-work', 'manage:jira-configuration'])).toBe(true);
    expect(canCreateJiraProjects(['read:jira-work'])).toBe(false);
    expect(canCreateJiraProjects(undefined)).toBe(false);
    expect(describeProjectCreationHint(['manage:jira-configuration'])).toEqual({
      allowed: true,
      text: 'Can create projects',
    });
    expect(describeProjectCreationHint([])).toEqual({
      allowed: false,
      text: 'Reconnect to allow creating projects',
    });
  });

  it('derives a valid key from a name', () => {
    expect(deriveProjectKey('ShiftSwap')).toBe('SHIFTSWAP');
    expect(deriveProjectKey('Shift Swap Verify')).toBe('SSV');
    expect(deriveProjectKey('Averyveryverylongsinglewordname')).toHaveLength(10);
    expect(deriveProjectKey('2024 Plan')).toBe('PLAN');
    expect(deriveProjectKey('!!!')).toBe('');
    for (const name of ['ShiftSwap', 'Shift Swap Verify', 'Order Desk']) {
      expect(validateProjectKeyInput(deriveProjectKey(name), [])).toBeNull();
    }
  });

  it('checks the key format and collisions with the listed projects', () => {
    expect(validateProjectKeyInput('SHIFT', ['OTHER'])).toBeNull();
    expect(validateProjectKeyInput('', [])).toMatch(/Enter/);
    for (const key of ['S', 'shift', '1ABC', 'ABCDEFGHIJK', 'AB-C']) {
      expect(validateProjectKeyInput(key, [])).toMatch(/2-10 uppercase/);
    }
    expect(validateProjectKeyInput('SHIFT', ['SHIFT'])).toBe(
      'That key is already used in this Jira site - choose another',
    );
  });

  it('maps the create-project error codes to fixed copy', () => {
    expect(describeCreateProjectError('PROJECT_KEY_TAKEN').kind).toBe('key_taken');
    expect(describeCreateProjectError('JIRA_ADMIN_REQUIRED')).toMatchObject({
      kind: 'admin_required',
      message: expect.stringContaining('not a Jira administrator'),
    });
    expect(describeCreateProjectError('RECONNECT_REQUIRED').kind).toBe('reconnect');
    expect(describeCreateProjectError('anything else').kind).toBe('other');
  });

  it('states exactly the name, key and site that will be sent', () => {
    expect(describeCreateSummary('  RMFlow ', 'RM', 'Acme')).toBe(
      'This will create the Jira project “RMFlow” with key RM on Acme.',
    );
    expect(describeCreateSummary('RoomFlow', 'RMF', null)).toBe(
      'This will create the Jira project “RoomFlow” with key RMF.',
    );
    expect(describeCreateSummary('RoomFlow', 'RMF', '  ')).not.toContain(' on ');
  });

  it('describes the persistent created notice and the expander label', () => {
    expect(describeCreatedNotice({ name: 'RMFlow', key: 'RM' }, null)).toEqual({
      tone: 'success',
      text: "Created “RMFlow” (RM) and selected it as this project's Jira target.",
    });
    const warning = describeCreatedNotice({ name: 'RMFlow', key: 'RM' }, 'Jira is slow.');
    expect(warning.tone).toBe('warning');
    expect(warning.text).toContain('Jira is slow.');
    expect(warning.text).toContain('Save target');
    expect(describeCreateToggle(false)).toEqual({
      label: 'Create a new Jira project',
      variant: 'link',
    });
    expect(describeCreateToggle(true)).toEqual({
      label: 'Create another Jira project',
      variant: 'secondary',
    });
  });

  it('cannot submit before the site is known, while pending, or with a bad name or key', () => {
    const ok = { cloudId: 'cloud-1', name: 'RMFlow', formatError: null, pending: false };
    expect(canSubmitCreate(ok)).toBe(true);
    expect(canSubmitCreate({ ...ok, cloudId: '' })).toBe(false);
    expect(canSubmitCreate({ ...ok, pending: true })).toBe(false);
    expect(canSubmitCreate({ ...ok, formatError: 'bad key' })).toBe(false);
    expect(canSubmitCreate({ ...ok, name: '   ' })).toBe(false);
    expect(canSubmitCreate({ ...ok, name: 'x'.repeat(81) })).toBe(false);
  });

  it('describes a missing_scope reconnect for the badge', () => {
    expect(describeNeedsReconnect({ provider: 'jira', reason: 'missing_scope' })).toEqual({
      label: 'Reconnect required',
      reason: 'needs permission to create projects - reconnect',
      provider: 'jira',
    });
  });
});
