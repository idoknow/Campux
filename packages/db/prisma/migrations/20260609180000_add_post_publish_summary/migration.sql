-- 为每条稿件持久化一次性生成的 LLM 极短总结（≤16 字），
-- 同一稿件发往多个墙时各墙复用同一份，避免 temperature 导致每墙文字分叉、并省去重复 LLM 调用。
ALTER TABLE "Post" ADD COLUMN "publishSummary" TEXT;
