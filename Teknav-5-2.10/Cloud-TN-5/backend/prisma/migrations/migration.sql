-- TekNav Upgrade: Tenant Isolation + Billing Idempotency + Workflow Versioning + Plugin Manifest
-- Version: 2023-10-01_00_init_tenant_upgrade
--
-- This migration aligns the database with the new 'TekNav 0→100' Schema.
-- It adds missing columns for Tenancy, Billing, Workflows, Plugins, and Analytics.
-- It enforces unique constraints for idempotency and tenant isolation.
--
-- IMPORTANT: Run this migration on a staging database first.

BEGIN;

-- 1. TENANCY & IDENTITY (Requirement A + B)
-- ----------------------------------------------------------------

-- Upgrade Tenant Table
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "status" VARCHAR(255) DEFAULT 'ACTIVE';
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "planTier" VARCHAR(255) DEFAULT 'FREE';
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "domain" VARCHAR(255);
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT NOW();

-- Create Tenant Index for Domain Lookup (M0)
CREATE INDEX IF NOT EXISTS "idx_tenant_domain" ON "Tenant"("domain");

-- Upgrade Workspace Table (Requirement B - Multi-site/Agency)
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "slug" VARCHAR(255);
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "defaultLocale" VARCHAR(255) DEFAULT 'en';
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT NOW();
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) DEFAULT NOW();

-- Enforce Unique Slug per Tenant (Requirement B)
CREATE UNIQUE INDEX IF NOT EXISTS "unique_workspace_tenant_slug" ON "Workspace"("tenantId", "slug");

-- 2. MEMBERSHIP & BILLING (Requirement A + B)
-- ----------------------------------------------------------------

-- Upgrade WorkspaceMember Table
ALTER TABLE "WorkspaceMember" ADD COLUMN IF NOT EXISTS "tenantId" INT NOT NULL DEFAULT 0;
ALTER TABLE "WorkspaceMember" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT NOW();
ALTER TABLE "WorkspaceMember" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) DEFAULT NOW();

-- Enforce Unique Membership (Requirement A)
-- Note: Existing table likely has `userId`, `workspaceId`. We add `tenantId`.
CREATE UNIQUE INDEX IF NOT EXISTS "unique_workspace_member_tenant_ws_user" ON "WorkspaceMember"("tenantId", "workspaceId", "userId");

-- Upgrade Plan Table
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "featuresJson" JSONB;
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "active" BOOLEAN DEFAULT true;
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT NOW();
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) DEFAULT NOW();
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "tenantId" INT;
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "workspaceId" INT;

-- Enforce Unique Plan per Workspace (Requirement B)
CREATE UNIQUE INDEX IF NOT EXISTS "unique_plan_tenant_ws" ON "Plan"("tenantId", "workspaceId");

-- Upgrade Subscription Table
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "status" VARCHAR(255) DEFAULT 'PENDING';
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3) DEFAULT NOW();
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "currentPeriodEnd" TIMESTAMP(3);
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "cancelAtPeriodEnd" BOOLEAN DEFAULT false;
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "planId" INT;
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "userId" INT;
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "workspaceId" INT;
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "tenantId" INT;

-- Enforce Unique Subscription per Tenant Workspace User (Requirement B)
CREATE UNIQUE INDEX IF NOT EXISTS "unique_subscription_tenant_ws_user" ON "Subscription"("tenantId", "workspaceId", "userId");

-- Upgrade Payment Table
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "provider" VARCHAR(255);
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "providerPaymentId" VARCHAR(255);
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "amountCents" INT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "currency" VARCHAR(255);
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "status" VARCHAR(255) DEFAULT 'PENDING';
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT NOW();
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "tenantId" INT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "subscriptionId" INT;

-- Create BillingEvent Store (Requirement A - Idempotency)
-- Assuming table exists or we create stub. Prompt implies existing.
-- We will add columns if table exists, or create table if not.
-- For safety in migration, we assume CREATE TABLE IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS "BillingEvent" (
  "id" SERIAL PRIMARY KEY,
  "tenantId" INT NOT NULL,
  "providerEventId" VARCHAR(255) NOT NULL,
  "type" VARCHAR(255),
  "receivedAt" TIMESTAMP(3) DEFAULT NOW(),
  "processedAt" TIMESTAMP(3),
  "status" VARCHAR(255) DEFAULT 'PENDING',
  "rawJson" JSONB
);

-- Enforce Unique Provider Event (Requirement A)
CREATE UNIQUE INDEX IF NOT EXISTS "unique_billing_event_tenant_provider" ON "BillingEvent"("tenantId", "providerEventId");

-- Create Entitlement Table (Requirement A)
CREATE TABLE IF NOT EXISTS "Entitlement" (
  "id" SERIAL PRIMARY KEY,
  "tenantId" INT NOT NULL,
  "userId" INT,
  "key" VARCHAR(255) NOT NULL,
  "value" JSONB,
  "validFrom" TIMESTAMP(3) DEFAULT NOW(),
  "validTo" TIMESTAMP(3)
);

CREATE UNIQUE INDEX IF NOT EXISTS "unique_entitlement_tenant_user_key" ON "Entitlement"("tenantId", "userId", "key");

-- 3. CONTENT & WORKFLOW (Requirement A + D)
-- ----------------------------------------------------------------

-- Upgrade Article Table
ALTER TABLE "Article" ADD COLUMN IF NOT EXISTS "tenantId" INT NOT NULL DEFAULT 0;
ALTER TABLE "Article" ADD COLUMN IF NOT EXISTS "workspaceId" INT NOT NULL DEFAULT 0;
ALTER TABLE "Article" ADD COLUMN IF NOT EXISTS "type" VARCHAR(255) DEFAULT 'POST';
ALTER TABLE "Article" ADD COLUMN IF NOT EXISTS "status" VARCHAR(255) DEFAULT 'DRAFT';
ALTER TABLE "Article" ADD COLUMN IF NOT EXISTS "locale" VARCHAR(255) DEFAULT 'en';
ALTER TABLE "Article" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "Article" ADD COLUMN IF NOT EXISTS "excerpt" TEXT;
ALTER TABLE "Article" ADD COLUMN IF NOT EXISTS "content" TEXT;
ALTER TABLE "Article" ADD COLUMN IF NOT EXISTS "publishedAt" TIMESTAMP(3);
ALTER TABLE "Article" ADD COLUMN IF NOT EXISTS "scheduledFor" TIMESTAMP(3);
ALTER TABLE "Article" ADD COLUMN IF NOT EXISTS "changedBy" INT;
ALTER TABLE "Article" ADD COLUMN IF NOT EXISTS "changedAt" TIMESTAMP(3) DEFAULT NOW();
ALTER TABLE "Article" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT NOW();
ALTER TABLE "Article" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

-- Upgrade ArticleVersion Table
ALTER TABLE "ArticleVersion" ADD COLUMN IF NOT EXISTS "tenantId" INT NOT NULL DEFAULT 0;
ALTER TABLE "ArticleVersion" ADD COLUMN IF NOT EXISTS "articleId" INT NOT NULL;
ALTER TABLE "ArticleVersion" ADD COLUMN IF NOT EXISTS "versionTitle" TEXT;
ALTER TABLE "ArticleVersion" ADD COLUMN IF NOT EXISTS "content" TEXT;
ALTER TABLE "ArticleVersion" ADD COLUMN IF NOT EXISTS "excerpt" TEXT;
ALTER TABLE "ArticleVersion" ADD COLUMN IF NOT EXISTS "createdBy" INT;
ALTER TABLE "ArticleVersion" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT NOW();

-- Upgrade EditorComment Table (Requirement D - Inline Comments)
ALTER TABLE "EditorComment" ADD COLUMN IF NOT EXISTS "tenantId" INT NOT NULL DEFAULT 0;
ALTER TABLE "EditorComment" ADD COLUMN IF NOT EXISTS "articleId" INT NOT NULL;
ALTER TABLE "EditorComment" ADD COLUMN IF NOT EXISTS "versionId" INT;
ALTER TABLE "EditorComment" ADD COLUMN IF NOT EXISTS "anchor" TEXT;
ALTER TABLE "EditorComment" ADD COLUMN IF NOT EXISTS "body" TEXT;
ALTER TABLE "EditorComment" ADD COLUMN IF NOT EXISTS "status" VARCHAR(255) DEFAULT 'ACTIVE';
ALTER TABLE "EditorComment" ADD COLUMN IF NOT EXISTS "createdBy" INT;
ALTER TABLE "EditorComment" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT NOW();

-- Upgrade ArticleTranslation Table (Requirement M1 - Translation Matrix)
CREATE TABLE IF NOT EXISTS "ArticleTranslation" (
  "id" SERIAL PRIMARY KEY,
  "tenantId" INT NOT NULL,
  "articleId" INT NOT NULL,
  "locale" TEXT NOT NULL,
  "status" VARCHAR(255) DEFAULT 'DRAFT',
  "title" TEXT,
  "content" TEXT,
  "publishedAt" TIMESTAMP(3),
  "changedBy" INT,
  "changedAt" TIMESTAMP(3) DEFAULT NOW()
);

-- Enforce Unique Translation per Article/Locale
CREATE UNIQUE INDEX IF NOT EXISTS "unique_article_translation_article_locale" ON "ArticleTranslation"("articleId", "locale");

-- Upgrade WorkflowDefinition Table (Requirement D - Workflow Engine)
CREATE TABLE IF NOT EXISTS "WorkflowDefinition" (
  "id" SERIAL PRIMARY KEY,
  "tenantId" INT NOT NULL,
  "workspaceId" INT NOT NULL,
  "contentType" VARCHAR(255),
  "jsonDefinition" JSONB,
  "version" VARCHAR(255) DEFAULT 'v1',
  "active" BOOLEAN DEFAULT true,
  "createdAt" TIMESTAMP(3) DEFAULT NOW(),
  "updatedAt" TIMESTAMP(3) DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_workflow_def_tenant_ws_content" ON "WorkflowDefinition"("tenantId", "workspaceId", "contentType", "active");

-- Upgrade WorkflowInstance Table
CREATE TABLE IF NOT EXISTS "WorkflowInstance" (
  "id" SERIAL PRIMARY KEY,
  "tenantId" INT NOT NULL,
  "contentId" INT NOT NULL,
  "definitionId" INT NOT NULL,
  "state" VARCHAR(255),
  "startedAt" TIMESTAMP(3) DEFAULT NOW(),
  "finishedAt" TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS "idx_workflow_instance_tenant_content" ON "WorkflowInstance"("tenantId", "contentId");

-- Upgrade WorkflowTask Table (Requirement D - Tasks)
CREATE TABLE IF NOT EXISTS "WorkflowTask" (
  "id" SERIAL PRIMARY KEY,
  "tenantId" INT NOT NULL,
  "runId" INT NOT NULL,
  "type" VARCHAR(255),
  "assigneeId" INT,
  "status" VARCHAR(255),
  "dueAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_workflow_task_run_status" ON "WorkflowTask"("runId", "status");

-- 4. MEDIA (Requirement A + D)
-- ----------------------------------------------------------------

-- Upgrade File Table
ALTER TABLE "File" ADD COLUMN IF NOT EXISTS "tenantId" INT NOT NULL DEFAULT 0;
ALTER TABLE "File" ADD COLUMN IF NOT EXISTS "workspaceId" INT NOT NULL DEFAULT 0;
ALTER TABLE "File" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "File" ADD COLUMN IF NOT EXISTS "url" TEXT;
ALTER TABLE "File" ADD COLUMN IF NOT EXISTS "mimeType" VARCHAR(255);
ALTER TABLE "File" ADD COLUMN IF NOT EXISTS "size" BIGINT;
ALTER TABLE "File" ADD COLUMN IF NOT EXISTS "uploadedBy" INT;
ALTER TABLE "File" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT NOW();
ALTER TABLE "File" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "File" ADD COLUMN IF NOT EXISTS "metadata" JSONB;

-- Upgrade MediaAsset Table
ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "tenantId" INT NOT NULL DEFAULT 0;
ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "workspaceId" INT NOT NULL DEFAULT 0;
ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "fileId" INT;
ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "kind" VARCHAR(255) DEFAULT 'FILE';
ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "originalUrl" TEXT;
ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "altText" TEXT;
ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "caption" TEXT;
ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "tags" TEXT[] DEFAULT '{}';
ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "folder" VARCHAR(255) DEFAULT 'root';
ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "metadata" JSONB;
ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT NOW();

-- 5. NEWSLETTER (Requirement A + D)
-- ----------------------------------------------------------------

-- Upgrade Subscriber Table
ALTER TABLE "Subscriber" ADD COLUMN IF NOT EXISTS "status" VARCHAR(255) DEFAULT 'ACTIVE';
ALTER TABLE "Subscriber" ADD COLUMN IF NOT EXISTS "preferencesJson" JSONB;
ALTER TABLE "Subscriber" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT NOW();

-- Enforce Unique Subscriber (Requirement A)
CREATE UNIQUE INDEX IF NOT EXISTS "unique_subscriber_tenant_ws_email" ON "Subscriber"("tenantId", "workspaceId", "email");

-- Upgrade Segment Table
CREATE TABLE IF NOT EXISTS "Segment" (
  "id" SERIAL PRIMARY KEY,
  "tenantId" INT NOT NULL,
  "workspaceId" INT NOT NULL,
  "name" TEXT,
  "queryJson" JSONB,
  "createdAt" TIMESTAMP(3) DEFAULT NOW()
);

-- Upgrade Campaign Table
CREATE TABLE IF NOT EXISTS "Campaign" (
  "id" SERIAL PRIMARY KEY,
  "tenantId" INT NOT NULL,
  "workspaceId" INT NOT NULL,
  "subject" TEXT,
  "bodyJson" JSONB,
  "status" VARCHAR(255) DEFAULT 'DRAFT',
  "scheduledFor" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) DEFAULT NOW()
);

-- Upgrade SendJob Table
CREATE TABLE IF NOT EXISTS "SendJob" (
  "id" SERIAL PRIMARY KEY,
  "tenantId" INT NOT NULL,
  "campaignId" INT NOT NULL,
  "status" VARCHAR(255) DEFAULT 'QUEUED',
  "total" INT,
  "sent" INT DEFAULT 0,
  "failed" INT DEFAULT 0,
  "providerBatchId" TEXT,
  "createdAt" TIMESTAMP(3) DEFAULT NOW()
);

-- Upgrade SendEvent Table
CREATE TABLE IF NOT EXISTS "SendEvent" (
  "id" SERIAL PRIMARY KEY,
  "tenantId" INT NOT NULL,
  "campaignId" INT NOT NULL,
  "subscriberId" INT NOT NULL,
  "type" VARCHAR(255),
  "occurredAt" TIMESTAMP(3) DEFAULT NOW(),
  "metaJson" JSONB
);

-- Upgrade SuppressionList Table
CREATE TABLE IF NOT EXISTS "SuppressionList" (
  "id" SERIAL PRIMARY KEY,
  "tenantId" INT NOT NULL,
  "email" TEXT,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) DEFAULT NOW()
);

-- Enforce Unique Suppression
CREATE UNIQUE INDEX IF NOT EXISTS "unique_suppression_tenant_email" ON "SuppressionList"("tenantId", "email");

-- 6. ANALYTICS & AUDIT (Requirement A)
-- ----------------------------------------------------------------

-- Upgrade EventsRaw Table
ALTER TABLE "EventsRaw" ADD COLUMN IF NOT EXISTS "tenantId" INT NOT NULL DEFAULT 0;
ALTER TABLE "EventsRaw" ADD COLUMN IF NOT EXISTS "type" VARCHAR(255);
ALTER TABLE "EventsRaw" ADD COLUMN IF NOT EXISTS "occurredAt" TIMESTAMP(3) DEFAULT NOW();
ALTER TABLE "EventsRaw" ADD COLUMN IF NOT EXISTS "actorId" INT;
ALTER TABLE "EventsRaw" ADD COLUMN IF NOT EXISTS "objectId" INT;
ALTER TABLE "EventsRaw" ADD COLUMN IF NOT EXISTS "objectType" VARCHAR(255);
ALTER TABLE "EventsRaw" ADD COLUMN IF NOT EXISTS "propertiesJson" JSONB;
ALTER TABLE "EventsRaw" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) DEFAULT NOW();

-- Upgrade MetricsDaily Table
ALTER TABLE "MetricsDaily" ADD COLUMN IF NOT EXISTS "tenantId" INT NOT NULL DEFAULT 0;
ALTER TABLE "MetricsDaily" ADD COLUMN IF NOT EXISTS "date" TIMESTAMP(3) DEFAULT NOW();
ALTER TABLE "MetricsDaily" ADD COLUMN IF NOT EXISTS "key" VARCHAR(255);
ALTER TABLE "MetricsDaily" ADD COLUMN IF NOT EXISTS "valueJson" JSONB;

-- Enforce Unique Metrics (Requirement M5)
CREATE UNIQUE INDEX IF NOT EXISTS "unique_metrics_tenant_date_key" ON "MetricsDaily"("tenantId", "date", "key");

-- Upgrade ContentStatsDaily Table
CREATE TABLE IF NOT EXISTS "ContentStatsDaily" (
  "id" SERIAL PRIMARY KEY,
  "tenantId" INT NOT NULL,
  "objectId" INT NOT NULL,
  "date" TIMESTAMP(3) DEFAULT NOW(),
  "views" INT DEFAULT 0,
  "readTime" FLOAT,
  "conversionsJson" JSONB
);

-- Enforce Unique Content Stats (Requirement M5)
CREATE UNIQUE INDEX IF NOT EXISTS "unique_content_stats_tenant_object_date" ON "ContentStatsDaily"("tenantId", "objectId", "date");

-- Upgrade AuditLog Table
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "tenantId" INT NOT NULL DEFAULT 0;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "actorUserId" INT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "action" VARCHAR(255);
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "resource" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "payload" JSONB;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "requestId" TEXT; // Trace ID
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT NOW();

-- Upgrade PaywallRule Table (Requirement M3)
CREATE TABLE IF NOT EXISTS "PaywallRule" (
  "id" SERIAL PRIMARY KEY,
  "tenantId" INT NOT NULL,
  "workspaceId" INT NOT NULL,
  "name" TEXT,
  "ruleJson" JSONB,
  "active" BOOLEAN DEFAULT true,
  "createdAt" TIMESTAMP(3) DEFAULT NOW()
);

-- Upgrade AccessLog Table (Requirement M10)
CREATE TABLE IF NOT EXISTS "AccessLog" (
  "id" SERIAL PRIMARY KEY,
  "tenantId" INT NOT NULL,
  "userId" INT NOT NULL,
  "actorUserId" INT NOT NULL,
  "action" TEXT,
  "resource" TEXT,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) DEFAULT NOW()
);

-- 7. PLUGINS & THEMES (Requirement A + D)
-- ----------------------------------------------------------------

-- Upgrade Plugin Table
CREATE TABLE IF NOT EXISTS "Plugin" (
  "id" SERIAL PRIMARY KEY,
  "tenantId" INT NOT NULL,
  "name" TEXT,
  "version" VARCHAR(255),
  "manifestJson" JSONB,
  "status" VARCHAR(255) DEFAULT 'ACTIVE',
  "signedHash" TEXT,
  "createdAt" TIMESTAMP(3) DEFAULT NOW()
);

-- Create PluginInstallation Table
CREATE TABLE IF NOT EXISTS "PluginInstallation" (
  "id" SERIAL PRIMARY KEY,
  "tenantId" INT NOT NULL,
  "workspaceId" INT NOT NULL,
  "pluginId" INT NOT NULL,
  "configJson" JSONB,
  "enabled" BOOLEAN DEFAULT true,
  "createdAt" TIMESTAMP(3) DEFAULT NOW()
);

-- 8. IDENTITY (Requirement A)
-- ----------------------------------------------------------------

-- Upgrade User Table
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "subscriptionTier" VARCHAR(255) DEFAULT 'FREE';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT NOW();

-- Upgrade Session Table (Requirement M10 - Hardening)
CREATE TABLE IF NOT EXISTS "Session" (
  "id" SERIAL PRIMARY KEY,
  "userId" INT NOT NULL,
  "deviceId" TEXT,
  "refreshTokenHash" TEXT,
  "ipAddress" VARCHAR(255),
  "userAgent" TEXT,
  "expiresAt" TIMESTAMP(3) DEFAULT NOW()
);

-- Upgrade UserDevice Table (Requirement M10)
CREATE TABLE IF NOT EXISTS "UserDevice" (
  "id" SERIAL PRIMARY KEY,
  "userId" INT NOT NULL,
  "deviceId" TEXT,
  "isTrusted" BOOLEAN DEFAULT false,
  "lastSeenAt" TIMESTAMP(3)
);

-- 9. CLEANUP / INDEXES FOR PERFORMANCE
-- ----------------------------------------------------------------

-- Create Indexes for Tenant Isolation (Requirement A)
CREATE INDEX IF NOT EXISTS "idx_article_tenant_ws" ON "Article"("tenantId", "workspaceId");
CREATE INDEX IF NOT EXISTS "idx_article_tenant_ws_status" ON "Article"("tenantId", "workspaceId", "status");
CREATE INDEX IF NOT EXISTS "idx_media_asset_tenant_ws" ON "MediaAsset"("tenantId", "workspaceId");
CREATE INDEX IF NOT EXISTS "idx_subscriber_tenant_ws" ON "Subscriber"("tenantId", "workspaceId");
CREATE INDEX IF NOT EXISTS "idx_audit_log_tenant_action" ON "AuditLog"("tenantId", "action", "createdAt" DESC);

-- Create Indexes for Content
CREATE INDEX IF NOT EXISTS "idx_article_published_at" ON "Article"("publishedAt", "tenantId") WHERE "publishedAt" IS NOT NULL;

-- Create Indexes for Billing (Requirement B)
CREATE INDEX IF NOT EXISTS "idx_billing_event_status" ON "BillingEvent"("status", "receivedAt");
CREATE INDEX IF NOT EXISTS "idx_subscription_user_status" ON "Subscription"("userId", "status");

-- Create Indexes for Newsletter (Requirement M4)
CREATE INDEX IF NOT EXISTS "idx_send_job_status" ON "SendJob"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "idx_send_event_campaign" ON "SendEvent"("campaignId", "occurredAt");
CREATE INDEX IF NOT EXISTS "idx_send_event_subscriber" ON "SendEvent"("subscriberId", "occurredAt");

COMMIT;
