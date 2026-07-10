'use client';

import { useDraggable } from '@dnd-kit/core';
import { motion } from 'framer-motion';
import { useTableTimer } from '@/hooks/useTableTimer';
import { cn } from '@/lib/utils';
import type { Table } from '@/types';

interface TableItemProps {
  table: Table;
  isSelected: boolean;
  isDragging: boolean;
  isEditMode: boolean;
  onClick: (e: React.MouseEvent) => void;
  isDimmed?: boolean;
}

// ─── Status config ────────────────────────────────────────────────────────────
const STATUS = {
  available: { fill: '#22c55e', chairFill: '#86efac', chairStroke: '#16a34a', label: 'Libre' },
  occupied:  { fill: '#ef4444', chairFill: '#fca5a5', chairStroke: '#b91c1c', label: 'Ocupado' },
  reserved:  { fill: '#f59e0b', chairFill: '#fcd34d', chairStroke: '#b45309', label: 'Reservado' },
  cleaning:  { fill: '#8b5cf6', chairFill: '#c4b5fd', chairStroke: '#6d28d9', label: 'Limpiando' },
  blocked:   { fill: '#94a3b8', chairFill: '#cbd5e1', chairStroke: '#64748b', label: 'Bloqueado' },
} as const;

type StatusKey = keyof typeof STATUS;

// ─── Single chair as a rounded-rect ───────────────────────────────────────────
function Chair({
  x, y, w, h, rx, angle,
  fill, stroke,
}: {
  x: number; y: number; w: number; h: number; rx: number;
  angle: number; fill: string; stroke: string;
}) {
  return (
    <rect
      x={x - w / 2}
      y={y - h / 2}
      width={w}
      height={h}
      rx={rx}
      fill={fill}
      stroke={stroke}
      strokeWidth={1.5}
      transform={`rotate(${angle},${x},${y})`}
    />
  );
}

// ─── Build chair positions around a shape ─────────────────────────────────────
function buildChairs(
  capacity: number,
  shape: string,
  tw: number, th: number,   // table body dimensions
  originX: number, originY: number, // centre of table in SVG space
  gapFromEdge: number,               // how far from table body edge
  cw: number, ch: number,            // chair width / height
): { x: number; y: number; angle: number }[] {
  const chairs: { x: number; y: number; angle: number }[] = [];
  const cap = Math.min(capacity, 10);

  if (shape === 'circle' || shape === 'oval') {
    // Evenly around circle
    const r = Math.min(tw, th) / 2 + gapFromEdge;
    for (let i = 0; i < cap; i++) {
      const deg = (360 / cap) * i - 90;
      const rad = (deg * Math.PI) / 180;
      chairs.push({
        x: originX + r * Math.cos(rad),
        y: originY + r * Math.sin(rad),
        angle: deg + 90,
      });
    }
  } else {
    // Rectangular table
    // Top row
    const topCount    = cap <= 2 ? 1 : cap <= 6 ? Math.ceil(cap / 2) : Math.ceil((cap - 2) / 2);
    const bottomCount = cap <= 2 ? 1 : cap <= 6 ? Math.floor(cap / 2) : Math.floor((cap - 2) / 2);
    const hasEnds     = cap > 6;

    const topY    = originY - th / 2 - gapFromEdge;
    const bottomY = originY + th / 2 + gapFromEdge;
    const leftX   = originX - tw / 2 - gapFromEdge;
    const rightX  = originX + tw / 2 + gapFromEdge;

    // Top chairs
    for (let i = 0; i < topCount; i++) {
      const x = originX - (tw / 2) + (tw / (topCount + 1)) * (i + 1);
      chairs.push({ x, y: topY, angle: 0 });
    }
    // Bottom chairs
    for (let i = 0; i < bottomCount; i++) {
      const x = originX - (tw / 2) + (tw / (bottomCount + 1)) * (i + 1);
      chairs.push({ x, y: bottomY, angle: 180 });
    }
    // End chairs (left/right) for 7+ capacity
    if (hasEnds) {
      chairs.push({ x: leftX,  y: originY, angle: -90 });
      chairs.push({ x: rightX, y: originY, angle: 90 });
    }
  }

  return chairs;
}

// ─── Main component ────────────────────────────────────────────────────────────
export function TableItem({ table, isSelected, isDragging, isEditMode, onClick, isDimmed }: TableItemProps) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: table.id,
    disabled: !isEditMode,
  });

  const { elapsedFormatted, isOvertime, isRunning } = useTableTimer(table.id);

  const shape    = table.table_type?.shape ?? 'square';
  const capacity = table.capacity ?? table.table_type?.capacity ?? 4;
  const status   = (table.status ?? 'available') as StatusKey;
  const st       = STATUS[status] ?? STATUS.available;
  const isCircle = shape === 'circle' || shape === 'oval';

  // ── Table body size ──
  let tw = 80, th = 80;
  if (capacity <= 2)       { tw = 72;  th = 72;  }
  else if (capacity <= 4)  { tw = 90;  th = 90;  }
  else if (capacity <= 6)  { tw = 130; th = 80;  }
  else if (capacity <= 8)  { tw = 155; th = 86;  }
  else                     { tw = 175; th = 92;  }

  // ── Chair dimensions ──
  // Chairs should be big and clearly visible – about 28-32% of table width
  const cw = isCircle
    ? Math.round(tw * 0.35)   // width of each chair
    : Math.round(tw * 0.22);
  const ch = Math.round(cw * 0.48);          // height (thin pill)
  const chairRx  = ch * 0.45;               // corner radius
  const gapEdge  = Math.round(ch * 0.7);    // gap between table body and chair centre

  // ── SVG canvas ──
  const pad  = gapEdge + ch / 2 + 8;
  const svgW = tw + pad * 2;
  const svgH = th + pad * 2;

  // Centre of table body in SVG space
  const ox = svgW / 2;
  const oy = svgH / 2;

  const chairList = buildChairs(capacity, shape, tw, th, ox, oy, gapEdge, cw, ch);

  // ── Body shape ──
  const bodyR = isCircle ? Math.min(tw, th) / 2 : 14;

  // ── Font sizes ──
  const labelFontSize = Math.max(12, Math.min(18, tw / 5.2));
  const subFontSize   = Math.max(9,  Math.min(12, tw / 8));
  const timerFontSize = Math.max(13,  Math.min(17, tw / 6.5));

  const containerStyle: React.CSSProperties = {
    position:  'absolute',
    left:      table.position_x - pad,
    top:       table.position_y - pad,
    width:     svgW,
    height:    svgH,
    transform: transform
      ? `translate(${transform.x}px, ${transform.y}px) rotate(${table.rotation}deg)`
      : `rotate(${table.rotation}deg)`,
    cursor: isEditMode ? 'grab' : 'pointer',
    zIndex: isSelected ? 20 : isDragging ? 30 : 10,
    touchAction: 'none',
  };

  return (
    <motion.div
      ref={setNodeRef}
      style={containerStyle}
      {...(isEditMode ? { ...listeners, ...attributes } : {})}
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
      whileHover={{ scale: 1.07 }}
      whileTap={{ scale: 0.97 }}
      animate={{ opacity: isDragging ? 0.3 : 1 }}
      transition={{ type: 'spring', stiffness: 380, damping: 28 }}
      className={cn("select-none transition-all duration-300", isDimmed && "opacity-15 blur-[0.7px] scale-[0.97] saturate-[0.3] pointer-events-none")}
    >
      <svg
        width={svgW}
        height={svgH}
        viewBox={`0 0 ${svgW} ${svgH}`}
        overflow="visible"
      >
        {/* ── Chairs (drawn BEHIND table) ── */}
        {chairList.map((c, i) => (
          <Chair
            key={i}
            x={c.x}
            y={c.y}
            w={cw}
            h={ch}
            rx={chairRx}
            angle={c.angle}
            fill={st.chairFill}
            stroke={st.chairStroke}
          />
        ))}

        {/* ── Selection ring ── */}
        {isSelected && (
          <rect
            x={ox - tw / 2 - 6}
            y={oy - th / 2 - 6}
            width={tw + 12}
            height={th + 12}
            rx={isCircle ? Math.min(tw, th) / 2 + 6 : 20}
            fill="none"
            stroke="#2563eb"
            strokeWidth={3}
            strokeDasharray="7 3"
          />
        )}

        {/* ── Table body ── */}
        <rect
          x={ox - tw / 2}
          y={oy - th / 2}
          width={tw}
          height={th}
          rx={bodyR}
          fill={st.fill}
          stroke="rgba(255,255,255,0.18)"
          strokeWidth={1.5}
        />

        {/* ── Status label (big) ── */}
        <text
          x={ox}
          y={oy - (isRunning ? 9 : 4)}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="white"
          fontSize={labelFontSize}
          fontWeight="900"
          fontFamily="system-ui,-apple-system,sans-serif"
          letterSpacing="-0.5"
        >
          {st.label}
        </text>

        {/* ── Table id + capacity ── */}
        <text
          x={ox}
          y={oy + (isRunning ? 6 : 12)}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="rgba(255,255,255,0.80)"
          fontSize={subFontSize}
          fontWeight="700"
          fontFamily="system-ui,-apple-system,sans-serif"
        >
          {table.label} · {capacity}p
        </text>

        {/* ── Timer (occupied) ── */}
        {isRunning && (
          <text
            x={ox}
            y={oy + 24}
            textAnchor="middle"
            dominantBaseline="middle"
            fill={isOvertime ? '#fca5a5' : '#bbf7d0'}
            fontSize={timerFontSize}
            fontWeight="900"
            fontFamily="'Courier New',monospace"
          >
            {elapsedFormatted}
          </text>
        )}

        {/* ── Edit-mode checkmark ── */}
        {isSelected && isEditMode && (
          <g>
            <circle
              cx={ox + tw / 2 - 3}
              cy={oy - th / 2 + 3}
              r={10}
              fill="#2563eb"
              stroke="white"
              strokeWidth={2}
            />
            <text
              x={ox + tw / 2 - 3}
              y={oy - th / 2 + 3}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="white"
              fontSize={11}
              fontWeight="900"
            >✓</text>
          </g>
        )}
      </svg>
    </motion.div>
  );
}
