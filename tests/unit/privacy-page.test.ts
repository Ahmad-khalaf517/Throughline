import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The logo pulls in next/image, which is irrelevant to the policy text.
vi.mock('@/components/icons/logo-mark', () => ({ LogoMark: () => null }));

import PrivacyPage, { metadata } from '@/app/privacy/page';

function render(): string {
  return renderToStaticMarkup(createElement(PrivacyPage));
}

describe('privacy page', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('has the expected metadata', () => {
    expect(metadata.title).toBe('Privacy Policy - Throughline');
    expect(typeof metadata.description).toBe('string');
    expect(metadata.description!.length).toBeGreaterThan(20);
  });

  it('renders exactly one h1 and one main landmark', () => {
    vi.stubEnv('NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL', '');
    const html = render();
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html.match(/<main[\s>]/g)).toHaveLength(1);
  });

  it('renders a mailto link when the contact email is set', () => {
    vi.stubEnv('NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL', 'privacy@example.test');
    expect(render()).toContain('href="mailto:privacy@example.test"');
  });

  it('omits the mailto link when the contact email is unset', () => {
    vi.stubEnv('NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL', '');
    const html = render();
    expect(html).not.toContain('mailto:');
    expect(html).toContain('contact the operator of the instance you use');
  });

  it('does not carry a draft marker', () => {
    expect(render().toLowerCase()).not.toContain('draft');
  });
});
