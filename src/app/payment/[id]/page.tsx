'use client';

import { useEffect, useState, use } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';
import { sendReservationConfirmationEmail } from '@/app/actions/emails';

import type { Reservation, Tenant } from '@/types';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { CreditCard, Calendar, Clock, Users, ShieldCheck, CheckCircle2, Loader2, AlertCircle, ChefHat } from 'lucide-react';
import { toast } from 'sonner';
import { useSearchParams } from 'next/navigation';


export default function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const [reservation, setReservation] = useState<Reservation | null>(null);

  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  // Form states
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');
  const [cardHolder, setCardHolder] = useState('');

  useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      try {
        const supabase = createClient();
        
        // Fetch reservation with relations
        const { data: res, error: resError } = await supabase
          .from('reservations')
          .select('*, room:rooms(*), shift:shifts(*), table:tables(*)')
          .eq('id', id)
          .single();

        if (resError || !res) {
          console.error('Error fetching reservation:', resError);
          setIsLoading(false);
          return;
        }

        setReservation(res);

        if (res.payment_status === 'paid') {
          setIsSuccess(true);
        }

        // If we returned from Stripe Checkout with success, verify it
        const successParam = searchParams.get('success');
        const sessionIdParam = searchParams.get('session_id');
        if (successParam === 'true' && sessionIdParam) {
          setIsProcessing(true);
          const { verifyPrepaymentSession } = await import('@/app/actions/payments');
          const verifyRes = await verifyPrepaymentSession(id, sessionIdParam);
          if (verifyRes.success) {
            setIsSuccess(true);
            setIsProcessing(false);
            setIsLoading(false);
            res.payment_status = 'paid';
            res.status = 'confirmed';
          } else {
            toast.error(verifyRes.error || 'No se pudo verificar el pago.');
            setIsProcessing(false);
          }
        }


        // Fetch tenant details
        const { data: ten, error: tenError } = await supabase
          .from('tenants')
          .select('*')
          .eq('id', res.tenant_id)
          .single();

        if (!tenError && ten) {
          setTenant(ten);
        }

        // AUTO-REDIRECT FOR STRIPE:
        // If the reservation is unpaid, requires prepayment online (Stripe), and we didn't just return from a session
        if (res.payment_status !== 'paid' && res.payment_method === 'online' && successParam !== 'true') {
          setIsProcessing(true);
          const { createPrepaymentSession } = await import('@/app/actions/payments');
          const result = await createPrepaymentSession(id, window.location.origin);
          if (result.success && result.url) {
            window.location.href = result.url; // Immediately send to Stripe
            return; // keep loading screen active while redirecting
          } else {
            toast.error(result.error || 'Error al iniciar la pasarela de Stripe');
            setIsProcessing(false);
          }
        }
      } catch (err) {
        console.error('Error loading payment details:', err);
      } finally {
        setIsLoading(false);
      }
    }

    if (id) {
      loadData();
    }
  }, [id, searchParams]);

  const handleCardNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '');
    const formatted = value.match(/.{1,4}/g)?.join(' ') || '';
    setCardNumber(formatted.slice(0, 19));
  };

  const handleExpiryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value.replace(/\D/g, '');
    if (value.length > 2) {
      value = value.slice(0, 2) + '/' + value.slice(2, 4);
    }
    setCardExpiry(value.slice(0, 5));
  };

  const handleCvvChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '');
    setCardCvv(value.slice(0, 4));
  };

  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault();

    if (reservation?.payment_method === 'online') {
      setIsProcessing(true);
      try {
        const { createPrepaymentSession } = await import('@/app/actions/payments');
        const result = await createPrepaymentSession(id, window.location.origin);
        if (result.success && result.url) {
          window.location.href = result.url; // Redirect to Stripe Checkout
        } else {
          toast.error(result.error || 'Error al iniciar la pasarela de Stripe');
          setIsProcessing(false);
        }
      } catch (err) {
        console.error('Error redirecting to Stripe:', err);
        toast.error('Error de conexión con la pasarela de pagos');
        setIsProcessing(false);
      }
      return;
    }

    setIsProcessing(true);

    // Simulate Bizum payment processing delay
    setTimeout(async () => {
      try {
        const supabase = createClient();
        
        // Update payment_status to 'paid' and status to 'confirmed'
        const { error } = await supabase
          .from('reservations')
          .update({
            payment_status: 'paid',
            status: 'confirmed',
            updated_at: new Date().toISOString(),
          })
          .eq('id', id);

        if (error) {
          throw error;
        }

        // Send actual email receipt and confirmation
        if (reservation?.guest_email) {
          const roomName = reservation.room?.name || 'Principal';
          await sendReservationConfirmationEmail({
            ...reservation,
            payment_status: 'paid',
            status: 'confirmed',
          }, roomName);
          toast.success(`📧 Recibo de pago enviado a ${reservation.guest_email}`);
        }

        setIsSuccess(true);
      } catch (err) {
        console.error('Error recording payment:', err);
        toast.error('Error al procesar el pago. Inténtelo de nuevo.');
      } finally {
        setIsProcessing(false);
      }
    }, 1500);
  };


  if (isLoading || isProcessing) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-center space-y-4 max-w-sm">
          <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto" />
          <p className="text-slate-650 text-sm font-bold">
            {reservation?.payment_method === 'online' && reservation.payment_status !== 'paid'
              ? 'Redirigiendo de forma segura a la pasarela de Stripe...'
              : 'Cargando detalles del pago seguro...'}
          </p>
        </div>
      </div>
    );
  }

  if (!reservation) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border-2 border-red-200 rounded-3xl p-8 max-w-md w-full text-center shadow-xl space-y-5">
          <div className="w-14 h-14 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto shadow-inner">
            <AlertCircle size={28} />
          </div>
          <div>
            <h2 className="text-slate-900 font-black text-xl">Enlace no válido</h2>
            <p className="text-slate-500 text-sm mt-1 font-bold">
              No hemos podido encontrar la solicitud de reserva o el enlace ha caducado.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between py-10 px-4">
      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-lg bg-white border-2 border-slate-200 rounded-3xl shadow-2xl overflow-hidden">
          
          {/* Header */}
          <div className="bg-slate-900 px-6 py-5 text-white flex items-center justify-between border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-md">
                <ChefHat size={20} className="text-white" />
              </div>
              <div>
                <h1 className="font-black text-base tracking-tight">{tenant?.name || 'MesaManager'}</h1>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Pasarela de Pago Seguro</p>
              </div>
            </div>
            <div className="flex items-center gap-1 bg-white/10 px-2.5 py-1 rounded-xl text-[10px] font-black uppercase tracking-wider text-slate-300 border border-white/5">
              <ShieldCheck size={12} className="text-emerald-400" />
              <span>SSL 256-bit</span>
            </div>
          </div>

          <AnimatePresence mode="wait">
            {isSuccess ? (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="p-8 text-center space-y-6"
              >
                <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mx-auto text-emerald-600 shadow-inner">
                  <CheckCircle2 size={40} className="animate-bounce" />
                </div>
                <div>
                  <h2 className="text-slate-900 font-black text-2xl">¡Pago Realizado con Éxito!</h2>
                  <p className="text-slate-550 text-sm mt-1.5 font-bold">
                    Tu reserva ha sido confirmada automáticamente en el restaurante.
                  </p>
                </div>

                <div className="bg-slate-50 border-2 border-slate-200 rounded-2xl p-5 text-left text-xs font-bold text-slate-700 space-y-3.5 shadow-sm">
                  <div className="flex justify-between border-b border-slate-200 pb-2.5">
                    <span className="text-slate-450">NÚMERO DE RESERVA</span>
                    <span className="text-slate-900 font-black">{reservation.reservation_number}</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-200 pb-2.5">
                    <span className="text-slate-450">CLIENTE</span>
                    <span className="text-slate-900 font-black">{reservation.guest_name}</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-200 pb-2.5">
                    <span className="text-slate-450">FECHA Y HORA</span>
                    <span className="text-slate-900 font-black uppercase">
                      {format(parseISO(reservation.date), "EEEE d 'de' MMMM", { locale: es })} a las {reservation.time.slice(0, 5)} hs
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-slate-200 pb-2.5">
                    <span className="text-slate-450">COMENSALES</span>
                    <span className="text-slate-900 font-black">{reservation.party_size} personas</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-200 pb-2.5">
                    <span className="text-slate-450">IMPORTE ABONADO</span>
                    <span className="text-emerald-600 font-black text-sm">{reservation.prepayment_amount} €</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-450">MOTIVO DEL PAGO</span>
                    <span className="text-slate-900 font-black truncate max-w-[200px]">
                      {reservation.prepayment_reason || 'Pago por adelantado'}
                    </span>
                  </div>
                </div>

                <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-2xl text-[11px] text-blue-700 text-left font-semibold">
                  📧 Hemos enviado un correo de confirmación de reserva y recibo de pago a <strong>{reservation.guest_email}</strong>. No es necesario realizar ninguna acción adicional.
                </div>

                <div className="pt-2">
                  <p className="text-slate-400 text-xs font-bold">¡Gracias por su confianza! Ya puede cerrar esta pestaña.</p>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="form"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="p-6 space-y-6"
              >
                {/* Solicitud Info */}
                <div className="bg-blue-50 border-2 border-blue-200 rounded-2xl p-5 flex items-start gap-4">
                  <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center text-blue-600 shrink-0 shadow-inner">
                    <CreditCard size={22} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Anticipo solicitado</p>
                    <p className="text-slate-900 font-black text-2xl mt-0.5">{reservation.prepayment_amount} €</p>
                    <p className="text-blue-800 text-xs font-bold mt-1.5 leading-relaxed">
                      <strong>Motivo:</strong> {reservation.prepayment_reason || 'Garantía de mesa / reserva especial'}
                    </p>
                  </div>
                </div>

                {/* Reservation Summary */}
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4.5 space-y-3 text-xs font-bold text-slate-700 shadow-sm">
                  <div className="flex items-center gap-2.5">
                    <Calendar size={14} className="text-slate-400" />
                    <span>Fecha: {format(parseISO(reservation.date), "EEEE d 'de' MMMM 'de' yyyy", { locale: es })}</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Clock size={14} className="text-slate-400" />
                    <span>Hora: {reservation.time.slice(0, 5)} hs</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Users size={14} className="text-slate-400" />
                    <span>Mesa para: {reservation.party_size} personas</span>
                  </div>
                </div>

                {/* Payment form */}
                <form onSubmit={handlePay} className="space-y-4">
                  {reservation.payment_method === 'online' ? (
                    <div className="bg-slate-50 border-2 border-slate-200 p-5 rounded-2xl space-y-3.5 text-center">
                      <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
                        <CreditCard size={18} />
                      </div>
                      <div>
                        <span className="text-slate-900 font-extrabold text-sm block">Pago Seguro con Stripe Checkout</span>
                        <span className="text-slate-500 text-xs mt-1 block leading-relaxed font-bold">
                          Serás redirigido de forma segura a la pasarela oficial de Stripe para completar el pago de <strong>{reservation.prepayment_amount} €</strong> con tu tarjeta de crédito o débito.
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-slate-50 border-2 border-slate-200 p-5 rounded-2xl space-y-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center shadow-inner text-lg">📲</div>
                        <div>
                          <span className="text-slate-900 font-extrabold text-sm block">Instrucciones de Pago por Bizum</span>
                          <span className="text-slate-550 text-[10px] font-bold block uppercase tracking-wider">Envío manual</span>
                        </div>
                      </div>
                      <div className="bg-white p-3.5 rounded-xl border border-slate-150 space-y-2.5 text-xs text-slate-700 font-bold">
                        <div className="flex justify-between">
                          <span className="text-slate-450">IMPORTE</span>
                          <span className="text-slate-900 font-black text-sm">{reservation.prepayment_amount} €</span>
                        </div>
                        <div className="flex justify-between border-t border-slate-100 pt-2">
                          <span className="text-slate-450">TELÉFONO BIZUM</span>
                          <span className="text-slate-900 font-black">{reservation.bizum_phone || '600000000'}</span>
                        </div>
                        <div className="flex justify-between border-t border-slate-100 pt-2">
                          <span className="text-slate-450">BENEFICIARIO</span>
                          <span className="text-slate-900 font-black">{reservation.bizum_name || 'Restaurante'}</span>
                        </div>
                        <div className="flex justify-between border-t border-slate-100 pt-2">
                          <span className="text-slate-450">CONCEPTO SUGERIDO</span>
                          <span className="text-slate-900 font-black truncate max-w-[200px]">Reserva {reservation.guest_name}</span>
                        </div>
                      </div>
                      <p className="text-[10px] text-slate-550 font-bold text-center">
                        Una vez que hayas realizado el envío desde tu aplicación de banco, pulsa en el botón de abajo para informar al restaurante.
                      </p>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isProcessing}
                    className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-2xl transition-all text-sm shadow-md flex items-center justify-center gap-2 cursor-pointer mt-4"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        <span>{reservation.payment_method === 'online' ? 'Abriendo pasarela de pago...' : 'Registrando confirmación...'}</span>
                      </>
                    ) : (
                      <>
                        <ShieldCheck size={16} />
                        <span>
                          {reservation.payment_method === 'online'
                            ? `Pagar ${reservation.prepayment_amount} € con Tarjeta`
                            : `He realizado el Bizum de ${reservation.prepayment_amount} €`
                          }
                        </span>
                      </>
                    )}
                  </button>
                </form>


                <div className="text-center">
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                    🔒 Sus datos de pago están encriptados y protegidos mediante SSL de 256 bits.
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

        </div>
      </div>

      {/* Footer */}
      <div className="text-center text-slate-400 text-[10px] font-bold uppercase tracking-wider py-4">
        &copy; {new Date().getFullYear()} {tenant?.name || 'MesaManager'}. Todos los derechos reservados.
      </div>
    </div>
  );
}
