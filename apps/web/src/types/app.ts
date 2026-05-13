import type { TenantSummary } from "@campux/domain";

export type MainTab = "post" | "posts" | "services" | "admin";
export type TenantRole = "submitter" | "reviewer" | "admin";

export type Membership = {
  id: string;
  role: TenantRole;
  tenant: TenantSummary;
};

export type CurrentMembership = {
  id: string;
  role: TenantRole;
};

export type MeResponse =
  | { authenticated: false }
  | {
      authenticated: true;
      user: {
        id: string;
        qqUin: string;
        displayName: string | null;
        systemRole: "system_operator" | null;
      };
      memberships: Membership[];
      currentTenant: TenantSummary | null;
      currentMembership: CurrentMembership | null;
      needsTenantSelection: boolean;
    };

export type AuthenticatedMe = Extract<MeResponse, { authenticated: true }>;

export type TenantMetadata = {
  brand: string;
  banner: string;
  postRules: string[];
  services: Array<{
    title: string;
    description?: string;
    url?: string;
  }>;
};

export type UploadedImage = {
  key: string;
  url: string;
  fileName: string;
  previewUrl: string;
};

export type PostItem = {
  id: string;
  displayId: number;
  title: string;
  text: string;
  images: unknown;
  anonymous: boolean;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type TenantStatus = "active" | "paused" | "archived";

export type SystemTenant = {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  createdAt: string;
  updatedAt: string;
  botAccountCount: number;
  postCount: number;
  memberCount: number;
};
