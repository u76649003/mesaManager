import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'dummy_key_for_build_time');

async function updateTenantSubscription(subscription: any) {
  const adminSupabase = createAdminClient();
  const customerId = subscription.customer as string;
  const tenantId = subscription.metadata?.tenant_id;

  // Determine the plan
  const priceId = subscription.items.data[0]?.price.id;
  let plan: 'basic' | 'pro' | 'trial' = 'basic';
  if (priceId === process.env.STRIPE_PRICE_PRO || subscription.metadata?.plan === 'pro') {
    plan = 'pro';
  } else if (priceId === process.env.STRIPE_PRICE_BASIC || subscription.metadata?.plan === 'basic') {
    plan = 'basic';
  }

  // Determine status
  let status: 'active' | 'inactive' | 'past_due' | 'cancelled' = 'inactive';
  if (subscription.status === 'active' || subscription.status === 'trialing') {
    status = 'active';
  } else if (subscription.status === 'past_due') {
    status = 'past_due';
  } else if (subscription.status === 'canceled' || subscription.status === 'unpaid') {
    status = 'cancelled';
  }

  const endsAt = subscription.current_period_end 
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;

  // Update query
  let query = adminSupabase.from('tenants').update({
    subscription_plan: plan,
    subscription_status: status,
    subscription_ends_at: endsAt,
    stripe_subscription_id: subscription.id,
    stripe_customer_id: customerId,
  });

  if (tenantId) {
    query = query.eq('id', tenantId);
  } else {
    query = query.eq('stripe_customer_id', customerId);
  }

  const { error } = await query;
  if (error) {
    console.error('Error updating tenant subscription in Supabase:', error);
    throw error;
  }
  console.log(`Successfully updated tenant. Plan: ${plan}, Status: ${status}`);
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error('Stripe webhook error:', err);
    return NextResponse.json({ error: 'Invalid signature: ' + err.message }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as any;
        await updateTenantSubscription(subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as any;
        await updateTenantSubscription(subscription);
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as any;
        if (invoice.subscription) {
          const subscription = await stripe.subscriptions.retrieve(invoice.subscription as string);
          await updateTenantSubscription(subscription as any);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as any;
        if (invoice.subscription) {
          const subscription = await stripe.subscriptions.retrieve(invoice.subscription as string);
          await updateTenantSubscription(subscription as any);
        }
        break;
      }

      default:
        console.log('Unhandled Stripe event:', event.type);
    }
  } catch (error: any) {
    console.error(`Error processing webhook event ${event.type}:`, error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
