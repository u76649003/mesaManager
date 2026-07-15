'use server';

import Stripe from 'stripe';
import { createClient } from '@/lib/supabase/server';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'dummy_key_for_build_time');

/**
 * Crea una sesión de Stripe Checkout para el prepago de una reserva
 */
export async function createPrepaymentSession(reservationId: string, origin: string) {
  try {
    if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY === 'dummy_key_for_build_time') {
      throw new Error('La clave secreta de Stripe (STRIPE_SECRET_KEY) no está configurada en las variables de entorno.');
    }

    const supabase = await createClient();
    
    // Fetch reservation
    const { data: res, error: resError } = await supabase
      .from('reservations')
      .select('*, tenant:tenants(*)')
      .eq('id', reservationId)
      .single();

    if (resError || !res) {
      throw new Error('No se pudo encontrar la reserva en la base de datos.');
    }

    const amountInCents = Math.round(Number(res.prepayment_amount) * 100);
    if (amountInCents <= 0) {
      throw new Error('El importe del prepago debe ser mayor que 0 €.');
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: `Garantía de Reserva - ${res.guest_name}`,
            description: res.prepayment_reason || 'Depósito para confirmación de mesa',
          },
          unit_amount: amountInCents,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${origin}/payment/${res.id}?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/payment/${res.id}?cancel=true`,
      metadata: {
        reservationId: res.id,
      },
    });

    return { success: true, url: session.url };
  } catch (error: any) {
    console.error('Error al crear sesión de Stripe Checkout:', error);
    return { success: false, error: error.message || String(error) };
  }
}

/**
 * Verifica la sesión de Stripe Checkout tras el retorno exitoso y confirma la reserva
 */
export async function verifyPrepaymentSession(reservationId: string, sessionId: string) {
  try {
    if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY === 'dummy_key_for_build_time') {
      throw new Error('La clave secreta de Stripe (STRIPE_SECRET_KEY) no está configurada.');
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    
    if (session.payment_status !== 'paid') {
      return { success: false, error: 'El pago aún no ha sido completado por la entidad bancaria.' };
    }
    
    if (session.metadata?.reservationId !== reservationId) {
      return { success: false, error: 'Los datos de la sesión de pago no coinciden con esta reserva.' };
    }

    const supabase = await createClient();
    
    // Update reservation status and payment status in Supabase
    const { error } = await supabase
      .from('reservations')
      .update({
        payment_status: 'paid',
        status: 'confirmed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', reservationId);

    if (error) {
      console.error('Error al actualizar el estado de la reserva tras pago:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error: any) {
    console.error('Error al verificar la sesión de pago:', error);
    return { success: false, error: error.message || String(error) };
  }
}
