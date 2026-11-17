import test from 'node:test';
import assert from 'node:assert/strict';
import { assess } from '../src/lib/model.ts';
import { agoText, bzWord, cloudWord, durationText, explain, kpText, kpWord, lookPhrase, powerWord, speedWord } from '../src/lib/words.ts';

const base = { name: 'Hobart', kp: 4.67, live: true, need: 4, cloud: 12, when: '1 am', bearing: 189 };

test('sentences read properly for each outcome', () => {
  assert.equal(
    explain(assess('visible', 'clear'), base),
    'Kp is about 5 right now, and Hobart usually needs Kp 4. The sky is mostly clear (12% cloud). Get away from town lights and look to the south.',
  );
  assert.equal(
    explain(assess('visible', 'clear'), { ...base, live: false, kp: 3.67 }),
    'Kp is forecast to reach about 4 around 1 am, and Hobart usually needs Kp 4. The sky should be mostly clear (12% cloud). Get away from town lights and look to the south. That only just clears the bar, so expect it low on the horizon and paler to the eye than in photos.',
  );
  // Comfortably above the bar: no caveat. Overhead: says so.
  assert.ok(!/only just/.test(explain(assess('visible', 'clear'), { ...base, kp: 6 })));
  assert.match(explain(assess('overhead', 'clear'), { ...base, kp: 7 }), /climb high into the sky/);
  assert.match(explain(assess('overhead', 'partly'), { ...base, kp: 7, cloud: 55 }), /high enough\. But about 55% of the sky is covered\. Worth it if you can find a gap to the south\. At this level/);
  assert.match(explain(assess('visible', 'cloudy'), { ...base, live: false, cloud: 95 }), /cloud cover will be about 95%, which hides it/);
  assert.match(explain(assess('visible', 'unknown'), { ...base, cloud: null }), /cloud forecast is unavailable/);
  assert.equal(
    explain(assess('close', 'clear'), { ...base, kp: 3 }),
    'Kp is about 3 right now, one step short: Hobart usually needs Kp 4. From a dark spot with a clear view to the south, a faint glow low on the horizon is possible. A camera will pick it up before your eyes do.',
  );
  assert.match(explain(assess('close', 'cloudy'), { ...base, kp: 3, cloud: 80 }), /With about 80% cloud on top of that/);
  assert.match(explain(assess('faint', 'clear'), { ...base, name: 'Melbourne', need: 7, kp: 5 }), /Melbourne usually needs Kp 7 for a display you can see/);
  assert.equal(explain(assess('quiet', 'clear'), { ...base, kp: 1 }), 'Kp is about 1 right now, well short: Hobart usually needs Kp 4.');
});

test('places beyond the Kp table get their own wording', () => {
  const perth = { ...base, name: 'Perth', need: null, bearing: 181 };
  assert.match(explain(assess('quiet', 'clear'), { ...perth, kp: 5 }), /^Kp is about 5 right now\. Perth is too far north for that/);
  assert.match(explain(assess('close', 'clear'), { ...perth, kp: 9 }), /an extreme storm\. Perth is normally too far north .* Face south\.$/);
  assert.match(explain(assess('close', 'cloudy'), { ...perth, kp: 9, cloud: 90 }), /about 90% of the sky is covered/);
  for (const reason of ['quiet', 'faint', 'close'] as const) {
    for (const sky of ['clear', 'partly', 'cloudy', 'unknown'] as const) {
      const text = explain(assess(reason, sky), { ...perth, kp: 9, cloud: sky === 'unknown' ? null : 50 });
      assert.ok(!/null|undefined|NaN/.test(text), text);
    }
  }
});

test('no sentence leaks a placeholder', () => {
  for (const activity of ['overhead', 'visible', 'close', 'faint', 'quiet'] as const) {
    for (const sky of ['clear', 'partly', 'cloudy', 'unknown'] as const) {
      for (const live of [true, false]) {
        const text = explain(assess(activity, sky), { ...base, live, cloud: sky === 'unknown' ? null : 40, bearing: null });
        assert.ok(!/null|undefined|NaN/.test(text), text);
        assert.ok(/\.$/.test(text), text);
      }
    }
  }
});

test('reading words', () => {
  assert.equal(kpWord(0.67), 'quiet');
  assert.equal(kpWord(3.33), 'unsettled');
  assert.equal(kpWord(4), 'active');
  assert.equal(kpWord(4.67), 'G1 minor storm');
  assert.equal(kpWord(9), 'G5 extreme storm');
  assert.equal(kpText(3), '3');
  assert.equal(kpText(3.67), '3.7');
  assert.equal(bzWord(-12), 'strongly south: good for aurora');
  assert.equal(bzWord(1), 'slightly north');
  assert.equal(speedWord(292), 'slow');
  assert.equal(speedWord(650), 'fast');
  assert.equal(powerWord(11), 'low');
  assert.equal(powerWord(75), 'high');
  assert.equal(cloudWord(30), 'mostly clear');
  assert.equal(lookPhrase(195), 'to the south-southwest');
  assert.equal(lookPhrase(null), 'to the south');
  assert.equal(durationText(5 * 3600000 + 20 * 60000), '5 h 20 min');
  assert.equal(durationText(3 * 3600000), '3 h');
  assert.equal(agoText(0, 30000), 'just now');
  assert.equal(agoText(0, 7 * 60000), '7 min ago');
  assert.equal(agoText(0, 2 * 3600000), '2 hours ago');
});
