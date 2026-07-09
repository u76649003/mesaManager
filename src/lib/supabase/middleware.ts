import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: Avoid writing any logic between createServerClient and
  // supabase.auth.getUser(). A simple mistake can cause write issues.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const url = request.nextUrl.clone();

  // Define paths that are public or for auth
  const isAuthPage = url.pathname.startsWith('/login') || url.pathname.startsWith('/register');
  const isApiRoute = url.pathname.startsWith('/api');
  const isStaticFile = url.pathname.includes('.') || url.pathname.startsWith('/_next');

  if (isApiRoute || isStaticFile) {
    return supabaseResponse;
  }

  if (!user && !isAuthPage) {
    // If not authenticated and not on an auth page, redirect to /login
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (user && isAuthPage) {
    // If authenticated and on login/register, redirect to dashboard (/)
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
