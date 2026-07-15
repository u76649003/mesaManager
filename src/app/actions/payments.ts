'use server';

import Stripe from 'stripe';
import { createClient } from '@/lib/supabase/server';

/**
 * Crea una sesión de Stripe Checkout para el prepago de una reserva
 */
export async function createPrepaymentSession(reservationId: string, origin: string) {
  try {
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

    // Use tenant-specific stripe key OR global fallback
    const stripeSecretKey = res.tenant?.stripe_secret_key || process.env.STRIPE_SECRET_KEY;

    if (!stripeSecretKey || stripeSecretKey === 'dummy_key_for_build_time') {
      throw new Error('La pasarela de pago (Stripe) no está configurada para este restaurante.');
    }

    const stripeInstance = new Stripe(stripeSecretKey);
    const amountInCents = Math.round(Number(res.prepayment_amount) * 100);
    if (amountInCents <= 0) {
      throw new Error('El importe del prepago debe ser mayor que 0 €.');
    }

    const session = await stripeInstance.checkout.sessions.create({
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
    const supabase = await createClient();

    // Fetch reservation to obtain tenant key
    const { data: res, error: resError } = await supabase
      .from('reservations')
      .select('*, tenant:tenants(*)')
      .eq('id', reservationId)
      .single();

    if (resError || !res) {
      throw new Error('No se pudo encontrar la reserva.');
    }

    const stripeSecretKey = res.tenant?.stripe_secret_key || process.env.STRIPE_SECRET_KEY;

    if (!stripeSecretKey || stripeSecretKey === 'dummy_key_for_build_time') {
      throw new Error('La pasarela de pago (Stripe) no está configurada.');
    }

    const stripeInstance = new Stripe(stripeSecretKey);
    const session = await stripeInstance.checkout.sessions.retrieve(sessionId);
    
    if (session.payment_status !== 'paid') {
      return { success: false, error: 'El pago aún no ha sido completado por la entidad bancaria.' };
    }
    
    if (session.metadata?.reservationId !== reservationId) {
      return { success: false, error: 'Los datos de la sesión de pago no coinciden con esta reserva.' };
    }
    
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

    // SEND AUTOMATIC CONFIRMATION EMAIL:
    // Once payment status is successfully verified, trigger the final confirmation email to the guest.
    if (res.guest_email) {
      try {
        const { sendReservationConfirmationEmail } = await import('@/app/actions/emails');
        // Fetch room name if available
        let roomName = 'Principal';
        if (res.room_id) {
          const { data: room } = await supabase
            .from('rooms')
            .select('name')
            .eq('id', res.room_id)
            .single();
          if (room) roomName = room.name;
        }

        await sendReservationConfirmationEmail({
          ...res,
          payment_status: 'paid',
          status: 'confirmed',
        }, roomName, `¡Hola <strong>${res.guest_name}</strong>! Hemos recibido correctamente tu pago de garantía de <strong>${res.prepayment_amount} €</strong> y tu reserva ha quedado completamente confirmada. ¡Te esperamos!`);
      } catch (emailErr) {
        console.error('Error sending confirmation email after Stripe verification:', emailErr);
      }
    }

    return { success: true };
  } catch (error: any) {
    console.error('Error al verificar la sesión de pago:', error);
    return { success: false, error: error.message || String(error) };
  }
}

