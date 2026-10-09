CREATE TABLE "ai_conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_chat_message" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_conversation" ADD CONSTRAINT "ai_conversation_trip_id_trip_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversation" ADD CONSTRAINT "ai_conversation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_conversation_trip_user_idx" ON "ai_conversation" USING btree ("trip_id","user_id","updated_at");--> statement-breakpoint
ALTER TABLE "ai_chat_message" ADD CONSTRAINT "ai_chat_message_conversation_id_ai_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "ai_conversation" ("trip_id", "user_id", "title", "created_at", "updated_at")
SELECT "trip_id", "user_id", 'Chat', min("created_at"), max("created_at") FROM "ai_chat_message" GROUP BY "trip_id", "user_id";--> statement-breakpoint
UPDATE "ai_chat_message" m SET "conversation_id" = c."id" FROM "ai_conversation" c WHERE c."trip_id" = m."trip_id" AND c."user_id" = m."user_id";
