// tests/login.kakao-oauth.spec.ts
// 목적:
// - /login 진입 → 랜덤 엔트리(환급/카카오) 클릭 → accounts.kakao.com/login 도달(load까지)
// - 카카오 로그인 URL의 continue(kauth authorize) 파라미터를 파싱해 OAuth 요청값을 검증한다.
//
// 검증 포인트(안정성 중심):
// - accounts.kakao.com/login 도달
// - continueHost == kauth.kakao.com
// - continuePathname == /oauth/authorize
// - continueParams.response_type == code
// - continueParams.redirect_uri == (기본) https://app.3o3.co.kr/login
// - client_id는 기본 “존재”만, 필요하면 env(KAKAO_CLIENT_ID)로 “값까지” 고정 검증

import { test, expect } from '@playwright/test';
import { LoginPage } from '../src/pages/LoginPage';
import { parseKakaoLoginUrl } from '../src/utils/kakao-url';
import {
  getExpectedKakaoClientId,
  getExpectedKakaoRedirectUri,
} from '../src/config/env';

test.describe('/login → Kakao OAuth 흐름', () => {
  test('랜덤 엔트리(환급 OR 카카오) 클릭 시 Kakao OAuth URL이 올바르게 구성된다.', async ({
    page,
  }) => {
    const loginPage = new LoginPage(page);

    await test.step('/login 진입', async () => {
      await loginPage.goto();
      await expect(page).toHaveURL(/\/login/);
    });

    const navResult = await test.step(
      '랜덤 엔트리 클릭 → accounts.kakao.com/login 도달',
      async () => {
        const result = await loginPage.clickEntryAndGoToKakaoLogin();

        expect(result.kakaoUrl).toMatch(
          /^https:\/\/accounts\.kakao\.com\/login\/?/,
        );

        return result;
      },
    );

    await test.step('OAuth 파라미터 검증(continue=kauth.kakao.com/oauth/authorize...)', async () => {
      const parsed = parseKakaoLoginUrl(navResult.kakaoUrl);

      expect(parsed.host, 'accounts.kakao.com이어야 합니다.').toBe(
        'accounts.kakao.com',
      );
      expect(
        parsed.pathname.startsWith('/login'),
        'path는 /login으로 시작해야 합니다.',
      ).toBeTruthy();

      expect(
        parsed.continueHost,
        'continueHost는 kauth.kakao.com이어야 합니다.',
      ).toBe('kauth.kakao.com');
      expect(
        parsed.continuePathname,
        'continuePathname은 /oauth/authorize 이어야 합니다.',
      ).toBe('/oauth/authorize');

      const params = parsed.continueParams ?? {};
      expect(
        params.response_type,
        'response_type은 code 이어야 합니다.',
      ).toBe('code');

      const expectedRedirectUri = getExpectedKakaoRedirectUri();
      expect(
        params.redirect_uri,
        'redirect_uri는 3o3 /login 이어야 합니다.',
      ).toBe(expectedRedirectUri);

      const expectedClientId = getExpectedKakaoClientId();
      if (expectedClientId) {
        expect(
          params.client_id,
          'client_id는 환경변수(KAKAO_CLIENT_ID)와 일치해야 합니다.',
        ).toBe(expectedClientId);
      } else {
        expect(
          params.client_id,
          'client_id는 존재해야 합니다.',
        ).toBeTruthy();
      }
    });
  });
});
