import type { TenantSummary } from "@campux/domain";

export type MainTab = "post" | "posts" | "ai" | "stats" | "services" | "admin";
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
      systemAccessibleTenants?: TenantSummary[];
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
  imageCompression: {
    enabled: boolean;
    quality: number;
    maxDimension: number;
  };
};

export type PostAttachment = {
  kind: "image";
  key: string;
  url: string;
  fileName: string;
  contentType?: string;
  size?: number;
  width?: number;
  height?: number;
};

export type PendingAttachment = {
  id: string;
  file: File;
  blobUrl: string;
  kind: "image";
  sortOrder: number;
  progress: number;
  status: "ready" | "uploading" | "failed";
  errorMessage?: string;
};

export type PostItem = {
  id: string;
  displayId: number;
  title: string;
  text: string;
  attachments: unknown;
  anonymous: boolean;
  status: string;
  recallIgnored: boolean;
  recallIgnoredAt: string | null;
  createdAt: string;
  updatedAt: string;
  recallReason: string | null;
  qzoneStats: {
    visitorCount: number | null;
    likeCount: number | null;
    commentCount: number | null;
    checkedAt: string | null;
    targets: Array<{
      targetName: string;
      botName: string | null;
      botQqUin: string | null;
      qzoneTid: string;
      visitorCount: number | null;
      likeCount: number | null;
      commentCount: number | null;
      checkedAt: string | null;
      lastError: string | null;
    }>;
    logs: Array<{
      targetName: string;
      botName: string | null;
      botQqUin: string | null;
      qzoneTid: string;
      message: string;
      checkedAt: string | null;
    }>;
  } | null;
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
  reviewNotificationEnabled: boolean;
  autoFriendRequestApprovalEnabled: boolean;
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

export type AiRules = {
  tone?: string;
  strictPrivacy?: boolean;
  allowedCategories?: string[];
  modelingKeywords?: string[];
  modelingNotes?: string;
};

export type TenantAiSettings = {
  enabled: boolean;
  mode: "local" | "llm";
  provider: string;
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
  temperature: number;
  timeoutSeconds: number;
  rules: AiRules;
};

export type AiEntity = {
  id: string;
  type: string;
  name: string;
  aliases: unknown;
  confidence: number;
  source: string;
  evidence?: AiEntityEvidence[];
  firstSeenAt: string;
  lastSeenAt: string;
  updatedAt: string;
};

export type AiEntityDetail = AiEntity & {
  evidence: AiEntityEvidence[];
};

export type AiEntityEvidence = {
  text: string;
  postId: string | null;
  analysisId: string | null;
  seenAt: string | null;
  post: {
    id: string;
    displayId: number;
    legacyTenantSlug: string | null;
    legacyDisplayId: number | null;
    legacyUuid: string | null;
    text: string;
    attachments: unknown;
    anonymous: boolean;
    status: string;
    recallIgnored: boolean;
    recallIgnoredAt: string | null;
    createdAt: string;
    updatedAt: string;
    author: {
      id: string;
      qqUin: string;
      displayName: string | null;
      email: string | null;
    };
  } | null;
};

export type AiAnalysisItem = {
  id: string;
  postId: string;
  displayId: number;
  postText: string;
  postStatus: string;
  postCreatedAt: string;
  provider: string;
  model: string;
  status: string;
  confidence: number | null;
  categories: unknown;
  entities: unknown;
  reasons: unknown;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AiOverview = {
  settings: TenantAiSettings;
  snapshot: {
    id: string;
    version: number;
    status: string;
    summary: string;
    entities?: unknown;
    modelingMemory?: unknown;
    rules?: unknown;
    metrics?: unknown;
    createdAt: string;
  } | null;
  entities: AiEntity[];
  analyses: AiAnalysisItem[];
  metrics: {
    totalEntities: number;
    entityTypeCounts: Record<string, number>;
    analyzedPosts: number;
    runningPosts: number;
    failedPosts: number;
    categoryCounts: Record<string, number>;
  };
  graph: {
    nodes: Array<{
      id: string;
      label: string;
      kind: string;
      weight: number;
      score?: number;
      radius?: number;
      degree?: number;
      community?: string;
      entityId?: string;
      entityType?: string;
      confidence?: number;
      occurrenceCount?: number;
      description?: string | null;
    }>;
    edges: Array<{
      source: string;
      target: string;
      label: string;
      type?: string;
      weight: number;
      confidence?: number;
      signalCount?: number;
      directed?: boolean;
    }>;
    stats?: {
      entityNodes: number;
      relationEdges: number;
      cooccurrenceEdges: number;
      communities: number;
    };
  };
  backfills: AiBackfillBatch[];
};

export type AiBackfillBatch = {
  id: string;
  tenantId: string;
  actorId: string | null;
  status: string;
  mode: "missing" | "failed" | "all" | string;
  totalCount: number;
  queuedCount: number;
  runningCount: number;
  succeededCount: number;
  skippedCount: number;
  failedCount: number;
  maxAttempts: number;
  lastError: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  logs: Array<{
    id: string;
    level: string;
    event: string;
    message: string;
    detail: unknown;
    createdAt: string;
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
  qzoneVisitors: {
    daily: Array<{ date: string; todayCount: number; totalCount: number }>;
    targets: Array<{
      id: string;
      displayName: string;
      bot: {
        displayName: string;
        qqUin: string;
      };
      daily: Array<{ date: string; todayCount: number; totalCount: number }>;
    }>;
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
  ready: boolean;
  readyAt: string | null;
  archiveWarningAt: string | null;
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
