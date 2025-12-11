// tests/login.page-health.spec.ts
// 목적:
// - /login 페이지에 대한 "가벼운 헬스체크"를 수행한다.
//   * 타이틀에 브랜드명이 포함되는지
//   * "환급 CTA 또는 Kakao 로그인 엔트리" 중 하나는 화면에 보이는지
//   * 페이지 진입 시 자바스크립트 런타임 에러(pageerror)가 없는지
//
// 특징:
// - A/B 테스트, 숨겨진 요소, 마케팅 카피 변경에 영향을 최소화하기 위해
//   "브랜드 + (환급 또는 Kakao 엔트리) + JS 에러 없음"만 검증한다.

import { test, expect } from '@playwright/test';
import { getLoginUrl } from '../src/config/env';
import { refundEntryCandidates } from '../src/utils/locators';

function kakaoEntryCandidatesForHealthCheck(page: import('@playwright/test').Page) {
  // 여러 버전을 흡수하기 위해 OR로 locator를 묶는다.
  const byRoleText = page.getByRole('button', {
    name: /카카오|카카오톡|카톡/i,
  });

  const byDataAttr = page.locator('[data-provider="kakao"]');

  const byHref = page.locator(
    'a[href*="kauth.kakao.com"], a[href*="accounts.kakao.com"]',
  );

  const byLogoImg = page.locator(
    'button:has(img[src*="kakao"]), a:has(img[src*="kakao"]), img[alt*="카카오"]',
  );

  return byRoleText.or(byDataAttr).or(byHref).or(byLogoImg);
}

test.describe('/login 페이지 헬스체크', () => {
  test('타이틀과 (환급 또는 Kakao) 엔트리 존재 확인', async ({ page }) => {
    await page.goto(getLoginUrl(), { waitUntil: 'networkidle' });

    // 1) 타이틀: 브랜드 기준으로 느슨하게 검사
    await expect(page).toHaveTitle(/삼쩜삼|3o3/i);

    // 2) "환급 CTA 또는 Kakao 로그인" 엔트리 후보
    const kakaoEntry = kakaoEntryCandidatesForHealthCheck(page);
    const refundEntry = refundEntryCandidates(page);

    const anyEntry = kakaoEntry.or(refundEntry);

    // Playwright의 웹 퍼스트 assertion을 써서
    // 동적 로딩을 기다리면서 "엔트리가 화면에 보이는지" 확인한다.
    // (둘 다 없다면 5초 동안 재시도 후 실패) :contentReference[oaicite:4]{index=4}
    await expect(
      anyEntry.first(),
      '환급 CTA 또는 Kakao 로그인 엔트리가 화면에 최소 1개는 보여야 합니다.',
    ).toBeVisible();
  });

  test('페이지 진입 시 자바스크립트 런타임 에러가 없어야 함', async ({ page }) => {
    const pageErrors: string[] = [];

    // window.onerror / unhandledrejection 기반 런타임 에러 수집
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
