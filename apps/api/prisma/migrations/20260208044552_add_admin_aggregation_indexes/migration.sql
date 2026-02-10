-- CreateIndex
CREATE INDEX "ai_usage_log_ai_provider_created_at_idx" ON "ai_usage_log"("ai_provider", "created_at");

-- CreateIndex
CREATE INDEX "transactions_created_at_idx" ON "transactions"("created_at");
