'use server';

import nodemailer from 'nodemailer';
import { createClient } from '@/lib/supabase/server';
import type { Reservation } from '@/types';

// Helper to check if SMTP settings are present
function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    console.warn('⚠️ SMTP credentials not fully configured in env variables. Emails will be logged to console.');
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // true for 465, false for others
    auth: {
      user,
      pass,
    },
  });
}

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  tenantId?: string;
}

async function sendMail({ to, subject, html, tenantId }: SendEmailParams) {
  let transporter: nodemailer.Transporter | null = null;
  let fromAddress = process.env.SMTP_FROM || '"MesaManager" <no-reply@mesamanager.com>';

  if (tenantId) {
    try {
      const supabase = await createClient();
      const { data: tenant } = await supabase
        .from('tenants')
        .select('name, smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, google_email, google_refresh_token')
        .eq('id', tenantId)
        .single();

      if (tenant && tenant.google_refresh_token && tenant.google_email) {
        // Use Google OAuth2 for sending emails
        transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            type: 'OAuth2',
            user: tenant.google_email,
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            refreshToken: tenant.google_refresh_token,
          },
        } as any);
        fromAddress = tenant.smtp_from || `"${tenant.name || 'Restaurante'}" <${tenant.google_email}>`;
      } else if (tenant && tenant.smtp_host && tenant.smtp_user && tenant.smtp_pass) {
        // Fallback to manual SMTP (App Password) configuration
        const port = Number(tenant.smtp_port) || 587;
        console.log(`📧 Usando SMTP: host=${tenant.smtp_host} port=${port} user=${tenant.smtp_user}`);
        transporter = nodemailer.createTransport({
          host: tenant.smtp_host,
          port,
          secure: port === 465,
          requireTLS: port === 587,
          auth: {
            user: tenant.smtp_user,
            pass: tenant.smtp_pass,
          },
          tls: { rejectUnauthorized: false },
        });
        fromAddress = tenant.smtp_from || `"${tenant.name || 'Restaurante'}" <${tenant.smtp_user}>`;
      } else {
        console.warn(`⚠️ Tenant ${tenantId} no tiene SMTP configurado. Correo simulado.`);
      }

    } catch (e) {
      console.error('Error fetching tenant SMTP settings:', e);
    }
  }

  if (!transporter) {
    transporter = getTransporter();
  }

  if (!transporter) {
    console.log('====== SIMULACIÓN DE ENVÍO DE CORREO ======');
    console.log(`Para: ${to}`);
    console.log(`Asunto: ${subject}`);
    console.log('Contenido HTML (texto plano):');
    console.log(html.replace(/<[^>]*>/g, ' ').substring(0, 300) + '...');
    console.log('==========================================');
    return { success: true, simulated: true };
  }

  // Verify the SMTP connection before trying to send
  try {
    await transporter.verify();
  } catch (verifyError: any) {
    const msg = verifyError?.message || 'Error de conexión SMTP';
    console.error('❌ SMTP verify failed:', msg);
    return { success: false, error: `Error de conexión con el servidor de correo: ${msg}. Comprueba que tu contraseña de aplicación de 16 letras es correcta y que tienes la verificación en 2 pasos activada en tu cuenta de Google.` };
  }

  try {
    const info = await transporter.sendMail({
      from: fromAddress,
      to,
      subject,
      html,
    });
    console.log(`📧 Correo enviado correctamente: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error: any) {
    const msg = error?.message || 'Error desconocido';
    console.error('❌ Error al enviar correo:', msg);
    return { success: false, error: `Error al enviar correo: ${msg}` };
  }
}

/**
 * Envía un correo de confirmación de reserva
 */
export async function sendReservationConfirmationEmail(reservation: Reservation, roomName: string, customMessage?: string) {
  if (!reservation.guest_email) return;

  const subject = `Confirmación de tu reserva - MesaManager`;
  const mainText = customMessage
    ? customMessage.replace(/\n/g, '<br>')
    : `Hola <strong>${reservation.guest_name}</strong>, tu reserva en nuestro restaurante ha sido confirmada con éxito.`;

  const html = `
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 30px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      <tr>
        <td align="center">
          <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 20px; border: 1px solid #e2e8f0; padding: 40px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03);">
            <tr>
              <td align="center" style="padding-bottom: 24px;">
                <div style="width: 56px; height: 56px; line-height: 56px; border-radius: 16px; background-color: #eff6ff; color: #2563eb; font-size: 28px; font-weight: bold; text-align: center; display: inline-block;">
                  📅
                </div>
              </td>
            </tr>
            <tr>
              <td align="center" style="font-size: 24px; font-weight: 800; color: #0f172a; padding-bottom: 12px; font-family: 'Outfit', sans-serif;">
                ¡Reserva Confirmada!
              </td>
            </tr>
            <tr>
              <td style="font-size: 15px; color: #475569; line-height: 1.6; padding-bottom: 24px;">
                ${mainText}
              </td>
            </tr>
            <tr>
              <td>
                <table width="100%" cellpadding="14" cellspacing="0" style="background-color: #f8fafc; border-radius: 16px; border: 1px solid #f1f5f9;">
                  <tr>
                    <td style="font-size: 13px; font-weight: bold; color: #64748b; border-bottom: 1px solid #f1f5f9; text-transform: uppercase; letter-spacing: 0.5px;">Fecha</td>
                    <td align="right" style="font-size: 14px; font-weight: bold; color: #0f172a; border-bottom: 1px solid #f1f5f9;">${reservation.date}</td>
                  </tr>
                  <tr>
                    <td style="font-size: 13px; font-weight: bold; color: #64748b; border-bottom: 1px solid #f1f5f9; text-transform: uppercase; letter-spacing: 0.5px;">Hora</td>
                    <td align="right" style="font-size: 14px; font-weight: bold; color: #0f172a; border-bottom: 1px solid #f1f5f9;">${reservation.time}</td>
                  </tr>
                  <tr>
                    <td style="font-size: 13px; font-weight: bold; color: #64748b; border-bottom: 1px solid #f1f5f9; text-transform: uppercase; letter-spacing: 0.5px;">Personas</td>
                    <td align="right" style="font-size: 14px; font-weight: bold; color: #0f172a; border-bottom: 1px solid #f1f5f9;">${reservation.party_size} personas</td>
                  </tr>
                  <tr>
                    <td style="font-size: 13px; font-weight: bold; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Sala / Zona</td>
                    <td align="right" style="font-size: 14px; font-weight: bold; color: #0f172a;">${roomName}</td>
                  </tr>
                </table>
              </td>
            </tr>
            ${reservation.notes ? `
            <tr>
              <td style="padding-top: 20px;">
                <div style="background-color: #fffbeb; border: 1px solid #fef3c7; border-radius: 12px; padding: 14px; font-size: 13.5px; color: #b45309; line-height: 1.5;">
                  <strong>Notas de tu reserva:</strong><br>
                  ${reservation.notes}
                </div>
              </td>
            </tr>
            ` : ''}
            <tr>
              <td style="font-size: 14px; color: #64748b; line-height: 1.6; text-align: center; padding-top: 32px; border-top: 1px solid #f1f5f9; margin-top: 32px;">
                Si necesitas realizar algún cambio o cancelar la reserva, ponte en contacto con nosotros directamente.
              </td>
            </tr>
          </table>
          <table width="600" cellpadding="0" cellspacing="0">
            <tr>
              <td align="center" style="font-size: 12px; color: #94a3b8; padding-top: 24px; font-weight: 500;">
                MesaManager · Gestión Inteligente de Restauración
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  return await sendMail({ to: reservation.guest_email, subject, html, tenantId: reservation.tenant_id ?? undefined });
}

/**
 * Envía un correo con la solicitud de prepago para confirmar la reserva
 */
export async function sendPaymentRequestEmail(reservation: Reservation, paymentUrl: string, customMessage?: string) {
  if (!reservation.guest_email) return;

  const subject = `Acción requerida: Pago de tu reserva - MesaManager`;
  const isBizum = reservation.payment_method === 'bizum';

  const defaultText = isBizum
    ? `Hola <strong>${reservation.guest_name}</strong>, para confirmar tu reserva de ${reservation.party_size} personas el ${reservation.date} a las ${reservation.time}, por favor realiza un Bizum de <strong>${reservation.prepayment_amount} €</strong> al teléfono <strong>${reservation.bizum_phone}</strong> a nombre de <strong>${reservation.bizum_name}</strong>.`
    : `Hola <strong>${reservation.guest_name}</strong>, para confirmar tu reserva es necesario realizar un depósito de garantía de <strong>${reservation.prepayment_amount} €</strong>. Haz clic en el botón de abajo para proceder con el pago seguro:`;

  const mainText = customMessage
    ? customMessage.replace(/\n/g, '<br>')
    : defaultText;

  const buttonHtml = isBizum
    ? `
      <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 16px; padding: 20px; margin-bottom: 30px;">
        <div style="font-size: 24px; text-align: center; margin-bottom: 8px;">📲</div>
        <div style="font-size: 15px; font-weight: bold; color: #166534; text-align: center;">Detalles del Pago por Bizum</div>
        <div style="font-size: 20px; font-weight: 800; color: #15803d; text-align: center; margin: 12px 0;">${reservation.prepayment_amount} €</div>
        <div style="font-size: 13.5px; color: #374151; padding: 12px; background-color: #ffffff; border-radius: 10px; border: 1px solid #e5e7eb;">
          📞 Teléfono Bizum: <strong>${reservation.bizum_phone}</strong><br>
          👤 Beneficiario: <strong>${reservation.bizum_name}</strong><br>
          📝 Concepto sugerido: <strong>Reserva ${reservation.guest_name}</strong>
        </div>
      </div>
    `
    : `
      <div style="text-align: center; padding-bottom: 30px;">
        <a href="${paymentUrl}" target="_blank" style="background-color: #ea580c; color: #ffffff; padding: 14px 28px; border-radius: 14px; text-decoration: none; font-size: 15px; font-weight: 800; display: inline-block; box-shadow: 0 4px 6px rgba(234, 88, 12, 0.15); border: 1px solid #d97706;">
          Pagar Ahora
        </a>
      </div>
    `;

  const html = `
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 30px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      <tr>
        <td align="center">
          <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 20px; border: 1px solid #e2e8f0; padding: 40px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03);">
            <tr>
              <td align="center" style="padding-bottom: 24px;">
                <div style="width: 56px; height: 56px; line-height: 56px; border-radius: 16px; background-color: #fff7ed; color: #ea580c; font-size: 28px; font-weight: bold; text-align: center; display: inline-block;">
                  ${isBizum ? '📲' : '💳'}
                </div>
              </td>
            </tr>
            <tr>
              <td align="center" style="font-size: 24px; font-weight: 800; color: #0f172a; padding-bottom: 12px; font-family: 'Outfit', sans-serif;">
                ${isBizum ? 'Solicitud de Pago por Bizum' : 'Completa tu Prepago'}
              </td>
            </tr>
            <tr>
              <td style="font-size: 15px; color: #475569; line-height: 1.6; padding-bottom: 24px;">
                ${mainText}
              </td>
            </tr>
            <tr>
              <td>
                ${buttonHtml}
              </td>
            </tr>
            <tr>
              <td>
                <table width="100%" cellpadding="14" cellspacing="0" style="background-color: #f8fafc; border-radius: 16px; border: 1px solid #f1f5f9;">
                  <tr>
                    <td style="font-size: 13px; font-weight: bold; color: #64748b; border-bottom: 1px solid #f1f5f9; text-transform: uppercase; letter-spacing: 0.5px;">Fecha</td>
                    <td align="right" style="font-size: 14px; font-weight: bold; color: #0f172a; border-bottom: 1px solid #f1f5f9;">${reservation.date}</td>
                  </tr>
                  <tr>
                    <td style="font-size: 13px; font-weight: bold; color: #64748b; border-bottom: 1px solid #f1f5f9; text-transform: uppercase; letter-spacing: 0.5px;">Hora</td>
                    <td align="right" style="font-size: 14px; font-weight: bold; color: #0f172a; border-bottom: 1px solid #f1f5f9;">${reservation.time}</td>
                  </tr>
                  <tr>
                    <td style="font-size: 13px; font-weight: bold; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Personas</td>
                    <td align="right" style="font-size: 14px; font-weight: bold; color: #0f172a;">${reservation.party_size} personas</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="font-size: 13px; color: #94a3b8; line-height: 1.6; text-align: center; padding-top: 32px; border-top: 1px solid #f1f5f9; margin-top: 32px;">
                Si el pago no se completa en las próximas horas, la prereserva podría ser liberada automáticamente.
              </td>
            </tr>
          </table>
          <table width="600" cellpadding="0" cellspacing="0">
            <tr>
              <td align="center" style="font-size: 12px; color: #94a3b8; padding-top: 24px; font-weight: 500;">
                MesaManager · Pasarela de Pago Segura
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  return await sendMail({ to: reservation.guest_email, subject, html, tenantId: reservation.tenant_id ?? undefined });
}

export async function sendAssistantPaymentRequest(
  reservationId: string,
  method: 'online' | 'bizum',
  amount: number,
  origin: string,
) {
  const supabase = await createClient();
  const { data: reservation, error } = await supabase
    .from('reservations')
    .select('*, tenant:tenants(bizum_phone, bizum_name)')
    .eq('id', reservationId)
    .single();
  if (error || !reservation) return { success: false, error: 'No se encontró la reserva.' };
  if (!reservation.guest_email) return { success: false, error: 'La reserva no tiene correo del cliente.' };
  const bizumPhone = reservation.bizum_phone || reservation.tenant?.bizum_phone;
  const bizumName = reservation.bizum_name || reservation.tenant?.bizum_name;
  if (method === 'bizum' && (!bizumPhone || !bizumName)) return { success: false, error: 'Configura el teléfono y beneficiario de Bizum en Ajustes.' };

  const { data: updated, error: updateError } = await supabase.from('reservations').update({
    is_prepayment: true,
    prepayment_amount: amount,
    prepayment_reason: 'Garantía de reserva',
    payment_method: method,
    payment_status: 'pending',
    status: 'pending',
    send_email: true,
    bizum_phone: method === 'bizum' ? bizumPhone : null,
    bizum_name: method === 'bizum' ? bizumName : null,
  }).eq('id', reservationId).select('*').single();
  if (updateError || !updated) return { success: false, error: updateError?.message || 'No se pudo preparar el pago.' };

  const baseUrl = origin.includes('localhost') || origin.includes('capacitor') ? 'https://mesa-manager.vercel.app' : origin;
  const emailResult = await sendPaymentRequestEmail(updated, `${baseUrl}/payment/${reservationId}`);
  if (!emailResult) return { success: false, error: 'No se pudo preparar el correo.' };
  if ('simulated' in emailResult && emailResult.simulated) return { success: false, error: 'El correo no está configurado. Conecta Gmail o SMTP en Ajustes.' };
  return emailResult;
}
