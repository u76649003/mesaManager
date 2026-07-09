import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatDateTime(date: string, time: string): string {
  return `${date} ${time}`;
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    available: '#22c55e',
    occupied:  '#ef4444',
    reserved:  '#f59e0b',
    cleaning:  '#8b5cf6',
    blocked:   '#6b7280',
    pending:   '#f59e0b',
    confirmed: '#3b82f6',
    seated:    '#ef4444',
    completed: '#22c55e',
    cancelled: '#6b7280',
    no_show:   '#9ca3af',
  };
  return colors[status] ?? '#6b7280';
}

export function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    available: 'Disponible',
    occupied:  'Ocupada',
    reserved:  'Reservada',
    cleaning:  'Limpieza',
    blocked:   'Bloqueada',
    pending:   'Pendiente',
    confirmed: 'Confirmada',
    seated:    'En mesa',
    completed: 'Completada',
    cancelled: 'Cancelada',
    no_show:   'No presentado',
  };
  return labels[status] ?? status;
}

export function isTableOvertime(occupiedSince: string, durationMinutes = 90): boolean {
  const elapsed = Date.now() - new Date(occupiedSince).getTime();
  return elapsed > durationMinutes * 60 * 1000;
}
