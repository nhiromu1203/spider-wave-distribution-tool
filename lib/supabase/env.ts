/**
 * Supabase の接続情報。未設定でもアプリがクラッシュせず、
 * セットアップ手順を案内できるようにする。
 */

export type SupabaseEnv = {
  url: string;
  anonKey: string;
};

export function readSupabaseEnv(): SupabaseEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey || url.includes("xxxxxxxx")) return null;
  return { url, anonKey };
}

export function requireSupabaseEnv(): SupabaseEnv {
  const env = readSupabaseEnv();
  if (!env) {
    throw new Error(
      "Supabase の接続情報が設定されていません。.env.local に NEXT_PUBLIC_SUPABASE_URL と NEXT_PUBLIC_SUPABASE_ANON_KEY を設定してください。",
    );
  }
  return env;
}

export const isSupabaseConfigured = () => readSupabaseEnv() !== null;
