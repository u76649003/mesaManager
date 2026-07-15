import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const { tenantId } = await request.json();
    if (!tenantId) {
      return NextResponse.json({ success: false, error: 'Falta el tenant_id' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: tenant, error: dbError } = await supabase
      .from('tenants')
      .select('name, smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from')
      .eq('id', tenantId)
      .single();

    if (dbError) {
      return NextResponse.json({
        success: false,
        error: `Error al leer la base de datos: ${dbError.message}. ¿Has ejecutado el SQL de las columnas SMTP en Supabase?`
      });
    }

    if (!tenant?.smtp_host || !tenant?.smtp_user || !tenant?.smtp_pass) {
      return NextResponse.json({
        success: false,
        error: `Los datos de correo no están guardados en la base de datos. smtp_host=${tenant?.smtp_host}, smtp_user=${tenant?.smtp_user}, smtp_pass=${tenant?.smtp_pass ? '****' : 'VACÍA'}. Por favor guarda primero los ajustes.`
      });
    }

    const port = Number(tenant.smtp_port) || 587;
    const transporter = nodemailer.createTransport({
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

    // Verify connection
    try {
      await transporter.verify();
    } catch (verifyErr: any) {
      return NextResponse.json({
        success: false,
        error: `Error de conexión SMTP: ${verifyErr.message}. 
Comprueba: 
1. Que la contraseña de 16 letras NO tiene espacios.
2. Que tienes la Verificación en 2 pasos activa en Google.
3. Que la contraseña de aplicación fue creada correctamente en myaccount.google.com/security.`
      });
    }

    // Send test email
    const fromAddress = tenant.smtp_from || `"${tenant.name || 'MesaManager'}" <${tenant.smtp_user}>`;
    await transporter.sendMail({
      from: fromAddress,
      to: tenant.smtp_user,
      subject: '✅ Prueba de correo - MesaManager',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; background: #f0fdf4; border-radius: 8px;">
          <h2 style="color: #16a34a;">✅ ¡Correo funcionando correctamente!</h2>
          <p>Este correo de prueba confirma que tu cuenta de Gmail está correctamente configurada en MesaManager.</p>
          <p><strong>Restaurante:</strong> ${tenant.name || 'Sin nombre'}</p>
          <p><strong>Correo configurado:</strong> ${tenant.smtp_user}</p>
          <p style="color: #6b7280; font-size: 12px;">MesaManager - Sistema de gestión de reservas</p>
        </div>
      `,
    });

    return NextResponse.json({
      success: true,
      message: `✅ Correo de prueba enviado correctamente a ${tenant.smtp_user}. Revisa tu bandeja de entrada.`
    });

  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message || 'Error desconocido' });
  }
}
