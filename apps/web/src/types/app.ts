import type { TenantSummary } from "@campux/domain";

export type MainTab = "post" | "posts" | "services" | "admin";
export type PostsTab = "mine" | "review";
export type AdminTab = "users" | "bans" | "metadata" | "bots" | "publish";
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

export type ActiveBan = {
  id: string;
  comment: string;
  startsAt: string;
  endsAt: string;
  createdAt: string;
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
      activeBan: ActiveBan | null;
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

export type ReviewPostItem = PostItem & {
  author: {
    id: string;
    qqUin: string;
    displayName: string | null;
  } | null;
};

export type AdminMember = {
  id: string;
  role: TenantRole;
  createdAt: string;
  user: {
    id: string;
    qqUin: string;
    displayName: string | null;
    systemRole: string | null;
  };
};

export type PublishTargetItem = {
  id: string;
  type: string;
  displayName: string;
  enabled: boolean;
  required: boolean;
  publishDelaySeconds: number;
  failurePolicy: string;
  qzoneRefreshMode: "protocol" | "qr";
  botAccount: {
    id: string;
    qqUin: string;
    displayName: string;
    enabled: boolean;
    connectionToken: string;
    publishTextTemplate: PublishTextTemplate;
    qzoneSession: AdminBotSession | null;
  };
};

export type PublishAttemptItem = {
  id: string;
  status: string;
  attempt: number;
  lastError: string | null;
  nextRunAt: string | null;
  externalId: string | null;
  verbose: PublishAttemptVerbose | null;
  updatedAt: string;
  post: {
    id: string;
    displayId: number;
    text: string;
    anonymous: boolean;
    status: string;
    author: {
      qqUin: string;
      displayName: string | null;
    };
  };
  publishTarget: {
    id: string;
    displayName: string;
    required: boolean;
    botAccount: {
      qqUin: string;
      displayName: string;
    };
  };
};

export type PublishAttemptVerbose = {
  mode?: string;
  targetName?: string;
  renderedBytes?: number;
  imageCount?: number;
  renderedImageIncluded?: boolean;
  cookieStatus?: string;
  cookieNames?: string[];
  uin?: string | null;
  publishedAt?: string | null;
  note?: string;
  http?: Array<{
    label: string;
    durationMs?: number;
    request: {
      method: string;
      url: string;
      headers?: Record<string, string>;
      body?: Record<string, string>;
    };
    response?: {
      status: number;
      statusText: string;
      headers?: Record<string, string>;
      body: string;
      parsed?: unknown;
    };
    error?: string;
  }>;
  [key: string]: unknown;
};

export type AdminBotAccount = {
  id: string;
  qqUin: string;
  displayName: string;
  enabled: boolean;
  reviewGroupId: string | null;
  connectionToken: string;
  publishTextTemplate: PublishTextTemplate;
  userMessageReply: string;
  userMessageReplyCooldownSeconds: number;
  lastSeenAt: string | null;
  createdAt: string;
  connection: {
    online: boolean;
    connectionCount: number;
  };
  sessions: Array<{
    id: string;
    type: string;
    domain: string;
    refreshedAt: string;
    expiresAt: string | null;
    status: "unchecked" | "available" | "invalid" | "expired";
    checkedAt: string | null;
    message: string | null;
  }>;
  publishTargets: Array<{
    id: string;
    type: string;
    displayName: string;
    enabled: boolean;
    required: boolean;
  }>;
};

export type PublishTextTemplate = {
  customText: string;
  includePostId: boolean;
  includeAuthorMention: boolean;
  includeLinks: boolean;
};

export type AdminBotSession = AdminBotAccount["sessions"][number];

export type AdminBotEvent = {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  detail: unknown;
  createdAt: string;
  actor: {
    id: string;
    qqUin: string;
    displayName: string | null;
  } | null;
};

export type AdminBanRecord = {
  id: string;
  comment: string;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  active: boolean;
  user: {
    id: string;
    qqUin: string;
    displayName: string | null;
  } | null;
  operator: {
    id: string;
    qqUin: string;
    displayName: string | null;
  } | null;
};

export type TenantStatus = "active" | "paused" | "archived";

export type SystemTenant = {
  id: string;
  slug: string;
  host: string | null;
  name: string;
  status: TenantStatus;
  createdAt: string;
  updatedAt: string;
  botAccountCount: number;
  postCount: number;
  memberCount: number;
};

export type SystemUser = {
  id: string;
  qqUin: string;
  displayName: string | null;
  systemRole: string | null;
  isTestAccount: boolean;
  createdAt: string;
  memberships: Array<{
    id: string;
    role: TenantRole;
    tenant: {
      id: string;
      name: string;
      slug: string;
      status: TenantStatus;
    };
  }>;
};

export type SystemBot = {
  id: string;
  qqUin: string;
  displayName: string;
  enabled: boolean;
  reviewGroupId: string | null;
  lastSeenAt: string | null;
  tenant: {
    id: string;
    name: string;
    slug: string;
    status: TenantStatus;
  };
  publishTargets: Array<{
    id: string;
    displayName: string;
    enabled: boolean;
    required: boolean;
  }>;
};

export type SystemQueueSnapshot = {
  runtime: {
    running: boolean;
    queued: number;
    processing: number;
    failed: number;
    lastError: string | null;
  };
  publishAttempts: {
    queued: number;
    running: number;
    failed: number;
    succeeded: number;
  };
};

export type AuditLogItem = {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  detail: unknown;
  createdAt: string;
  tenant: {
    id: string;
    name: string;
    slug: string;
  } | null;
  actor: {
    id: string;
    qqUin: string;
    displayName: string | null;
  } | null;
};
