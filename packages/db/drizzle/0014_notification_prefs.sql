CREATE TABLE "notification_pref" (
	"user_id" text PRIMARY KEY NOT NULL,
	"disabled" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trip_member" ADD COLUMN "notifications_muted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_pref" ADD CONSTRAINT "notification_pref_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;