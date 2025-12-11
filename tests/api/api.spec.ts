// tests/api/szs-api.spec.ts
// 목적:
// - 삼쩜삼 서비스의 "토큰이 필요 없는" API를 중심으로 헬스체크를 수행한다.
// - 인증이 필요한 API는 "인증 없이 / 잘못된 방식으로 접근 시 적절히 거절되는지"만 검증한다.
//   (실제 유저 정보/로그인 상태 검증은 토큰이 필요하므로 과제 범위에서 제외)

import { test, expect } from '@playwright/test';

// 삼쩜삼 웹 앱 설정/상태 정보 엔드포인트
const CONFIG_URL = 'https://app.3o3.co.kr/config.json';

// 삼쩜삼 백엔드 게이트웨이 (인증 필요 API의 "보안 스모크" 용도)
const SZS_GATEWAY_BASE_URL = 'https://web-gw.3o3.co.kr';

test.describe('삼쩜삼 공개/헬스체크 API', () => {
  test('GET /config.json: 기본 응답 구조 및 타입 검증', async ({ request }) => {
    const res = await request.get(CONFIG_URL);

    // 상태 코드 200 계열이어야 함
    expect(res.ok()).toBeTruthy();

    const body = (await res.json()) as any;

    // 최상위 플래그 및 data 존재 여부
    expect(typeof body).toBe('object');
    expect(body).toHaveProperty('ok');
    expect(body).toHaveProperty('data');

    // ok는 boolean, data는 객체여야 한다.
    expect(typeof body.ok).toBe('boolean');
    expect(typeof body.data).toBe('object');

    // notifications, hasClosedSite 타입 검증
    if (body.data.notifications !== undefined) {
      expect(Array.isArray(body.data.notifications)).toBe(true);
    }

    if (body.data.hasClosedSite !== undefined) {
      expect(typeof body.data.hasClosedSite).toBe('boolean');
    }

    // 점검 정보가 있을 경우의 구조 예시 검증 (있으면 타입 확인, 없으면 통과)
    const maintenance = body.data.maintenanceInfo;
    if (maintenance && maintenance.gov24MaintenanceTime) {
      const t = maintenance.gov24MaintenanceTime;
      if (t.startedAt !== undefined) {
        expect(typeof t.startedAt).toBe('string');
      }
      if (t.endedAt !== undefined) {
        expect(typeof t.endedAt).toBe('string');
      }
    }
  });

  test('GET /config.json: 응답시간이 1000ms 이내', async ({ request }) => {
    const start = Date.now();
    const res = await request.get(CONFIG_URL);
    const duration = Date.now() - start;

    expect(res.ok()).toBeTruthy();
    // 네트워크/환경에 따라 조정 가능한 기준값. 여기서는 1초 이내로 설정.
    expect(duration).toBeLessThan(1000);
  });

  test('GET /config.json: hasClosedSite 플래그로 운영 상태 확인', async ({
    request,
  }) => {
    const res = await request.get(CONFIG_URL);
    expect(res.ok()).toBeTruthy();

    const body = (await res.json()) as any;

    // hasClosedSite는 "사이트가 강제 종료/폐쇄 상태인지"를 나타내는 플래그로 가정
    expect(typeof body.data.hasClosedSite).toBe('boolean');

    // 과제 시점 기준, 서비스는 운영 중이므로 false를 기대값으로 둔다.
    // (실제 운영 환경에서는 모니터링/알림 기준으로 활용 가능)
    expect(body.data.hasClosedSite).toBe(false);
  });

  test('GET /config.json: 핵심 키 계약(Contract) 검증', async ({ request }) => {
    const res = await request.get(CONFIG_URL);
    expect(res.ok()).toBeTruthy();

    const body = (await res.json()) as any;
    const data = body.data ?? {};
    const keys = Object.keys(data);

    // 설정 변경 시에도 반드시 유지되어야 할 핵심 키 목록
    const requiredKeys = [
      'notifications',
      'hasClosedSite',
      'scrappingAsync',
      'scrapingAsync',
    ];

    for (const key of requiredKeys) {
      expect(
        keys,
        `config.data에 필수 키 "${key}"가 존재해야 합니다.`,
      ).toContain(key);
    }
  });
});

test.describe('삼쩜삼 인증 필요한 API의 보안 스모크', () => {
  test('GET /szs/api/v2/users/personal-info: 인증 없이 접근 시 거절', async ({
    request,
  }) => {
    const res = await request.get(
      `${SZS_GATEWAY_BASE_URL}/szs/api/v2/users/personal-info`,
      {
        headers: {
          // 실제 웹에서 요청할 때와 유사한 진입 경로를 알려주는 헤더
          'X-Web-Path': 'https://app.3o3.co.kr/login',
        },
      },
    );

    // 내부 구현에 따라 401(Unauthorized) 또는 403(Forbidden)일 수 있으므로 둘 다 허용
    expect([401, 403]).toContain(res.status());
  });

  test('GET /szs/api/v2/users/personal-info: 형식만 맞는 가짜 토큰도 거절', async ({
    request,
  }) => {
    const res = await request.get(
      `${SZS_GATEWAY_BASE_URL}/szs/api/v2/users/personal-info`,
      {
        headers: {
          'X-Web-Path': 'https://app.3o3.co.kr/login',
          // 실제 유효 토큰이 아니라, 형식만 맞는 가짜 토큰을 보낸다.
          Authorization: 'Bearer invalid-token-for-test-only',
        },
      },
    );

    // 잘못된 토큰에 대해 500 등의 서버 에러가 발생하지 않고,
    // 401/403 범주로 거절되는지만 확인한다.
    expect([401, 403]).toContain(res.status());
  });

  test('POST /szs/api/v2/users/personal-info: 잘못된 메서드는 허용되지 않는다', async ({
    request,
  }) => {
    const res = await request.post(
      `${SZS_GATEWAY_BASE_URL}/szs/api/v2/users/personal-info`,
      {
        headers: {
          'X-Web-Path': 'https://app.3o3.co.kr/login',
        },
        data: {}, // 의미 없는 바디
      },
    );

    // 실제 구현에 따라 404 또는 405, 혹은 인증 거절(401/403) 응답이 올 수 있다.
    // 중요한 것은 500 같은 서버 에러가 아니라는 점.
    expect([404, 405, 401, 403]).toContain(res.status());
  });
});
