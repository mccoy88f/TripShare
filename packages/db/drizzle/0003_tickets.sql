CREATE TABLE "booking_ticket" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"booking_id" text NOT NULL,
	"member_id" uuid,
	"label" text,
	"file_name" text,
	"storage_name" text,
	"mime_type" text,
	"size" integer,
	"code_format" text,
	"code_value" text,
	"wallet_url" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "booking_ticket" ADD CONSTRAINT "booking_ticket_trip_id_trip_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_ticket" ADD CONSTRAINT "booking_ticket_member_id_trip_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."trip_member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_ticket" ADD CONSTRAINT "booking_ticket_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_ticket_trip_idx" ON "booking_ticket" USING btree ("trip_id","booking_id");