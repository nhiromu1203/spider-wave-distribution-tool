/**
 * Supabase の接続情報。未設定でもアプリがクラッシュせず、
 * セットアップ手順を案内できるようにする。
 *
 * ── 実際に起きた不具合 ──────────────────────────────────────
 * Vercel の Environment Variables へ値を貼り付ける際、
 *   ・引用符ごと貼る            "sb_publishable_..."
 *   ・変数名ごと貼る            NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
 *   ・前後に空白や改行が混じる
 * といった取り違えが起きやすい。
 *
 * これらはいずれも「値が入っているが正しくない」状態になり、
 * Supabase は 401「Invalid API key」を返す。どこが悪いのか画面からは
 * 分からないため、ここで値を整えたうえで、形の異常を具体的に指摘する。
 * ────────────────────────────────────────────────────────────
 */

export type SupabaseEnv = {
  url: string;
  anonKey: string;
};

const URL_VAR = "NEXT_PUBLIC_SUPABASE_URL";
const KEY_VAR = "NEXT_PUBLIC_SUPABASE_ANON_KEY";

/**
 * 環境変数の値から、貼り付け時に紛れ込みやすいものを取り除く。
 *
 * 値そのものは変えない。取り除くのは「明らかに値ではない部分」だけ。
 */
export function sanitizeEnvValue(
  raw: string | undefined,
  variableName: string,
): string | null {
  if (raw === undefined) return null;

  let value = raw.trim();
  if (value === "") return null;

  // "NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_..." のように変数名ごと貼られた場合
  if (value.startsWith(`${variableName}=`)) {
    value = value.slice(variableName.length + 1).trim();
  }

  // "..." や '...' のように引用符ごと貼られた場合（前後が対になっているときだけ外す）
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
    value = value.slice(1, -1).trim();
  }

  return value === "" ? null : value;
}

/** API キーの種別 */
export type SupabaseKeyKind =
  | "publishable" // sb_publishable_… 新方式。ブラウザに配信してよい
  | "secret" // sb_secret_…      サーバー専用。RLS を迂回するため使ってはいけない
  | "legacy_jwt" // eyJ…             旧方式の anon / service_role
  | "unknown";

export function classifySupabaseKey(key: string): SupabaseKeyKind {
  if (key.startsWith("sb_publishable_")) return "publishable";
  if (key.startsWith("sb_secret_")) return "secret";
  if (key.startsWith("eyJ")) return "legacy_jwt";
  return "unknown";
}

export type SupabaseEnvDiagnosis = {
  env: SupabaseEnv | null;
  /** 設定はされているが形がおかしい場合の指摘 */
  problems: string[];
  urlPresent: boolean;
  keyPresent: boolean;
  keyKind: SupabaseKeyKind | null;
};

/**
 * 接続情報を読み、形の異常を洗い出す。
 * 値そのものは返さない診断用（画面やログに出しても安全な内容だけ）。
 */
export function diagnoseSupabaseEnv(): SupabaseEnvDiagnosis {
  // NEXT_PUBLIC_ の値は、ビルド時にこの「静的な参照」だけが実際の値へ置き換わる。
  // process.env[URL_VAR] のように変数で参照するとブラウザ側で undefined になるため、
  // 必ずこの形のまま書くこと。
  const url = sanitizeEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL, URL_VAR);
  const anonKey = sanitizeEnvValue(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, KEY_VAR);
  const problems: string[] = [];

  if (!url) {
    problems.push(`${URL_VAR} が設定されていません。`);
  } else if (url.includes("xxxxxxxx")) {
    problems.push(`${URL_VAR} が .env.example のままです。`);
  } else if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/.test(url)) {
    problems.push(
      `${URL_VAR} の形式が違います。https://<プロジェクトID>.supabase.co の形で、末尾に / やパスを付けずに設定してください。`,
    );
  }

  const keyKind = anonKey ? classifySupabaseKey(anonKey) : null;

  if (!anonKey) {
    problems.push(`${KEY_VAR} が設定されていません。`);
  } else if (keyKind === "secret") {
    problems.push(
      `${KEY_VAR} に secret key（sb_secret_…）が設定されています。RLS を迂回するため使用できません。Publishable key（sb_publishable_…）に変更してください。`,
    );
  } else if (keyKind === "unknown") {
    problems.push(
      `${KEY_VAR} の形式が違います。sb_publishable_… または eyJ… で始まる値を、引用符・変数名・改行を含めずに設定してください。`,
    );
  }

  const usable =
    url !== null &&
    anonKey !== null &&
    !url.includes("xxxxxxxx") &&
    keyKind !== "secret" &&
    keyKind !== "unknown";

  return {
    env: usable ? { url, anonKey } : null,
    problems,
    urlPresent: url !== null,
    keyPresent: anonKey !== null,
    keyKind,
  };
}

export function readSupabaseEnv(): SupabaseEnv | null {
  return diagnoseSupabaseEnv().env;
}

export function requireSupabaseEnv(): SupabaseEnv {
  const diagnosis = diagnoseSupabaseEnv();
  if (!diagnosis.env) {
    throw new Error(
      `Supabase の接続情報を読み取れません。${diagnosis.problems.join(" ")}`,
    );
  }
  return diagnosis.env;
}

export const isSupabaseConfigured = () => readSupabaseEnv() !== null;

/**
 * サーバー側だけで使う秘密鍵（service_role）。
 *
 * ── なぜ必要か ──────────────────────────────────────────────
 * ログインを不要にしたため、ブラウザから来る利用者は誰も認証されない。
 * DB の権限は authenticated に対して与えてあるので、そのままでは
 * 一覧の取得も CSV 取込も権限不足で失敗する。
 *
 * かといって anon に読み書きを開けると、URL さえ分かれば誰でも
 * DB を直接叩けてしまう。そこで DB へは必ずサーバー側から触り、
 * その際にこの鍵を使う。鍵はブラウザへ送られない。
 *
 * ── 扱いの注意 ──────────────────────────────────────────────
 * この鍵は RLS を迂回する。NEXT_PUBLIC_ を付けてはいけない。
 * 付けるとビルド時にブラウザ向けのコードへ埋め込まれ、公開される。
 * ────────────────────────────────────────────────────────────
 */
export function readServiceRoleKey(): string | null {
  const raw = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const key = sanitizeEnvValue(raw, "SUPABASE_SERVICE_ROLE_KEY");
  if (!key) return null;

  // 取り違え防止。publishable key を入れても RLS は迂回できない
  if (classifySupabaseKey(key) === "publishable") return null;

  return key;
}
