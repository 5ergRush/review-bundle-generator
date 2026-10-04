import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir, devNull } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { stringify } from 'yaml';
import { createReviewBundle, createReviewerRequest, parseRulesYaml } from '../src/index.js';

const teardown = { side: 'removed', kind: 'member-call', callee: 'this.subscription.unsubscribe', within: 'ngOnDestroy' };
const state = { side: 'removed', kind: 'assignment', target: 'this.loading', within: 'load' };
const yaml = (predicate = teardown, schemaVersion = 'review-rules/v3') => stringify({ schemaVersion, rules: [{ id: 'invariant', title: 'Review changed invariant', instruction: 'Verify equivalent enforcement using the evidence.', scope: { paths: ['src/**'] }, when: { changedSyntax: [predicate] } }] });
const source = (method = 'ngOnDestroy', statement = 'this.subscription.unsubscribe();') => `export class Screen {\n  subscription!: { unsubscribe(): void };\n  ${method}() {\n    ${statement}\n  }\n}\n`;
async function review(t, before, after, predicate = teardown) {
  const repo = await mkdtemp(join(tmpdir(), 'review-contextual-')); t.after(() => rm(repo, { recursive: true, force: true }));
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull,
    GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
  const git = (...args) => execFileSync('git', ['-c', `core.hooksPath=${devNull}`, '-c', 'commit.gpgSign=false', ...args], { cwd: repo, env, encoding: 'utf8', timeout: 10000 }).trim();
  git('init', '-q', '--template=', '--initial-branch=main'); await mkdir(join(repo, 'src'));
  const commit = async content => { await writeFile(join(repo, 'src/screen.ts'), content); git('add', '-A'); git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
  const base = await commit(before); const head = await commit(after);
  const bundle = await createReviewBundle({ repo, base, head, comparison: 'direct', rulesYaml: yaml(predicate) });
  const packet = createReviewerRequest(bundle, { id: 'test', version: 'context-v1' });
  return { bundle, packet, decision: bundle.ruleSelection.decisions[0] };
}

test('v3 validates member receivers, assignments and enclosing names; v2 rejects additions', () => {
  assert.throws(() => parseRulesYaml(yaml(teardown, 'review-rules/v2')), { code: 'INVALID_RULES' });
  for (const bad of [{ ...teardown, callee: 'subscription.unsubscribe' }, { ...teardown, within: 'foo.bar' }, { ...teardown, target: 'this.state' }, { ...state, target: 'loading' }, { ...state, callee: 'this.set' }, { ...state, target: 'this[a]' }]) assert.throws(() => parseRulesYaml(yaml(bad)), { code: 'INVALID_RULES' });
  assert.equal(parseRulesYaml(yaml()).schemaVersion, 'review-rules/v3');
});

test('lifecycle member call rule retains exact method/line evidence in validated packet', async t => {
  const r = await review(t, source(), source('ngOnDestroy', ''));
  assert.equal(r.decision.status, 'matched'); assert.equal(r.bundle.ruleSelection.schemaVersion, 'rule-selection/v3');
  const observation = r.decision.matches[0].syntaxMatches[0][0]; assert.equal(observation.within, 'ngOnDestroy'); assert.equal(observation.callee, 'this.subscription.unsubscribe'); assert.equal(observation.startLine, 4);
  assert.equal(r.packet.selectedRules.length, 1);
});

for (const [name, before, after] of [
  ['same call in another method', source('refresh'), source('refresh', '')],
  ['comment-only teardown', source(), source('ngOnDestroy', 'this.subscription.unsubscribe(); // unchanged')],
  ['member call mentioned in string', source('ngOnDestroy', 'const s = "this.subscription.unsubscribe()";'), source('ngOnDestroy', 'const s = "new";')],
  ['another receiver', source('ngOnDestroy', 'other.subscription.unsubscribe();'), source('ngOnDestroy', '')],
  ['computed receiver', source('ngOnDestroy', 'this["subscription"].unsubscribe();'), source('ngOnDestroy', '')],
]) test(`${name} does not select teardown rule`, async t => {
  const r = await review(t, before, after); assert.equal(r.decision.status, 'skipped'); assert.equal(r.packet.selectedRules.length, 0);
});

test('simple state assignment selects the specified target/method', async t => {
  const r = await review(t, source('load', 'this.loading = true;'), source('load', ''), state);
  assert.equal(r.decision.status, 'matched'); const observation = r.decision.matches[0].syntaxMatches[0][0]; assert.equal(observation.target, 'this.loading'); assert.equal(observation.within, 'load');
});

for (const [name, statement, method] of [['another state', 'this.ready = true;', 'load'], ['another method', 'this.loading = true;', 'reset'], ['compound assignment', 'this.loading += 1;', 'load']]) test(`${name} does not select state invariant`, async t => {
  const r = await review(t, source(method, statement), source(method, ''), state); assert.equal(r.decision.status, 'skipped');
});

test('anonymous callback does not inherit outer method scope and reports unavailable qualifier', async t => {
  const r = await review(t, source('ngOnDestroy', 'const callback = () => this.subscription.unsubscribe();'), source('ngOnDestroy', ''));
  assert.equal(r.decision.status, 'skipped'); assert.equal(r.decision.reason, 'syntax-evidence-unavailable');
});

test('method rename changes contextual scope even with unchanged call tokens', async t => {
  const r = await review(t, source(), source('refresh')); assert.equal(r.decision.status, 'matched'); assert.equal(r.decision.matches[0].syntaxMatches[0][0].within, 'ngOnDestroy'); assert.equal(r.decision.matches[0].syntaxMatches[0][0].withinLine, 3);
});

test('added member calls are observed independently', async t => {
  const r = await review(t, source('ngOnDestroy', ''), source(), { ...teardown, side: 'added' }); assert.equal(r.decision.status, 'matched');
});
