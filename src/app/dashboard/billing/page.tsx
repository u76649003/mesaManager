'use client';

import { useState, useEffect } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { CreditCard, Check, Sparkles, Shield, AlertTriangle, ArrowRight, Loader2, ArrowLeft } from 'lucide-react';
import { getBillingData, createCheckoutSession, createPortalSession } from './actions';
import { toast } from 'sonner';
import type { Room } from '@/types';
import Link from 'next/link';

const DEMO_ROOM: Room = {
  id: '10000000-0000-0000-0000-000000000001',
  tenant_id: '00000000-0000-0000-0000-000000000001',
  name: 'Salón Principal',
  canvas_width: 1200,
  canvas_height: 800,
  background_color: '#0f172a',
  is_active: true,
  sort_order: 1,
  created_at: new Date().toISOString(),
};

export default function BillingPage() {
  const [rooms] = useState<Room[]>([DEMO_ROOM]);
  const [activeRoom, setActiveRoom] = useState<Room>(DEMO_ROOM);
  
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [billingData, setBillingData] = useState<{
    tenant: {
      name: string;
      subscription_plan: 'basic' | 'pro' | 'trial';
      subscription_status: 'active' | 'inactive' | 'past_due' | 'cancelled';
      subscription_ends_at?: string;
      stripe_customer_id?: string;
    };
    email: string | undefined;
  } | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        const data = await getBillingData();
        // @ts-ignore
        setBillingData(data);
      } catch (err: any) {
        console.error(err);
        toast.error('Error al cargar datos de facturación: ' + err.message);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const handleSubscribe = async (plan: 'basic' | 'pro') => {
    setActionLoading(plan);
    try {
      const res = await createCheckoutSession(plan);
      if (res.url) {
        window.location.href = res.url;
      } else {
        toast.error('No se pudo generar la sesión de pago.');
      }
    } catch (err: any) {
      toast.error(err.message || 'Error al iniciar checkout.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleManage = async () => {
    setActionLoading('manage');
    try {
      const res = await createPortalSession();
      if (res.url) {
        window.location.href = res.url;
      } else {
        toast.error('No se pudo generar la sesión de portal de facturación.');
      }
    } catch (err: any) {
      toast.error(err.message || 'Error al abrir el portal de facturación.');
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="app-shell">
      <Sidebar activeRoom={activeRoom} rooms={rooms} onRoomChange={setActiveRoom} />

      <div className="main-content flex flex-col h-screen overflow-y-auto bg-slate-50 text-slate-900 p-6 md:p-8">
        
        {/* Header */}
          <div className="pb-6 border-b-2 border-slate-200 gap-4 mb-8 flex flex-col sm:flex-row items-stretch sm:items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-blue-50 border-2 border-blue-200 flex items-center justify-center text-blue-600 shadow-sm">
              <CreditCard size={20} />
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-900 leading-tight">Facturación y Planes</h1>
              <p className="text-slate-500 text-sm mt-0.5 font-bold">Gestiona tu suscripción y métodos de pago</p>
            </div>
          </div>
          <div>
            <Link 
              href="/" 
              className="flex items-center gap-1.5 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-black rounded-xl transition-colors border-2 border-slate-200"
            >
              <ArrowLeft size={16} />
              <span>Volver a Sala</span>
            </Link>
          </div>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="animate-spin text-indigo-500" size={32} />
          </div>
        ) : !billingData ? (
          <div className="flex flex-col items-center justify-center py-20 text-center border-2 border-dashed border-slate-200 rounded-3xl bg-white">
            <AlertTriangle className="text-amber-500 mb-3" size={40} />
            <h3 className="text-slate-700 font-extrabold">No se pudo cargar la información</h3>
            <p className="text-slate-500 text-sm mt-1 font-bold">Inténtalo de nuevo más tarde.</p>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto w-full space-y-8">
            
            {/* Estado actual de suscripción */}
            <div className="p-6 rounded-2xl bg-white border-2 border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-6">
              <div className="space-y-2">
                <div className="text-xs font-black uppercase tracking-wider text-blue-600">
                  Plan Actual
                </div>
                <div className="flex items-center gap-3">
                  <h2 className="text-2xl font-black capitalize text-slate-900">
                    Plan {billingData.tenant.subscription_plan === 'trial' ? 'Prueba Gratuita' : billingData.tenant.subscription_plan}
                  </h2>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border flex items-center gap-1 ${
                    billingData.tenant.subscription_status === 'active' 
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' 
                      : billingData.tenant.subscription_status === 'past_due'
                      ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                      : 'bg-slate-500/10 border-slate-500/30 text-slate-400'
                  }`}>
                    {billingData.tenant.subscription_status === 'active' ? 'Activo' : billingData.tenant.subscription_status}
                  </span>
                </div>
                <p className="text-slate-400 text-sm">
                  {billingData.tenant.subscription_ends_at && (
                    <>Tu suscripción actual finaliza / se renueva el: {new Date(billingData.tenant.subscription_ends_at).toLocaleDateString('es-ES')}</>
                  )}
                  {!billingData.tenant.subscription_ends_at && <>Prueba ilimitada para configurar tu local y gestionar tus reservas.</>}
                </p>
              </div>
              
              {billingData.tenant.stripe_customer_id && (
                <div>
                  <button
                    onClick={handleManage}
                    disabled={actionLoading !== null}
                    className="w-full md:w-auto flex items-center justify-center gap-2 px-6 py-2.5 bg-slate-850 hover:bg-slate-800 text-white border border-slate-700 text-sm font-semibold rounded-xl transition-all"
                  >
                    {actionLoading === 'manage' ? (
                      <Loader2 size={16} className="animate-spin text-white" />
                    ) : (
                      <Sparkles size={16} className="text-amber-400" />
                    )}
                    <span>Portal de Facturación Stripe</span>
                  </button>
                </div>
              )}
            </div>

            {/* Listado de Planes */}
            <div className="space-y-4">
              <h3 className="text-lg font-black text-slate-900">Planes disponibles</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Plan Basic */}
                <div className={`p-6 rounded-2xl border-2 flex flex-col justify-between h-full bg-white transition-all ${
                  billingData.tenant.subscription_plan === 'basic' && billingData.tenant.subscription_status === 'active'
                    ? 'border-blue-500 shadow-md shadow-blue-50' 
                    : 'border-slate-200 hover:border-slate-300'
                }`}>
                  <div className="space-y-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="text-lg font-black text-slate-900">Basic</h4>
                        <p className="text-slate-500 text-sm mt-1 font-bold">Perfecto para pequeños cafés y bares.</p>
                      </div>
                      <span className="px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-xs font-extrabold text-slate-700">
                        Sencillo
                      </span>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-black text-slate-900">29€</span>
                      <span className="text-slate-500 text-sm font-bold">/ mes</span>
                    </div>
                    <ul className="space-y-2.5 pt-4 border-t-2 border-slate-100">
                      {[
                        'Hasta 15 mesas configurables',
                        'Gestión básica de reservas',
                        'Soporte por correo electrónico',
                        '1 salón/sala'
                      ].map((feature) => (
                        <li key={feature} className="flex items-center gap-2.5 text-slate-700 text-sm font-bold">
                          <Check size={16} className="text-blue-600 shrink-0" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="mt-8">
                    <button
                      onClick={() => handleSubscribe('basic')}
                      disabled={actionLoading !== null || (billingData.tenant.subscription_plan === 'basic' && billingData.tenant.subscription_status === 'active')}
                      className={`w-full py-3 px-4 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                        billingData.tenant.subscription_plan === 'basic' && billingData.tenant.subscription_status === 'active'
                          ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                          : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/20'
                      }`}
                    >
                      {actionLoading === 'basic' ? (
                        <Loader2 size={16} className="animate-spin text-white" />
                      ) : billingData.tenant.subscription_plan === 'basic' && billingData.tenant.subscription_status === 'active' ? (
                        <span>Suscrito</span>
                      ) : (
                        <>
                          <span>Contratar Plan Basic</span>
                          <ArrowRight size={16} />
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Plan Pro */}
                <div className={`p-6 rounded-2xl border flex flex-col justify-between h-full bg-slate-900 relative transition-all ${
                  billingData.tenant.subscription_plan === 'pro' && billingData.tenant.subscription_status === 'active'
                    ? 'border-indigo-500 ring-2 ring-indigo-500/20' 
                    : 'border-slate-800 hover:border-slate-700'
                }`}>
                  <div className="absolute -top-3 right-4 px-3 py-1 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center gap-1 shadow-md">
                    <Sparkles size={12} />
                    <span>Recomendado</span>
                  </div>

                  <div className="space-y-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="text-lg font-bold text-white">Pro</h4>
                        <p className="text-slate-400 text-sm mt-1">Para restaurantes medianos y grandes.</p>
                      </div>
                      <span className="px-2.5 py-1 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-xs font-semibold text-indigo-400">
                        Avanzado
                      </span>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-extrabold text-white">49€</span>
                      <span className="text-slate-400 text-sm">/ mes</span>
                    </div>
                    <ul className="space-y-2.5 pt-4 border-t border-slate-800">
                      {[
                        'Salones y salas ilimitadas',
                        'Mesas ilimitadas',
                        'Gestión avanzada de reservas con histórico',
                        'Auditoría y log de reservas',
                        'Soporte prioritario 24/7'
                      ].map((feature) => (
                        <li key={feature} className="flex items-center gap-2.5 text-slate-300 text-sm">
                          <Check size={16} className="text-indigo-400 shrink-0" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="mt-8">
                    <button
                      onClick={() => handleSubscribe('pro')}
                      disabled={actionLoading !== null || (billingData.tenant.subscription_plan === 'pro' && billingData.tenant.subscription_status === 'active')}
                      className={`w-full py-3 px-4 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                        billingData.tenant.subscription_plan === 'pro' && billingData.tenant.subscription_status === 'active'
                          ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                          : 'bg-indigo-650 hover:bg-indigo-600 text-white shadow-lg shadow-indigo-900/30 ring-1 ring-indigo-500/50'
                      }`}
                    >
                      {actionLoading === 'pro' ? (
                        <Loader2 size={16} className="animate-spin text-white" />
                      ) : billingData.tenant.subscription_plan === 'pro' && billingData.tenant.subscription_status === 'active' ? (
                        <span>Suscrito</span>
                      ) : (
                        <>
                          <span>Contratar Plan Pro</span>
                          <ArrowRight size={16} />
                        </>
                      )}
                    </button>
                  </div>
                </div>

              </div>
            </div>

            {/* Garantía */}
            <div className="flex items-center gap-3 p-4 rounded-xl bg-slate-900/40 border border-slate-850">
              <Shield className="text-indigo-400 shrink-0" size={20} />
              <p className="text-xs text-slate-400 leading-normal">
                Procesamiento de pagos seguro a través de Stripe. Puedes cancelar tu suscripción o actualizar tu plan en cualquier momento desde esta misma página.
              </p>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
