import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { TimelineSpec } from "../timeline/spec";

export const workspaceRole = pgEnum("workspace_role", ["owner", "admin", "editor", "viewer"]);
export const planTier = pgEnum("plan_tier", ["starter", "creator", "pro", "agency"]);
export const contentMode = pgEnum("content_mode", ["clipper", "faceless"]);
export const rightsStatus = pgEnum("rights_status", ["unknown", "metadata_only", "owned", "licensed", "public_domain"]);
export const discoveredStatus = pgEnum("discovered_status", ["new", "saved", "dismissed", "used"]);
export const assetKind = pgEnum("asset_kind", ["source_video", "broll_video", "broll_image", "narration", "music", "logo", "render", "thumbnail"]);
export const assetStatus = pgEnum("asset_status", ["pending_upload", "ready", "rejected"]);
export const jobStatus = pgEnum("job_status", ["queued", "running", "succeeded", "failed", "cancel_requested", "cancelled"]);
export const agentName = pgEnum("agent_name", ["discovery", "research", "script", "clipping", "visual", "voice", "editing", "qa", "publishing", "analytics"]);
export const logLevel = pgEnum("log_level", ["info", "warn", "error"]);
export const videoStatus = pgEnum("video_status", [
  "draft",
  "candidate",
  "in_production",
  "ready_to_render",
  "rendering",
  "pending_approval",
  "approved",
  "rejected",
  "failed",
]);
export const factStatus = pgEnum("fact_status", ["supported", "uncertain"]);
export const socialPlatform = pgEnum("social_platform", ["instagram", "facebook", "youtube"]);
export const publishStatus = pgEnum("publish_status", ["draft", "scheduled", "publishing", "published", "failed", "cancelled"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};
const id = () => uuid("id").primaryKey().defaultRandom();
const workspaceRef = () =>
  uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" });
const projectRef = () =>
  uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" });

// Mirrors auth.users; the row is created by the handle_new_user trigger.
export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name"),
  ...timestamps,
});

export const workspaces = pgTable("workspaces", {
  id: id(),
  name: text("name").notNull(),
  ...timestamps,
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: id(),
    workspaceId: workspaceRef(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: workspaceRole("role").notNull().default("viewer"),
    ...timestamps,
  },
  (t) => [uniqueIndex("workspace_members_unique").on(t.workspaceId, t.userId), index("workspace_members_user").on(t.userId)],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: id(),
    workspaceId: workspaceRef(),
    plan: planTier("plan").notNull().default("starter"),
    status: text("status").notNull().default("active"),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("subscriptions_workspace").on(t.workspaceId)],
);

export const projects = pgTable(
  "projects",
  {
    id: id(),
    workspaceId: workspaceRef(),
    name: text("name").notNull(),
    niche: text("niche").notNull(),
    targetAudience: text("target_audience"),
    language: text("language").notNull().default("en"),
    region: text("region"),
    mode: contentMode("mode").notNull().default("faceless"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("projects_workspace").on(t.workspaceId)],
);

export const projectSettings = pgTable(
  "project_settings",
  {
    id: id(),
    workspaceId: workspaceRef(),
    projectId: projectRef(),
    preferredDurationSeconds: integer("preferred_duration_seconds").notNull().default(30),
    productionTargetPerWeek: integer("production_target_per_week").notNull().default(3),
    brandPrimary: text("brand_primary").notNull().default("#58D5C9"),
    brandSecondary: text("brand_secondary").notNull().default("#77A9FF"),
    logoAssetId: uuid("logo_asset_id"),
    musicAssetId: uuid("music_asset_id"),
    captionStyle: text("caption_style").notNull().default("signal"),
    template: text("template").notNull().default("signal"),
    tone: text("tone").notNull().default("educational"),
    voiceId: text("voice_id"),
    voiceSpeed: real("voice_speed").notNull().default(1),
    approvalRequired: boolean("approval_required").notNull().default(true),
    autoPublish: boolean("auto_publish").notNull().default(false),
    ...timestamps,
  },
  (t) => [uniqueIndex("project_settings_project").on(t.projectId)],
);

export const nicheKeywords = pgTable(
  "niche_keywords",
  {
    id: id(),
    workspaceId: workspaceRef(),
    projectId: projectRef(),
    keyword: text("keyword").notNull(),
    excluded: boolean("excluded").notNull().default(false),
    createdAt: timestamps.createdAt,
  },
  (t) => [uniqueIndex("niche_keywords_unique").on(t.projectId, t.keyword)],
);

export const discoverySources = pgTable(
  "discovery_sources",
  {
    id: id(),
    workspaceId: workspaceRef(),
    projectId: projectRef(),
    kind: text("kind").notNull(), // "channel" | "saved_search"
    value: text("value").notNull(),
    label: text("label"),
    ...timestamps,
  },
  (t) => [index("discovery_sources_project").on(t.projectId)],
);

export type ScoreBreakdown = {
  total: number;
  complete: boolean;
  factors: { key: string; label: string; score: number | null; weight: number; reason: string }[];
};

export const discoveredVideos = pgTable(
  "discovered_videos",
  {
    id: id(),
    workspaceId: workspaceRef(),
    projectId: projectRef(),
    youtubeId: text("youtube_id").notNull(),
    title: text("title").notNull(),
    channelTitle: text("channel_title").notNull(),
    channelId: text("channel_id"),
    description: text("description"),
    thumbnailUrl: text("thumbnail_url"),
    durationSeconds: integer("duration_seconds"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    viewCount: bigint("view_count", { mode: "number" }),
    likeCount: bigint("like_count", { mode: "number" }),
    commentCount: bigint("comment_count", { mode: "number" }),
    opportunityScore: integer("opportunity_score"),
    scoreBreakdown: jsonb("score_breakdown").$type<ScoreBreakdown>(),
    topicTags: jsonb("topic_tags").$type<string[]>().notNull().default([]),
    suggestedMode: contentMode("suggested_mode"),
    rightsStatus: rightsStatus("rights_status").notNull().default("metadata_only"),
    status: discoveredStatus("status").notNull().default("new"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("discovered_videos_unique").on(t.projectId, t.youtubeId),
    index("discovered_videos_score").on(t.projectId, t.opportunityScore),
  ],
);

export const mediaAssets = pgTable(
  "media_assets",
  {
    id: id(),
    workspaceId: workspaceRef(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    kind: assetKind("kind").notNull(),
    status: assetStatus("status").notNull().default("ready"),
    storageKey: text("storage_key").notNull(),
    filename: text("filename"),
    contentType: text("content_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    durationSeconds: real("duration_seconds"),
    width: integer("width"),
    height: integer("height"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [uniqueIndex("media_assets_key").on(t.storageKey), index("media_assets_project").on(t.projectId, t.kind)],
);

export const sourceAssets = pgTable(
  "source_assets",
  {
    id: id(),
    workspaceId: workspaceRef(),
    projectId: projectRef(),
    mediaAssetId: uuid("media_asset_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    rightsConfirmedBy: uuid("rights_confirmed_by").references(() => users.id, { onDelete: "set null" }),
    rightsConfirmedAt: timestamp("rights_confirmed_at", { withTimezone: true }).notNull(),
    rightsBasis: text("rights_basis").notNull(),
    ...timestamps,
  },
  (t) => [index("source_assets_project").on(t.projectId)],
);

export const assetLicenses = pgTable(
  "asset_licenses",
  {
    id: id(),
    workspaceId: workspaceRef(),
    mediaAssetId: uuid("media_asset_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    license: text("license").notNull(),
    sourceUrl: text("source_url"),
    attribution: text("attribution"),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("asset_licenses_asset").on(t.mediaAssetId)],
);

export type TranscriptWord = { word: string; start: number; end: number };
export type TranscriptSegment = { start: number; end: number; text: string; speaker?: string };

export const transcripts = pgTable(
  "transcripts",
  {
    id: id(),
    workspaceId: workspaceRef(),
    sourceAssetId: uuid("source_asset_id")
      .notNull()
      .references(() => sourceAssets.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    language: text("language"),
    text: text("text").notNull(),
    words: jsonb("words").$type<TranscriptWord[]>().notNull().default([]),
    segments: jsonb("segments").$type<TranscriptSegment[]>().notNull().default([]),
    topics: jsonb("topics").$type<string[]>().notNull().default([]),
    ...timestamps,
  },
  (t) => [uniqueIndex("transcripts_source").on(t.sourceAssetId)],
);

export type ResearchSource = { id: string; title: string; url: string; excerpt: string; provider: string };
export type ResearchFact = { claim: string; status: "supported" | "uncertain"; sourceIds: string[] };

export const contentIdeas = pgTable(
  "content_ideas",
  {
    id: id(),
    workspaceId: workspaceRef(),
    projectId: projectRef(),
    topic: text("topic").notNull(),
    angle: text("angle"),
    discoveredVideoId: uuid("discovered_video_id").references(() => discoveredVideos.id, { onDelete: "set null" }),
    sources: jsonb("sources").$type<ResearchSource[]>().notNull().default([]),
    facts: jsonb("facts").$type<ResearchFact[]>().notNull().default([]),
    researchedAt: timestamp("researched_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("content_ideas_project").on(t.projectId)],
);

export const videoProjects = pgTable(
  "video_projects",
  {
    id: id(),
    workspaceId: workspaceRef(),
    projectId: projectRef(),
    mode: contentMode("mode").notNull(),
    status: videoStatus("status").notNull().default("draft"),
    title: text("title").notNull(),
    hook: text("hook"),
    opportunityScore: integer("opportunity_score"),
    scoreReason: text("score_reason"),
    contentIdeaId: uuid("content_idea_id").references(() => contentIdeas.id, { onDelete: "set null" }),
    sourceAssetId: uuid("source_asset_id").references(() => sourceAssets.id, { onDelete: "set null" }),
    sourceStartSeconds: real("source_start_seconds"),
    sourceEndSeconds: real("source_end_seconds"),
    targetDurationSeconds: integer("target_duration_seconds"),
    tone: text("tone"),
    timeline: jsonb("timeline").$type<TimelineSpec>(),
    timelineVersion: integer("timeline_version").notNull().default(0),
    generationSettings: jsonb("generation_settings").$type<Record<string, unknown>>().notNull().default({}),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    lastError: text("last_error"),
    ...timestamps,
  },
  (t) => [index("video_projects_project").on(t.projectId, t.status), index("video_projects_source").on(t.sourceAssetId)],
);

// Saved snapshots of a timeline, used by the editor's version history.
export const videoProjectVersions = pgTable(
  "video_project_versions",
  {
    id: id(),
    workspaceId: workspaceRef(),
    videoProjectId: uuid("video_project_id")
      .notNull()
      .references(() => videoProjects.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    timeline: jsonb("timeline").$type<TimelineSpec>().notNull(),
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamps.createdAt,
  },
  (t) => [uniqueIndex("video_project_versions_unique").on(t.videoProjectId, t.version)],
);

export const scripts = pgTable(
  "scripts",
  {
    id: id(),
    workspaceId: workspaceRef(),
    videoProjectId: uuid("video_project_id")
      .notNull()
      .references(() => videoProjects.id, { onDelete: "cascade" }),
    origin: text("origin").notNull(), // "ai" | "manual"
    title: text("title").notNull(),
    hook: text("hook"),
    callToAction: text("call_to_action"),
    body: text("body").notNull(),
    tone: text("tone"),
    targetDurationSeconds: integer("target_duration_seconds"),
    ...timestamps,
  },
  (t) => [uniqueIndex("scripts_video").on(t.videoProjectId)],
);

export const videoScenes = pgTable(
  "video_scenes",
  {
    id: id(),
    workspaceId: workspaceRef(),
    videoProjectId: uuid("video_project_id")
      .notNull()
      .references(() => videoProjects.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    narration: text("narration").notNull(),
    visualQuery: text("visual_query"),
    narrationAssetId: uuid("narration_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    visualAssetId: uuid("visual_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    durationSeconds: real("duration_seconds"),
    wordTimings: jsonb("word_timings").$type<TranscriptWord[]>(),
    timingSource: text("timing_source"), // "provider" | "estimated"
    speaker: text("speaker"),
    callout: jsonb("callout").$type<{ value: string; label?: string }>(),
    ...timestamps,
  },
  (t) => [index("video_scenes_video").on(t.videoProjectId, t.position)],
);

export const timelineTracks = pgTable(
  "timeline_tracks",
  {
    id: id(),
    workspaceId: workspaceRef(),
    videoProjectId: uuid("video_project_id")
      .notNull()
      .references(() => videoProjects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // visual | narration | captions | text | music
    position: integer("position").notNull().default(0),
    muted: boolean("muted").notNull().default(false),
    volume: real("volume").notNull().default(1),
    ...timestamps,
  },
  (t) => [uniqueIndex("timeline_tracks_unique").on(t.videoProjectId, t.kind)],
);

export const productionJobs = pgTable(
  "production_jobs",
  {
    id: id(),
    workspaceId: workspaceRef(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    videoProjectId: uuid("video_project_id").references(() => videoProjects.id, { onDelete: "cascade" }),
    agent: agentName("agent").notNull(),
    kind: text("kind").notNull(),
    label: text("label").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    result: jsonb("result").$type<Record<string, unknown>>(),
    status: jobStatus("status").notNull().default("queued"),
    progress: real("progress").notNull().default(0),
    priority: integer("priority").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(4),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    idempotencyKey: text("idempotency_key"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    costMicroUsd: bigint("cost_micro_usd", { mode: "number" }).notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("production_jobs_claim").on(t.status, t.runAfter),
    index("production_jobs_workspace").on(t.workspaceId, t.createdAt),
    index("production_jobs_video").on(t.videoProjectId),
    uniqueIndex("production_jobs_idempotency")
      .on(t.workspaceId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
  ],
);

export const agentControls = pgTable(
  "agent_controls",
  {
    id: id(),
    workspaceId: workspaceRef(),
    agent: agentName("agent").notNull(),
    paused: boolean("paused").notNull().default(false),
    ...timestamps,
  },
  (t) => [uniqueIndex("agent_controls_unique").on(t.workspaceId, t.agent)],
);

export const agentTaskLogs = pgTable(
  "agent_task_logs",
  {
    id: id(),
    workspaceId: workspaceRef(),
    jobId: uuid("job_id").references(() => productionJobs.id, { onDelete: "cascade" }),
    agent: agentName("agent").notNull(),
    level: logLevel("level").notNull().default("info"),
    message: text("message").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>(),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("agent_task_logs_workspace").on(t.workspaceId, t.createdAt), index("agent_task_logs_job").on(t.jobId)],
);

export type QaCheck = { key: string; label: string; passed: boolean; detail: string; blocking: boolean };

export const renderedVideos = pgTable(
  "rendered_videos",
  {
    id: id(),
    workspaceId: workspaceRef(),
    videoProjectId: uuid("video_project_id")
      .notNull()
      .references(() => videoProjects.id, { onDelete: "cascade" }),
    mediaAssetId: uuid("media_asset_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "restrict" }),
    timelineVersion: integer("timeline_version").notNull(),
    timelineSnapshot: jsonb("timeline_snapshot").$type<TimelineSpec>().notNull(),
    durationSeconds: real("duration_seconds"),
    width: integer("width"),
    height: integer("height"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    renderMs: integer("render_ms"),
    qaPassed: boolean("qa_passed"),
    qaReport: jsonb("qa_report").$type<QaCheck[]>(),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("rendered_videos_video").on(t.videoProjectId, t.createdAt)],
);

export const socialAccounts = pgTable(
  "social_accounts",
  {
    id: id(),
    workspaceId: workspaceRef(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    platform: socialPlatform("platform").notNull(),
    externalAccountId: text("external_account_id").notNull(),
    displayName: text("display_name"),
    // AES-256-GCM ciphertext. Column access is revoked from `authenticated` in the RLS migration.
    accessTokenEncrypted: text("access_token_encrypted"),
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    ...timestamps,
  },
  (t) => [uniqueIndex("social_accounts_unique").on(t.workspaceId, t.platform, t.externalAccountId)],
);

export const publishingJobs = pgTable(
  "publishing_jobs",
  {
    id: id(),
    workspaceId: workspaceRef(),
    renderedVideoId: uuid("rendered_video_id")
      .notNull()
      .references(() => renderedVideos.id, { onDelete: "cascade" }),
    socialAccountId: uuid("social_account_id")
      .notNull()
      .references(() => socialAccounts.id, { onDelete: "cascade" }),
    status: publishStatus("status").notNull().default("draft"),
    caption: text("caption"),
    idempotencyKey: text("idempotency_key").notNull(),
    externalPostId: text("external_post_id"),
    externalUrl: text("external_url"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    ...timestamps,
  },
  (t) => [uniqueIndex("publishing_jobs_idempotency").on(t.workspaceId, t.idempotencyKey)],
);

export const scheduledPosts = pgTable(
  "scheduled_posts",
  {
    id: id(),
    workspaceId: workspaceRef(),
    projectId: projectRef(),
    videoProjectId: uuid("video_project_id")
      .notNull()
      .references(() => videoProjects.id, { onDelete: "cascade" }),
    publishingJobId: uuid("publishing_job_id").references(() => publishingJobs.id, { onDelete: "set null" }),
    platform: socialPlatform("platform").notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [index("scheduled_posts_time").on(t.workspaceId, t.scheduledFor)],
);

export const analyticsSnapshots = pgTable(
  "analytics_snapshots",
  {
    id: id(),
    workspaceId: workspaceRef(),
    publishingJobId: uuid("publishing_job_id")
      .notNull()
      .references(() => publishingJobs.id, { onDelete: "cascade" }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    // Null means the platform does not report this metric.
    views: bigint("views", { mode: "number" }),
    likes: bigint("likes", { mode: "number" }),
    comments: bigint("comments", { mode: "number" }),
    shares: bigint("shares", { mode: "number" }),
    watchTimeSeconds: bigint("watch_time_seconds", { mode: "number" }),
  },
  (t) => [index("analytics_snapshots_job").on(t.publishingJobId, t.capturedAt)],
);

export const automationRules = pgTable(
  "automation_rules",
  {
    id: id(),
    workspaceId: workspaceRef(),
    projectId: projectRef(),
    enabled: boolean("enabled").notNull().default(false),
    cron: text("cron").notNull().default("0 8 * * *"),
    maxDailyVideos: integer("max_daily_videos").notNull().default(1),
    minContentScore: integer("min_content_score").notNull().default(60),
    approvalRequired: boolean("approval_required").notNull().default(true),
    autoPublish: boolean("auto_publish").notNull().default(false),
    monthlyBudgetUsd: numeric("monthly_budget_usd", { precision: 10, scale: 2 }),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [uniqueIndex("automation_rules_project").on(t.projectId)],
);

export const usageEvents = pgTable(
  "usage_events",
  {
    id: id(),
    workspaceId: workspaceRef(),
    jobId: uuid("job_id").references(() => productionJobs.id, { onDelete: "set null" }),
    kind: text("kind").notNull(), // llm | transcription | tts | stock | render | storage
    provider: text("provider").notNull(),
    quantity: real("quantity").notNull(),
    unit: text("unit").notNull(),
    costMicroUsd: bigint("cost_micro_usd", { mode: "number" }),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("usage_events_workspace").on(t.workspaceId, t.createdAt)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    workspaceId: workspaceRef(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    href: text("href"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("notifications_workspace").on(t.workspaceId, t.createdAt)],
);

// Not workspace data. RLS is on with no policies, so only the owner connection can read it.
export const workerHeartbeats = pgTable("worker_heartbeats", {
  workerId: text("worker_id").primaryKey(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    workspaceId: workspaceRef(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    data: jsonb("data").$type<Record<string, unknown>>(),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("audit_logs_workspace").on(t.workspaceId, t.createdAt)],
);
