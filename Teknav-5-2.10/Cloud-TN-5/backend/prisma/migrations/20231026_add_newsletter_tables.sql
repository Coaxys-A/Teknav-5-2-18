-- Migration: Add Newsletter Tables
-- Part 10.5 - Workstream 1

CREATE TABLE "subscribers" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "workspace_id" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL, -- 'active', 'unsub', 'bounced', 'complained', 'cleaned'
    "preferences_json" JSONB,
    "metadata_json" JSONB, -- Source, Opt-in IP, etc.
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscribers_tenant_workspace_unique" UNIQUE ("tenant_id", "workspace_id", "email")
);

CREATE INDEX "subscribers_status_idx" ON "subscribers"("status");

CREATE TABLE "segments" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "workspace_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "query_json" JSONB NOT NULL, -- Query definition (Mongo-style or JSON-Logic)
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER, -- Actor
    "active" BOOLEAN NOT NULL DEFAULT true,
    "tenant_id" INTEGER NOT NULL,
    "workspace_id" INTEGER NOT NULL,

    PRIMARY KEY ("id")
);

CREATE TABLE "campaigns" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "workspace_id" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "body_json" JSONB NOT NULL, -- HTML/Content blocks
    "status" TEXT NOT NULL, -- 'draft', 'scheduled', 'sending', 'sent', 'cancelled'
    "scheduled_for" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER,
    "tenant_id" INTEGER NOT NULL,
    "workspace_id" INTEGER NOT NULL,
    "segment_id" INTEGER, -- Use Segment

    PRIMARY KEY ("id")
);

CREATE TABLE "send_jobs" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "status" TEXT NOT NULL, -- 'queued', 'processing', 'completed', 'failed'
    "total" INTEGER NOT NULL,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "provider_batch_id" TEXT, -- Provider reference
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenant_id" INTEGER NOT NULL,
    "workspace_id" INTEGER NOT NULL,

    PRIMARY KEY ("id"),
    CONSTRAINT "send_jobs_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE
);

CREATE INDEX "send_jobs_status_idx" ON "send_jobs"("status");

CREATE TABLE "send_events" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "workspace_id" INTEGER NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "subscriber_id" INTEGER,
    "type" TEXT NOT NULL, -- 'delivered', 'open', 'click', 'bounce', 'unsub'
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "meta_json" JSONB, -- { user_agent, ip, link_id, bounce_reason, complaint_type }
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenant_id" INTEGER NOT NULL,
    "workspace_id" INTEGER NOT NULL,
    "subscriber_id" INTEGER,
    "campaign_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL,

    PRIMARY KEY ("id"),
    CONSTRAINT "send_events_subscriber_campaign_fk" FOREIGN KEY ("subscriber_id", "campaign_id") REFERENCES "subscribers"("id"), "campaigns"("id") ON DELETE CASCADE
);

CREATE INDEX "send_events_type_idx" ON "send_events"("type");
CREATE INDEX "send_events_occurred_at_idx" ON "send_events"("occurred_at");

CREATE TABLE "suppression_list" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "workspace_id" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL, -- 'bounce', 'unsub', 'complaint', 'admin'
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenant_id" INTEGER NOT NULL,
    "workspace_id" INTEGER NOT NULL,

    PRIMARY KEY ("id"),
    CONSTRAINT "suppression_list_tenant_workspace_email_unique" UNIQUE ("tenant_id", "workspace_id", "email")
);
