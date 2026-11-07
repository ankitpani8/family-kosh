import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isConfigured = Boolean(url && key);

/** The app's single Supabase client. null when the build has no backend configured. */
export const supabase: SupabaseClient | null = isConfigured
  ? createClient(url!, key!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
      realtime: { params: { eventsPerSecond: 5 } },
    })
  : null;

export function sb(): SupabaseClient {
  if (!supabase) throw new Error("Supabase is not configured for this build.");
  return supabase;
}

/** Where email links (confirmation, password reset) should send people back to. */
export function appUrl(): string {
  const configured = import.meta.env.VITE_APP_URL as string | undefined;
  if (configured) return configured;
  return window.location.origin + window.location.pathname;
}
