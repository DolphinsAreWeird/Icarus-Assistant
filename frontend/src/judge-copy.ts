// Words for visitors who explore on their own (the hosted demo for judges). Oasis's side console was written for a
// live pitch with a presenter ("starts timer", "Scenario B"). Same buttons, same actions; only the words change.
// A string that is no longer in the design is skipped, so a new export from Oasis never breaks the app.

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
];

export function withJudgeCopy(html: string): string {
  return JUDGE_COPY.reduce((out, [from, to]) => out.split(from).join(to), html);
}
