CREATE TABLE "trip_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"emoji" text,
	"title" text,
	"content" text NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "status" text DEFAULT 'paid' NOT NULL;--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "booking_id" text;--> statement-breakpoint
ALTER TABLE "trip_note" ADD CONSTRAINT "trip_note_trip_id_trip_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_note" ADD CONSTRAINT "trip_note_member_id_trip_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."trip_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trip_note_trip_idx" ON "trip_note" USING btree ("trip_id","created_at");