CREATE TABLE "memory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"trip_id" uuid,
	"kind" text NOT NULL,
	"storage_name" text NOT NULL,
	"thumb_name" text,
	"mime_type" text NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"width" integer,
	"height" integer,
	"duration_sec" double precision,
	"taken_at" timestamp with time zone,
	"lat" double precision,
	"lon" double precision,
	"caption" text,
	"shared" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memory" ADD CONSTRAINT "memory_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory" ADD CONSTRAINT "memory_trip_id_trip_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trip"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_user_idx" ON "memory" USING btree ("user_id","taken_at");--> statement-breakpoint
CREATE INDEX "memory_trip_idx" ON "memory" USING btree ("trip_id","taken_at");