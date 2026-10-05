// Checks the distributed tarball and installed CLI, not the source checkout imports.
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import { tmpdir, devNull } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const source = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'review-package-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(executable, args, cwd, label, env = process.env) {
  try { return execFileSync(executable, args, { cwd, env, encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024, windowsHide: true }); }
  catch { throw new Error(`Installed-package smoke failed during ${label}.`); }
}
try {
  const packed = JSON.parse(run(npm, ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], source, 'pack'))[0];
  assert(packed.files.some(file => file.path === 'src/gitlab.js'));
  assert(!packed.files.some(file => file.path.startsWith('test/') || file.path.startsWith('.github/') || file.path.startsWith('scripts/')));
  const consumer = join(temporary, 'consumer'); await mkdir(consumer);
  // npm ci caches locked tarballs, but may not cache registry packuments. Seed the
  // consumer lock with those same resolved URLs/integrities so install stays offline.
  const sourceManifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
  const consumerManifest = { name: 'package-smoke-consumer', version: '1.0.0', private: true, type: 'module', dependencies: sourceManifest.dependencies };
  const consumerLock = JSON.parse(await readFile(join(source, 'package-lock.json'), 'utf8'));
  consumerLock.name = consumerManifest.name; consumerLock.version = consumerManifest.version;
  consumerLock.packages[''] = { name: consumerManifest.name, version: consumerManifest.version, dependencies: consumerManifest.dependencies };
  await writeFile(join(consumer, 'package.json'), JSON.stringify(consumerManifest));
  await writeFile(join(consumer, 'package-lock.json'), JSON.stringify(consumerLock));
  run(npm, ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', join(temporary, packed.filename)], consumer, 'offline install');
  const packageDirectory = join(consumer, 'node_modules', 'review-bundle-generator');
  const cli = join(packageDirectory, 'src', 'cli.js');
  const imported = run(process.execPath, ['--input-type=module', '-e',
    "import * as api from 'review-bundle-generator'; if (!['createReviewBundle','createRuleContextBundle','createReviewerRequest','evaluateReviewRuns','fetchGitLabMergeRequest','checkRuntime','compileAcceptanceExpectations','auditReviewBundle'].every(name => typeof api[name] === 'function')) process.exit(1); console.log('exports-ready');"], consumer, 'package exports');
  assert.equal(imported.trim(), 'exports-ready');
  const doctor = JSON.parse(run(process.execPath, [cli, 'doctor'], consumer, 'installed doctor')); assert.equal(doctor.status, 'runtime-ready');
  const manifest = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'));
  assert.match(manifest.bin['review-bundle'], /^(?:\.\/)?src\/cli\.js$/u);
  await access(join(consumer, 'node_modules', '.bin', process.platform === 'win32' ? 'review-bundle.cmd' : 'review-bundle'));
  if (process.platform !== 'win32') {
    const binDoctor = JSON.parse(run(join(consumer, 'node_modules', '.bin', 'review-bundle'), ['doctor'], consumer, 'installed bin'));
    assert.equal(binDoctor.status, 'runtime-ready');
  }
  const repo = join(temporary, 'source-repo'); await mkdir(repo);
  const gitEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
  const git = (...args) => run('git', ['-c', `core.hooksPath=${devNull}`, '-c', 'commit.gpgSign=false', ...args], repo, 'synthetic Git fixture', gitEnv).trim();
  git('init', '-q', '--template=', '--initial-branch=main');
  const before = "export function validate(amount: number) {\n" + '  void amount;\n'.repeat(12) + "  if (amount <= 0) throw new Error('invalid');\n" + '  void amount;\n'.repeat(12) + "  return true;\n}\n";
  await writeFile(join(repo, 'file.ts'), before);
  await writeFile(join(repo, 'caller.ts'), "import { validate } from './file';\nconst invoke = validate;\ninvoke(-1);\n");
  const componentBefore = "import { Component as View } from '@angular/core';\n@View({templateUrl: './consumer.view'})\nexport class Panel {\n  loading = false;\n  load() {\n    this.loading = true;\n  }\n}\n";
  await writeFile(join(repo, 'component.ts'), componentBefore);
  await writeFile(join(repo, 'consumer.view'), '<button [disabled]="loading">Load</button>\n');
  git('add', '-A'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
  await writeFile(join(repo, 'file.ts'), before.replace("  if (amount <= 0) throw new Error('invalid');\n", ''));
  await writeFile(join(repo, 'component.ts'), componentBefore.replace('    this.loading = true;\n', '')); git('add', '-A'); git('commit', '-qm', 'head');
  const bundle = JSON.parse(run(process.execPath, [cli, 'bundle', '--repo', repo, '--base', base, '--semantic'], consumer, 'installed semantic bundle'));
  assert.equal(bundle.schemaVersion, 'review-bundle/v3'); assert.equal(bundle.summary.changedFiles, 2);
  await writeFile(join(temporary, 'context-policy.json'), JSON.stringify([{ ruleId: 'amount', kind: 'direct-callers', sides: ['old', 'new'] }]));
  await writeFile(join(temporary, 'rules.json'), JSON.stringify({ schemaVersion: 'review-rules/v3', rules: [{ id: 'amount', title: 'Amount invariant', instruction: 'Check validation and actual callers.', scope: { paths: ['file.ts'] }, when: { changedSyntax: [{ side: 'removed', kind: 'throw-guard', identifiers: ['amount'], within: 'validate' }] } },
    { id: 'loading', title: 'Loading state', instruction: 'Check component template consumers and equivalent cleanup.', scope: { paths: ['component.ts'] }, when: { changedSyntax: [{ side: 'removed', kind: 'assignment', target: 'this.loading', within: 'load' }] } }] }));
  const ruleContext = JSON.parse(run(process.execPath, [cli, 'rule-context-bundle', '--repo', repo, '--base', base, '--rule-source', 'pinned',
    '--rules', join(temporary, 'rules.json'), '--context-policy', join(temporary, 'context-policy.json'), '--angular-templates', '--angular-bindings'], consumer, 'installed rule context bundle'));
  assert.equal(ruleContext.bundle.schemaVersion, 'review-bundle/v6'); assert.equal(ruleContext.schemaVersion, 'rule-context-bundle/v1'); assert.equal(ruleContext.contextPlan.requests.length, 2);
  assert.equal(ruleContext.bundle.angularTemplateContext.decisions.find(d => d.ruleId === 'loading').template.path, 'consumer.view');
  assert.equal(ruleContext.bundle.evidence.find(e => e.type === 'angular-template-source').content, '<button [disabled]="loading">Load</button>\n');
  const loadingBinding = ruleContext.bundle.angularTemplateBindings.decisions.find(d => d.ruleId === 'loading').bindings[0].references[0];
  assert.equal(loadingBinding.name, 'loading'); assert.equal(loadingBinding.classification, 'component-member');
  assert.equal(loadingBinding.member.name, 'loading');
  assert.equal(ruleContext.bundle.contextExpansion.schemaVersion, 'caller-context/v2');
  for (const decision of ruleContext.bundle.contextExpansion.decisions) {
    assert.equal(decision.matches.length, 1); assert.equal(decision.matches[0].resolution.kind, 'local-const-alias');
    assert.equal(decision.matches[0].resolution.aliases.length, 1);
  }
  await writeFile(join(temporary, 'bundle.json'), JSON.stringify(ruleContext.bundle));
  const packet = JSON.parse(run(process.execPath, [cli, 'packet', '--bundle', join(temporary, 'bundle.json'), '--reviewer-id', 'package-smoke', '--reviewer-version', 'v1'], consumer, 'installed alias provenance packet'));
  assert.equal(packet.selectedRules[0].id, 'amount');
  // Expectations are authored from the synthetic edit, not from generator counts/decisions.
  const expectations = { schemaVersion: 'review-acceptance-expectations/v1', caseId: 'installed-guard-removal', cohort: 'development',
    provenance: { kind: 'synthetic', author: 'package-smoke', revision: '1' },
    revisions: { requestedBaseCommit: base, effectiveBaseCommit: base, headCommit: git('rev-parse', 'HEAD'), comparison: 'merge-base' },
    ruleConfigId: ruleContext.bundle.ruleSelection.configId, ruleSource: 'pinned',
    changes: [{ status: 'M', oldPath: 'file.ts', newPath: 'file.ts', oldKind: 'file', newKind: 'file', coverage: 'text-diff',
      addedLines: 0, removedLines: 1, selectedRuleIds: ['amount'], requiredPatchLines: ["-  if (amount <= 0) throw new Error('invalid');"], sourceCoverage: { available: true, reason: 'parsed-pinned-sources' } }] };
  expectations.changes.push({ status: 'M', oldPath: 'component.ts', newPath: 'component.ts', oldKind: 'file', newKind: 'file', coverage: 'text-diff', addedLines: 0, removedLines: 1,
    selectedRuleIds: ['loading'], requiredPatchLines: ['-    this.loading = true;'], sourceCoverage: { available: true, reason: 'parsed-pinned-sources' } });
  await writeFile(join(temporary, 'expectations.json'), JSON.stringify(expectations));
  const acceptance = JSON.parse(run(process.execPath, [cli, 'audit', '--bundle', join(temporary, 'bundle.json'), '--expectations', join(temporary, 'expectations.json')], consumer, 'installed offline acceptance'));
  assert.equal(acceptance.passed, true); assert.equal(acceptance.reviewerImprovement, 'not-measured');
  const fixtureDirectory = join(packageDirectory, 'fixtures', 'evaluation');
  const report = JSON.parse(run(process.execPath, [cli, 'evaluate', '--dataset', join(fixtureDirectory, 'dataset.json'), '--runs', join(fixtureDirectory, 'runs.json')], consumer, 'installed offline evaluation'));
  assert.equal(report.schemaVersion, 'review-evaluation-report/v1'); assert.equal(report.evidenceKind, 'synthetic-or-mixed');
  process.stdout.write('Installed tarball, exports, CLI, runtime doctor, semantic bundle, automatic alias callers, Angular template ownership/packet, offline acceptance and evaluation passed.\n');
} finally { await rm(temporary, { recursive: true, force: true }); }
