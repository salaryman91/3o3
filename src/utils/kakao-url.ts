// src/utils/kakao-url.ts
// 목적:
// - accounts.kakao.com/login URL 및 continue(=kauth.kakao.com/oauth/authorize...) 파라미터를 파싱한다.
// - OAuth 요청값(client_id, redirect_uri, response_type 등)을 테스트에서 검증할 수 있게 한다.

export const KAKAO_ACCOUNTS_LOGIN_RE = /^https:\/\/accounts\.kakao\.com\/login\/?/i;

export type ParsedKakaoLoginUrl = {
  url: string;
  host: string;          // accounts.kakao.com
  pathname: string;      // /login ...
  searchParams: Record<string, string>;

  // continue(내부 authorize) 파싱 결과
  continueUrl?: string;
  continueHost?: string;         // kauth.kakao.com
  continuePathname?: string;     // /oauth/authorize ...
  continueParams?: Record<string, string>;
};

export function isKakaoAccountsLoginUrl(url: string): boolean {
  return KAKAO_ACCOUNTS_LOGIN_RE.test(url);
}

export function parseKakaoLoginUrl(rawUrl: string): ParsedKakaoLoginUrl {
  const url = new URL(rawUrl);

  const parsed: ParsedKakaoLoginUrl = {
    url: rawUrl,
    host: url.host,
    pathname: url.pathname,
    searchParams: Object.fromEntries(url.searchParams.entries()),
  };

  const cont = url.searchParams.get('continue');
  if (!cont) return parsed;

  parsed.continueUrl = cont;

  try {
    const cu = new URL(cont);
    parsed.continueHost = cu.host;
    parsed.continuePathname = cu.pathname;
    parsed.continueParams = Object.fromEntries(cu.searchParams.entries());
  } catch {
    // continue가 URL이 아닐 수도 있으니(예외 케이스) 파싱 실패를 치명 오류로 만들지 않는다.
  }

  return parsed;
}
