import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './lib/i18n';
import './styles/index.css';
import { queryClient, TRPCProvider, trpcClient } from './lib/trpc';
import { router } from './router';

// Safari su iPhone ignora "user-scalable=no": si ferma qui lo zoom della pagina con il pizzico.
// Lo zoom resta sulle immagini (ZoomImage), che usano il tocco e non questi eventi.
for (const type of ['gesturestart', 'gesturechange', 'gestureend'])
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <RouterProvider router={router} />
      </TRPCProvider>
    </QueryClientProvider>
  </StrictMode>,
);
