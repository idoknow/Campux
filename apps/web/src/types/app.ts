import type { TenantSummary } from "@campux/domain";

export type MainTab = "post" | "posts" | "stats" | "services" | "admin";
export type PostsTab = "mine" | "review";
export type AdminTab = "users" | "bans" | "metadata" | "bots" | "publish";
export type TenantRole = "submitter" | "reviewer" | "admin";
export type SystemRole = "operations_admin" | "system_operator";

export type OAuthServerSettings = {
  enabled: boolean;
  authorizationCodeTtlMinutes: number;
  accessTokenTtlMinutes: number;
  refreshTokenTtlDays: number;
  pkceRequired: boolean;
  allowPlainPkce: boolean;
  stateKey?: string | null;
};

export type OAuthClientItem = {
  id: string;
  tenantId: string;
  clientId: string;
  name: string;
  description: string | null;
  enabled: boolean;
  pkceRequired: boolean;
  redirectUris: string[];
  scopes: string[];
  createdAt: string;
  updatedAt: string;
};

export type OAuthClientSecretResponse = {
  client: OAuthClientItem;
  clientSecret: string;
};

export type OAuthAuthorizeClientResponse = {
  client: OAuthClientItem;
  settings: OAuthServerSettings;
  tenant: {
    id: string;
    name: string;
    slug: string;
  };
};

export type OAuthClientSettingsResponse = {
  settings: OAuthServerSettings;
};

export type Pagination = {
  page: number;
  limit: number;
  total: number;
  pageCount: number;
};

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
        email: string | null;
        displayName: string | null;
        systemRole: SystemRole | null;
        passwordChangeRequired: boolean;
      };
      memberships: Membership[];
      currentTenant: TenantSummary | null;
      currentMembership: CurrentMembership | null;
      activeBan: ActiveBan | null;
      needsTenantSelection: boolean;
      hostLocked: boolean;
    };

export type AuthenticatedMe = Extract<MeResponse, { authenticated: true }>;

export type TenantMetadata = {
  brand: string;
  banner: string;
  logoUrl: string;
  postRules: string[];
  pendingPostLimit: number;
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
  sortOrder: number;
};

export type UploadingFile = {
  id: string;
  file: File;
  blobUrl: string;
  progress: number;
  status: "uploading" | "failed";
  sortOrder: number;
  errorMessage?: string;
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

export type AdminMemberDetail = {
  member: AdminMember;
  stats: {
    postsTotal: number;
    postsByStatus: Record<string, number>;
    activeBanCount: number;
  };
  posts: Array<{
    id: string;
    displayId: number;
    text: string;
    anonymous: boolean;
    status: string;
    imageCount: number;
    createdAt: string;
    updatedAt: string;
  }>;
  bans: Array<{
    id: string;
    comment: string;
    startsAt: string;
    endsAt: string;
    createdAt: string;
    active: boolean;
    operator: {
      id: string;
      qqUin: string;
      displayName: string | null;
    } | null;
  }>;
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
  qzoneTid: string | null;
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
  qzoneTid?: string | null;
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
  reviewGroupMessageReply: string;
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
  suffixText: string;
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

export type TenantStats = {
  generatedAt: string;
  range: {
    days: number;
    since: string;
    until: string;
  };
  overview: {
    totalPosts: number;
    recent7Posts: number;
    recent30Posts: number;
    uniqueAuthors: number;
    activeAuthors30d: number;
    anonymousPosts: number;
    anonymousRate: number | null;
    postsWithImages: number;
    imageRate: number | null;
    imagesTotal: number;
    avgImagesPerPost: number | null;
    avgReviewMinutes: number | null;
  };
  posts: {
    byStatus: Record<string, number>;
    daily: Array<{ date: string; total: number; approved: number; rejected: number; published: number }>;
    userDaily: Array<{ date: string; newMembers: number; totalMembers: number }>;
    hourly: Array<{ hour: number; total: number }>;
    topAuthors30d: Array<{
      authorId: string;
      count: number;
      user: {
        id: string;
        qqUin: string;
        displayName: string | null;
      } | null;
    }>;
  };
  review: {
    reviewed30d: number;
    approved30d: number;
    rejected30d: number;
    avgReviewMinutes: number | null;
  };
  publishing: {
    byStatus: Record<string, number>;
    successRate: number | null;
    targets: Array<{
      id: string;
      displayName: string;
      enabled: boolean;
      required: boolean;
      delaySeconds: number;
      bot: {
        qqUin: string;
        displayName: string;
      };
      counts: Record<string, number>;
      successRate: number | null;
    }>;
    recentFailures: Array<{
      id: string;
      postDisplayId: number;
      postText: string;
      postStatus: string;
      targetName: string;
      botName: string;
      botQqUin: string;
      lastError: string | null;
      updatedAt: string;
    }>;
  };
  members: {
    byRole: Record<string, number>;
    total: number;
    activeBans: number;
    totalBans: number;
  };
  bots: Array<{
    id: string;
    qqUin: string;
    displayName: string;
    enabled: boolean;
    reviewGroupId: string | null;
    publishTargetCount: number;
    lastSeenAt: string | null;
    qzoneSession: {
      status: string;
      checkedAt: string | null;
      message: string | null;
      refreshedAt: string;
    } | null;
  }>;
  audit: {
    actions30d: Array<{ action: string; count: number }>;
  };
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
  bots: Array<{
    id: string;
    qqUin: string;
    displayName: string;
    enabled: boolean;
    reviewGroupId: string | null;
    lastSeenAt: string | null;
    publishTargets: Array<{
      id: string;
      displayName: string;
      enabled: boolean;
      required: boolean;
    }>;
  }>;
};

export type SystemUser = {
  id: string;
  qqUin: string;
  email: string | null;
  displayName: string | null;
  systemRole: SystemRole | null;
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
