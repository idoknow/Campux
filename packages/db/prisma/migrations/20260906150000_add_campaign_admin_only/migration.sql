-- AlterTable: 竞选「仅管理可见」开关（管理员可隐藏，非管理员列表/详情/投票不可见）
ALTER TABLE "Campaign" ADD COLUMN "adminOnly" BOOLEAN NOT NULL DEFAULT false;
