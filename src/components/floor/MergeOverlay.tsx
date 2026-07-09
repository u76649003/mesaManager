'use client';

import { motion } from 'framer-motion';
import type { Table, TableGroup } from '@/types';

interface MergeOverlayProps {
  group: TableGroup;
  tables: Table[];
}

export function MergeOverlay({ group, tables }: MergeOverlayProps) {
  if (tables.length < 2) return null;

  // Calcular bounding box del grupo
  const minX = Math.min(...tables.map((t) => t.position_x));
  const minY = Math.min(...tables.map((t) => t.position_y));
  const maxX = Math.max(...tables.map((t) => t.position_x + (t.table_type?.width ?? 80)));
  const maxY = Math.max(...tables.map((t) => t.position_y + (t.table_type?.height ?? 80)));

  const padding = 12;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="absolute pointer-events-none"
      style={{
        left: minX - padding,
        top: minY - padding,
        width: maxX - minX + padding * 2,
        height: maxY - minY + padding * 2,
        border: '2px dashed #6366f1',
        borderRadius: 16,
        background: 'rgba(99, 102, 241, 0.05)',
      }}
    >
      {/* Etiqueta del grupo */}
      {group.label && (
        <div className="absolute -top-3 left-3 bg-indigo-600 text-white text-xs font-semibold px-2 py-0.5 rounded-full">
          {group.label}
        </div>
      )}

      {/* Líneas de conexión entre mesas */}
      <svg
        className="absolute inset-0 overflow-visible"
        style={{ left: -padding, top: -padding }}
      >
        {tables.slice(1).map((table, i) => {
          const prev = tables[i];
          const x1 = prev.position_x - minX + padding + (prev.table_type?.width ?? 80) / 2;
          const y1 = prev.position_y - minY + padding + (prev.table_type?.height ?? 80) / 2;
          const x2 = table.position_x - minX + padding + (table.table_type?.width ?? 80) / 2;
          const y2 = table.position_y - minY + padding + (table.table_type?.height ?? 80) / 2;
          return (
            <line
              key={table.id}
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke="#6366f1"
              strokeWidth="2"
              strokeDasharray="6 3"
              opacity="0.4"
            />
          );
        })}
      </svg>
    </motion.div>
  );
}
