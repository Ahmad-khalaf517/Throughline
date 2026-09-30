import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ErdDiagram, parseErdModel } from '@/components/review/erd-diagram';

const payload = {
  entities: [
    {
      name: 'users',
      purpose: 'Accounts',
      attributes: [
        { name: 'id', dataType: 'uuid', nullable: false, key: 'primary' },
        { name: 'email', dataType: 'text', nullable: false, key: 'none' },
      ],
    },
    {
      name: 'projects',
      purpose: 'Owned projects',
      attributes: [
        { name: 'id', dataType: 'uuid', nullable: false, key: 'primary' },
        { name: 'owner_id', dataType: 'uuid', nullable: false, key: 'foreign' },
      ],
    },
  ],
  relationships: [
    {
      from: 'users',
      to: 'projects',
      cardinality: 'one-to-many',
      explanation: 'A user owns projects.',
    },
  ],
};

describe('ERD visual model (FR-094)', () => {
  it('renders tables, columns, types, keys, and relation lines as SVG', () => {
    const model = parseErdModel(payload);
    expect(model).not.toBeNull();
    const html = renderToStaticMarkup(
      createElement(ErdDiagram, { model: model!, filename: 'erd.svg' }),
    );

    expect(html).toContain('<svg');
    expect(html).toContain('role="img"');
    expect(html).toContain('users');
    expect(html).toContain('projects');
    expect(html).toContain('owner_id');
    expect(html).toContain('uuid');
    expect(html).toContain('PK');
    expect(html).toContain('FK');
    expect(html).toContain('one-to-many');
    expect(html).toContain('<path d="M');
  });

  it('rejects relationships pointing at missing entities', () => {
    expect(
      parseErdModel({
        ...payload,
        relationships: [{ ...payload.relationships[0], to: 'missing' }],
      }),
    ).toBeNull();
  });
});
