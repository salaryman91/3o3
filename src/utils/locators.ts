// src/utils/locators.ts
// 목적:
// - /login 랜딩에서 텍스트(name) 불안정 문제를 피하기 위해 구조 기반 locator 제공
//
// 전략:
// - 카카오 버튼(2종): button 내부에 카카오 로고 이미지(img src)가 포함되는 공통 구조를 사용
// - 환급 CTA: main 영역 button 중 카카오 로고가 없는 버튼을 후보로 사용
// - :visible 사용으로 “DOM에는 있으나 숨김” 요소를 배제

import type { Locator, Page } from '@playwright/test';

export const KAKAO_LOGO_SRC_PART = 'logo_brand_kakaotalk.svg';

export function kakaoEntryCandidates(page: Page): Locator {
  return page.locator(
    `button[type="button"]:has(img[src*="${KAKAO_LOGO_SRC_PART}"]):visible`
  );
}

export function refundEntryCandidates(page: Page): Locator {
  return page.locator(
    `main button[type="button"]:not(:has(img[src*="${KAKAO_LOGO_SRC_PART}"])):visible`
  );
}
