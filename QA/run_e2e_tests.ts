// ============================================================================
// Cata Raid Sim — Dedicated E2E Master Test Runner (Tiers 1 - 4)
// Specification: TEST_INFRA.md § Test Architecture & Invocation
// ============================================================================

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface SuiteResult {
  name: string;
  tier: string;
  passed: number;
  total: number;
  durationMs: number;
  status: 'PASSED' | 'FAILED' | 'PENDING';
  error?: any;
}

export async function runAllE2ETests(): Promise<{
  totalSuites: number;
  passedSuites: number;
  totalTests: number;
  totalPassed: number;
  durationMs: number;
}> {
  const startTime = Date.now();

  console.log('================================================================================');
  console.log('🛡️  CATA RAID SIM — E2E MASTER TEST RUNNER (TIERS 1 - 4)');
  console.log('    Specification: TEST_INFRA.md & ORIGINAL_REQUEST.md (R1 - R8)');
  console.log('================================================================================\n');

  const suites: SuiteResult[] = [];

  // ──────────────────────────────────────────────────────────────────────────
  // Suite 1: Tier 1 Feature Coverage (40 Tests, 5 per R1-R8)
  // ──────────────────────────────────────────────────────────────────────────
  const tier1Path = path.resolve(__dirname, 'tests/e2e_tier1_features.test.ts');
  const s1Start = Date.now();
  if (fs.existsSync(tier1Path)) {
    try {
      const { runTier1FeatureTests } = await import('./tests/e2e_tier1_features.test.js' as any).catch(
        () => import('./tests/e2e_tier1_features.test.ts' as any)
      );
      if (typeof runTier1FeatureTests === 'function') {
        const res = await runTier1FeatureTests();
        suites.push({
          name: 'Tier 1: Feature Coverage (R1-R8)',
          tier: 'Tier 1',
          passed: res.passed,
          total: res.total,
          durationMs: Date.now() - s1Start,
          status: res.passed === res.total && res.total >= 40 ? 'PASSED' : 'FAILED',
        });
      } else {
        throw new Error('runTier1FeatureTests function not exported from e2e_tier1_features.test.ts');
      }
    } catch (err: any) {
      suites.push({
        name: 'Tier 1: Feature Coverage (R1-R8)',
        tier: 'Tier 1',
        passed: 0,
        total: 40,
        durationMs: Date.now() - s1Start,
        status: 'FAILED',
        error: err,
      });
    }
  } else {
    suites.push({
      name: 'Tier 1: Feature Coverage (R1-R8)',
      tier: 'Tier 1',
      passed: 0,
      total: 40,
      durationMs: 0,
      status: 'PENDING',
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Suite 2: Tier 2 Boundary & Corner Cases (40 Tests, 5 per R1-R8)
  // ──────────────────────────────────────────────────────────────────────────
  const tier2Path = path.resolve(__dirname, 'tests/e2e_tier2_boundaries.test.ts');
  const s2Start = Date.now();
  if (fs.existsSync(tier2Path)) {
    try {
      const { runTier2BoundaryTests } = await import('./tests/e2e_tier2_boundaries.test.js' as any).catch(
        () => import('./tests/e2e_tier2_boundaries.test.ts' as any)
      );
      if (typeof runTier2BoundaryTests === 'function') {
        const res = await runTier2BoundaryTests();
        suites.push({
          name: 'Tier 2: Boundary & Corner Cases (R1-R8)',
          tier: 'Tier 2',
          passed: res.passed,
          total: res.total,
          durationMs: Date.now() - s2Start,
          status: res.passed === res.total && res.total >= 40 ? 'PASSED' : 'FAILED',
        });
      } else {
        throw new Error('runTier2BoundaryTests function not exported from e2e_tier2_boundaries.test.ts');
      }
    } catch (err: any) {
      suites.push({
        name: 'Tier 2: Boundary & Corner Cases (R1-R8)',
        tier: 'Tier 2',
        passed: 0,
        total: 40,
        durationMs: Date.now() - s2Start,
        status: 'FAILED',
        error: err,
      });
    }
  } else {
    suites.push({
      name: 'Tier 2: Boundary & Corner Cases (R1-R8)',
      tier: 'Tier 2',
      passed: 0,
      total: 40,
      durationMs: 0,
      status: 'PENDING',
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Suite 3: Tier 3 Cross-Feature Pairwise Interactions (10 Tests)
  // ──────────────────────────────────────────────────────────────────────────
  const tier3Path = path.resolve(__dirname, 'tests/e2e_tier3_combinations.test.ts');
  const s3Start = Date.now();
  if (fs.existsSync(tier3Path)) {
    try {
      const mod = await import('./tests/e2e_tier3_combinations.test.js' as any).catch(
        () => import('./tests/e2e_tier3_combinations.test.ts' as any)
      );
      const runner = mod.runTier3CombinationTests || mod.runTier3CombinationsTests;
      if (typeof runner === 'function') {
        const res = await runner();
        suites.push({
          name: 'Tier 3: Cross-Feature Pairwise Interactions',
          tier: 'Tier 3',
          passed: res.passed,
          total: res.total,
          durationMs: Date.now() - s3Start,
          status: res.passed === res.total && res.total >= 10 ? 'PASSED' : 'FAILED',
        });
      } else {
        throw new Error('runTier3CombinationTests function not exported from e2e_tier3_combinations.test.ts');
      }
    } catch (err: any) {
      suites.push({
        name: 'Tier 3: Cross-Feature Pairwise Interactions',
        tier: 'Tier 3',
        passed: 0,
        total: 10,
        durationMs: Date.now() - s3Start,
        status: 'FAILED',
        error: err,
      });
    }
  } else {
    suites.push({
      name: 'Tier 3: Cross-Feature Pairwise Interactions',
      tier: 'Tier 3',
      passed: 0,
      total: 10,
      durationMs: 0,
      status: 'PENDING',
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Suite 4: Tier 4 Comprehensive End-to-End Scenarios (6 Tests)
  // ──────────────────────────────────────────────────────────────────────────
  const tier4Path = path.resolve(__dirname, 'tests/e2e_tier4_scenarios.test.ts');
  const s4Start = Date.now();
  if (fs.existsSync(tier4Path)) {
    try {
      const { runTier4ScenarioTests } = await import('./tests/e2e_tier4_scenarios.test.js' as any).catch(
        () => import('./tests/e2e_tier4_scenarios.test.ts' as any)
      );
      if (typeof runTier4ScenarioTests === 'function') {
        const res = await runTier4ScenarioTests();
        suites.push({
          name: 'Tier 4: Comprehensive Real-World Scenarios',
          tier: 'Tier 4',
          passed: res.passed,
          total: res.total,
          durationMs: Date.now() - s4Start,
          status: res.passed === res.total && res.total >= 6 ? 'PASSED' : 'FAILED',
        });
      } else {
        throw new Error('runTier4ScenarioTests function not exported from e2e_tier4_scenarios.test.ts');
      }
    } catch (err: any) {
      suites.push({
        name: 'Tier 4: Comprehensive Real-World Scenarios',
        tier: 'Tier 4',
        passed: 0,
        total: 6,
        durationMs: Date.now() - s4Start,
        status: 'FAILED',
        error: err,
      });
    }
  } else {
    suites.push({
      name: 'Tier 4: Comprehensive Real-World Scenarios',
      tier: 'Tier 4',
      passed: 0,
      total: 6,
      durationMs: 0,
      status: 'PENDING',
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Summary Reporting
  // ──────────────────────────────────────────────────────────────────────────
  const totalDurationMs = Date.now() - startTime;
  let totalTests = 0;
  let totalPassed = 0;
  let passedSuites = 0;

  console.log('\n================================================================================');
  console.log('📊 E2E TEST EXECUTION SUMMARY REPORT');
  console.log('================================================================================');

  for (const s of suites) {
    totalTests += s.total;
    totalPassed += s.passed;
    const mark = s.status === 'PASSED' ? '✓' : s.status === 'PENDING' ? '⏳' : '❌';
    if (s.status === 'PASSED') passedSuites++;
    console.log(
      `  ${mark} [${s.tier}] ${s.name.padEnd(46)} ${s.passed}/${s.total} passed (${s.durationMs}ms)`
    );
    if (s.error) {
      console.log(`     ⚠️ 异常: ${s.error?.message || s.error}`);
    }
  }

  console.log('--------------------------------------------------------------------------------');
  console.log(`  Total Suites:  ${suites.length} (Passed: ${passedSuites}/${suites.length})`);
  console.log(`  Total Tests:   ${totalTests} (Target: 96+)`);
  console.log(`  Total Passed:  ${totalPassed}`);
  console.log(`  Elapsed Time:  ${(totalDurationMs / 1000).toFixed(2)}s`);
  console.log('================================================================================\n');

  return {
    totalSuites: suites.length,
    passedSuites,
    totalTests,
    totalPassed,
    durationMs: totalDurationMs,
  };
}

// Standalone CLI execution
if (
  process.argv[1]?.endsWith('run_e2e_tests.ts') ||
  process.argv[1]?.endsWith('run_e2e_tests.js')
) {
  runAllE2ETests()
    .then(res => {
      if (res.passedSuites === res.totalSuites && res.totalPassed === res.totalTests && res.totalTests >= 96) {
        console.log('✅ ALL E2E TEST SUITES PASSED CLEANLY (Exit 0)\n');
        process.exit(0);
      } else {
        console.error(`❌ E2E RUN FAILED OR INCOMPLETE: ${res.passedSuites}/${res.totalSuites} suites passed, ${res.totalPassed}/${res.totalTests} tests passed.\n`);
        process.exit(1);
      }
    })
    .catch(err => {
      console.error('Fatal execution failure in run_e2e_tests:', err);
      process.exit(1);
    });
}
