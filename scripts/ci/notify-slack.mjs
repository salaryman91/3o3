// scripts/ci/notify-slack.mjs
// 목적:
// - run/meta.json + playwright-report/screenshots/map.txt 를 읽어서
//   Slack Incoming Webhook으로 "텍스트 기반" 요약 메시지를 보낸다.
// - blocks 를 사용하지 않고 text만 사용해서 invalid_blocks 에러를 피한다.
// - 실패한 각 테스트별 스크린샷 URL도 텍스트로 나열한다.

import fs from 'node:fs/promises';
import path from 'node:path';

async function loadMeta(rootDir) {
  const metaPath = path.join(rootDir, 'run', 'meta.json');

  try {
    const raw = await fs.readFile(metaPath, 'utf8');
    const meta = JSON.parse(raw);
    console.log('[notify-slack] Loaded meta.json:', meta);
    return meta;
  } catch (err) {
    console.warn(
      '[notify-slack] meta.json 을 읽지 못했습니다. Slack 전송을 건너뜁니다.',
      err,
    );
    return null;
  }
}

async function loadScreenshotMap(rootDir, meta) {
  // collect-results 에서 meta.screenshotMapPath 에 상대 경로를 넣어둠
  const relPath =
    (meta && meta.screenshotMapPath) ||
    'playwright-report/screenshots/map.txt';

  const mapPath = path.join(rootDir, relPath);

  try {
    const content = await fs.readFile(mapPath, 'utf8');
    const lines = content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const list = lines.map((line) => {
      // fileName|testName 형식
      const [fileName, ...rest] = line.split('|');
      const testName = (rest.join('|') || '').trim() || '(테스트 이름 없음)';
      return { fileName, testName };
    });

    console.log('[notify-slack] Loaded screenshot map:', list);
    return list;
  } catch (err) {
    console.log(
      '[notify-slack] screenshots map을 찾지 못했습니다. 스크린샷 링크 없이 진행합니다.',
      err.message,
    );
    return [];
  }
}

function buildMessage(meta, screenshots) {
  const status = meta.status || process.env.CI_STATUS || 'unknown';
  const branch = meta.branch || process.env.BRANCH_NAME || '';
  const repository = meta.repository || process.env.REPOSITORY || '';
  const commit = meta.commit || process.env.COMMIT_SHA || '';
  const runId = meta.runId || process.env.RUN_ID || '';
  const reportBaseUrl =
    meta.reportBaseUrl || process.env.PLAYWRIGHT_REPORT_PAGES_URL || '';

  const total = meta.total ?? 0;
  const passed = meta.passed ?? 0;
  const failed = meta.failed ?? 0;
  const flaky = meta.flaky ?? 0;

  const passRate =
    typeof meta.passRate === 'number'
      ? meta.passRate
      : Number.isFinite(meta.passRate)
      ? Number(meta.passRate)
      : null;

  const isSuccess = status === 'success';
  const statusEmoji = isSuccess ? '✅' : '❌';
  const statusKorean = isSuccess ? '성공' : '실패';

  const runUrl =
    runId && repository
      ? `https://github.com/${repository}/actions/runs/${runId}`
      : '';
  const commitUrl =
    commit && repository
      ? `https://github.com/${repository}/commit/${commit}`
      : '';

  const lines = [];

  // ── 헤더 ────────────────────────────────────────────────
  lines.push(`${statusEmoji} 3o3 Playwright 테스트 ${statusKorean}`);
  lines.push('');
  // 여기서 Status / Branch 를 "태그 느낌"으로 코드 스타일 처리
  lines.push(`Status: \`${status}\``);
  if (branch) {
    lines.push(`Branch: \`${branch}\``);
  }
  if (commitUrl) {
    lines.push(`Commit: ${commitUrl}`);
  } else if (commit) {
    lines.push(`Commit: \`${commit}\``);
  }
  if (runUrl) {
    lines.push(`Run URL: ${runUrl}`);
  }
  lines.push('');

  // ── 테스트 요약 ─────────────────────────────────────────
  lines.push('Tests:');
  lines.push(`• Total : ${total}`);
  lines.push(`• Passed: ${passed}`);
  lines.push(`• Failed: ${failed}`);
  lines.push(`• Flaky : ${flaky}`);
  if (passRate !== null && !Number.isNaN(passRate)) {
    lines.push(`• Pass rate: ${passRate.toFixed(1)}%`);
  }

  // ── HTML 리포트 링크 ────────────────────────────────────
  if (reportBaseUrl) {
    lines.push('');
    lines.push(`HTML Report: ${reportBaseUrl}`);
  }

  // ── 실패 스크린샷 목록 ──────────────────────────────────
  if (!isSuccess && screenshots.length > 0) {
    lines.push('');
    lines.push('실패 테스트별 스크린샷 링크');

    const base = (reportBaseUrl || '').replace(/\/$/, '');

    screenshots.forEach((shot, idx) => {
      const relativePath = shot.fileName.replace(/^\.?\//, '');
      const url = base ? `${base}/${relativePath}` : relativePath;

      console.log('[notify-slack] screenshot URL:', url);

      lines.push('');
      lines.push(`Fail #${idx + 1}: ${shot.testName}`);
      lines.push(`Screenshot: ${url}`);
    });
  }

  return lines.join('\n');
}

async function main() {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;

  if (!webhookUrl) {
    console.log(
      '[notify-slack] SLACK_WEBHOOK_URL 이 설정되어 있지 않습니다. Slack 전송을 건너뜁니다.',
    );
    return;
  }

  const rootDir = process.cwd();

  const meta = await loadMeta(rootDir);
  if (!meta) return;

  const screenshots = await loadScreenshotMap(rootDir, meta);

  const text = buildMessage(meta, screenshots);

  const payload = { text };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const body = await res.text();

    if (!res.ok) {
      console.error(
        '[notify-slack] Slack 전송 실패:',
        res.status,
        res.statusText,
        body,
      );
      return;
    }

    console.log('[notify-slack] Slack 전송 성공:', body);
  } catch (err) {
    console.error('[notify-slack] Slack 전송 중 예외 발생:', err);
  }
}

main().catch((err) => {
  console.error('[notify-slack] 예상치 못한 예외:', err);
});
