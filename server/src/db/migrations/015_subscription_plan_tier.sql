-- 015_subscription_plan_tier.sql
-- Add plan_tier column to subscriptions table for multi-tier plan tracking

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS plan_tier VARCHAR(50);
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan_tier ON subscriptions(plan_tier);
