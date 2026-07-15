import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get('tenant_id');
  
  if (!tenantId) {
    return NextResponse.json({ error: 'Falta el ID del inquilino (tenant_id)' }, { status: 400 });
  }
  
  const origin = new URL(request.url).origin;
  const redirectUri = `${origin}/api/auth/google/callback`;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId || clientId === 'dummy_key_for_build_time') {
    return NextResponse.redirect(`${origin}/dashboard/settings?google_error=Las+credenciales+de+Google+OAuth+(GOOGLE_CLIENT_ID)+no+estan+configuradas+en+el+servidor`);
  }

  
  // Scopes requested: Gmail send access and User profile email lookup
  const scopes = [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/userinfo.email'
  ];

  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + 
    `client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scopes.join(' '))}` +
    `&access_type=offline` +
    `&prompt=consent` +
    `&state=${tenantId}`;
     
  return NextResponse.redirect(googleAuthUrl);
}
