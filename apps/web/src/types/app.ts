import type { TenantSummary } from "@campux/domain";

export type MainTab = "post" | "posts" | "stats" | "services" | "admin";
export type PostsTab = "mine" | "review" | "published";
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
        autoFollowOwnPosts: boolean;
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
  imageMaxSizeMb: number;
  botStylishMessagesEnabled: boolean;
  botPrivatePostStylishEnabled: boolean;
  publishMode: "single" | "accumulate";
  publishAccumulate: {
    minImages: number;
    maxImages: number;
    staleMinutes: number;
  };
  publishLlmSummaryEnabled: boolean;
  enableColorSelection: boolean;
  enableMarkdownRender: boolean;
  enableFontSelection: boolean;
  enableAnonymousAvatarSelection: boolean;
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
  status: "ready" | "converting" | "uploading" | "failed";
  errorMessage?: string;
  /** Original video file before GIF conversion (if attachment started as video) */
  originalVideo: File | undefined;
  /** Remote GIF URL returned by the validated server-side converter. */
  remoteGifUrl?: string;
  /** Short-lived server claim authorizing the converted GIF URL. */
  remoteGifProof?: string;
};

export type PostItem = {
  id: string;
  displayId: number;
  title: string;
  text: string;
  attachments: unknown;
  anonymous: boolean;
  anonymousAvatar: string | null;
  bgColor: string | null;
  textColor: string | null;
  font: string | null;
  status: string;
  recallIgnored: boolean;
  recallIgnoredAt: string | null;
  createdAt: string;
  updatedAt: string;
  recallReason: string | null;
  following?: boolean;
  submissionChannel: "web" | "private";
  qzoneStats: {
    visitorCount: number | null;
    likeCount: number | null;
    commentCount: number | null;
    forwardCount: number | null;
    checkedAt: string | null;
    targets: Array<{
      targetName: string;
      botName: string | null;
      botQqUin: string | null;
      qzoneTid: string;
      visitorCount: number | null;
      likeCount: number | null;
      commentCount: number | null;
      forwardCount: number | null;
      checkedAt: string | null;
      lastError: string | null;
      comments?: Array<{
        uin: string;
        name: string;
        content: string;
        images?: string[];
        createdAt: string | null;
        replies?: Array<{ uin: string; name: string; content: string; images?: string[]; createdAt: string | null }>;
      }>;
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
  batch?: {
    postCount: number;
    displayIds: number[];
    otherDisplayIds: number[];
    collecting: boolean;
  } | null;
  tags: AssignedPostTag[];
};

export type PostTimelineEntry = {
  actorId: string | null;
  actorName: string | null;
  actorQq: string | null;
  oldStatus: string | null;
  newStatus: string;
  comment: string;
  createdAt: string;
};

export type ReviewPostItem = PostItem & {
  author: {
    id: string;
    qqUin: string;
    displayName: string | null;
  } | null;
  timeline?: PostTimelineEntry[];
};

export type PublishedFeedAuthor = {
  displayName: string;
  qqUin: string;
} | null;

export type PublishedFeedPost = {
  id: string;
  displayId: number;
  text: string;
  attachments: unknown;
  anonymous: boolean;
  author: PublishedFeedAuthor;
  bgColor: string | null;
  textColor: string | null;
  font: string | null;
  createdAt: string;
  tags: AssignedPostTag[];
};

export type PublishedFeedItem = {
  kind: "single" | "batch";
  key: string;
  publishedAt: string;
  posts: PublishedFeedPost[];
  qzoneStats: PostItem["qzoneStats"];
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
    platform: "onebot" | "official_qq";
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
  platform: "onebot" | "official_qq" | string;
  destinationLabel: string;
  destinationId: string | null;
  externalIdLabel: string;
  qzoneTidLabel: string;
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
      platform: "onebot" | "official_qq" | string;
      qqUin: string;
      officialAppId: string | null;
      reviewGroupId: string | null;
      displayName: string;
    };
  };
};

export type PublishAttemptVerbose = {
  mode?: string;
  appId?: string | null;
  channelId?: string | null;
  title?: string | null;
  contentLength?: number;
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
  platform: "onebot" | "official_qq";
  qqUin: string;
  officialAppId: string | null;
  officialAppSecretConfigured: boolean;
  officialAppSecret?: string;
  displayName: string;
  enabled: boolean;
  reviewGroupId: string | null;
  reviewNotificationEnabled: boolean;
  reviewQueueAutoReminderEnabled: boolean;
  reviewQueueReminderThresholdHours: number;
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
  /** 是否启用私聊投稿 AI 语义收稿 */
  privatePostAiEnabled?: boolean;
  /** 是否启用投稿后的 LLM 自动打标 */
  postTaggingEnabled?: boolean;
  /** 是否启用 LLM 定期维护标签库 */
  postTagMaintenanceEnabled?: boolean;
  /** 私聊 AI 聚合收稿等待秒数，0 表示不聚合 */
  privatePostAggregateDelaySeconds?: number;
  /** 对话投稿额外触发关键词，如 ["发帖", "吐槽", "表白"] */
  postTriggerKeywords?: string[];
  /** 私聊投稿 AI 语义收稿的完整系统提示词，留空使用内置默认提示词 */
  privatePostPrompt?: string;
};

export type PostTag = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  status: string;
  source: string;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
  postCount?: number;
};

export type AssignedPostTag = PostTag & {
  assignmentSource: string;
  confidence: number | null;
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

export type PublishTextTemplate = {
  customText: string;
  suffixText: string;
  includePostId: boolean;
  includeAuthorMention: boolean;
  includeLinks: boolean;
  includeQZoneLink: boolean;
  qzoneLinkBotAccountId: string;
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
    totalPosts: number;
    byStatus: Record<string, number>;
    bySource: {
      private: number;
      web: number;
    };
    anonymousPosts: number;
    anonymousRate: number | null;
    postsWithImages: number;
    imageRate: number | null;
    imagesTotal: number;
    avgImagesPerPost: number | null;
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
  botFriends: {
    daily: Array<{ date: string; friendCount: number }>;
    bots: Array<{
      botAccountId: string;
      bot: {
        displayName: string;
        qqUin: string;
      };
      daily: Array<{ date: string; friendCount: number }>;
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
