import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const tenantId = searchParams.get('state'); // The state contains the tenantId passed earlier
  
  const origin = new URL(request.url).origin;

  if (!code || !tenantId) {
    return NextResponse.redirect(`${origin}/dashboard/settings?google_error=Falta+codigo+de+autorizacion+o+tenant_id`);
  }
  
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${origin}/dashboard/settings?google_error=Credenciales+de+Google+no+configuradas+en+el+servidor`);
  }
  
  const redirectUri = `${origin}/api/auth/google/callback`;
  
  try {
    // 1. Exchange auth code for access & refresh tokens
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    
    const tokenData = await response.json();
    
    if (tokenData.error) {
      throw new Error(tokenData.error_description || tokenData.error);
    }
    
    // 2. Fetch the connected Google Account email
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userData = await userResponse.json();
    const email = userData.email;
    
    if (!email) {
      throw new Error('No se pudo recuperar la dirección de correo electrónico de Google.');
    }
    
    const supabase = await createClient();
    
    // 3. Update the tenant record with the secure OAuth credentials
    const { error } = await supabase
      .from('tenants')
      .update({
        google_access_token: tokenData.access_token,
        google_refresh_token: tokenData.refresh_token || null, // refresh token is sent on first prompt consent
        google_token_expiry: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
        google_email: email,
        smtp_host: 'smtp.gmail.com', // Pre-fill SMTP indicator fields
        smtp_port: 587,
        smtp_user: email,
        smtp_from: `"MesaManager" <${email}>`,
      })
      .eq('id', tenantId);
      
    if (error) {
      throw new Error(`Error en base de datos: ${error.message}`);
    }
    
    // Redirect back to general settings page with a success query parameter
    return NextResponse.redirect(`${origin}/dashboard/settings?google_success=true`);
  } catch (err: any) {
    console.error('Error in Google OAuth Callback:', err);
    return NextResponse.redirect(`${origin}/dashboard/settings?google_error=${encodeURIComponent(err.message || 'Error desconocido')}`);
  }
}
