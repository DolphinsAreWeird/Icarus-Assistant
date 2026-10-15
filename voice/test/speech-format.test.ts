import { describe, expect, it } from 'vitest';
import { numberToWordsEn, shortenForSpeech, spokenExactNumber, stripMarkdown, toSpeakable } from '../src/shared/speech-format';

const now = new Date('2026-10-15T10:00:00Z');
const en = (text: string, extra = {}) => toSpeakable(text, { lang: 'en', now, ...extra });
const th = (text: string, extra = {}) => toSpeakable(text, { lang: 'th', now, ...extra });

describe('markdown and symbols', () => {
  it('strips bold, italics, headings, bullets, links and emoji', () => {
    expect(en('**Gold** is *down* today')).toBe('Gold is down today.');
    expect(en('## Fees\n- Trading fee\n- Network fee')).toBe('Fees. Trading fee. Network fee.');
    expect(en('See [the fee page](https://example.com/fees) now.')).toBe('See the fee page now.');
    expect(en('Nice work 🎉')).toBe('Nice work.');
  });
  it('removes code blocks and raw URLs', () => {
    expect(stripMarkdown('Look: ```const x = 1``` and https://a.b/c done')).toContain('done');
    expect(en('Go to https://example.com now.')).toBe('Go to now.');
  });
  it('turns arrows, ampersands, tildes and dashes into speech', () => {
    expect(en('Gold → Bitcoin')).toBe('Gold to Bitcoin.');
    expect(en('Fees & taxes')).toBe('Fees and taxes.');
    expect(en('It costs ~50 baht')).toBe('It costs about fifty baht.');
    expect(en('Gold, which is steady \u2014 mostly \u2014 rose.')).toBe('Gold, which is steady, mostly, rose.');
  });
  it('never outputs an em dash', () => {
    expect(en('One \u2014 two \u2013 three')).not.toMatch(/[\u2013\u2014]/);
  });
});

describe('percent', () => {
  it('says down for negative and up for positive', () => {
    expect(en('Gold is -2.3% today')).toBe('Gold is down two point three percent today.');
    expect(en('Gold is +1.5% today')).toBe('Gold is up one point five percent today.');
    expect(en('Share is 2.3% of your money')).toBe('Share is two point three percent of your money.');
  });
  it('keeps the space before the number after punctuation or Thai letters', () => {
    expect(en('Gold, 2.3% today')).toBe('Gold, two point three percent today.');
    expect(en('(2.3%) today')).toBe('(two point three percent) today.');
    expect(th('ทองลดลง 2.3%')).toBe('ทองลดลง 2.3 เปอร์เซ็นต์.');
  });
  it('handles a space between the sign and the number', () => {
    expect(en('Gold is - 2.3% today')).toBe('Gold is down two point three percent today.');
  });
  it('handles the unicode minus', () => {
    expect(en('Gold is −2.3% today')).toBe('Gold is down two point three percent today.');
  });
  it('does not say "down down"', () => {
    expect(en('Gold fell -2.3% today')).toBe('Gold fell two point three percent today.');
    expect(en('Gold is down -2.3% since yesterday.')).toBe('Gold is down two point three percent since yesterday.');
    expect(en('Bitcoin rose +4% this week')).toBe('Bitcoin rose four percent this week.');
  });
  it('rounds for speech', () => {
    expect(en('Gold is down 2.34%')).toBe('Gold is down two point three percent.');
    expect(en('Bitcoin is up 12.7%')).toBe('Bitcoin is up about thirteen percent.');
  });
  it('reads ranges', () => {
    expect(en('Usually 5-10% a year')).toBe('Usually five to ten percent a year.');
  });
  it('works in Thai', () => {
    expect(th('ทอง -2.3%')).toBe('ทอง ลดลง 2.3 เปอร์เซ็นต์.');
    expect(th('ทองลดลง -2.3%')).toBe('ทองลดลง 2.3 เปอร์เซ็นต์.');
    expect(th('ทอง +1.5%')).toBe('ทอง เพิ่มขึ้น 1.5 เปอร์เซ็นต์.');
  });
});

describe('money', () => {
  it('turns the baht sign into words and rounds', () => {
    expect(en('It costs ฿1,015.')).toBe('It costs about one thousand baht.');
    expect(en('You have ฿87,432 in gold')).toBe('You have about eighty-seven thousand baht in gold.');
    expect(en('Fee is ฿15')).toBe('Fee is fifteen baht.');
    expect(en('Fee is ฿15.50')).toBe('Fee is about sixteen baht.');
  });
  it('handles codes and words', () => {
    expect(en('Pay THB 1,015 now')).toBe('Pay about one thousand baht now.');
    expect(en('Pay 1,015 THB now')).toBe('Pay about one thousand baht now.');
    expect(en('Pay 1,015 baht now')).toBe('Pay about one thousand baht now.');
    expect(en('Bitcoin is $67,432')).toBe('Bitcoin is about sixty-seven thousand dollars.');
  });
  it('says millions', () => {
    expect(en('Worth $1.2M')).toBe('Worth one point two million dollars.');
    expect(en('Worth $1.25M')).toBe('Worth about one point three million dollars.');
  });
  it('keeps small amounts', () => {
    expect(en('One unit is ฿0.45')).toBe('One unit is zero point four five baht.');
  });
  it('does not add "about" twice', () => {
    expect(en('That is about ฿1,015')).toBe('That is about one thousand baht.');
  });
  it('keeps every digit in exact mode', () => {
    expect(en('Total ฿1,015', { exact: true })).toBe('Total one thousand fifteen baht.');
    expect(en('Total ฿1,015.50', { exact: true })).toBe('Total one thousand fifteen point five zero baht.');
    expect(en('Gold is down 2.34%', { exact: true })).toBe('Gold is down two point three four percent.');
  });
  it('works in Thai', () => {
    expect(th('รวม ฿1,015')).toBe('รวม ประมาณ 1,000 บาท.');
    expect(th('ค่าธรรมเนียม 15 บาท')).toBe('ค่าธรรมเนียม 15 บาท.');
  });
});

describe('numbers are spoken as words in English (the live voice misread "1,015" as "1,215")', () => {
  it('says whole numbers', () => {
    expect(numberToWordsEn(0)).toBe('zero');
    expect(numberToWordsEn(15)).toBe('fifteen');
    expect(numberToWordsEn(21)).toBe('twenty-one');
    expect(numberToWordsEn(100)).toBe('one hundred');
    expect(numberToWordsEn(1015)).toBe('one thousand fifteen');
    expect(numberToWordsEn('1,015')).toBe('one thousand fifteen');
    expect(numberToWordsEn(1000)).toBe('one thousand');
    expect(numberToWordsEn(87432)).toBe('eighty-seven thousand four hundred thirty-two');
    expect(numberToWordsEn(1_250_000)).toBe('one million two hundred fifty thousand');
    expect(numberToWordsEn(1_000_001)).toBe('one million one');
    expect(numberToWordsEn(2_000_000_000)).toBe('two billion');
  });
  it('says every decimal digit on its own, so nothing is lost', () => {
    expect(numberToWordsEn('1,015.50')).toBe('one thousand fifteen point five zero');
    expect(numberToWordsEn('0.45')).toBe('zero point four five');
    expect(numberToWordsEn('1,234.56')).toBe('one thousand two hundred thirty-four point five six');
  });
  it('hands back anything that is not a plain number', () => {
    expect(numberToWordsEn('abc')).toBe('abc');
    expect(numberToWordsEn('1e9')).toBe('1e9');
    expect(numberToWordsEn('1234567890123456')).toBe('1234567890123456'); // over 15 digits
  });
  it('speaks exact amounts as words in English and digits in Thai', () => {
    expect(spokenExactNumber(1015, 'en')).toBe('one thousand fifteen');
    expect(spokenExactNumber(1015.5, 'en')).toBe('one thousand fifteen point five zero');
    expect(spokenExactNumber(1015, 'th')).toBe('1,015');
    expect(spokenExactNumber(1015.5, 'th')).toBe('1,015.50');
  });
  it('leaves small plain numbers alone (units, dates)', () => {
    expect(en('Over 7d')).toBe('Over 7 days.');
    expect(en('Updated 2026-10-15.')).toBe('Updated October 15.');
  });
});

describe('dates, times and units', () => {
  it('says dates naturally and drops the current year', () => {
    expect(en('Updated 2026-10-15.')).toBe('Updated October 15.');
    expect(en('Opened on 2025-03-02')).toBe('Opened on March 2, 2025.');
    expect(en('Due 15 Oct 2026')).toBe('Due October 15.');
    expect(en('Due Mar 2, 2025')).toBe('Due March 2, 2025.');
    expect(en('At 2026-10-15T14:30:00Z')).toBe('At October 15.');
  });
  it('says Thai dates in Buddhist Era', () => {
    expect(th('อัปเดต 2026-10-15')).toBe('อัปเดต 15 ตุลาคม.');
    expect(th('เปิดเมื่อ 2025-03-02')).toBe('เปิดเมื่อ 2 มีนาคม 2568.');
  });
  it('ignores impossible dates', () => {
    expect(en('Code 2026-13-45')).toContain('2026');
  });
  it('says times', () => {
    expect(en('Markets open at 09:05')).toBe('Markets open at 9:05 AM.');
    expect(en('Closes at 14:30')).toBe('Closes at 2:30 PM.');
    expect(en('Closes at 12:00')).toBe('Closes at 12 PM.');
  });
  it('says short units', () => {
    expect(en('Up 2% in 24h')).toBe('Up two percent in 24 hours.');
    expect(en('The 24h change is flat')).toBe('The 24 hour change is flat.');
    expect(en('Over 7d')).toBe('Over 7 days.');
  });
  it('leaves element ids alone', () => {
    expect(en('home.balance and asset.change24h')).toBe('home.balance and asset.change24h.');
  });
});

describe('pronunciation', () => {
  it('applies the pronunciation list', () => {
    expect(en('Welcome to U-topia')).toBe('Welcome to You topia.');
  });
});

describe('long replies', () => {
  const four = 'First point. Second point. Third point. Fourth point.';
  it('leaves 3 sentences or fewer alone', () => {
    expect(en('One. Two. Three.')).toBe('One. Two. Three.');
  });
  it('speaks the first two and points to the screen when longer', () => {
    expect(en(four)).toBe('First point. Second point. The rest is on your screen.');
  });
  it('does not split on decimals', () => {
    expect(en('Gold is up 2.3 percent. Bitcoin is flat.')).toBe('Gold is up 2.3 percent. Bitcoin is flat.');
  });
  it('shortens one very long sentence', () => {
    const long = 'word '.repeat(120).trim() + '.';
    const out = en(long);
    expect(out.length).toBeLessThan(400);
    expect(out.endsWith('The rest is on your screen.')).toBe(true);
  });
  it('uses the Thai pointer for long Thai text (by length, since Thai has no full stops)', () => {
    const long = 'ประโยคนี้ยาวพอสมควรและมีรายละเอียดมากมาย '.repeat(8).trim();
    expect(long.length).toBeGreaterThan(200);
    const out = th(long);
    expect(out.endsWith('ที่เหลืออ่านได้บนหน้าจอ')).toBe(true);
    expect(out.length).toBeLessThan(260);
  });
  it('does NOT cut a short Thai reply, even though Thai has spaces inside a sentence', () => {
    // This is the Thai mock "explain" reply. It has 5 space-separated pieces but is one short sentence.
    expect(th('ตัวเลขสีแดงคือการเปลี่ยนแปลงของวันนี้ ทองลดลง 2.3% จากเมื่อวาน')).toBe(
      'ตัวเลขสีแดงคือการเปลี่ยนแปลงของวันนี้ ทองลดลง 2.3 เปอร์เซ็นต์ จากเมื่อวาน.',
    );
  });
  it('counts Thai sentences by line breaks and full stops', () => {
    expect(th('หนึ่ง. สอง. สาม. สี่.')).toBe('หนึ่ง. สอง. ที่เหลืออ่านได้บนหน้าจอ');
  });
  it('shortenForSpeech can be called alone', () => {
    expect(shortenForSpeech('A. B. C. D.', { lang: 'en' })).toBe('A. B. The rest is on your screen.');
  });
});

describe('degenerate input', () => {
  it('returns an empty string for empty text', () => {
    expect(en('')).toBe('');
    expect(en('   ')).toBe('');
  });
});
