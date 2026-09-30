'use client';

import { useId, useRef } from 'react';
import { Download, Maximize2, X } from 'lucide-react';

export interface ErdAttribute {
  name: string;
  dataType: string;
  nullable: boolean;
  key: 'primary' | 'foreign' | 'none';
}

export interface ErdEntity {
  name: string;
  purpose: string;
  attributes: ErdAttribute[];
}

export interface ErdRelation {
  from: string;
  to: string;
  cardinality: string;
  explanation: string;
}

export interface ErdModel {
  entities: ErdEntity[];
  relationships: ErdRelation[];
}

type Box = { x: number; y: number; width: number; height: number };
type PositionedEntity = ErdEntity & { box: Box };
type Multiplicity = 'one' | 'many' | 'zero-or-one' | 'zero-or-many';
type Endpoint = { x: number; y: number; direction: -1 | 1 };

const CARD_WIDTH = 346;
const HEADER_HEIGHT = 48;
const ROW_HEIGHT = 30;
const FOOTER_HEIGHT = 10;
const COLUMN_GAP = 132;
const ROW_GAP = 112;
const MARGIN = 28;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Stored model output is validated at generation; keep the read path safe for older payloads. */
export function parseErdModel(value: unknown): ErdModel | null {
  if (!isRecord(value) || !Array.isArray(value.entities) || !Array.isArray(value.relationships)) {
    return null;
  }
  const entities: ErdEntity[] = [];
  for (const entry of value.entities) {
    if (
      !isRecord(entry) ||
      typeof entry.name !== 'string' ||
      !Array.isArray(entry.attributes) ||
      entry.attributes.length === 0 ||
      entities.some((entity) => entity.name === entry.name)
    ) {
      return null;
    }
    const attributes: ErdAttribute[] = [];
    for (const attribute of entry.attributes) {
      if (
        !isRecord(attribute) ||
        typeof attribute.name !== 'string' ||
        typeof attribute.dataType !== 'string' ||
        typeof attribute.nullable !== 'boolean' ||
        (attribute.key !== 'primary' && attribute.key !== 'foreign' && attribute.key !== 'none')
      ) {
        return null;
      }
      attributes.push({
        name: attribute.name,
        dataType: attribute.dataType,
        nullable: attribute.nullable,
        key: attribute.key,
      });
    }
    entities.push({
      name: entry.name,
      purpose: typeof entry.purpose === 'string' ? entry.purpose : '',
      attributes,
    });
  }
  if (entities.length === 0) return null;
  const names = new Set(entities.map((entity) => entity.name));
  const relationships: ErdRelation[] = [];
  for (const entry of value.relationships) {
    if (
      !isRecord(entry) ||
      typeof entry.from !== 'string' ||
      typeof entry.to !== 'string' ||
      typeof entry.cardinality !== 'string' ||
      !names.has(entry.from) ||
      !names.has(entry.to)
    ) {
      return null;
    }
    relationships.push({
      from: entry.from,
      to: entry.to,
      cardinality: entry.cardinality,
      explanation: typeof entry.explanation === 'string' ? entry.explanation : '',
    });
  }
  return { entities, relationships };
}

function layoutEntities(entities: ErdEntity[]) {
  const columns = entities.length === 1 ? 1 : 2;
  const rowHeights: number[] = [];
  for (let index = 0; index < entities.length; index += columns) {
    rowHeights.push(
      Math.max(
        ...entities
          .slice(index, index + columns)
          .map((entity) => HEADER_HEIGHT + entity.attributes.length * ROW_HEIGHT + FOOTER_HEIGHT),
      ),
    );
  }
  const rowStarts: number[] = [];
  let y = MARGIN;
  for (const height of rowHeights) {
    rowStarts.push(y);
    y += height + ROW_GAP;
  }
  const positioned = entities.map((entity, index): PositionedEntity => {
    const row = Math.floor(index / columns);
    return {
      ...entity,
      box: {
        x: MARGIN + (index % columns) * (CARD_WIDTH + COLUMN_GAP),
        y: rowStarts[row] ?? MARGIN,
        width: CARD_WIDTH,
        height: HEADER_HEIGHT + entity.attributes.length * ROW_HEIGHT + FOOTER_HEIGHT,
      },
    };
  });
  return {
    positioned,
    width:
      MARGIN * 2 +
      columns * CARD_WIDTH +
      (columns - 1) * COLUMN_GAP +
      (columns === 1 ? COLUMN_GAP / 2 : 0),
    height: y - ROW_GAP + MARGIN,
  };
}

function relationPath(from: Box, to: Box) {
  const fromCenter = from.y + from.height / 2;
  const toCenter = to.y + to.height / 2;
  if (from === to) {
    const isLeftColumn = from.x === MARGIN;
    const edge = isLeftColumn ? from.x + from.width : from.x;
    const elbow = edge + (isLeftColumn ? COLUMN_GAP / 3 : -COLUMN_GAP / 3);
    return {
      d: `M ${edge} ${fromCenter - 10} H ${elbow} V ${fromCenter + 10} H ${edge}`,
      labelX: elbow + 14,
      labelY: fromCenter,
      fromEndpoint: { x: edge, y: fromCenter - 10, direction: (isLeftColumn ? 1 : -1) as -1 | 1 },
      toEndpoint: { x: edge, y: fromCenter + 10, direction: (isLeftColumn ? 1 : -1) as -1 | 1 },
    };
  }
  if (from.x !== to.x) {
    const left = from.x < to.x ? from : to;
    const right = from.x < to.x ? to : from;
    const leftY = left.y + left.height / 2;
    const rightY = right.y + right.height / 2;
    const gutterX = left.x + left.width + COLUMN_GAP / 2;
    return {
      d: `M ${left.x + left.width} ${leftY} H ${gutterX} V ${rightY} H ${right.x}`,
      labelX: gutterX,
      labelY: (leftY + rightY) / 2,
      fromEndpoint:
        from.x < to.x
          ? { x: left.x + left.width, y: leftY, direction: 1 as const }
          : { x: right.x, y: rightY, direction: -1 as const },
      toEndpoint:
        from.x < to.x
          ? { x: right.x, y: rightY, direction: -1 as const }
          : { x: left.x + left.width, y: leftY, direction: 1 as const },
    };
  }
  const isLeftColumn = from.x === MARGIN;
  const edgeX = isLeftColumn ? from.x + from.width : from.x;
  const gutterX = edgeX + (isLeftColumn ? COLUMN_GAP / 2 : -COLUMN_GAP / 2);
  return {
    d: `M ${edgeX} ${fromCenter} H ${gutterX} V ${toCenter} H ${edgeX}`,
    labelX: gutterX,
    labelY: (fromCenter + toCenter) / 2,
    fromEndpoint: { x: edgeX, y: fromCenter, direction: (isLeftColumn ? 1 : -1) as -1 | 1 },
    toEndpoint: { x: edgeX, y: toCenter, direction: (isLeftColumn ? 1 : -1) as -1 | 1 },
  };
}

function parseMultiplicity(value: string): Multiplicity | null {
  const token = value.trim().toLowerCase().replace(/[\s_]/g, '');
  if (token === 'one' || token === '1' || token === 'exactlyone') return 'one';
  if (token === 'many' || token === 'n' || token === 'm' || token === '*') return 'many';
  if (token === 'zero-or-one' || token === '0..1' || token === 'optionalone') return 'zero-or-one';
  if (
    token === 'zero-or-many' ||
    token === '0..*' ||
    token === '0..n' ||
    token === 'optionalmany'
  ) {
    return 'zero-or-many';
  }
  return null;
}

/** Only recognized cardinalities get semantic endpoint marks; preserve other model text. */
export function parseCardinality(value: string): [Multiplicity, Multiplicity] | null {
  const normalized = value.trim().toLowerCase().replace(/[–—→]/g, '-');
  if (/^1\s*\.\.\s*(?:\*|n|many)$/.test(normalized)) return ['one', 'many'];
  const parts = normalized.split(/\s*(?:-?to-?|:)\s*/);
  if (parts.length !== 2) return null;
  const from = parseMultiplicity(parts[0] ?? '');
  const to = parseMultiplicity(parts[1] ?? '');
  return from && to ? [from, to] : null;
}

function CardinalityMark({ endpoint, kind }: { endpoint: Endpoint; kind: Multiplicity }) {
  const { x, y, direction } = endpoint;
  const many = kind === 'many' || kind === 'zero-or-many';
  const optional = kind === 'zero-or-one' || kind === 'zero-or-many';
  return (
    <g data-cardinality-mark={kind} fill="none" stroke="#9f381c" strokeWidth={2}>
      {many ? (
        <path
          d={`M ${x + direction * 13} ${y} L ${x + direction * 2} ${y - 8} M ${x + direction * 13} ${y} L ${x + direction * 2} ${y} M ${x + direction * 13} ${y} L ${x + direction * 2} ${y + 8}`}
        />
      ) : (
        <line x1={x + direction * 7} y1={y - 8} x2={x + direction * 7} y2={y + 8} />
      )}
      {optional ? (
        <circle cx={x + direction * 21} cy={y} r={4.5} fill="#fffdfb" />
      ) : !many ? (
        <line x1={x + direction * 14} y1={y - 8} x2={x + direction * 14} y2={y + 8} />
      ) : null}
    </g>
  );
}

function visibleText(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function EntityCard({ entity }: { entity: PositionedEntity }) {
  const { x, y, width, height } = entity.box;
  return (
    <g>
      <title>{`${entity.name}: ${entity.purpose}`}</title>
      <rect x={x} y={y} width={width} height={height} rx={8} fill="#fffdfb" stroke="#baa99c" />
      <path
        d={`M ${x + 8} ${y} H ${x + width - 8} Q ${x + width} ${y} ${x + width} ${y + 8} V ${y + HEADER_HEIGHT} H ${x} V ${y + 8} Q ${x} ${y} ${x + 8} ${y}`}
        fill="#3d332e"
      />
      <text x={x + 16} y={y + 30} fill="#fffdfb" fontSize="15" fontWeight="700">
        {visibleText(entity.name, 32)}
      </text>
      {entity.attributes.map((attribute, index) => {
        const rowY = y + HEADER_HEIGHT + index * ROW_HEIGHT;
        const keyLabel =
          attribute.key === 'primary' ? 'PK' : attribute.key === 'foreign' ? 'FK' : '';
        return (
          <g key={`${attribute.name}-${index}`}>
            <title>{`${attribute.name}: ${attribute.dataType}${attribute.nullable ? ', nullable' : ', required'}${keyLabel ? `, ${keyLabel}` : ''}`}</title>
            {index % 2 === 1 && (
              <rect x={x + 1} y={rowY} width={width - 2} height={ROW_HEIGHT} fill="#f6f1ec" />
            )}
            {keyLabel && (
              <>
                <rect
                  x={x + 12}
                  y={rowY + 6}
                  width={30}
                  height={18}
                  rx={4}
                  fill={attribute.key === 'primary' ? '#e8eddf' : '#f5e7df'}
                />
                <text
                  x={x + 27}
                  y={rowY + 19}
                  textAnchor="middle"
                  fontSize="10"
                  fontWeight="700"
                  fill={attribute.key === 'primary' ? '#49652c' : '#9f381c'}
                >
                  {keyLabel}
                </text>
              </>
            )}
            <text x={x + 51} y={rowY + 20} fill="#29231f" fontSize="12" fontFamily="monospace">
              {visibleText(attribute.name, 23)}
            </text>
            <text
              x={x + width - 13}
              y={rowY + 20}
              textAnchor="end"
              fill="#625850"
              fontSize="11"
              fontFamily="monospace"
            >
              {visibleText(attribute.dataType, 14)}
              {attribute.nullable ? '?' : ''}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export function ErdDiagram({ model, filename }: { model: ErdModel; filename: string }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const expandedCanvasRef = useRef<HTMLDivElement>(null);
  const rawId = useId();
  const titleId = `${rawId}-title`;
  const descriptionId = `${rawId}-description`;
  const layout = layoutEntities(model.entities);
  const byName = new Map(layout.positioned.map((entity) => [entity.name, entity]));

  function downloadSvg() {
    const svg = svgRef.current;
    if (!svg) return;
    const copy = svg.cloneNode(true) as SVGSVGElement;
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    copy.removeAttribute('class');
    const url = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function expandDiagram() {
    const svg = svgRef.current;
    const dialog = dialogRef.current;
    const canvas = expandedCanvasRef.current;
    if (!svg || !dialog || !canvas) return;
    const copy = svg.cloneNode(true) as SVGSVGElement;
    copy.removeAttribute('class');
    copy.setAttribute('width', String(layout.width));
    copy.setAttribute('height', String(layout.height));
    const title = copy.querySelector('title');
    const description = copy.querySelector('desc');
    if (title) title.id = `${rawId}-expanded-title`;
    if (description) description.id = `${rawId}-expanded-description`;
    copy.setAttribute('aria-labelledby', `${rawId}-expanded-title ${rawId}-expanded-description`);
    canvas.replaceChildren(copy);
    dialog.showModal();
  }

  return (
    <section className="app-card p-6" aria-labelledby="erd-diagram-heading">
      <div className="document-print-hide mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="app-kicker">Visual model</p>
          <h3 id="erd-diagram-heading" className="text-on-surface mt-1 text-lg font-semibold">
            Entity relationship diagram
          </h3>
          <p className="text-on-surface-variant mt-1 text-xs">
            {model.entities.length} tables · {model.relationships.length} relationships
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={expandDiagram}
            className="border-surface-dim text-on-surface focus-visible:ring-primary inline-flex min-h-10 items-center gap-2 rounded-lg border px-4 text-sm font-medium focus-visible:ring-2"
          >
            <Maximize2 className="size-4" aria-hidden="true" />
            Expand
          </button>
          <button
            type="button"
            onClick={downloadSvg}
            className="border-surface-dim text-on-surface focus-visible:ring-primary inline-flex min-h-10 items-center gap-2 rounded-lg border px-4 text-sm font-medium focus-visible:ring-2"
          >
            <Download className="size-4" aria-hidden="true" />
            Download SVG
          </button>
        </div>
      </div>
      <div className="erd-diagram overflow-hidden rounded-lg border border-[#ded4cc] bg-[#f8f6f2]">
        <svg
          ref={svgRef}
          xmlns="http://www.w3.org/2000/svg"
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="img"
          aria-labelledby={`${titleId} ${descriptionId}`}
          className="block h-80 w-full"
        >
          <title id={titleId}>Entity relationship diagram</title>
          <desc id={descriptionId}>
            {`${model.entities.length} tables and ${model.relationships.length} relationships. Each table lists its columns, data types, and primary or foreign keys.`}
          </desc>
          <rect width={layout.width} height={layout.height} fill="#f8f6f2" />
          {model.relationships.map((relation, index) => {
            const from = byName.get(relation.from);
            const to = byName.get(relation.to);
            if (!from || !to) return null;
            const path = relationPath(from.box, to.box);
            return (
              <g key={`${relation.from}-${relation.to}-${index}`}>
                <title>{`${relation.from} to ${relation.to}: ${relation.cardinality}. ${relation.explanation}`}</title>
                <path d={path.d} fill="none" stroke="#9f381c" strokeWidth={2} />
              </g>
            );
          })}
          {layout.positioned.map((entity) => (
            <EntityCard key={entity.name} entity={entity} />
          ))}
          {model.relationships.map((relation, index) => {
            const from = byName.get(relation.from);
            const to = byName.get(relation.to);
            if (!from || !to) return null;
            const path = relationPath(from.box, to.box);
            const marks = parseCardinality(relation.cardinality);
            if (marks) {
              return (
                <g key={`marks-${index}`}>
                  <CardinalityMark endpoint={path.fromEndpoint} kind={marks[0]} />
                  <CardinalityMark endpoint={path.toEndpoint} kind={marks[1]} />
                </g>
              );
            }
            const label = visibleText(relation.cardinality, 19);
            const labelWidth = Math.max(30, label.length * 7 + 18);
            return (
              <g key={`label-${index}`}>
                <rect
                  x={path.labelX - labelWidth / 2}
                  y={path.labelY - 13}
                  width={labelWidth}
                  height={25}
                  rx={5}
                  fill="#fffdfb"
                  stroke="#d4c4b8"
                />
                <text
                  x={path.labelX}
                  y={path.labelY + 4}
                  textAnchor="middle"
                  fill="#803019"
                  fontSize="11"
                  fontWeight="700"
                >
                  {label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="document-print-hide text-on-surface-variant mt-3 text-xs">
        PK = primary key · FK = foreign key · ? = nullable column · || = one · crow&apos;s foot =
        many · ○ = optional. Expand to inspect the full-size diagram.
      </p>
      <dialog
        ref={dialogRef}
        aria-label="Expanded entity relationship diagram"
        className="document-print-hide fixed inset-4 m-auto max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-none overflow-hidden rounded-xl border border-[#ded4cc] bg-[#fffdfb] p-0 shadow-xl backdrop:bg-black/50"
      >
        <div className="border-surface-dim bg-surface-container-lowest sticky top-0 z-10 flex items-center justify-between gap-3 border-b p-4">
          <p className="text-on-surface text-sm font-semibold">
            Entity relationship diagram · full size
          </p>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="border-surface-dim text-on-surface focus-visible:ring-primary inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium focus-visible:ring-2"
          >
            <X className="size-4" aria-hidden="true" />
            Close
          </button>
        </div>
        <div
          ref={expandedCanvasRef}
          className="max-h-[calc(100vh-6rem)] overflow-auto bg-[#f8f6f2]"
        />
      </dialog>
      <div className="sr-only">
        {model.entities.map((entity) => (
          <section key={entity.name}>
            <h4>{entity.name}</h4>
            <p>{entity.purpose}</p>
            <ul>
              {entity.attributes.map((attribute) => (
                <li key={attribute.name}>
                  {attribute.name}, {attribute.dataType},{' '}
                  {attribute.key === 'none' ? 'no key' : `${attribute.key} key`},{' '}
                  {attribute.nullable ? 'nullable' : 'required'}
                </li>
              ))}
            </ul>
          </section>
        ))}
        <h4>Relationships</h4>
        <ul>
          {model.relationships.map((relation, index) => (
            <li key={index}>
              {relation.from} to {relation.to}: {relation.cardinality}. {relation.explanation}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
