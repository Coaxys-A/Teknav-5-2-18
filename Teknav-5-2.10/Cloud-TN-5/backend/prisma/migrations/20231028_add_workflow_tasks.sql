-- Migration: Add Workflow Tasks (Approvals/Gating)
-- Part 10.5 - Workstream 1

-- Note: Assumes `workflow_instances` and `workflow_steps` exist.
-- We add specific task tracking for approvals.

CREATE TABLE "workflow_tasks" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "workspace_id" INTEGER NOT NULL,
    "instance_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL, -- 'approval', 'review', 'legal', 'seo', 'ai_safety', 'translation'
    "assignee_id" INTEGER, -- User ID
    "status" TEXT NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'APPROVED', 'REJECTED', 'SKIPPED'
    "decision_reason" TEXT,
    "due_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER, -- Actor who created task
    "tenant_id" INTEGER NOT NULL,
    "workspace_id" INTEGER NOT NULL,
    "instance_id" INTEGER NOT NULL,

    PRIMARY KEY ("id"),
    CONSTRAINT "workflow_tasks_instance_fk" FOREIGN KEY ("instance_id") REFERENCES "workflow_instances"("id") ON DELETE CASCADE
);

CREATE INDEX "workflow_tasks_status_idx" ON "workflow_tasks"("status");
CREATE INDEX "workflow_tasks_assignee_idx" ON "workflow_tasks"("assignee_id");
