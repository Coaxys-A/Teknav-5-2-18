-- Migration: Add Plugin Slots & Manifest Updates
-- Part 10.5 - Workstream 1

-- Add Columns to `plugins` (if not existing)
ALTER TABLE "plugins" ADD COLUMN IF NOT EXISTS "signed_hash" TEXT;
ALTER TABLE "plugins" ADD COLUMN IF NOT EXISTS "manifest_json" JSONB;
ALTER TABLE "plugins" ADD COLUMN IF NOT EXISTS "status" TEXT DEFAULT 'ACTIVE';

CREATE TABLE "plugin_slots" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL, -- 'admin_sidebar', 'editor_sidebar', 'content_widget', 'analytics_card'
    "description" TEXT,
    "component_id" TEXT, -- React component ID or Webpack chunk ID
    "capabilities" TEXT[] NOT NULL, -- ['read:users', 'write:articles']
    "tenant_id" INTEGER NOT NULL,
    "workspace_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("id")
);

CREATE INDEX "plugin_slots_name_idx" ON "plugin_slots"("name");

-- Plugin Installations Table (Link plugins to workspaces with config)
CREATE TABLE "plugin_installations" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "workspace_id" INTEGER NOT NULL,
    "plugin_id" INTEGER NOT NULL,
    "config_json" JSONB, -- Plugin-specific settings
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "installed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "installed_by" INTEGER, -- Actor
    "tenant_id" INTEGER NOT NULL,
    "workspace_id" INTEGER NOT NULL,
    "plugin_id" INTEGER NOT NULL,

    PRIMARY KEY ("id"),
    CONSTRAINT "plugin_installations_tenant_workspace_plugin_unique" UNIQUE ("tenant_id", "workspace_id", "plugin_id"),
    CONSTRAINT "plugin_installations_plugin_fk" FOREIGN KEY ("plugin_id") REFERENCES "plugins"("id") ON DELETE CASCADE
);
