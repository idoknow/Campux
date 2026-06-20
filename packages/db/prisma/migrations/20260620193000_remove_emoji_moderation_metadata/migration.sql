-- Remove dead tenant metadata left by the removed emoji moderation feature.
DELETE FROM "TenantMetadata"
WHERE "key" = 'enable_emoji_moderation';
