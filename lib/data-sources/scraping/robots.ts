/**
 * robots.txt の取得と判定。
 *
 * 取得先が自動アクセスを拒否している場合は、その判断に従って取得を停止する。
 * 回避処理（User-Agent の付け替え、別経路からの再取得など）は実装しない。
 */

export type RobotsRule = {
  type: "allow" | "disallow";
  path: string;
};

export type RobotsGroup = {
  userAgents: string[];
  rules: RobotsRule[];
  crawlDelayMs: number | null;
};

export type RobotsTxt = {
  groups: RobotsGroup[];
  /** 取得できなかった場合の理由。null なら正常に取得できた */
  fetchError: string | null;
};

/** robots.txt の本文を構文解析する */
export function parseRobotsTxt(body: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  // 直前の行も User-agent だった場合、同じグループに属する
  let lastLineWasUserAgent = false;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;

    const separator = line.indexOf(":");
    if (separator < 0) continue;

    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "user-agent") {
      if (!current || !lastLineWasUserAgent) {
        current = { userAgents: [], rules: [], crawlDelayMs: null };
        groups.push(current);
      }
      current.userAgents.push(value.toLowerCase());
      lastLineWasUserAgent = true;
      continue;
    }

    lastLineWasUserAgent = false;
    if (!current) continue;

    if (field === "disallow") {
      // 空の Disallow は「制限なし」を意味する
      if (value !== "") current.rules.push({ type: "disallow", path: value });
    } else if (field === "allow") {
      if (value !== "") current.rules.push({ type: "allow", path: value });
    } else if (field === "crawl-delay") {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) {
        current.crawlDelayMs = Math.round(seconds * 1000);
      }
    }
  }

  return groups;
}

/** 自分の User-Agent に最も適合するグループを選ぶ（完全一致 > ワイルドカード） */
function selectGroup(groups: RobotsGroup[], userAgent: string): RobotsGroup | null {
  const ua = userAgent.toLowerCase();

  let wildcard: RobotsGroup | null = null;
  let specific: RobotsGroup | null = null;
  let specificLength = -1;

  for (const group of groups) {
    for (const token of group.userAgents) {
      if (token === "*") {
        wildcard ??= group;
        continue;
      }
      // robots.txt の User-agent は前方一致で照合するのが慣例
      if (ua.includes(token) && token.length > specificLength) {
        specific = group;
        specificLength = token.length;
      }
    }
  }

  return specific ?? wildcard;
}

/** robots.txt のパスパターンを 1 本のパスに照合する（* と $ に対応） */
function matchesPath(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;

  const segments = body.split("*");
  let index = 0;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment === "") continue;

    const found = i === 0 ? (path.startsWith(segment) ? 0 : -1) : path.indexOf(segment, index);
    if (found < 0) return false;
    index = found + segment.length;
  }

  if (anchored) return index === path.length;
  return true;
}

export type RobotsDecision = {
  allowed: boolean;
  /** 拒否された場合の理由（画面にそのまま出せる日本語） */
  reason: string | null;
  /** robots.txt が指定していた Crawl-delay（ms） */
  crawlDelayMs: number | null;
};

/**
 * 指定パスへのアクセスが許可されているか判定する。
 * 最長一致のルールが優先され、同じ長さなら Allow が優先される（一般的な実装に合わせる）。
 */
export function isPathAllowed(
  groups: RobotsGroup[],
  userAgent: string,
  path: string,
): RobotsDecision {
  const group = selectGroup(groups, userAgent);
  if (!group) return { allowed: true, reason: null, crawlDelayMs: null };

  let best: { rule: RobotsRule; length: number } | null = null;

  for (const rule of group.rules) {
    if (!matchesPath(rule.path, path)) continue;
    const length = rule.path.length;
    if (
      !best ||
      length > best.length ||
      (length === best.length && rule.type === "allow")
    ) {
      best = { rule, length };
    }
  }

  if (best && best.rule.type === "disallow") {
    return {
      allowed: false,
      reason: `robots.txt がこのパスへの自動アクセスを拒否しています（Disallow: ${best.rule.path}）。取得を中止します。`,
      crawlDelayMs: group.crawlDelayMs,
    };
  }

  return { allowed: true, reason: null, crawlDelayMs: group.crawlDelayMs };
}

/**
 * robots.txt を取得する。
 *
 * 取得できなかった場合は「拒否」として扱う。
 * 相手の意思が確認できない状態で自動アクセスを続けないため。
 */
export async function fetchRobotsTxt(
  baseUrl: string,
  userAgent: string,
  timeoutMs: number,
): Promise<RobotsTxt> {
  const url = new URL("/robots.txt", baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": userAgent, Accept: "text/plain" },
      signal: controller.signal,
      cache: "no-store",
    });

    // 404 は「robots.txt が無い＝制限なし」として扱うのが慣例
    if (response.status === 404) return { groups: [], fetchError: null };

    if (!response.ok) {
      return {
        groups: [],
        fetchError: `robots.txt を取得できませんでした (HTTP ${response.status})。相手の意思を確認できないため取得を中止します。`,
      };
    }

    return { groups: parseRobotsTxt(await response.text()), fetchError: null };
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? `robots.txt の取得がタイムアウトしました（${timeoutMs}ms）。`
        : `robots.txt を取得できませんでした: ${
            error instanceof Error ? error.message : String(error)
          }`;
    return { groups: [], fetchError: `${message} 取得を中止します。` };
  } finally {
    clearTimeout(timer);
  }
}
