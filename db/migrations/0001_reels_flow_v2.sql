ALTER TABLE "source_videos" ADD COLUMN "caption" text;
--> statement-breakpoint
ALTER TABLE "clips" ADD COLUMN "part_number" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "clips" ALTER COLUMN "part_number" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "clips" ADD COLUMN "posted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "clips" DROP COLUMN "caption";
--> statement-breakpoint
ALTER TABLE "clips" DROP COLUMN "hashtags";
