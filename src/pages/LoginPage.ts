// src/pages/LoginPage.ts

import { expect, type Locator, type Page } from '@playwright/test';
import { getLoginUrl } from '../config/env';
import { kakaoEntryCandidates, refundEntryCandidates } from '../utils/locators';
import { KAKAO_ACCOUNTS_LOGIN_RE, isKakaoAccountsLoginUrl } from '../utils/kakao-url';

export type EntryType = 'kakao' | 'refund';

export type KakaoNavResult = {
  entryClicked: EntryType;
  mode: 'same-tab' | 'popup';
  kakaoPage: Page;
  kakaoUrl: string;
};

export class LoginPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto(getLoginUrl(), { waitUntil: 'domcontentloaded' });
  }

  private kakaoCandidates(): Locator {
    return kakaoEntryCandidates(this.page);
  }

  private refundCandidates(): Locator {
    return refundEntryCandidates(this.page);
  }

  /**
   * "/login" 상단에 노출될 수 있는
   * "예상 환급액 계산 기준" 모달이 떠 있으면 닫는다.
   *
   * - 모달이 늦게 뜨는 경우를 대비해 짧게 polling 한다.
   * - 실패해도 예외를 던지지 않고 조용히 넘어간다(헬스체크/로그인 공통 사용).
   */
  async closeExpectedRefundInfoIfOpen(maxWaitMs = 5000): Promise<void> {
    const dialog = this.page.getByRole('dialog', {
      name: /예상 환급액 계산 기준/i,
    });
    const confirmButton = this.page.getByRole('button', { name: '확인' });

    const start = Date.now();

    while (Date.now() - start < maxWaitMs) {
      let count = 0;
      try {
        count = await dialog.count();
      } catch {
        count = 0;
      }

      if (count > 0) {
        const first = dialog.first();
        const visible = await first.isVisible().catch(() => false);

        if (visible) {
          try {
            await confirmButton.click();
            await first
              .waitFor({ state: 'hidden', timeout: 3000 })
              .catch(() => {});
          } catch {
            // 모달이 닫히지 않아도 여기서 예외는 삼킨다.
          }
          break;
        }
      }

      // 아직 모달이 안 뜬 경우 잠깐 대기 후 다시 확인
      await this.page.waitForTimeout(200);
    }
  }

  private async pickLargest(locator: Locator): Promise<Locator> {
    const count = await locator.count();
    if (count <= 1) return locator.first();

    const index = await locator.evaluateAll((els) => {
      let bestIdx = 0;
      let bestArea = -1;
      for (let i = 0; i < els.length; i++) {
        const r = els[i].getBoundingClientRect();
        const area = r.width * r.height;
        if (area > bestArea) {
          bestArea = area;
          bestIdx = i;
        }
      }
      return bestIdx;
    });

    return locator.nth(index);
  }

  private async clickAndWaitForKakaoLogin(
    target: Locator,
  ): Promise<{ mode: 'same-tab' | 'popup'; kakaoPage: Page }> {
    const page = this.page;

    const popupPromise = page.waitForEvent('popup', { timeout: 10_000 }).then(
      async (popup) => {
        await popup.waitForURL(KAKAO_ACCOUNTS_LOGIN_RE, {
          timeout: 10_000,
          waitUntil: 'load',
        });
        return { mode: 'popup' as const, kakaoPage: popup };
      },
      () => null,
    );

    const sameTabPromise = (async () => {
      await Promise.all([
        page.waitForURL(KAKAO_ACCOUNTS_LOGIN_RE, {
          timeout: 10_000,
          waitUntil: 'load',
        }),
        target.click(),
      ]);

      return { mode: 'same-tab' as const, kakaoPage: page };
    })();

    const firstHit =
      (await Promise.race([popupPromise, sameTabPromise])) ?? undefined;

    if (firstHit?.mode === 'popup' || firstHit?.mode === 'same-tab') {
      return firstHit;
    }

    await page.waitForURL(KAKAO_ACCOUNTS_LOGIN_RE, {
      timeout: 5000,
      waitUntil: 'load',
    });

    return { mode: 'same-tab', kakaoPage: page };
  }

  /**
   * 환급/카카오 엔트리 중 하나를 클릭하고 카카오 로그인 페이지까지 이동한다.
   * - 진입 전 모달("예상 환급액 계산 기준")을 최대 5초 동안 감시/닫는다.
   * - 우선 카카오 엔트리, 없으면 가장 큰 환급 CTA를 선택한다.
   */
  async clickEntryAndGoToKakaoLogin(): Promise<KakaoNavResult> {
    const kakao = this.kakaoCandidates();
    const refund = this.refundCandidates();

    // 모달이 늦게 뜨는 경우까지 포함해서 한 번 정리
    await this.closeExpectedRefundInfoIfOpen();

    // 둘 중 하나라도 나타나면 진행
    await expect(kakao.or(refund).first()).toBeVisible();

    let entryClicked: EntryType;
    let firstTarget: Locator;

    if ((await kakao.count()) > 0) {
      entryClicked = 'kakao';
      firstTarget = kakao.first();
    } else {
      entryClicked = 'refund';
      firstTarget = await this.pickLargest(refund);
    }

    const nav = await this.clickAndWaitForKakaoLogin(firstTarget);
    let kakaoUrl = nav.kakaoPage.url();

    if (!isKakaoAccountsLoginUrl(kakaoUrl) && entryClicked === 'refund') {
      const retryKakao = this.kakaoCandidates();
      if ((await retryKakao.count()) > 0) {
        entryClicked = 'kakao';

        const retryNav = await this.clickAndWaitForKakaoLogin(
          retryKakao.first(),
        );
        kakaoUrl = retryNav.kakaoPage.url();

        nav.mode = retryNav.mode;
        nav.kakaoPage = retryNav.kakaoPage;
      }
    }

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
