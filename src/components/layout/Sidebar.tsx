'use client';

import { motion } from 'framer-motion';
import { useFloorStore } from '@/stores/useFloorStore';
import { cn } from '@/lib/utils';
import type { Room } from '@/types';
import {
  LayoutDashboard,
  CalendarDays,
  Settings,
  ChefHat,
  Users,
  CreditCard,
  LogOut,
  MapPin,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logout } from '@/app/actions/auth';

interface SidebarProps {
  activeRoom: Room;
  rooms: Room[];
  onRoomChange: (room: Room) => void;
}

const NAV_ITEMS = [
  { icon: LayoutDashboard, label: 'Plano de Sala', id: 'floor', href: '/' },
  { icon: CalendarDays,    label: 'Reservas',     id: 'reservations', href: '/dashboard/reservations' },
  { icon: Users,           label: 'Camareros',    id: 'staff', href: '/dashboard/staff' },
  { icon: CreditCard,      label: 'Facturación',  id: 'billing', href: '/dashboard/billing' },
  { icon: Settings,        label: 'Ajustes',      id: 'settings', href: '/dashboard/settings' },
];

export function Sidebar({ activeRoom, rooms, onRoomChange }: SidebarProps) {
  const pathname = usePathname();

  const getActiveId = () => {
    if (pathname === '/') return 'floor';
    if (pathname.startsWith('/dashboard/reservations')) return 'reservations';
    if (pathname.startsWith('/dashboard/staff')) return 'staff';
    if (pathname.startsWith('/dashboard/billing')) return 'billing';
    if (pathname.startsWith('/dashboard/settings')) return 'settings';
    return 'floor';
  };

  const activeNav = getActiveId();

  return (
    <aside className="sidebar flex flex-col justify-between h-screen border-r-2 border-slate-200 bg-white p-6 w-[240px] shrink-0 z-40">
      {/* Brand Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20 border border-blue-550 shrink-0">
          <ChefHat size={24} />
        </div>
        <div className="min-w-0">
          <span className="text-slate-900 font-extrabold text-base tracking-tight block" style={{ fontFamily: 'var(--font-title)' }}>
            MesaManager
          </span>
          <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">
            Panel de Control
          </span>
        </div>
      </div>

      <div className="h-[1.5px] bg-slate-100 mb-4 w-full" />

      {/* Navigation list */}
      <nav className="flex flex-col gap-2 flex-1 overflow-y-auto">
        {NAV_ITEMS.map(({ icon: Icon, label, id, href }) => {
          const isActive = activeNav === id;
          return (
            <Link
              key={id}
              href={href}
              className={cn(
                'flex items-center gap-3.5 px-4 py-3.5 rounded-2xl transition-all cursor-pointer border-2 text-sm font-bold',
                isActive
                  ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-600/15'
                  : 'text-slate-600 border-transparent hover:bg-slate-50 hover:text-slate-900'
              )}
            >
              <Icon size={20} className="shrink-0" />
              <span>{label}</span>
            </Link>
          );
        })}

        {/* Salas selector */}
        {activeNav === 'floor' && rooms.length > 0 && (
          <div className="mt-6 space-y-2">
            <span className="text-[10px] uppercase tracking-wider text-slate-450 font-extrabold block px-2 mb-2">
              Salas y Zonas
            </span>
            {rooms.map((room) => {
              const isSelected = activeRoom.id === room.id;
              return (
                <button
                  key={room.id}
                  onClick={() => onRoomChange(room)}
                  className={cn(
                    'w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all border-2 text-xs font-bold text-left cursor-pointer',
                    isSelected
                      ? 'bg-slate-100 border-slate-300 text-slate-900 shadow-sm'
                      : 'text-slate-650 border-transparent hover:bg-slate-50 hover:text-slate-900'
                  )}
                >
                  <MapPin size={16} className={cn("shrink-0", isSelected ? "text-blue-600" : "text-slate-400")} />
                  <span className="truncate">{room.name}</span>
                </button>
              );
            })}
          </div>
        )}
      </nav>

      <div className="h-[1.5px] bg-slate-100 my-4 w-full" />

      {/* Footer Profile & Logout */}
      <div className="flex flex-col gap-3 mt-auto">
        {/* User profile details */}
        <div className="flex items-center gap-3 px-2">
          <div className="w-10 h-10 rounded-xl bg-slate-100 border-2 border-slate-200 flex items-center justify-center text-slate-800 font-extrabold text-sm shrink-0 shadow-inner">
            U
          </div>
          <div className="min-w-0">
            <span className="text-slate-900 font-bold text-xs block truncate leading-tight">Usuario Principal</span>
            <span className="text-[9px] text-slate-500 font-bold uppercase block leading-none mt-0.5">Encargado</span>
          </div>
        </div>

        {/* Logout button */}
        <button
          onClick={async () => {
            if (window.confirm('¿Estás seguro de que quieres cerrar la sesión?')) {
              await logout();
            }
          }}
          className="flex items-center gap-3.5 px-4 py-3 rounded-2xl transition-all cursor-pointer border-2 border-transparent text-slate-650 hover:bg-red-50 hover:border-red-100 hover:text-red-650 text-xs font-bold"
        >
          <LogOut size={16} className="shrink-0" />
          <span>Cerrar Sesión</span>
        </button>
      </div>
    </aside>
  );
}
