// A dynamic, answer-light FAQ. Rule: an answer never just asserts the conclusion ("because X is
// true"). It shows what the clues say, in numbers drawn from the data on screen, and hands the
// question back with something to try. All plain data — an AI helper could later sit behind it.
import { html, raw, fmt } from './dom.js';
import { placeName } from './places.js';

export const sticksLong = (d) => Math.tan((d.value_app * Math.PI) / 180);
export const farFromMiddle = (d) => `${Math.abs(d.lat).toFixed(0)}° ${d.lat >= 0 ? 'north' : 'south'} of the middle of the world`;

// ctx: { sites:[{o,d}], anySim, J, S, step }
export function buildFaq(ctx) {
  const { sites, anySim, J, step } = ctx;
  const byLen = [...sites].sort((a, b) => sticksLong(a.d) - sticksLong(b.d));
  const short = byLen[0], long = byLen[byLen.length - 1];
  const byMiddle = [...sites].sort((a, b) => Math.abs(a.d.lat) - Math.abs(b.d.lat));
  const name = (s) => placeName(s.d.lat, s.d.lon);
  const tries = J?.tries || [];
  const E = (id, steps, q, tags, a) => ({ id, steps, q, tags, a });

  return [
    E('why-long-short', ['look'], `Why is ${name(short)} the shortest and ${name(long)} the longest?`, 'shortest longest why different shadow city', html`
      <p>Let’s not guess. Let’s <b>look at the clues</b>.</p>
      <ul class="faqlist"><li><b>${name(short)}</b> is ${farFromMiddle(short.d)}. Its shadow is only <b>${fmt(sticksLong(short.d), 1)} sticks</b> long.</li>
      <li><b>${name(long)}</b> is ${farFromMiddle(long.d)}. Its shadow is <b>${fmt(sticksLong(long.d), 1)} sticks</b> long.</li></ul>
      <p>Now look at <i>every</i> place, from the middle of the world out to the far north and far south:</p>
      <div class="table-wrap"><table><thead><tr><th>Place</th><th class="num">Far from the middle</th><th class="num">Shadow (sticks)</th></tr></thead><tbody>${byMiddle.map((s) => html`<tr><td>${name(s)}</td><td class="num">${Math.abs(s.d.lat).toFixed(0)}°</td><td class="num">${fmt(sticksLong(s.d), 1)}</td></tr>`)}</tbody></table></div>
      <p style="margin-top:12px">Do you see a pattern? What gets bigger when the other thing gets bigger?</p>
      <p><button class="btn sm" data-faq-pattern>Show me the pattern</button></p>
      <p class="hint">Finding the pattern is the first clue. The next step is to build a world that makes the <i>same</i> pattern.</p>`),
    E('what-is-middle', ['look', 'guess'], 'What is “the middle of the world”?', 'equator latitude middle north south', html`
      <p>On a map or a globe, people draw an imaginary line around the middle. It’s called the <b>equator</b>. Every place has a number — its <b>latitude</b> — that says how far north or south of that line it is.</p>
      <p>We use that number because a phone’s GPS can measure it. Nobody has to tell you what it is.</p>`),
    E('which-way-shadow', ['look'], 'Why do all the shadows point the same way here?', 'direction point left right', html`
      <p>We drew them all pointing the same way so they’re <b>easy to compare</b>. In real life a shadow falls on the side away from the Sun, so it can point any direction.</p>
      <p>When you measure your own shadow, you’ll say which way it points.</p>`),
    E('how-measure', ['look', 'all'], 'How do people measure a shadow?', 'stick ruler measure how', html`
      <p>Stand a stick straight up in the sun. Measure the stick. Measure its shadow from the bottom of the stick to the tip. That’s it — a ruler is all you need.</p>
      <p>We write down <b>where</b> you are (GPS), <b>when</b> (the clock), and how <b>straight</b> the stick was. Then anyone can check.</p>
      <p><a class="btn sm" href="#/e/shadow-angle/run">I want to try it</a></p>`),
    E('are-real', ['all'], 'Are these sticks real?', 'real fake simulated practice computer', anySim
      ? html`<p>Right now they are <b>practice sticks</b>, made by a computer, so you can try the game. We say so on purpose — we don’t want to trick you.</p><p>Real sticks come from real people. The practice ones are replaced when real measurements come in. You can add yours!</p><p><a class="btn sm primary" href="#/e/shadow-angle/run">Measure my own shadow</a></p>`
      : html`<p>Yes. Real people with real sticks and real phones measured these. You can open any one and check the numbers.</p>`),
    E('why-no-answer', ['all'], 'Why won’t you just tell me the answer?', 'answer tell why not', html`
      <p>Because something you find out <b>yourself</b> stays with you. And because anybody — even us — can be wrong.</p>
      <p>So we give you the clues and the tools, and <b>you</b> decide. You can look at every number. Nothing is hidden.</p>`),
    E('can-be-wrong', ['all'], 'What if I get it wrong?', 'wrong mistake fail', html`
      <p>Then you learned something! Real scientists have wrong ideas all the time. What matters is that they <b>test</b> them.</p>
      <p>A wrong idea that gets tested helps you more than a right idea you never checked.</p>`),
    E('why-flat', ['all'], 'Why do some people think the Earth is flat?', 'flat earth people believe', html`
      <p>It’s a fair question — and a fair clue. <b>Where you stand, the ground looks flat.</b> Every one of us has seen that.</p>
      <p>The way to find out isn’t to argue or to trust someone. It’s to <b>test an idea against measurements</b>. Any idea is welcome here, including a flat world: build it and see what it predicts for real places.</p>
      <p><button class="btn sm" data-faq-go="3">Build a world and test it</button></p>`),
    E('can-i-trust', ['all'], 'How do I know this app isn’t tricking me?', 'trust trick fake honest verify', html`
      <p>Great question to ask. You don’t have to trust us:</p>
      <ul class="faqlist"><li>Every measurement’s numbers are public. You can download them all.</li><li>The math is open — you can read it.</li><li>Each measurement is signed by the phone that made it, and nothing can be changed in secret.</li><li>The world-builder only <i>checks</i> your idea. It never picks the answer for you.</li></ul>
      <p><a class="btn sm" href="#/method">How it all works</a></p>`),
    E('predict-first', ['guess'], 'What if I don’t know which idea to pick?', 'dont know pick unsure', html`
      <p>That’s a good place to start. Pick the one that feels closest, or pick “I don’t know yet.” Nothing is locked in.</p>
      <p>Each idea makes a <b>prediction</b> — what the shadows should look like. Next you’ll check the predictions against the real sticks.</p>`),
    E('which-right', ['guess'], 'Which idea is right?', 'which right correct answer', html`
      <p>That’s exactly what the next step is for. Each idea says what shadows should look like in each place. Then we <b>compare with the real sticks</b>. The one that matches is the one to trust.</p>`),
    E('lamp', ['guess', 'build'], 'What does “the Sun is close, like a lamp” mean?', 'close lamp sun distance near', html`
      <p>Imagine a lamp over a table. Put a pencil on the table close to the lamp, and another far out at the edge. Their shadows are different, because the light comes from a <b>different direction</b> for each one.</p>
      <p>You can try this with a lamp at home! Does it make the same pattern you see in the sticks?</p>`),
    E('matches', ['build'], 'What does “matches” mean?', 'match close enough tolerance', html`
      <p>For each place, your world makes a prediction: “the shadow should be this long.” If the real shadow is <b>close enough</b> — close enough that a wobbly ruler could explain the difference — we count it as a match ✓.</p>
      <p>If it’s farther off than that, it’s “different” ✗.</p>`),
    E('dotted-change', ['build'], 'Why do the dotted lines change when I move the Sun?', 'dotted line slider change', html`
      <p>The dotted line is what <b>your world</b> says each shadow should be. When you move the Sun, you change what your world says — so the lines move.</p>
      <p>Watch which places move a lot and which barely move. What do the moving ones have in common?</p>`),
    E('only-some', ['build'], 'My world only matches some places. Did I do it wrong?', 'some places partly wrong', html`
      <p>No — you just learned something! Which places match, and which don’t?</p>
      <p>Try this: change <b>one thing at a time</b>, then test again. ${tries.length ? `You’ve tried ${tries.length} world${tries.length > 1 ? 's' : ''} so far.` : ''} Is there a world that matches <i>all</i> of the places?</p>`),
    E('both-shapes', ['build'], 'Should I try both ground shapes?', 'plate ball both try', html`
      <p>Yes — a good detective tests <b>every idea</b>, even the ones they don’t like. Try the plate and the ball, and slide the Sun close and far for each.</p>`),
    E('match-all', ['build', 'notes'], 'What if I find a world that matches every place?', 'match all perfect found', html`
      <p>Great detective work! Now comes the real test: does it also work for places <b>nobody has measured yet</b>? A good idea predicts places it hasn’t seen.</p>
      <p>Add your own measurement and see if your world gets <i>that</i> one right too.</p>
      <p><a class="btn sm primary" href="#/e/shadow-angle/run">Measure my own shadow</a></p>`),
    E('sun-how-far', ['build'], 'How far away is the Sun, really?', 'sun distance how far', html`
      <p>People have worked it out in different ways — and the shadow trick you’re using is one of the oldest. That’s why you get a slider: you pick a distance, and we check what your pick predicts.</p>
      <p>Which distances match the real sticks best?</p>`),
    E('what-write', ['notes'], 'What should I write?', 'write notes journal', html`
      <p>Just say what you saw, in your own words: “I tried…, and I noticed…” You can also write what would make you change your mind. That’s a real scientist’s habit.</p>`),
    E('share', ['notes', 'next'], 'How do I share this with a friend who disagrees?', 'share friend argue convince', html`
      <p>Don’t send them an answer — send them the <b>game</b>. Ask them to build <i>their</i> world and see what it predicts. People believe what they test themselves.</p>
      <p><button class="btn sm primary" data-faq-share>Send the link</button></p>`),
  ].map((e) => ({ ...e, relevant: e.steps.includes(step) || e.steps.includes('all') }));
}

export function searchFaq(faq, query) {
  const q = query.trim().toLowerCase();
  if (!q) return faq;
  const words = q.split(/\s+/);
  const score = (e) => words.reduce((s, w) => s + (e.q.toLowerCase().includes(w) ? 3 : 0) + (e.tags.includes(w) ? 2 : 0), 0);
  return faq.map((e) => ({ e, s: score(e) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.e);
}

export { raw };
