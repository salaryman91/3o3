// tests/health_chech.spec.ts

import { test, expect } from '@playwright/test';
import { getLoginUrl } from '../src/config/env';
import { kakaoEntryCandidates, refundEntryCandidates } from '../src/utils/locators';
import { LoginPage } from '../src/pages/LoginPage';

test.describe('/login 페이지 헬스체크', () => {
  test('타이틀과 (환급 또는 Kakao) 엔트리 존재 확인', async ({ page }) => {
    const loginPage = new LoginPage(page);

    await page.goto(getLoginUrl(), { waitUntil: 'networkidle' });

    // 진입 직후 + 잠깐 지켜보면서 모달이 뜨면 닫는다.
    await loginPage.closeExpectedRefundInfoIfOpen();

    await expect(page).toHaveTitle(/삼쩜삼|3o3/i);

    const kakaoEntry = kakaoEntryCandidates(page);
    const refundEntry = refundEntryCandidates(page);
    const anyEntry = kakaoEntry.or(refundEntry);

    const count = await anyEntry.count();
    expect(
      count,
      '환급 CTA 또는 Kakao 로그인 엔트리 후보(locator.or 집합)가 DOM에 최소 1개는 존재해야 합니다.',
    ).toBeGreaterThan(0);

    await expect(
      anyEntry.first(),
      '환급 CTA 또는 Kakao 로그인 엔트리 중 하나는 실제로 화면에 보여야 합니다.',
    ).toBeVisible();
  });

  test('페이지 진입 시 자바스크립트 런타임 에러가 없어야 함', async ({ page }) => {
    const pageErrors: string[] = [];

    page.on('pageerror', (error) => {
      pageErrors.push(error.message ?? String(error));
    });

    await page.goto(getLoginUrl(), { waitUntil: 'load' });

    expect(
      pageErrors,
      `페이지 진입 중 pageerror가 발생했습니다:\n${pageErrors.join('\n')}`,
    ).toEqual([]);
  });
});
