# Stripe Integration Guide for Mentible

**Status:** Implementation Plan  
**Date:** 2026-09-23  
**Author:** Claude (Haiku 4.5)

---

## Overview

Integrate Stripe into the Mentible backend to handle:
- **Managed-key billing** (subscription + metered token allowance)
- **BYOK licensing** (optional: app subscription fee only, no token billing)
- **Invoice generation** (for token overages)
- **Webhook handling** (subscription state changes)

This replaces the dormant RevenueCat paywall. Stripe handles both web + mobile API-first.

---

## Architecture Decision

### Why Stripe

| Factor | Choice | Reason |
|--------|--------|--------|
| Payment processor | Stripe | 2.9%+$0.30/txn cheaper than RevenueCat (20%), API-first, web + mobile |
| Subscription model | Stripe Billing | Native metering (token usage), entitlement sync |
| Mobile IAP | Skip (for MVP) | Stripe API billing for all; IAP optional Phase 2 |
| Webhook sync | Stripe Webhooks | Sync subscription state to `user_entitlements` table |
| Currency | USD-only (MVP) | Single currency; multi-currency v1.2+ |

### Products & Prices

```
Stripe Products (create in dashboard or via API):

1. Mentible Managed Plan - Standard
   Price: $19/month
   Metering: 5,000 tokens/month included
   Overage: $0.001/token above limit
   Audience: Self-learners, small teams

2. Mentible Managed Plan - Pro
   Price: $49/month
   Metering: 25,000 tokens/month included
   Overage: $0.0008/token above limit
   Audience: SME studios, high-volume authors

3. Mentible BYOK License (optional)
   Price: $9.99/month OR $99/year
   Metering: None (user pays vendor directly)
   Audience: Power users with existing Anthropic account
```

---

## Database Schema

### New Tables / Migrations

```sql
-- 0031: Stripe subscription & metering
CREATE TABLE stripe_customers (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    stripe_customer_id VARCHAR(255) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE stripe_subscriptions (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    stripe_subscription_id VARCHAR(255) NOT NULL UNIQUE,
    stripe_price_id VARCHAR(255) NOT NULL,  -- Links to Stripe product
    plan_type VARCHAR(50) NOT NULL,  -- 'managed_standard', 'managed_pro', 'byok_license'
    status VARCHAR(50) NOT NULL,  -- 'active', 'past_due', 'canceled', 'unpaid'
    current_period_start TIMESTAMP,
    current_period_end TIMESTAMP,
    cancel_at TIMESTAMP,
    canceled_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_status CHECK (status IN ('active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired'))
);

CREATE TABLE stripe_usage_records (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    stripe_subscription_id VARCHAR(255) NOT NULL,
    tokens_used INT NOT NULL,
    overage_tokens INT NOT NULL DEFAULT 0,
    usage_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    stripe_meter_event_id VARCHAR(255) UNIQUE,  -- Idempotency key
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX (user_id, usage_timestamp),
    INDEX (stripe_subscription_id)
);

CREATE TABLE stripe_invoices (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    stripe_invoice_id VARCHAR(255) NOT NULL UNIQUE,
    stripe_customer_id VARCHAR(255) NOT NULL,
    amount_due BIGINT,  -- cents
    amount_paid BIGINT DEFAULT 0,
    currency VARCHAR(3) DEFAULT 'usd',
    status VARCHAR(50),  -- 'draft', 'open', 'paid', 'void', 'uncollectible'
    invoice_pdf_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX (user_id)
);

-- Amend user_entitlements (from ADR-005 Phase 1)
ALTER TABLE user_entitlements
ADD COLUMN stripe_subscription_id VARCHAR(255) REFERENCES stripe_subscriptions(stripe_subscription_id),
ADD COLUMN tokens_remaining INT,  -- Decrement per generation
ADD COLUMN tokens_per_period INT,  -- e.g., 5000 for Standard
ADD COLUMN period_end_date TIMESTAMP,
ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
```

---

## Backend Integration

### 1. Dependencies

```bash
# pyproject.toml
stripe>=7.0.0,<8.0.0
```

### 2. Configuration (`backend/src/core/config.py`)

```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # ... existing config ...
    
    # Stripe
    STRIPE_SECRET_KEY: str  # Required
    STRIPE_PUBLISHABLE_KEY: str  # For mobile/web client
    STRIPE_WEBHOOK_SECRET: str  # For webhook signature verification
    STRIPE_PRICE_MANAGED_STANDARD: str  # e.g., "price_1Ox..."
    STRIPE_PRICE_MANAGED_PRO: str
    STRIPE_PRICE_BYOK_LICENSE: str
    
    # Metering
    STRIPE_METER_EVENT_NAME: str = "tokens_consumed"  # Meter name in Stripe
    
    # URLs
    STRIPE_RETURN_URL_SUCCESS: str = "https://mentible.app/billing/success"
    STRIPE_RETURN_URL_CANCEL: str = "https://mentible.app/billing/cancel"
    
    class Config:
        env_file = ".env"
        extra = "ignore"
```

### 3. Stripe Client Wrapper (`backend/src/billing/stripe_client.py`)

```python
import stripe
from ..core.config import settings

stripe.api_key = settings.STRIPE_SECRET_KEY
stripe.api_version = "2024-04-10"  # Pin API version

class StripeClient:
    """Stripe API wrapper with idempotency & error handling."""
    
    @staticmethod
    async def create_customer(user_id: str, email: str) -> dict:
        """Create Stripe customer tied to user."""
        try:
            customer = stripe.Customer.create(
                email=email,
                metadata={"user_id": str(user_id)},
                idempotency_key=f"user_{user_id}",  # Idempotency
            )
            return customer
        except stripe.error.CardError as e:
            raise StripeError(f"Card declined: {e.user_message}")
        except stripe.error.StripeError as e:
            raise StripeError(f"Stripe error: {str(e)}")
    
    @staticmethod
    async def create_subscription(
        customer_id: str,
        price_id: str,
        user_id: str,
    ) -> dict:
        """Create subscription for customer."""
        subscription = stripe.Subscription.create(
            customer=customer_id,
            items=[{"price": price_id}],
            payment_behavior="default_incomplete",
            expand=["latest_invoice.payment_intent"],
            metadata={"user_id": str(user_id)},
            idempotency_key=f"sub_{user_id}_{price_id}",
        )
        return subscription
    
    @staticmethod
    async def record_usage(
        subscription_id: str,
        tokens_used: int,
        idempotency_key: str,
    ) -> dict:
        """Record token usage as meter event (metering billing)."""
        meter_event = stripe.billing.MeterEvent.create(
            event_name=settings.STRIPE_METER_EVENT_NAME,
            timestamp=int(time.time()),
            identifier=subscription_id,
            value=tokens_used,
            idempotency_key=idempotency_key,  # Prevent duplicates
        )
        return meter_event
    
    @staticmethod
    async def cancel_subscription(subscription_id: str, at_period_end: bool = True) -> dict:
        """Cancel subscription (at end of period or immediately)."""
        subscription = stripe.Subscription.modify(
            subscription_id,
            cancel_at_period_end=at_period_end,
        )
        return subscription
    
    @staticmethod
    async def retrieve_invoice(invoice_id: str) -> dict:
        """Fetch invoice details + PDF URL."""
        invoice = stripe.Invoice.retrieve(invoice_id)
        return invoice
    
    @staticmethod
    async def verify_webhook_signature(body: bytes, sig_header: str) -> dict:
        """Verify webhook came from Stripe (not forged)."""
        try:
            event = stripe.Webhook.construct_event(
                body, sig_header, settings.STRIPE_WEBHOOK_SECRET
            )
            return event
        except ValueError:
            raise WebhookError("Invalid webhook payload")
        except stripe.error.SignatureVerificationError:
            raise WebhookError("Invalid signature")
```

### 4. Billing Service (`backend/src/billing/stripe_service.py`)

```python
from sqlalchemy.ext.asyncio import AsyncSession
from ..auth.deps import get_current_user
from ..core.db import get_async_session
from .stripe_client import StripeClient
from .models import StripeCustomer, StripeSubscription, StripeUsageRecord

class StripeService:
    """Business logic: subscriptions, metering, entitlements."""
    
    @staticmethod
    async def get_or_create_customer(
        db: AsyncSession, user_id: str, email: str
    ) -> StripeCustomer:
        """Fetch or create Stripe customer for user."""
        customer_row = await db.execute(
            select(StripeCustomer).where(StripeCustomer.user_id == user_id)
        )
        existing = customer_row.scalar_one_or_none()
        
        if existing:
            return existing
        
        stripe_customer = await StripeClient.create_customer(user_id, email)
        db_customer = StripeCustomer(
            user_id=user_id,
            stripe_customer_id=stripe_customer.id,
            email=email,
        )
        db.add(db_customer)
        await db.commit()
        return db_customer
    
    @staticmethod
    async def start_subscription(
        db: AsyncSession,
        user_id: str,
        plan_type: str,  # 'managed_standard', 'managed_pro', 'byok_license'
    ) -> dict:
        """Create subscription checkout session."""
        # Get or create customer
        account = await get_account(db, user_id)  # Assumes account table exists
        customer = await StripeService.get_or_create_customer(
            db, user_id, account.email
        )
        
        # Map plan to Stripe price
        price_map = {
            'managed_standard': settings.STRIPE_PRICE_MANAGED_STANDARD,
            'managed_pro': settings.STRIPE_PRICE_MANAGED_PRO,
            'byok_license': settings.STRIPE_PRICE_BYOK_LICENSE,
        }
        
        if plan_type not in price_map:
            raise ValueError(f"Invalid plan type: {plan_type}")
        
        # Create Checkout Session (redirect user to pay)
        session = stripe.checkout.Session.create(
            customer=customer.stripe_customer_id,
            line_items=[
                {
                    "price": price_map[plan_type],
                    "quantity": 1,
                }
            ],
            mode="subscription",
            success_url=settings.STRIPE_RETURN_URL_SUCCESS,
            cancel_url=settings.STRIPE_RETURN_URL_CANCEL,
            metadata={"user_id": str(user_id), "plan_type": plan_type},
        )
        
        return {"checkout_url": session.url, "session_id": session.id}
    
    @staticmethod
    async def record_token_usage(
        db: AsyncSession,
        user_id: str,
        tokens_used: int,
    ) -> None:
        """Record token usage as Stripe meter event + decrement allowance."""
        # Get active subscription
        subscription = await db.execute(
            select(StripeSubscription).where(
                StripeSubscription.user_id == user_id,
                StripeSubscription.status == "active",
            )
        )
        sub_row = subscription.scalar_one_or_none()
        
        if not sub_row:
            # User on free tier or no subscription → no metering
            return
        
        # Record meter event in Stripe (async, for billing)
        idempotency_key = f"{sub_row.id}_{int(time.time())}_{tokens_used}"
        await StripeClient.record_usage(
            subscription_id=sub_row.stripe_subscription_id,
            tokens_used=tokens_used,
            idempotency_key=idempotency_key,
        )
        
        # Decrement local allowance (for real-time UI feedback)
        entitlement = await db.execute(
            select(UserEntitlements).where(UserEntitlements.user_id == user_id)
        )
        ent_row = entitlement.scalar_one_or_none()
        
        if ent_row:
            ent_row.tokens_remaining = max(0, ent_row.tokens_remaining - tokens_used)
            await db.commit()
    
    @staticmethod
    async def handle_subscription_updated(
        db: AsyncSession,
        stripe_subscription_id: str,
        event: dict,  # Stripe webhook event
    ) -> None:
        """Sync subscription state after Stripe update (payment failed, etc.)."""
        subscription_obj = event["data"]["object"]
        
        # Update DB
        subscription = await db.execute(
            select(StripeSubscription).where(
                StripeSubscription.stripe_subscription_id == stripe_subscription_id
            )
        )
        sub_row = subscription.scalar_one_or_none()
        
        if sub_row:
            sub_row.status = subscription_obj["status"]
            sub_row.current_period_start = datetime.fromtimestamp(
                subscription_obj["current_period_start"]
            )
            sub_row.current_period_end = datetime.fromtimestamp(
                subscription_obj["current_period_end"]
            )
            await db.commit()
            
            # Notify user (email, push, etc.)
            if subscription_obj["status"] == "past_due":
                await send_payment_failed_email(sub_row.user_id)
```

### 5. API Routes (`backend/src/billing/router.py`)

```python
from fastapi import APIRouter, Depends, Request, HTTPException
from ..auth.deps import require_auth
from .stripe_service import StripeService
from .stripe_client import StripeClient

router = APIRouter(prefix="/api/v1/billing", tags=["billing"])

@router.post("/subscribe/{plan_type}")
async def create_subscription(
    plan_type: str,
    current_user = Depends(require_auth),
    db = Depends(get_async_session),
):
    """Start subscription checkout. Returns Stripe Checkout session URL."""
    try:
        result = await StripeService.start_subscription(db, current_user.id, plan_type)
        return {"checkout_url": result["checkout_url"]}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/cancel-subscription")
async def cancel_subscription(
    current_user = Depends(require_auth),
    db = Depends(get_async_session),
):
    """Cancel subscription at end of current period."""
    subscription = await db.execute(
        select(StripeSubscription).where(
            StripeSubscription.user_id == current_user.id,
            StripeSubscription.status == "active",
        )
    )
    sub_row = subscription.scalar_one_or_none()
    
    if not sub_row:
        raise HTTPException(status_code=404, detail="No active subscription")
    
    await StripeClient.cancel_subscription(sub_row.stripe_subscription_id, at_period_end=True)
    return {"message": "Subscription canceled at period end"}

@router.get("/subscription-info")
async def get_subscription_info(
    current_user = Depends(require_auth),
    db = Depends(get_async_session),
):
    """Get user's subscription status + token allowance."""
    subscription = await db.execute(
        select(StripeSubscription).where(StripeSubscription.user_id == current_user.id)
    )
    sub_row = subscription.scalar_one_or_none()
    
    if not sub_row:
        return {"plan": "free", "tokens_remaining": None}
    
    entitlement = await db.execute(
        select(UserEntitlements).where(UserEntitlements.user_id == current_user.id)
    )
    ent_row = entitlement.scalar_one_or_none()
    
    return {
        "plan": sub_row.plan_type,
        "status": sub_row.status,
        "tokens_remaining": ent_row.tokens_remaining if ent_row else 0,
        "tokens_per_period": ent_row.tokens_per_period if ent_row else 0,
        "period_end": sub_row.current_period_end,
    }

@router.post("/webhook")
async def stripe_webhook(
    request: Request,
    db = Depends(get_async_session),
):
    """Stripe webhook endpoint (subscription.updated, invoice.* events)."""
    body = await request.body()
    sig_header = request.headers.get("stripe-signature")
    
    try:
        event = StripeClient.verify_webhook_signature(body, sig_header)
    except WebhookError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    # Route event
    if event["type"] == "customer.subscription.updated":
        subscription_id = event["data"]["object"]["id"]
        await StripeService.handle_subscription_updated(db, subscription_id, event)
    
    elif event["type"] == "invoice.payment_succeeded":
        # Log successful payment
        pass
    
    elif event["type"] == "invoice.payment_failed":
        # Alert user
        pass
    
    return {"status": "received"}
```

### 6. Integrate into `/generate` Flow

Modify `backend/src/generate/router.py` to record token usage:

```python
from ..billing.stripe_service import StripeService

@router.post("/generate")
async def generate(
    request: GenerateRequest,
    current_user = Depends(require_auth),  # Now required
    db = Depends(get_async_session),
):
    """Generate lesson. Record token usage for billing."""
    
    # ... existing validation ...
    
    # Call LLM
    lesson_json = await call_anthropic(request, api_key=...)
    tokens_used = lesson_json["usage"]["input_tokens"] + lesson_json["usage"]["output_tokens"]
    
    # Record usage (metering)
    await StripeService.record_token_usage(db, current_user.id, tokens_used)
    
    # Return lesson
    return {"lesson": lesson_json["content"]}
```

---

## Mobile Integration

### 1. Fetch Checkout URL

```typescript
// mobile/src/api/billingClient.ts
export async function startSubscription(
  planType: "managed_standard" | "managed_pro" | "byok_license"
): Promise<string> {
  const response = await apiClient.post(
    `/billing/subscribe/${planType}`,
    {}
  );
  return response.data.checkout_url;
}
```

### 2. Open Checkout (Web View)

```typescript
// mobile/src/screens/Settings.tsx
import { WebView } from "react-native-webview";

export function SubscribeButton({ planType }) {
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);

  const handleSubscribe = async () => {
    const url = await startSubscription(planType);
    setCheckoutUrl(url);
  };

  if (checkoutUrl) {
    return (
      <WebView
        source={{ uri: checkoutUrl }}
        onNavigationStateChange={(navState) => {
          if (navState.url.includes("/billing/success")) {
            setCheckoutUrl(null);
            // Refresh subscription info
            await refetchSubscription();
          }
        }}
      />
    );
  }

  return <Button onPress={handleSubscribe}>Subscribe to {planType}</Button>;
}
```

### 3. Display Token Usage

```typescript
// mobile/src/components/UsageMeter.tsx
export function UsageMeter() {
  const subscription = useSubscriptionInfo();

  if (!subscription) return null;

  const remaining = subscription.tokens_remaining;
  const total = subscription.tokens_per_period;
  const percent = (remaining / total) * 100;

  return (
    <View>
      <Text>{remaining} / {total} tokens</Text>
      <ProgressBar value={percent} />
    </View>
  );
}
```

---

## Web Integration

### 1. Settings → Billing Tab

```typescript
// web/src/components/BillingTab.tsx
export function BillingTab() {
  const [subscription, setSubscription] = useState(null);

  useEffect(() => {
    fetch("/api/v1/billing/subscription-info")
      .then(r => r.json())
      .then(setSubscription);
  }, []);

  if (!subscription) return <Skeleton />;

  return (
    <div>
      <h2>Billing Plan</h2>
      <p>Current: {subscription.plan}</p>
      <p>
        Tokens: {subscription.tokens_remaining} / {subscription.tokens_per_period}
      </p>
      <button onClick={() => window.location.href = "/api/v1/billing/subscribe/managed_pro"}>
        Upgrade
      </button>
      <button onClick={() => fetch("/api/v1/billing/cancel-subscription", { method: "POST" })}>
        Cancel
      </button>
    </div>
  );
}
```

---

## Webhook Setup

### 1. Configure in Stripe Dashboard

1. Go to **Developers** → **Webhooks**
2. Click **Add Endpoint**
3. URL: `https://mambakkam.net/mentible-api/api/v1/billing/webhook`
4. Events to send:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.created`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. Copy **Signing Secret** → set `STRIPE_WEBHOOK_SECRET` in `.env`

### 2. Test Locally

```bash
# Terminal 1: Run backend
cd backend && uvicorn main:app --reload

# Terminal 2: Forward Stripe events to localhost
stripe listen --forward-to localhost:8000/api/v1/billing/webhook

# Terminal 3: Trigger test event
stripe trigger customer.subscription.created
```

---

## Testing

### Unit Tests

```python
# backend/tests/test_stripe_service.py
import pytest
from unittest.mock import patch, AsyncMock
from sqlalchemy.ext.asyncio import AsyncSession

@pytest.mark.asyncio
async def test_record_token_usage(db: AsyncSession):
    """Verify meter event sent to Stripe."""
    user_id = uuid.uuid4()
    
    # Setup: create mock subscription
    subscription = StripeSubscription(
        user_id=user_id,
        stripe_subscription_id="sub_12345",
        status="active",
    )
    db.add(subscription)
    await db.commit()
    
    # Test
    with patch("stripe.billing.MeterEvent.create") as mock_meter:
        mock_meter.return_value = AsyncMock()
        await StripeService.record_token_usage(db, user_id, tokens_used=1000)
    
    mock_meter.assert_called_once()
    call_kwargs = mock_meter.call_args.kwargs
    assert call_kwargs["value"] == 1000
    assert call_kwargs["identifier"] == "sub_12345"

@pytest.mark.asyncio
async def test_webhook_signature_verification():
    """Verify webhook validation rejects forged events."""
    from .stripe_client import WebhookError
    
    with pytest.raises(WebhookError):
        StripeClient.verify_webhook_signature(
            b"fake body",
            "bad signature",
        )
```

### Integration Tests

```bash
# Test against Stripe test mode (no charges)
export STRIPE_SECRET_KEY=sk_test_...

cd backend
pytest tests/test_stripe_service.py -v
```

### E2E Tests (Manual)

1. Use Stripe test card: `4242 4242 4242 4242` (any future expiry)
2. Subscribe to Standard plan
3. Verify subscription created in DB
4. Generate a lesson (call `/generate`)
5. Check `stripe_usage_records` table
6. Verify invoice generated after usage
7. Cancel subscription
8. Verify `cancel_at_period_end` honored

---

## Deployment Checklist

- [ ] Add `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` to `.env.prod`
- [ ] Run migration `0031` on prod DB
- [ ] Deploy backend to prod (`git push origin main` → auto-deploy)
- [ ] Test webhook endpoint is reachable: `curl -I https://mambakkam.net/mentible-api/api/v1/billing/webhook`
- [ ] Configure Stripe webhook in dashboard (endpoint URL + signing secret)
- [ ] Test Stripe test mode end-to-end (checkout, meter, invoice)
- [ ] Set up payment method on Stripe (to cover metering costs to Anthropic)
- [ ] Enable Stripe live mode in production Stripe account
- [ ] Update Settings → Billing tab UI on web + mobile
- [ ] Add Help topic: "Subscription & Billing" (per Definition of Done)

---

## Deferred (Phase 2+)

- [ ] Mobile native IAP (iOS + Android) instead of web checkout
- [ ] Multi-currency support
- [ ] Usage discounts (annual prepay, volume)
- [ ] Refund policy automation
- [ ] Fraud detection (Radar)
- [ ] Per-provider credential management in billing (ADR-014)

---

## References

- **Stripe API Docs:** https://stripe.com/docs/api
- **Stripe Metering (Billing Meters):** https://stripe.com/docs/billing/meter-billing
- **Stripe Webhooks:** https://stripe.com/docs/webhooks
- **Checkout Sessions:** https://stripe.com/docs/payments/checkout
- **ADR-005:** Multi-provider LLM support + metering design
- **CLAUDE.md D17:** Product pricing model

---

## Questions / Gotchas

**Q: What if a user is on BYOK? Do they pay for subscriptions?**  
A: Per D17, BYOK users pay for the app fee only (e.g., `byok_license` plan, $9.99/month). Token costs are theirs (they pay Anthropic directly). Managed users pay for the subscription, which includes a token allowance.

**Q: How do we prevent token exhaustion mid-generation?**  
A: Check `tokens_remaining` **before** starting `/generate`. If insufficient, return 402 "Insufficient tokens" + prompt upgrade. Exact check TBD (e.g., 2000-token buffer).

**Q: Do we need to handle failed payments?**  
A: Yes. Stripe sets subscription to `past_due` → webhook fires → we email user + disable generation. Re-enable on payment success.

**Q: Can users downgrade mid-period?**  
A: Yes, via `cancel-subscription` endpoint. Stripe prorates the refund (if applicable). Entitlements drop to free tier immediately (or next period, depending on policy).

---

**Author:** Claude (Haiku 4.5)  
**Next Steps:** Review with team, adjust per-plan token allowances, then implement Phase 1 (checkout flow only; Phase 2 = admin dashboards + analytics).
