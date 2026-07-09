'use client';

import { useState, useEffect, useRef } from 'react';
import { useFloorStore } from '@/stores/useFloorStore';
import { formatTime, isTableOvertime } from '@/lib/utils';

// ============================================================
// useTableTimer — Temporizador en tiempo real por mesa
// El occupiedSince viene del Zustand store (persiste entre vistas)
// ============================================================

interface UseTableTimerReturn {
  elapsedMs: number;
  elapsedFormatted: string;
  hours: number;
  minutes: number;
  seconds: number;
  isOvertime: boolean;
  isRunning: boolean;
}

export function useTableTimer(
  tableId: string,
  overtimeLimitMinutes = 90
): UseTableTimerReturn {
  const occupiedSince = useFloorStore((s) => s.occupiedSince[tableId]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!occupiedSince) {
      setElapsedMs(0);
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    // Calcular elapsed inicial inmediatamente
    const startTime = new Date(occupiedSince).getTime();
    setElapsedMs(Date.now() - startTime);

    intervalRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startTime);
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [occupiedSince]);

  const totalSeconds = Math.floor(elapsedMs / 1000);
  const hours   = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return {
    elapsedMs,
    elapsedFormatted: formatTime(elapsedMs),
    hours,
    minutes,
    seconds,
    isOvertime: occupiedSince ? isTableOvertime(occupiedSince, overtimeLimitMinutes) : false,
    isRunning: !!occupiedSince,
  };
}
