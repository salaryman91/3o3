// scripts/ci/collect-results.mjs
// 역할:
// - playwright-summary.log 에서 total/passed/failed/flaky 파싱
// - test-results 폴더에서 실패 스크린샷 찾아 dedupe 후
//   playwright-report/screenshots/failed-N.png 으로 복사
// - run/meta.json, playwright-report/screenshots/map.txt 생성

import fs from 'fs/promises';
import path from 'path';

const SUMMARY_LOG = 'playwright-summary.log';
const TEST_RESULTS_DIR = 'test-results';
const REPORT_DIR = 'playwright-report';
const SCREENSHOT_DIR = path.join(REPORT_DIR, 'screenshots');
const META_DIR = 'run';
const META_FILE = path.join(META_DIR, 'meta.json');
const MAP_FILE = path.join(SCREENSHOT_DIR, 'map.txt');

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function firstIntMatch(regex, text) {
  const m = text.match(regex);
  return m ? Number(m[1]) : null;
}

function lastIntMatch(regex, text) {
  let m;
  let last = null;
  while ((m = regex.exec(text)) !== null) {
    last = Number(m[1]);
  }
  return last;
}

async function parseSummary() {
  try {
    const raw = await fs.readFile(SUMMARY_LOG, 'utf8');
    const clean = stripAnsi(raw);

    const totalFromRunning = firstIntMatch(
      /Running\s+(\d+)\s+tests?/i,
      clean,
    );
    const passed = lastIntMatch(/(\d+)\s+passed\b/gi, clean);
    const failed = lastIntMatch(/(\d+)\s+failed\b/gi, clean);
    const flakyRaw = lastIntMatch(/(\d+)\s+flaky\b/gi, clean);

    let total = totalFromRunning;
    const flaky = flakyRaw ?? 0;

    if (!total && (passed != null || failed != null || flakyRaw != null)) {
      total =
        (passed ?? 0) +
        (failed ?? 0) +
        (flakyRaw ?? 0);
    }

    let passRate = null;
    if (total && passed != null) {
      passRate = Number(((passed / total) * 100).toFixed(1));
    }

    const summary = {
      total: total ?? null,
      passed: passed ?? null,
      failed: failed ?? null,
      flaky,
      passRate,
    };

    console.log('[collect-results] Parsed summary:', summary);
    return summary;
  } catch (err) {
    console.warn(
      `[collect-results] Failed to read ${SUMMARY_LOG}:`,
      err.message,
    );
    return {
      total: null,
      passed: null,
      failed: null,
      flaky: 0,
      passRate: null,
    };
  }
}

async function walkForFailedScreenshots(rootDir) {
  const found = [];

  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (
        entry.isFile() &&
        /^test-failed-.*\.png$/i.test(entry.name)
      ) {
        const folderName = path.basename(path.dirname(fullPath));
        found.push({ filePath: fullPath, folderName });
      }
    }
  }

  await walk(rootDir);
  return found;
}

function normalizeTestName(folderName) {
  // 예: health_chech--login-테스트-이름--repeat97
  const parts = folderName.split('--');
  let base = parts.length >= 2 ? parts[1] : folderName;

  // retry / repeat 꼬리 제거
  base = base.replace(/--?retry\d+$/i, '').replace(/--?repeat\d+$/i, '');

  // 하이픈/언더스코어를 공백으로
  base = base.replace(/[-_]+/g, ' ');

  return base.trim();
}

function dedupeScreenshots(rawList) {
  const seenKeys = new Set();
  const result = [];

  for (const item of rawList) {
    const testName = normalizeTestName(item.folderName);
    const key = testName.toLowerCase();
    if (seenKeys.has(key)) {
      // 동일 테스트의 retry 스크린샷은 무시
      continue;
    }
    seenKeys.add(key);
    result.push({
      filePath: item.filePath,
      testName: testName || item.folderName,
    });
  }

  return result;
}

async function collectScreenshots() {
  try {
    await fs.access(TEST_RESULTS_DIR);
  } catch {
    console.log(
      `[collect-results] ${TEST_RESULTS_DIR} 디렉터리가 없어 스크린샷을 찾지 않습니다.`,
    );
    return [];
  }

  const raw = await walkForFailedScreenshots(TEST_RESULTS_DIR);
  const deduped = dedupeScreenshots(raw);

  if (!deduped.length) {
    console.log('[collect-results] 실패 스크린샷이 없습니다.');
    return [];
  }

  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });

  const mapLines = [];
  let index = 1;

  for (const item of deduped) {
    const relPath = path.join('screenshots', `failed-${index}.png`);
    const destPath = path.join(REPORT_DIR, relPath);
    await fs.copyFile(item.filePath, destPath);
    mapLines.push(`${relPath}|||${item.testName}`);
    console.log(
      `[collect-results] Copy ${item.filePath} -> ${destPath} (${item.testName})`,
    );
    index += 1;
  }

  await fs.writeFile(MAP_FILE, mapLines.join('\n'), 'utf8');
  console.log(
    `[collect-results] map.txt 생성 완료: ${MAP_FILE} (${mapLines.length}개)`,
  );

  return {
    count: mapLines.length,
    mapPath: MAP_FILE,
  };
}

async function main() {
  const summary = await parseSummary();
  const screenshotsInfo = await collectScreenshots();

  await fs.mkdir(META_DIR, { recursive: true });

  const status = process.env.CI_STATUS || 'unknown';
  const branch = process.env.BRANCH_NAME || 'unknown';
  const commit = process.env.COMMIT_SHA || 'unknown';
  const repository = process.env.REPOSITORY || 'unknown';
  const runId = process.env.RUN_ID || 'unknown';
  const reportBaseUrl =
    process.env.PLAYWRIGHT_REPORT_PAGES_URL || '';

  const meta = {
    status,
    branch,
    commit,
    repository,
    runId,
    reportBaseUrl,
    createdAt: new Date().toISOString(),
    ...summary,
    failedScreenshotCount: screenshotsInfo.count ?? 0,
    screenshotMapPath: screenshotsInfo.mapPath
      ? path.relative(process.cwd(), screenshotsInfo.mapPath)
      : null,
  };

  await fs.writeFile(META_FILE, JSON.stringify(meta, null, 2), 'utf8');
  console.log(`[collect-results] meta.json 생성 완료: ${META_FILE}`);
  console.log('[collect-results] meta:', meta);
}

main().catch((err) => {
  console.error('[collect-results] Unhandled error:', err);
  // continue-on-error 이므로 여기서 실패해도 전체 Job 상태는 테스트 결과에 의해 결정됨
  process.exit(1);
});
