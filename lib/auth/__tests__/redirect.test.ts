import { describe, expect, it } from "vitest";
import { DEFAULT_REDIRECT, safeRedirectTarget } from "../redirect";

describe("ログイン後の遷移先", () => {
  it("アプリ内のパスはそのまま通す", () => {
    expect(safeRedirectTarget("/buildings")).toBe("/buildings");
    expect(safeRedirectTarget("/duplicates")).toBe("/duplicates");
    expect(safeRedirectTarget("/buildings?city=荒川区")).toBe("/buildings?city=荒川区");
  });

  it("プロトコル相対URLで外部へ飛ばせない", () => {
    // "//example.com" は先頭が "/" だが、ブラウザは外部サイトと解釈する
    expect(safeRedirectTarget("//example.com")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectTarget("//example.com/path")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectTarget("/\\example.com")).toBe(DEFAULT_REDIRECT);
  });

  it("絶対URLは受け付けない", () => {
    expect(safeRedirectTarget("https://example.com")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectTarget("javascript:alert(1)")).toBe(DEFAULT_REDIRECT);
  });

  it("空や未指定なら既定の遷移先", () => {
    expect(safeRedirectTarget("")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectTarget(null)).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectTarget(undefined)).toBe(DEFAULT_REDIRECT);
  });
});
