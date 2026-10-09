import { adminClient, inferAdditionalFields, magicLinkClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  basePath: '/api/auth',
  plugins: [
    adminClient(),
    magicLinkClient(),
    // Campi del profilo accettati in registrazione (vedi apps/api/src/auth.ts).
    inferAdditionalFields({
      user: {
        locale: { type: 'string', required: false },
        defaultCurrency: { type: 'string', required: false },
      },
    }),
  ],
});

export const { useSession, signIn, signUp, signOut } = authClient;
