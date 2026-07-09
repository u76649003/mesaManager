'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { login } from '@/app/actions/auth';

export default function LoginPage() {
  const [state, formAction, isPending] = useActionState(login, null);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-extrabold text-white tracking-tight">MesaManager</h1>
          <p className="text-slate-400 mt-2 text-sm">Inicia sesión en tu panel de gestión de sala</p>
        </div>

        <form action={formAction} className="space-y-6">
          {state?.error && (
            <div className="p-3 bg-red-950/50 border border-red-800 text-red-200 rounded-lg text-sm">
              {state.error}
            </div>
          )}

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
              placeholder="nombre@restaurante.com"
            />
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
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={isPending}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-550 disabled:bg-indigo-850 disabled:text-slate-450 font-bold rounded-lg text-white transition-all shadow-md flex items-center justify-center cursor-pointer"
          >
            {isPending ? 'Iniciando sesión...' : 'Entrar'}
          </button>
        </form>

        <p className="text-center text-slate-400 text-sm mt-6">
          ¿No tienes una cuenta?{' '}
          <Link href="/register" className="text-indigo-400 hover:underline">
            Registra tu restaurante
          </Link>
        </p>
      </div>
    </div>
  );
}
