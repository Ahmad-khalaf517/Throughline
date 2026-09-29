import { describe, expect, it } from 'vitest';
import {
  availableActions,
  connectionAfterWriteError,
  connectStartHref,
  describeConnectionPrompt,
  describeConnectionStatus,
  describeDisconnectResult,
  describeNeedsReconnect,
  describeStitchConnectError,
  describeTargetError,
  isSafeReturnTo,
  isWriteWithheld,
  readConnectionsBanner,
} from '@/lib/connections-ui';
import type { ConnectionDTO } from '@/lib/serialize';

function dto(status: ConnectionDTO['status'], displayName: string | null = 'ada'): ConnectionDTO {
  return { provider: 'github', status, displayName, scopes: [], connectedAt: null };
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

describe('connect-to-continue prompt (FR-089)', () => {
  it('shows nothing for an active, target-ready connection or an absent block', () => {
    expect(describeConnectionPrompt('github', { status: 'active', targetReady: true })).toBeNull();
    expect(describeConnectionPrompt('github', undefined)).toBeNull();
    expect(isWriteWithheld('jira', { status: 'active', targetReady: true })).toBe(false);
  });

  it('prompts to connect, reconnect, or pick a target, and withholds the write', () => {
    expect(describeConnectionPrompt('jira', { status: 'none', targetReady: false })?.kind).toBe(
      'connect',
    );
    expect(describeConnectionPrompt('github', { status: 'revoked', targetReady: true })?.kind).toBe(
      'reconnect',
    );
    expect(describeConnectionPrompt('github', { status: 'active', targetReady: false })?.kind).toBe(
      'target',
    );
    expect(isWriteWithheld('github', { status: 'needs_reauth', targetReady: true })).toBe(true);
  });

  it('never asks Stitch for a target', () => {
    expect(describeConnectionPrompt('stitch', { status: 'active', targetReady: false })).toBeNull();
  });

  it('folds a 409 from a write into the connection state', () => {
    const active = { status: 'active', targetReady: true } as const;
    expect(connectionAfterWriteError('CONNECTION_REQUIRED', active)).toEqual({
      status: 'none',
      targetReady: true,
    });
    expect(connectionAfterWriteError('RECONNECT_REQUIRED', active)?.status).toBe('needs_reauth');
    expect(connectionAfterWriteError('TARGET_REQUIRED', active)).toEqual({
      status: 'active',
      targetReady: false,
    });
    expect(connectionAfterWriteError('NAME_TAKEN_BY_OTHER', active)).toBeNull();
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
