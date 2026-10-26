import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// A channel = one brand destination = one YT account + one IG account + a schedule.
export const channels = pgTable("channels", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  ctaTemplate: text("cta_template"),
  scheduleTz: text("schedule_tz").notNull().default("Asia/Kolkata"),
  postTimes: text("post_times")
    .array()
    .notNull()
    .default(["05:00", "13:00", "21:00"]),
  // True whenever the most recent YouTube upload for this channel came back
  // privacyStatus=private despite requesting public — the tell-tale sign the
  // Data API project's compliance audit hasn't been approved yet.
  youtubeAuditPending: boolean("youtube_audit_pending").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// One row per connected social account, grouped under a channel.
export const connections = pgTable(
  "connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(), // 'youtube' | 'instagram'
    accountId: text("account_id").notNull(), // YT channel id | IG business user id
    pageId: text("page_id"), // IG only: linked Facebook Page id
    accessTokenEnc: text("access_token_enc").notNull(), // AES-GCM encrypted
    refreshTokenEnc: text("refresh_token_enc"), // AES-GCM encrypted (YT). IG uses long-lived token
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("connections_channel_platform_unique").on(
      table.channelId,
      table.platform,
    ),
  ],
);

export const sourceVideos = pgTable("source_videos", {
  id: uuid("id").primaryKey().defaultRandom(),
  channelId: uuid("channel_id")
    .notNull()
    .references(() => channels.id, { onDelete: "cascade" }),
  sourceType: text("source_type").notNull(), // 'upload' | 'youtube_url'
  sourceUrl: text("source_url"), // the YT URL if applicable
  storageKey: text("storage_key"), // R2 key of the source file
  caption: text("caption"), // operator-provided; shared by every clip cut from this video
  durationMs: integer("duration_ms"),
  transcript: jsonb("transcript"), // whisper segments with word timestamps
  status: text("status").notNull().default("ingesting"), // ingesting|transcribing|ready|failed
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const clips = pgTable("clips", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceVideoId: uuid("source_video_id")
    .notNull()
    .references(() => sourceVideos.id, { onDelete: "cascade" }),
  partNumber: integer("part_number").notNull(), // 1-indexed position among clips from the same source video
  startMs: integer("start_ms").notNull(),
  endMs: integer("end_ms").notNull(), // enforce (end_ms - start_ms) <= 90000
  title: text("title"), // "Part N #Shorts"
  renderKey: text("render_key"), // R2 key of rendered vertical mp4
  status: text("status").notNull().default("draft"), // draft|approved|rendered|scheduled|posted|failed
  error: text("error"),
  postedAt: timestamp("posted_at", { withTimezone: true }), // set once both platforms report posted
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const publishJobs = pgTable("publish_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  clipId: uuid("clip_id")
    .notNull()
    .references(() => clips.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(), // 'youtube' | 'instagram'
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("pending"), // pending|publishing|posted|failed
  externalPostId: text("external_post_id"), // YT video id | IG media id
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
