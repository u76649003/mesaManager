'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function getBillingData() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error('No autenticado');
  }

  // Get user profile and tenant
  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('tenant_id')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) {
    throw new Error('Perfil de usuario no encontrado');
  }

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('name, subscription_plan, subscription_status, subscription_ends_at, stripe_customer_id')
    .eq('id', profile.tenant_id)
    .single();

  if (tenantError || !tenant) {
    throw new Error('Tenant no encontrado');
  }

  return {
    tenant,
    email: user.email,
  };
}

export async function createCheckoutSession(plan: 'basic' | 'pro') {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error('No autenticado');
  }

  // Get user profile and tenant
  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('tenant_id')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) {
    throw new Error('Perfil de usuario no encontrado');
  }

  const tenantId = profile.tenant_id;

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('id, name, stripe_customer_id')
    .eq('id', tenantId)
    .single();

  if (tenantError || !tenant) {
    throw new Error('Tenant no encontrado');
  }

  const priceId = plan === 'basic' ? process.env.STRIPE_PRICE_BASIC : process.env.STRIPE_PRICE_PRO;

  if (!priceId) {
    throw new Error(`ID de precio para el plan ${plan} no configurado en las variables de entorno`);
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  let customerId = tenant.stripe_customer_id;

  if (!customerId) {
    // Create Stripe customer
    const customer = await stripe.customers.create({
      email: user.email,
      name: tenant.name,
      metadata: {
        tenant_id: tenantId,
      },
    });
    customerId = customer.id;

    // Save to tenant in Supabase
    const adminSupabase = createAdminClient();
    const { error: updateError } = await adminSupabase
      .from('tenants')
      .update({ stripe_customer_id: customerId })
      .eq('id', tenantId);

    if (updateError) {
      console.error('Error updating tenant stripe_customer_id:', updateError);
    }
  }

  // Create checkout session
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ['card'],
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    mode: 'subscription',
    success_url: `${appUrl}/dashboard/billing?success=true&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/dashboard/billing?canceled=true`,
    metadata: {
      tenant_id: tenantId,
      plan: plan,
    },
    subscription_data: {
      metadata: {
        tenant_id: tenantId,
        plan: plan,
      },
    },
  });

  return { url: session.url };
}

export async function createPortalSession() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error('No autenticado');
  }

  // Get user profile and tenant
  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('tenant_id')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) {
    throw new Error('Perfil de usuario no encontrado');
  }

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('stripe_customer_id')
    .eq('id', profile.tenant_id)
    .single();

  if (tenantError || !tenant || !tenant.stripe_customer_id) {
    throw new Error('No existe cliente de Stripe registrado');
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  const session = await stripe.billingPortal.sessions.create({
    customer: tenant.stripe_customer_id,
    return_url: `${appUrl}/dashboard/billing`,
  });

  return { url: session.url };
}
