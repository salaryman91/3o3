// src/pages/LoginPage.ts
/**
 * 목적:
 * - /login 페이지에서 "환급 CTA OR 카카오" 랜덤 진입을 처리하고,
 *   카카오 로그인 페이지(accounts.kakao.com/login) 도달까지 대기한다.
 * - Kakao 엔트리는 A/B 테스트나 UI 버전에 따라 구조가 달라질 수 있으므로,
 *   여러 locator 후보를 OR로 묶어서 안정적으로 탐색한다.
 */

import { expect, type Locator, type Page } from '@playwright/test';
import { getLoginUrl } from '../config/env';
import {
  KAKAO_LOGO_SRC_PART,
  refundEntryCandidates,
} from '../utils/locators';
import {
  KAKAO_ACCOUNTS_LOGIN_RE,
  isKakaoAccountsLoginUrl,
} from '../utils/kakao-url';

export type EntryType = 'kakao' | 'refund';

export type KakaoNavResult = {
  entryClicked: EntryType;
  mode: 'same-tab' | 'popup';
  kakaoPage: Page;
  kakaoUrl: string;
};

export class LoginPage {
  constructor(private readonly page: Page) {}

  /** /login 진입 */
  async goto(): Promise<void> {
    await this.page.goto(getLoginUrl(), { waitUntil: 'domcontentloaded' });
  }

  /**
   * Kakao 엔트리 후보:
   * - 버튼 텍스트에 "카카오/카카오톡/카톡"이 포함된 버튼
   * - data-provider="kakao" 속성이 있는 요소
   * - href에 kauth/ accounts.kakao.com 이 포함된 링크
   * - Kakao 로고 이미지가 포함된 버튼/링크
   *
   * 여러 버전(A/B 테스트, UI 개편 등)을 흡수하기 위해 OR로 묶는다.
   */
  private kakaoCandidates(): Locator {
    const { page } = this;

    const byRoleText = page.getByRole('button', {
      name: /카카오|카카오톡|카톡/i,
    });

    const byDataAttr = page.locator('[data-provider="kakao"]');

    const byHref = page.locator(
      'a[href*="kauth.kakao.com"], a[href*="accounts.kakao.com"]',
    );

    const byLogoImg = page.locator(
      `button:has(img[src*="${KAKAO_LOGO_SRC_PART}"]), a:has(img[src*="${KAKAO_LOGO_SRC_PART}"])`,
    );

    return byRoleText.or(byDataAttr).or(byHref).or(byLogoImg);
  }

  /** 환급 CTA 후보 (구조 기반) */
  private refundCandidates(): Locator {
    return refundEntryCandidates(this.page);
  }

  /** 가장 큰 버튼(넓이 기준)을 선택 */
  private async pickLargest(candidates: Locator): Promise<Locator> {
    const count = await candidates.count();
    if (count === 0) {
      throw new Error('환급 CTA 후보가 없습니다.');
    }

    let largestIndex = 0;
    let largestArea = 0;

    for (let i = 0; i < count; i++) {
      const el = candidates.nth(i);
      const box = await el.boundingBox();
      if (!box) continue;

      const area = box.width * box.height;
      if (area > largestArea) {
        largestArea = area;
        largestIndex = i;
      }
    }

    return candidates.nth(largestIndex);
  }

  /**
   * 어떤 Locator를 클릭하면 카카오 로그인으로 이동하는지 불확실할 때:
   * - popup(새창) / same-tab(현재 탭) 두 경로를 동시에 대기한다.
   * - waitForURL에는 waitUntil: 'load'를 사용해 페이지 로드까지 기다린다.
   */
  private async clickAndWaitForKakaoLogin(
    target: Locator,
  ): Promise<{ mode: 'same-tab' | 'popup'; kakaoPage: Page }> {
    const popupPromise = this.page
      .waitForEvent('popup', { timeout: 5_000 })
      .then((p) => ({ mode: 'popup' as const, kakaoPage: p }))
      .catch(() => null);

    const sameTabPromise = this.page
      .waitForURL(KAKAO_ACCOUNTS_LOGIN_RE, {
        timeout: 15_000,
        waitUntil: 'load',
      })
      .then(() => ({ mode: 'same-tab' as const, kakaoPage: this.page }))
      .catch(() => null);

    await target.click({ noWaitAfter: true });

    const firstHit = await Promise.race([popupPromise, sameTabPromise]);

    if (firstHit?.mode === 'popup') {
      await firstHit.kakaoPage.waitForURL(KAKAO_ACCOUNTS_LOGIN_RE, {
        timeout: 15_000,
        waitUntil: 'load',
      });
      return firstHit;
    }

    if (firstHit?.mode === 'same-tab') {
      return firstHit;
    }

    throw new Error('카카오 로그인 페이지로의 내비게이션을 감지하지 못했습니다.');
  }

  /**
   * 요구사항:
   * - "환급금 OR 카카오" 랜덤 노출 → 클릭 → 카카오 로그인 페이지(accounts.kakao.com/login) 도달까지
   * - Kakao 엔트리는 여러 버전이 존재할 수 있으므로 kakaoCandidates()로 통합 관리한다.
   */
  async clickEntryAndGoToKakaoLogin(): Promise<KakaoNavResult> {
    const kakao = this.kakaoCandidates();
    const refund = this.refundCandidates();

    // 둘 중 하나라도 나타나면 진행 (숨겨진 요소가 많으므로 or 집합의 first 기준)
    await expect(kakao.or(refund).first()).toBeVisible();

    // 1) 첫 클릭 타겟 결정
    let entryClicked: EntryType;
    let firstTarget: Locator;

    if ((await kakao.count()) > 0) {
      entryClicked = 'kakao';
      firstTarget = kakao.first();
    } else {
      entryClicked = 'refund';
      firstTarget = await this.pickLargest(refund);
    }

    // 2) 클릭 후 카카오 로그인 페이지 대기
    let nav = await this.clickAndWaitForKakaoLogin(firstTarget);
    let kakaoUrl = nav.kakaoPage.url();

    // 3) refund를 눌렀는데 아직 카카오 URL이 아니라면, Kakao 엔트리를 다시 탐색 후 1회 추가 시도
    if (!isKakaoAccountsLoginUrl(kakaoUrl)) {
      const kakaoAgain = this.kakaoCandidates();
      if ((await kakaoAgain.count()) > 0) {
        nav = await this.clickAndWaitForKakaoLogin(kakaoAgain.first());
        kakaoUrl = nav.kakaoPage.url();
        entryClicked = 'kakao';
      }
    }

    // 최종 검증
    expect(
      isKakaoAccountsLoginUrl(kakaoUrl),
      `카카오 로그인 URL 도달 실패: 현재 URL=${kakaoUrl}`,
    ).toBeTruthy();

    return {
      entryClicked,
      mode: nav.mode,
      kakaoPage: nav.kakaoPage,
      kakaoUrl,
    };
  }
}
