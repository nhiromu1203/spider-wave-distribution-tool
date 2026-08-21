"use client";

import { useState, useTransition } from "react";
import { signInWithGoogle } from "./actions";

/**
 * Google でログインする。
 *
 * 押した時点では誰がログインするか分からないため、ここでは
 * 許可アカウントかどうかを判断しない。Google から戻ってきた
 * /auth/callback で、認証後のメールアドレスを見て判断する。
 */
export function GoogleSignInButton({ next }: { next: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <button
        type="button"
        className="btn w-full"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            // 成功した場合はここで Google へ遷移するため、戻り値は来ない
            const result = await signInWithGoogle(next);
            if (result?.error) setError(result.error);
          })
        }
      >
        {pending ? "Google へ移動しています…" : "Google でログイン"}
      </button>

      {error && (
        <p
          role="alert"
          className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      )}
    </div>
  );
}
