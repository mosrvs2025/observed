import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./web-resolve.mjs', import.meta.url);
const { buildFaq, searchFaq } = await import('../public/js/faq.js');

const site = (lat, lon, value_app) => ({ o: { synthetic: true }, d: { lat, lon, value_app } });
const sites = [site(19, -99, 5), site(51, 0, 51), site(64, -22, 70), site(-34, 151, 34), site(-54, -68, 60), site(35, 139, 36), site(-1, 36, 1), site(40, -104, 38)];

test('every FAQ entry renders for every step, with data-driven names and numbers', () => {
  for (const step of ['hello', 'look', 'guess', 'build', 'notes', 'next']) {
    const faq = buildFaq({ sites, anySim: true, J: { tries: [{}, {}] }, S: {}, step });
    assert.ok(faq.length >= 15);
    for (const e of faq) { assert.ok(e.q.length > 5, e.id); assert.ok(String(e.a).length > 40, e.id); assert.doesNotMatch(e.q, /[<>]/, `raw markup in question ${e.id}`); }
  }
  const why = buildFaq({ sites, anySim: true, J: {}, S: {}, step: 'look' }).find((e) => e.id === 'why-long-short');
  assert.match(why.q, /shortest/); assert.match(String(why.a), /sticks/);
});

test('answers hand the question back — none states the conclusion outright', () => {
  const faq = buildFaq({ sites, anySim: false, J: {}, S: {}, step: 'build' });
  for (const e of faq) assert.doesNotMatch(String(e.a), /because the (earth|world) is (round|a ball|flat)|the earth is (round|flat)\b/i, e.id);
});

test('search finds relevant questions and ignores noise', () => {
  const faq = buildFaq({ sites, anySim: true, J: {}, S: {}, step: 'look' });
  assert.ok(searchFaq(faq, 'flat').some((e) => e.id === 'why-flat'));
  assert.ok(searchFaq(faq, 'real').some((e) => e.id === 'are-real'));
  assert.equal(searchFaq(faq, 'zzzzqqq').length, 0);
  assert.equal(searchFaq(faq, '').length, faq.length);
});
