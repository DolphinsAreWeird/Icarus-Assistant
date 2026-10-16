// Words and finishing touches for visitors who explore on their own (the hosted demo for judges), applied to Oasis's
// design export when it loads. The export itself stays unchanged; a string that is no longer in it is skipped, so a
// new export never breaks the app (test/judge-copy.test.ts watches every one).
//
//   JUDGE_COPY      the side console speaks to a visitor, not a presenter ("starts timer", "Scenario B")
//   PRODUCT_POLISH  no design placeholders on screen: a real Visa card, an avatar, one user name, baht everywhere
//   LIVE_DATA_COPY  with the backend: labels that say what is true (live prices; the swap uses the THB balance)

export const JUDGE_COPY: ReadonlyArray<readonly [string, string]> = [
  ['Icarus demo console', 'Try Icarus yourself'],
  ['Hackathon scenarios. Prices, balances and assistant replies are demo data.', 'Live prices, demo account. Nothing real is bought.'],
  ["title:'Without Icarus',sub:'Resets to Home, starts timer. Stops at confirmation.'",
    "title:'Race 1: without Icarus',sub:'Buy ฿1,000 of gold by tapping through the app. The stopwatch stops at Confirm.'"],
  ["title:'With Icarus',sub:'Opens voice and starts timer. Say “Put 1,000 baht in gold”.'",
    "title:'Race 2: with Icarus',sub:'The same task by voice. Say “Put 1,000 baht in gold”.'"],
  ["title:'Say “1,000 baht in gold”',sub:'Speaks the Scenario B request for you.'",
    "title:'No mic? Let Icarus hear it',sub:'Plays the race 2 request for you.'"],
  ["sub:'Optional tutorial mode with highlights.'", "sub:'Icarus points at each button, one step at a time.'"],
  ['Shows questions and friction from this session.', 'What users asked and where they got stuck: the view a business pays for.'],
  // the race itself: what's running, the two times, and the result in plain words
  ["this.toast('Scenario A: buy ฿1,000 of Gold manually')", "this.toast('Race 1: buy ฿1,000 of gold by tapping through the app')"],
  ["'Running · Scenario A':'Running · Scenario B'):'Idle'", "'Race 1 running · by hand':'Race 2 running · with Icarus'):'Ready'"],
  ['>A · Manual<', '>Race 1 · by hand<'],
  ['>B · With Icarus<', '>Race 2 · Icarus<'],
  ["'Icarus flow was '+(s.results.A/s.results.B).toFixed(1)+'× faster':'Manual flow was faster this run'",
    "'With Icarus: '+(s.results.A/s.results.B).toFixed(1)+'× faster than by hand':'By hand was faster this time. Try race 2 by voice.'"],
];

const CONTACTLESS = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M8.5 7.5a6 6 0 0 1 0 9M12 5a9.5 9.5 0 0 1 0 14M15.5 2.5a13 13 0 0 1 0 19"/></svg>';
const CHIP = '<div style="width:44px;height:33px;border-radius:7px;background:linear-gradient(135deg,#F7D98B,#D9A93E);box-shadow:inset 0 0 0 1px rgba(120,80,10,.25)">' +
  '<svg width="44" height="33" viewBox="0 0 44 33" fill="none" stroke="rgba(120,80,10,.45)" stroke-width="1"><path d="M0 11h14M0 22h14M30 11h14M30 22h14M14 0v33M30 0v33M14 16.5h16"/></svg></div>';

export const PRODUCT_POLISH: ReadonlyArray<readonly [string, string]> = [
  // the avatar: an initial, not a "photo" placeholder
  ['background:repeating-linear-gradient(135deg,#F0D6DD 0 4px,#F8E6EB 4px 8px);display:flex;align-items:center;justify-content:center;font:500 9px ui-monospace,Menlo,monospace;color:#8A6B75">photo<',
    'background:linear-gradient(135deg,#F6A6B8,#C94F72);display:flex;align-items:center;justify-content:center;font:600 21px Fredoka,Mali,system-ui,sans-serif;color:#fff;box-shadow:0 4px 10px rgba(201,79,114,.3)">M<'],
  // one user: the backend's demo account is Mint
  ['>John Doe<', '>Mint Srisuk<'],
  ['Hi John', 'Hi Mint'],
  ['สวัสดีจอห์น', 'สวัสดีมิ้นท์'],
  // the card: a U-topia Visa debit card, with a chip and the contactless mark
  ['background-color:#E8809B;background-image:radial-gradient(circle at 20px 20px,rgba(255,255,255,.22) 0 6px,transparent 7px);background-size:40px 40px;padding:20px 22px;',
    'background-color:#C94F72;background-image:radial-gradient(circle at 20px 20px,rgba(255,255,255,.13) 0 5px,transparent 6px),linear-gradient(135deg,#F290AB 0%,#D9668A 45%,#A8385A 100%);background-size:40px 40px,100% 100%;box-shadow:0 14px 30px rgba(168,56,90,.35);padding:20px 22px;'],
  ['<div style="display:flex;justify-content:flex-end"><div style="height:26px;padding:0 10px;border:1px dashed rgba(255,255,255,.35);border-radius:6px;font:500 10px ui-monospace,Menlo,monospace;display:flex;align-items:center;color:rgba(255,255,255,.6)">network logo</div></div>',
    '<div style="display:flex;justify-content:space-between;align-items:center"><div style="font:600 21px Fredoka,Mali,system-ui,sans-serif;letter-spacing:.2px">U-topia</div>' +
    `<div style="display:flex;align-items:center;gap:10px"><div style="font-size:11px;letter-spacing:1.5px;opacity:.85">DEBIT</div>${CONTACTLESS}</div></div>${CHIP}`],
  ['<div style="display:flex;align-items:center;justify-content:space-between"><div style="height:26px;padding:0 10px;border:1px dashed rgba(255,255,255,.35);border-radius:6px;font:500 10px ui-monospace,Menlo,monospace;display:flex;align-items:center;color:rgba(255,255,255,.6)">brand logo</div><div style="font-size:15px;letter-spacing:.5px">JOHN DOE</div></div>',
    '<div style="display:flex;align-items:flex-end;justify-content:space-between"><div><div style="font-size:9.5px;letter-spacing:1.5px;opacity:.8">CARDHOLDER · VALID THRU 08/29</div>' +
    '<div style="font-size:15px;letter-spacing:.8px;margin-top:2px">MINT SRISUK</div></div><div style="font:italic 900 31px/1 \'Arial Black\',Arial,sans-serif;letter-spacing:-1.5px;color:#fff">VISA</div></div>'],
  // baht, not dollars
  ['$8,448.60', '฿8,448.60'],
  ['>$4k<', '>฿4k<'],
  ['>$2k<', '>฿2k<'],
  ['>$0<', '>฿0<'],
];

export const LIVE_DATA_COPY: ReadonlyArray<readonly [string, string]> = [
  ['Demo prices · not live', 'Live prices, in baht'],
  ['Prices shown are demo data, not live market prices.', 'Prices are live, in baht; the account is a demo.'],
  // the asset page's change pill: the backend's change is over the 1D chart the app shows, so say 1D, not 24h
  ['{{ asset.change24 }}<span style="font-weight:400;opacity:.8">24h</span>', '{{ asset.change24 }}<span style="font-weight:400;opacity:.8">1D</span>'],
  ['Prices are demo data. The final quantity may differ slightly when the order fills.',
    'Prices are live; the account is a demo. The final quantity may differ slightly when the order fills.'],
  // the swap starts from the THB wallet the demo account really has (demo-data.ts fills the numbers)
  ['background:#26A17B;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600">₮<',
    'background:#C94F72;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600">฿<'],
  ['<div style="font-size:17px">USDT</div>', '<div style="font-size:17px">THB</div>'],
  ['Balance 2,140.00', 'Balance {{ spendBal }}'],
  ['≈ 0.007416', '≈ {{ swapBtc }}'],
  ['1 BTC = $67,420.15', '1 BTC ≈ {{ btcThb }}'],
];

const apply = (html: string, pairs: ReadonlyArray<readonly [string, string]>) =>
  pairs.reduce((out, [from, to]) => out.split(from).join(to), html);

export function withJudgeCopy(html: string, options: { liveData?: boolean } = {}): string {
  const polished = apply(apply(html, JUDGE_COPY), PRODUCT_POLISH);
  return options.liveData ? apply(polished, LIVE_DATA_COPY) : polished;
}
