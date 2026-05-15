ALTER TABLE "Tenant" ADD COLUMN "host" TEXT;

CREATE UNIQUE INDEX "Tenant_host_key" ON "Tenant"("host");
