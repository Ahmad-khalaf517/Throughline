import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ErdDiagram, parseCardinality, parseErdModel } from '@/components/review/erd-diagram';

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
    expect(html).toContain('data-cardinality-mark="one"');
    expect(html).toContain('data-cardinality-mark="many"');
    expect(html).toContain('Expand');
    expect(html).toContain('Download SVG');
    expect(html).toContain('class="block h-80 w-full"');
    expect(html).toContain('<path d="M');
  });

  it('maps cardinalities to endpoint notation and retains unknown labels', () => {
    expect(parseCardinality('one-to-many')).toEqual(['one', 'many']);
    expect(parseCardinality('many-to-one')).toEqual(['many', 'one']);
    expect(parseCardinality('1:N')).toEqual(['one', 'many']);
    expect(parseCardinality('zero-or-one-to-zero-or-many')).toEqual([
      'zero-or-one',
      'zero-or-many',
    ]);
    expect(parseCardinality('depends-on')).toBeNull();

    const model = parseErdModel({
      ...payload,
      relationships: [{ ...payload.relationships[0], cardinality: 'depends-on' }],
    });
    const html = renderToStaticMarkup(
      createElement(ErdDiagram, { model: model!, filename: 'erd.svg' }),
    );
    expect(html).toContain('depends-on');
    expect(html).not.toContain('data-cardinality-mark=');
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
