import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import { authController } from '@/lib/auth-controller';
import { queryClient, reportConfigurationStatus } from '@/lib/query-client';
import { supabase } from '@/lib/supabase';
import { router } from '@/router';
import '@/index.css';

reportConfigurationStatus();

// Keep the auth controller in step with token refreshes and sign-outs that
// happen outside React (e.g. Supabase's auto token refresh).
supabase.auth.onAuthStateChange((_event, session) => {
  authController.handleExternalSession(session);
});

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root was not found in index.html');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster
        theme="dark"
        position="bottom-right"
        richColors={false}
        toastOptions={{
          classNames: {
            toast:
              '!rounded-xl !border-kv-line !bg-kv-raised !text-kv-white !font-sans !text-sm !shadow-lift',
            description: '!text-kv-muted',
            actionButton: '!rounded-full !bg-kv-white !text-kv-bg',
          },
        }}
      />
    </QueryClientProvider>
  </StrictMode>,
);
