CREATE TABLE "packing_check" (
	"trip_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"member_id" uuid NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "packing_check_trip_id_item_id_member_id_pk" PRIMARY KEY("trip_id","item_id","member_id")
);
--> statement-breakpoint
ALTER TABLE "trip" ADD COLUMN "plan" jsonb;--> statement-breakpoint
ALTER TABLE "trip" ADD COLUMN "plan_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "packing_check" ADD CONSTRAINT "packing_check_trip_id_trip_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_check" ADD CONSTRAINT "packing_check_member_id_trip_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."trip_member"("id") ON DELETE cascade ON UPDATE no action;