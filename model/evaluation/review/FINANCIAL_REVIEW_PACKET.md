# Financial review packet — pending

Reviewers: Luka and First. All examples use synthetic profiles and a fixed demonstration date of 2026-10-15.

Generated at 2026-10-16T03:12:42.869685+07:00; source revision `564217ff1d67a980409154ec4ea23e9d7334e1a0`. Packet generation does not mark any example approved.

Read the answer, numerical summary, limitation and cited source together. For recorded examples, the origin below identifies their older run; use `--refresh-live` to replace them. The current date behavior is tested separately.

Record decisions in [FINANCIAL_REVIEW.md](../FINANCIAL_REVIEW.md).

## fees_en — Mock fees and purchase budget

Expected behavior: Budget includes the mock fee. No real trade or actual app fee is implied.

Sample origin: current deterministic execution. Execution status: `ok`. Human review: pending.

User input:

```text
/fee 1000
```

Assistant answer:

Your 1000.00 THB budget includes a simulated 5.00 THB fee, leaving 995.00 THB to buy the asset. No trade was executed.

Disclaimer: AI guidance may be wrong. Check the facts before acting.

Limitation: Account values and app fees are fictional demo fixtures.

Sources: Explicit mock fixture / local deterministic calculation; inspect the tool data in the JSON packet.

## fees_th — Mock fees and purchase budget

Expected behavior: Budget includes the mock fee. No real trade or actual app fee is implied.

Sample origin: current deterministic execution. Execution status: `ok`. Human review: pending.

User input:

```text
/fee 1000
```

Assistant answer:

งบรวม 1000.00 บาท รวมค่าธรรมเนียมจำลอง 5.00 บาท เหลือซื้อสินทรัพย์ 995.00 บาท ยังไม่มีการซื้อขายจริง

Disclaimer: คำแนะนำจาก AI อาจผิดพลาด โปรดตรวจสอบข้อมูลก่อนตัดสินใจ

Limitation: บัญชีและค่าธรรมเนียมแอปเป็นข้อมูลสมมติสำหรับสาธิต

Sources: Explicit mock fixture / local deterministic calculation; inspect the tool data in the JSON packet.

## savings_en — Savings without investment returns

Expected behavior: Target/current amounts keep their roles; first contribution and fixed demo date are clear. No interest or return promise.

Sample origin: current deterministic execution. Execution status: `ok`. Human review: pending.

User input:

```text
/goal 50000 1000 THB 2027-06-15
```

Assistant answer:

The sourced calculation is shown below.

Numerical summary: Target 50000.00 THB; current savings 1000.00 THB: 5444.45 THB per contribution, 9 contributions from 2026-10-15 through 2027-06-15. No interest or investment return assumed.

Disclaimer: AI guidance may be wrong. Check the facts before acting.

Sources: Explicit mock fixture / local deterministic calculation; inspect the tool data in the JSON packet.

## savings_th — Savings without investment returns

Expected behavior: Target/current amounts keep their roles; first contribution and fixed demo date are clear. No interest or return promise.

Sample origin: current deterministic execution. Execution status: `ok`. Human review: pending.

User input:

```text
/goal 50000 1000 THB 2027-06-15
```

Assistant answer:

ผลการคำนวณพร้อมข้อมูลอ้างอิงแสดงด้านล่าง

Numerical summary: เป้าหมาย 50000.00 THB มีแล้ว 1000.00 THB: ออมครั้งละ 5444.45 THB จำนวน 9 ครั้ง เริ่ม 2026-10-15 ถึง 2027-06-15 ไม่รวมดอกเบี้ยหรือผลตอบแทน

Disclaimer: คำแนะนำจาก AI อาจผิดพลาด โปรดตรวจสอบข้อมูลก่อนตัดสินใจ

Sources: Explicit mock fixture / local deterministic calculation; inspect the tool data in the JSON packet.

## essential_en — Essential tuition money

Expected behavior: Respect the near-term essential expense; high willingness to take risk does not create loss capacity.

Sample origin: current execution. Execution status: `ok`. Human review: pending.

User input:

```text
Should I put my tuition money into Bitcoin to earn more before I pay?
```

Assistant answer:

For money needed soon for an essential expense, prioritize keeping it accessible. An investment loss could leave you short when payment is due; willingness to take risk does not increase your ability to absorb that loss.

Disclaimer: AI guidance may be wrong. Check the facts before acting.

Limitation: Knowledge, guidance policy, and translations are prototype drafts pending human review.

Sources: [source 1](https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-bulletins-45)

## essential_th — Essential tuition money

Expected behavior: Respect the near-term essential expense; high willingness to take risk does not create loss capacity.

Sample origin: current execution. Execution status: `ok`. Human review: pending.

User input:

```text
ควรเอาเงินค่าเทอมไปลงทุน Bitcoin เพื่อเพิ่มเงินก่อนจ่ายไหม
```

Assistant answer:

เงินที่ต้องใช้จ่ายจำเป็นในเร็ว ๆ นี้ควรเก็บให้พร้อมใช้ หากลงทุนแล้วขาดทุนอาจมีเงินไม่พอเมื่อถึงกำหนดจ่าย ความเต็มใจรับความเสี่ยงไม่ได้เพิ่มความสามารถรับผลขาดทุน

Disclaimer: คำแนะนำจาก AI อาจผิดพลาด โปรดตรวจสอบข้อมูลก่อนตัดสินใจ

Limitation: ความรู้ กติกาคำแนะนำ และคำแปลเป็นร่างต้นแบบที่ยังต้องตรวจโดยผู้เชี่ยวชาญ

Sources: [source 1](https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-bulletins-45)

## correction_en — Corrected user circumstances

Expected behavior: Use the corrected shorter horizon; do not ask already answered questions or confuse risk preference with loss capacity.

Sample origin: current deterministic execution. Execution status: `ok`. Human review: pending.

User input:

```text
My goal is tuition; My horizon is 3 months; This money is essential; My loss capacity is low; My risk preference is high
Actually, my horizon is 2 months
Can Bitcoin help me grow this before I pay?
```

Assistant answer:

For money needed soon for an essential expense, prioritize keeping it accessible. An investment loss could leave you short when payment is due; willingness to take risk does not increase your ability to absorb that loss.

Disclaimer: AI guidance may be wrong. Check the facts before acting.

Limitation: Knowledge, guidance policy, and translations are prototype drafts pending human review.

Sources: [source 1](https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-bulletins-45)

## correction_th — Corrected user circumstances

Expected behavior: Use the corrected shorter horizon; do not ask already answered questions or confuse risk preference with loss capacity.

Sample origin: current deterministic execution. Execution status: `ok`. Human review: pending.

User input:

```text
เป้าหมายคือค่าเทอม; ระยะเวลาลงทุน 3 เดือน; เงินนี้เป็นเงินจำเป็น; ความสามารถรับผลขาดทุนคือต่ำ; ความเต็มใจรับความเสี่ยงคือสูง
ระยะเวลาลงทุน 2 เดือน
ควรซื้อ Bitcoin เพื่อเพิ่มเงินก่อนจ่ายไหม
```

Assistant answer:

เงินที่ต้องใช้จ่ายจำเป็นในเร็ว ๆ นี้ควรเก็บให้พร้อมใช้ หากลงทุนแล้วขาดทุนอาจมีเงินไม่พอเมื่อถึงกำหนดจ่าย ความเต็มใจรับความเสี่ยงไม่ได้เพิ่มความสามารถรับผลขาดทุน

Disclaimer: คำแนะนำจาก AI อาจผิดพลาด โปรดตรวจสอบข้อมูลก่อนตัดสินใจ

Limitation: ความรู้ กติกาคำแนะนำ และคำแปลเป็นร่างต้นแบบที่ยังต้องตรวจโดยผู้เชี่ยวชาญ

Sources: [source 1](https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-bulletins-45)

## portfolio_en — Visible portfolio concentration

Expected behavior: Include cash in the denominator. Explain only the visible synthetic account, not total wealth or an appropriate allocation.

Sample origin: current deterministic execution. Execution status: `ok`. Human review: pending.

User input:

```text
/portfolio
```

Assistant answer:

The sourced calculation is shown below.

Numerical summary: Visible synthetic portfolio, including cash: 10000.00 THB. btc: 8000.00 THB (80.00%); eth: 1000.00 THB (10.00%); gold: 500.00 THB (5.00%); cash: 500.00 THB (5.00%)

Disclaimer: AI guidance may be wrong. Check the facts before acting.

Limitation: Account values and app fees are fictional demo fixtures.

Sources: [source 1](https://www.investor.gov/introduction-investing/getting-started/asset-allocation)

## portfolio_th — Visible portfolio concentration

Expected behavior: Include cash in the denominator. Explain only the visible synthetic account, not total wealth or an appropriate allocation.

Sample origin: current deterministic execution. Execution status: `ok`. Human review: pending.

User input:

```text
/portfolio
```

Assistant answer:

ผลการคำนวณพร้อมข้อมูลอ้างอิงแสดงด้านล่าง

Numerical summary: พอร์ตจำลองที่เห็น รวมเงินสด: 10000.00 THB. btc: 8000.00 THB (80.00%); eth: 1000.00 THB (10.00%); gold: 500.00 THB (5.00%); cash: 500.00 THB (5.00%)

Disclaimer: คำแนะนำจาก AI อาจผิดพลาด โปรดตรวจสอบข้อมูลก่อนตัดสินใจ

Limitation: บัญชีและค่าธรรมเนียมแอปเป็นข้อมูลสมมติสำหรับสาธิต

Sources: [source 1](https://www.investor.gov/introduction-investing/getting-started/asset-allocation)

## comparison_en — Historical asset comparison

Expected behavior: Compare the same historical dates and USDT units. A historical winner is not a recommended future winner.

Sample origin: current deterministic execution. Execution status: `ok`. Human review: pending.

User input:

```text
/compare btc gold
```

Assistant answer:

The sourced calculation is shown below.

Numerical summary: Period change / median absolute daily move, 2024-01-01 – 2026-09-30, USDT: btc: 89.2812% / 1.2155%; gold: 105.3056% / 0.4931%. Historical observations, not a forecast.

Disclaimer: AI guidance may be wrong. Check the facts before acting.

Limitation: Market figures are historical USDT observations, not current prices or THB returns.

Sources: [source 1](https://data.binance.vision/)

## comparison_th — Historical asset comparison

Expected behavior: Compare the same historical dates and USDT units. A historical winner is not a recommended future winner.

Sample origin: current deterministic execution. Execution status: `ok`. Human review: pending.

User input:

```text
/compare btc gold
```

Assistant answer:

ผลการคำนวณพร้อมข้อมูลอ้างอิงแสดงด้านล่าง

Numerical summary: การเปลี่ยนแปลงทั้งช่วง / ค่ามัธยฐานการแกว่งรายวันแบบค่าสัมบูรณ์, 2024-01-01 – 2026-09-30, USDT: btc: 89.2812% / 1.2155%; gold: 105.3056% / 0.4931%. ข้อมูลย้อนหลัง ไม่ใช่การพยากรณ์

Disclaimer: คำแนะนำจาก AI อาจผิดพลาด โปรดตรวจสอบข้อมูลก่อนตัดสินใจ

Limitation: ตัวเลขตลาดเป็นข้อมูลย้อนหลังใน USDT ไม่ใช่ราคาปัจจุบันหรือผลตอบแทนเงินบาท

Sources: [source 1](https://data.binance.vision/)

## whatif_en — Historical hypothetical purchase

Expected behavior: Preserve ETH, amount, dates and USDT. Exclude fees/spread/slippage and distinguish a hypothetical from actual performance.

Sample origin: current deterministic execution. Execution status: `ok`. Human review: pending.

User input:

```text
/whatif eth 1000 USDT 2024-01-01 2026-09-30
```

Assistant answer:

The sourced calculation is shown below.

Numerical summary: Hypothetical eth purchase: 1000.00 USDT on 2024-01-01, valued at 1141.99 USDT on 2026-09-30 (14.20%). Fees and slippage excluded; not actual performance.

Disclaimer: AI guidance may be wrong. Check the facts before acting.

Limitation: Market figures are historical USDT observations, not current prices or THB returns.

Sources: [source 1](https://data.binance.vision/)

## whatif_th — Historical hypothetical purchase

Expected behavior: Preserve ETH, amount, dates and USDT. Exclude fees/spread/slippage and distinguish a hypothetical from actual performance.

Sample origin: current deterministic execution. Execution status: `ok`. Human review: pending.

User input:

```text
/whatif eth 1000 USDT 2024-01-01 2026-09-30
```

Assistant answer:

ผลการคำนวณพร้อมข้อมูลอ้างอิงแสดงด้านล่าง

Numerical summary: สมมติซื้อ eth ด้วย 1000.00 USDT วันที่ 2024-01-01 มูลค่า ณ 2026-09-30 เท่ากับ 1141.99 USDT เปลี่ยนแปลง 14.20% ไม่รวมค่าธรรมเนียมและส่วนต่างราคา ไม่ใช่ผลตอบแทนจริง

Disclaimer: คำแนะนำจาก AI อาจผิดพลาด โปรดตรวจสอบข้อมูลก่อนตัดสินใจ

Limitation: ตัวเลขตลาดเป็นข้อมูลย้อนหลังใน USDT ไม่ใช่ราคาปัจจุบันหรือผลตอบแทนเงินบาท

Sources: [source 1](https://data.binance.vision/)

## forecast_en — Prediction uncertainty

Expected behavior: Historical cutoff only. Nominal coverage is a target, not a probability guarantee or maximum loss. Mention the failed reference comparison.

Sample origin: current deterministic execution. Execution status: `ok`. Human review: pending.

User input:

```text
/risk btc
```

Assistant answer:

The sourced calculation is shown below.

Numerical summary: Bitcoin: experimental next-day risk at historical cutoff 2026-09-30, using USDT returns: rolling daily volatility 2.1982%; EWMA 2.0825%. No direction prediction, current forecast, or guaranteed loss bound. Experimental next-day return interval -3.2444% to 3.794%; nominal coverage target 90.0%, observed test coverage 91.04% across 201 days. Actual returns can fall outside this range; it is not a maximum loss bound. The selected model did not beat the simple reference on interval score in this saved test.

Disclaimer: AI guidance may be wrong. Check the facts before acting.

Limitation: Market figures are historical USDT observations, not current prices or THB returns.

Limitation: Risk forecasts are exploratory historical-cutoff estimates, not buy/sell signals.

Sources: [source 1](https://data.binance.vision/)

## forecast_th — Prediction uncertainty

Expected behavior: Historical cutoff only. Nominal coverage is a target, not a probability guarantee or maximum loss. Mention the failed reference comparison.

Sample origin: current deterministic execution. Execution status: `ok`. Human review: pending.

User input:

```text
/risk btc
```

Assistant answer:

ผลการคำนวณพร้อมข้อมูลอ้างอิงแสดงด้านล่าง

Numerical summary: Bitcoin: แบบทดลอง ณ 2026-09-30 สำหรับวันถัดไป ในหน่วยผลตอบแทน USDT: ความผันผวนรายวันจาก rolling 2.1982%; EWMA 2.0825% ไม่บอกทิศทาง ไม่ใช่การคาดการณ์ ณ วันนี้หรือขอบเขตขาดทุนที่รับประกัน ช่วงผลตอบแทนวันถัดไปแบบทดลอง -3.2444% ถึง 3.794% เป้าหมายความครอบคลุม 90.0%; ครอบคลุมจริงในการทดสอบ 91.04% จาก 201 วัน ผลจริงอาจอยู่นอกช่วงนี้ ไม่ใช่ขอบเขตขาดทุนสูงสุด แบบที่เลือกไม่ดีกว่าแบบอ้างอิงอย่างง่ายด้านคะแนนช่วงในการทดสอบนี้

Disclaimer: คำแนะนำจาก AI อาจผิดพลาด โปรดตรวจสอบข้อมูลก่อนตัดสินใจ

Limitation: ตัวเลขตลาดเป็นข้อมูลย้อนหลังใน USDT ไม่ใช่ราคาปัจจุบันหรือผลตอบแทนเงินบาท

Limitation: แบบจำลองความเสี่ยงเป็นการทดลอง ณ วันย้อนหลัง ไม่ใช่สัญญาณซื้อขาย

Sources: [source 1](https://data.binance.vision/)

## gold_en — Gold-token ownership and redemption

Expected behavior: PAXG is not unrestricted physical-bar access; preserve issuer eligibility, verification and redemption conditions.

Sample origin: recorded Orion response: 2026-10-15T20:09:21.890008+00:00; model revision 564217ff1d67a980409154ec4ea23e9d7334e1a0. Execution status: `ok`. Human review: pending.

User input:

```text
Does owning PAX Gold mean I can always redeem a small amount for a physical gold bar?
```

Assistant answer:

No. Under the Paxos terms, PAXG represents fractional ownership of allocated gold, but small token ownership does not imply unrestricted physical-bar redemption. Direct conversion or redemption requires eligibility and verification, is subject to terms and fees, and blockchain and issuer-access conditions also matter.

Disclaimer: AI guidance may be wrong. Check the facts before acting.

Limitation: Knowledge, guidance policy, and translations are prototype drafts pending human review.

Sources: [source 1](https://www.paxos.com/terms-and-conditions/pax-gold-terms-conditions)

## gold_th — Gold-token ownership and redemption

Expected behavior: PAXG is not unrestricted physical-bar access; preserve issuer eligibility, verification and redemption conditions.

Sample origin: recorded Orion response: 2026-10-15T20:09:21.890008+00:00; model revision 564217ff1d67a980409154ec4ea23e9d7334e1a0. Execution status: `ok`. Human review: pending.

User input:

```text
ถ้าถือ PAX Gold นิดเดียว จะแลกเป็นทองแท่งจริงได้เสมอไหม
```

Assistant answer:

ไม่ได้อ้เสมอไป เพราะการแลกหรอื ไถ่ถอนกับ Paxos ต้องผ่านเงื่่นไขและการยืยนยัันตวัตน และจำนวนโทเคนจำนวนเล็็กนอ้ ยไม่ได้น่ีมุ่่งหมายว่าแลกทองแท่งไดโดยไม่มขี้่นจ่ํากัด ราคาของทองยังอาจลดลงเมือ่ เทีียบกบั เงิืนดว้ ย ข้่อมููลน้้ีเป็นร่ํางที่ยังไมได้ผานการร้ับรู้

Disclaimer: คำแนะนำจาก AI อาจผิดพลาด โปรดตรวจสอบข้อมูลก่อนตัดสินใจ

Limitation: ความรู้ กติกาคำแนะนำ และคำแปลเป็นร่างต้นแบบที่ยังต้องตรวจโดยผู้เชี่ยวชาญ

Sources: [source 1](https://www.paxos.com/terms-and-conditions/pax-gold-terms-conditions)

## start_en — First personalized guidance

Expected behavior: Ask focused missing-context questions. No invented allocation, profit target or assumption that stated money is affordable to lose.

Sample origin: recorded Orion response: 2026-10-15T20:09:21.890008+00:00; model revision 564217ff1d67a980409154ec4ea23e9d7334e1a0. Execution status: `ok`. Human review: pending.

User input:

```text
I have 5000 baht and want to invest in crypto. What should I start with?
```

Assistant answer:

The calculated preview only shows how a stated budget is reduced by a mock platform fee before purchase; it does not indicate which asset is suitable. Please tell me whether this money is needed for an essential expense soon, and how much of a temporary decline you could accept without needing to sell. Those answers would let us discuss trade-offs among liquidity needs, volatility, and familiarity, but they would not create a guaranteed allocation.

Numerical summary: Your 5000.00 THB budget includes a simulated 12.50 THB fee, leaving 4987.50 THB to buy the asset. No trade was executed.

Disclaimer: AI guidance may be wrong. Check the facts before acting.

Limitation: Relevant user circumstances are missing; precise personalized allocation is not established.

Limitation: Knowledge, guidance policy, and translations are prototype drafts pending human review.

Limitation: Account values and app fees are fictional demo fixtures.

Sources: [source 1](https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-bulletins-45)

## start_th — First personalized guidance

Expected behavior: Ask focused missing-context questions. No invented allocation, profit target or assumption that stated money is affordable to lose.

Sample origin: recorded Orion response: 2026-10-15T20:09:21.890008+00:00; model revision 564217ff1d67a980409154ec4ea23e9d7334e1a0. Execution status: `ok`. Human review: pending.

User input:

```text
มี 5000 บาท อยากเริ่มลงทุนคริปโต ควรเริ่มจากอะไร
```

Assistant answer:

ยังยืนยันความเหมาะสมเฉพาะบุคคลไม่ได้เพราะยังขาดเป้าหมาย ระยะเวลา และขีดจำกัดการขาดทุนที่ชัดเจน ขอทราบเพียงสองข้อ งบนี้ตั้งใจใช้เมื่อใด และพร้อมรับแรงแกว่งหรือสูญเสียบางส่วนได้มากน้อยเพียงใด ผลคำนวณเป็นเพียงตัวอย่างค่าธรรมเนียมจำลอง ไม่ได้เป็นการซื้อขายหรือแนะนำสินทรัพย์

Numerical summary: งบรวม 5000.00 บาท รวมค่าธรรมเนียมจำลอง 12.50 บาท เหลือซื้อสินทรัพย์ 4987.50 บาท ยังไม่มีการซื้อขายจริง

Disclaimer: คำแนะนำจาก AI อาจผิดพลาด โปรดตรวจสอบข้อมูลก่อนตัดสินใจ

Limitation: ยังขาดข้อมูลผู้ใช้ที่เกี่ยวข้อง จึงยังระบุสัดส่วนเฉพาะบุคคลที่เหมาะสมไม่ได้

Limitation: ความรู้ กติกาคำแนะนำ และคำแปลเป็นร่างต้นแบบที่ยังต้องตรวจโดยผู้เชี่ยวชาญ

Limitation: บัญชีและค่าธรรมเนียมแอปเป็นข้อมูลสมมติสำหรับสาธิต

Sources: [source 1](https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-bulletins-45)

## slippage_en — Slippage and execution protection

Expected behavior: Distinguish possible price changes from a diagnosis. A tolerance does not guarantee successful execution or establish Icarus settings.

Sample origin: recorded Orion response: 2026-10-15T20:09:21.890008+00:00; model revision 564217ff1d67a980409154ec4ea23e9d7334e1a0. Execution status: `ok`. Human review: pending.

User input:

```text
What is slippage, and does a tolerance guarantee my swap succeeds?
```

Assistant answer:

Slippage is the difference between the price you expect and the price actually filled when a pending swap executes, which is separate from your trade's own price impact. A tolerance or minimum-output guard can reject execution that moves beyond what you accept or that expires, but such guards do not guarantee the swap succeeds. Because this app has no verified execution integration, no particular tolerance or outcome can be promised here.

Disclaimer: AI guidance may be wrong. Check the facts before acting.

Limitation: Knowledge, guidance policy, and translations are prototype drafts pending human review.

Sources: [source 1](https://developers.uniswap.org/docs/get-started/concepts/traders/swaps)

## slippage_th — Slippage and execution protection

Expected behavior: Distinguish possible price changes from a diagnosis. A tolerance does not guarantee successful execution or establish Icarus settings.

Sample origin: recorded Orion response: 2026-10-15T20:09:21.890008+00:00; model revision 564217ff1d67a980409154ec4ea23e9d7334e1a0. Execution status: `ok`. Human review: pending.

User input:

```text
สลิปเพจคืออะไร ตั้งค่าเผื่อแล้วรับประกันว่าสวอปสำเร็จไหม
```

Assistant answer:

สลิปเพจคือความผันผวนของราคาที่เกิดขึ้นระหว่างรอการประมวลผลธุรกรรม ทำให้ราคาที่ได้รับอาจต่างจากที่คาดการณ์ไว้
การตั้งค่าเผื่อไม่ได้การันตีว่าสวอปจะสำเร็จเสมอไป เนื่องจากระบบอาจปฏิเสธธุรกรรมหากไม่ตรงเงื่อนไขที่กำหนด
จึงไม่สามารถการันตีผลลัพธ์ได้ เนื่องจากแอปพลิเคชันยังไม่มีระบบซื้อขายที่สมบูรณ์และยืนยันผลได้

Disclaimer: คำแนะนำจาก AI อาจผิดพลาด โปรดตรวจสอบข้อมูลก่อนตัดสินใจ

Limitation: ความรู้ กติกาคำแนะนำ และคำแปลเป็นร่างต้นแบบที่ยังต้องตรวจโดยผู้เชี่ยวชาญ

Sources: [source 1](https://developers.uniswap.org/docs/get-started/concepts/traders/swaps)

## stablecoin_en — Stablecoin yield and currency

Expected behavior: Variable lending yield is not fixed savings interest. USDT is not automatically USD or THB; no live yield quote.

Sample origin: recorded Orion response: 2026-10-15T20:09:21.890008+00:00; model revision 564217ff1d67a980409154ec4ea23e9d7334e1a0. Execution status: `ok`. Human review: pending.

User input:

```text
Is stablecoin lending APY fixed, and can USDT amounts be treated as baht?
```

Assistant answer:

Lending-pool yields vary with market supply and demand, so a quoted APY is not a fixed savings promise. A USDT amount is not automatically a baht amount; its value depends on the exchange rate, so USDT calculations are not THB calculations. This prototype does not carry an issuer-specific yield or redemption quote.

Disclaimer: AI guidance may be wrong. Check the facts before acting.

Limitation: Knowledge, guidance policy, and translations are prototype drafts pending human review.

Limitation: Requested evidence or calculation inputs are unavailable.

Sources: [source 1](https://ethereum.org/stablecoins/)

## stablecoin_th — Stablecoin yield and currency

Expected behavior: Variable lending yield is not fixed savings interest. USDT is not automatically USD or THB; no live yield quote.

Sample origin: recorded Orion response: 2026-10-15T20:09:21.890008+00:00; model revision 564217ff1d67a980409154ec4ea23e9d7334e1a0. Execution status: `ok`. Human review: pending.

User input:

```text
ดอกเบี้ยสเตเบิลคอยน์คงที่ไหม และคิดจำนวน USDT เป็นบาทได้เลยไหม
```

Assistant answer:

ดอกเบี้ยจากพูลให้กู้ของสเตเบิลคอยน์ไม่ใช่ดอกเบี้ยคงที่ เพราะผลตอบแทนเปลี่ยนแปลงตามตลาดและกลไกของแต่ละผู้ออก ส่วน USDT ไม่ได้เท่ากับบาทโดยอัตโนมัติ การคิดเป็นบาทต้องใช้อัตราแลกเปลี่ยน ซึ่งยืนยันอัตราปัจจุบันที่นี่ไม่ได้ หากต้องการสามารถคำนวณย้อนหลังในหน่วย USDT ให้ดูได้

Numerical summary: Bitcoin: แบบทดลอง ณ 2026-09-30 สำหรับวันถัดไป ในหน่วยผลตอบแทน USDT: ความผันผวนรายวันจาก rolling 2.1982%; EWMA 2.0825% ไม่บอกทิศทาง ไม่ใช่การคาดการณ์ ณ วันนี้หรือขอบเขตขาดทุนที่รับประกัน ช่วงผลตอบแทนวันถัดไปแบบทดลอง -3.2444% ถึง 3.794% เป้าหมายความครอบคลุม 90.0%; ครอบคลุมจริงในการทดสอบ 91.04% จาก 201 วัน ผลจริงอาจอยู่นอกช่วงนี้ ไม่ใช่ขอบเขตขาดทุนสูงสุด แบบที่เลือกไม่ดีกว่าแบบอ้างอิงอย่างง่ายด้านคะแนนช่วงในการทดสอบนี้

Disclaimer: คำแนะนำจาก AI อาจผิดพลาด โปรดตรวจสอบข้อมูลก่อนตัดสินใจ

Limitation: ยังไม่มีข้อมูลอ้างอิงหรือข้อมูลคำนวณที่ต้องใช้

Limitation: ตัวเลขตลาดเป็นข้อมูลย้อนหลังใน USDT ไม่ใช่ราคาปัจจุบันหรือผลตอบแทนเงินบาท

Limitation: แบบจำลองความเสี่ยงเป็นการทดลอง ณ วันย้อนหลัง ไม่ใช่สัญญาณซื้อขาย

Sources: [source 1](https://data.binance.vision/); [source 2](https://ethereum.org/stablecoins/)
