-- Le chat create dalla migrazione delle conversazioni (titolo "Chat") prendono come titolo
-- la prima domanda dell'utente, come le chat nuove.
UPDATE "ai_conversation" c
SET "title" = left(regexp_replace(trim(m."content"), '\s+', ' ', 'g'), 60)
FROM (
  SELECT DISTINCT ON ("conversation_id") "conversation_id", "content"
  FROM "ai_chat_message"
  WHERE "role" = 'user' AND "conversation_id" IS NOT NULL
  ORDER BY "conversation_id", "created_at"
) m
WHERE m."conversation_id" = c."id" AND c."title" = 'Chat';
