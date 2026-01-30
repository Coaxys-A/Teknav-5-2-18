-- Migration: Add Billing Events (Idempotency Anchor)
-- Part 10.5 - Workstream 1

CREATE TABLE "billing_events" (
    "id" TEXT NOT NULL, -- Composite Key (provider + provider_event_id)
    "tenant_id" INTEGER NOT NULL,
    "provider" TEXT NOT NULL, -- 'stripe', 'lemon', 'paddle'
    "provider_event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "status" TEXT NOT NULL, -- 'PENDING', 'PROCESSED', 'FAILED'
    "raw_json" TEXT, -- Payload
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("id")
);

-- Index for fast lookup
CREATE INDEX "billing_events_provider_event_id_idx" ON "billing_events"("provider", "provider_event_id");

-- Trigger to prevent double insert if idempotency key exists
CREATE UNIQUE INDEX "billing_events_unique_provider_event" ON "billing_events"("provider", "provider_event_id");
