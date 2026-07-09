'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { registerTenant } from '@/app/actions/auth';

export default function RegisterPage() {
  const [state, formAction, isPending] = useActionState(registerTenant, null);
  const [slug, setSlug] = useState('');

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.value;
    const generatedSlug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    setSlug(generatedSlug);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-extrabold text-white tracking-tight">MesaManager</h1>
          <p className="text-slate-400 mt-2 text-sm">Registra tu restaurante y comienza a gestionar tu sala</p>
        </div>

        <form action={formAction} className="space-y-6">
          {state?.error && (
            <div className="p-3 bg-red-950/50 border border-red-800 text-red-200 rounded-lg text-sm">
              {state.error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label htmlFor="ownerName" className="text-sm font-semibold text-slate-300">
                Tu Nombre Completo
              </label>
              <input
                id="ownerName"
                name="ownerName"
                type="text"
                required
                className="w-full px-4 py-2.5 bg-slate-950 border border-slate-850 rounded-lg focus:outline-none focus:border-indigo-500 text-slate-100 transition-colors"
                placeholder="Juan Pérez"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-semibold text-slate-300">
                Correo Electrónico
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                className="w-full px-4 py-2.5 bg-slate-950 border border-slate-850 rounded-lg focus:outline-none focus:border-indigo-500 text-slate-100 transition-colors"
                placeholder="juan@mirestaurante.com"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-semibold text-slate-300">
              Contraseña
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              className="w-full px-4 py-2.5 bg-slate-950 border border-slate-850 rounded-lg focus:outline-none focus:border-indigo-500 text-slate-100 transition-colors"
              placeholder="Min. 6 caracteres"
            />
          </div>

          <div className="border-t border-slate-800 my-4 pt-4" />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label htmlFor="restaurantName" className="text-sm font-semibold text-slate-300">
                Nombre del Restaurante
              </label>
              <input
                id="restaurantName"
                name="restaurantName"
                type="text"
                required
                onChange={handleNameChange}
                className="w-full px-4 py-2.5 bg-slate-950 border border-slate-850 rounded-lg focus:outline-none focus:border-indigo-500 text-slate-100 transition-colors"
                placeholder="El Mirador"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="restaurantSlug" className="text-sm font-semibold text-slate-300">
                Slug (Identificador en URL)
              </label>
              <input
                id="restaurantSlug"
                name="restaurantSlug"
                type="text"
                required
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-950 border border-slate-850 rounded-lg focus:outline-none focus:border-indigo-500 text-slate-100 transition-colors"
                placeholder="el-mirador"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isPending}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-550 disabled:bg-indigo-850 disabled:text-slate-450 font-bold rounded-lg text-white transition-all shadow-md flex items-center justify-center cursor-pointer"
          >
            {isPending ? 'Registrando restaurante...' : 'Registrarse'}
          </button>
        </form>

        <p className="text-center text-slate-400 text-sm mt-6">
          ¿Ya tienes cuenta?{' '}
          <Link href="/login" className="text-indigo-400 hover:underline">
            Inicia sesión
          </Link>
        </p>
      </div>
    </div>
  );
}
