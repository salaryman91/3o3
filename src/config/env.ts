// src/config/env.ts
// 목적:
// - 테스트 환경 값을 한 곳에서 관리한다.
// - OAuth 요청값 검증에서 기대값(redirect_uri, client_id)을 환경변수로 오버라이드 가능하게 한다.
//
// 환경변수:
// - BASE_URL: 기본 https://app.3o3.co.kr
// - LOGIN_PATH: 기본 /login
// - KAKAO_CLIENT_ID: (옵션) client_id 기대값 고정 검증용
// - KAKAO_REDIRECT_URI: (옵션) redirect_uri 기대값 고정 검증용(기본값은 BASE_URL + LOGIN_PATH)

import 'dotenv/config';

export type EnvConfig = {
  baseUrl: string;
  loginPath: string;
};

let cachedEnv: EnvConfig | null = null;

export function getEnv(): EnvConfig {
  if (cachedEnv) return cachedEnv;

  const baseUrl = (process.env.BASE_URL ?? 'https://app.3o3.co.kr').trim();
  const loginPath = (process.env.LOGIN_PATH ?? '/login').trim();

  const normalizedBaseUrl = baseUrl.endsWith('/')
    ? baseUrl.slice(0, -1)
    : baseUrl;

  cachedEnv = {
    baseUrl: normalizedBaseUrl,
    loginPath,
  };

  return cachedEnv;
}

export function getLoginUrl(): string {
  const { baseUrl, loginPath } = getEnv();
  return `${baseUrl}${loginPath.startsWith('/') ? loginPath : `/${loginPath}`}`;
}

export function getExpectedKakaoClientId(): string | undefined {
  const v = (process.env.KAKAO_CLIENT_ID ?? '').trim();
  return v.length ? v : undefined;
}

export function getExpectedKakaoRedirectUri(): string {
  const v = (process.env.KAKAO_REDIRECT_URI ?? '').trim();
  return v.length ? v : getLoginUrl();
}
