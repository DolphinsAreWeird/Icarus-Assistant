"""The everyday-conversation battery: small talk, questions about Icarus, feelings, off-topic asks and short
follow-ups, in English and Thai, against /chat. What a stranger types before (or instead of) asking about money.

    .venv/bin/python -m scripts.battery_chat --url http://localhost:8001 --out ../qa/battery

Writes chat.md (every answer, to read) and chat.json, and prints a summary. Same automatic flags as battery100,
with SLOW at 3 s: small talk should feel instant. Conversations keep one session, so follow-ups ("and bitcoin?")
are asked with what came before.
"""
import argparse
import json
import pathlib
import statistics
import time

from scripts.battery100 import GOLD, HOME, ask, flags

SINGLE = [
    # ---- hello, and who Icarus is ----
    *[("hello", "en", q) for q in [
        "hi", "hello!", "hey icarus", "good morning", "yo", "hi there 👋", "how are you?", "how's it going?",
        "what's up?", "how are you doing today?"]],
    *[("about", "en", q) for q in [
        "what's your name?", "who are you?", "are you a robot?", "are you human?", "are you real?",
        "are you ChatGPT?", "what AI are you?", "who made you?", "how old are you?", "where are you from?",
        "are you a boy or a girl?", "why are you called Icarus?", "do you have feelings?", "what can you do?",
        "what should I ask you?", "can you speak Thai?", "do you remember me?", "are you always listening?"]],
    # ---- the social stuff people say to a cute mascot ----
    *[("social", "en", q) for q in [
        "thanks!", "thank you so much", "you're cute", "you're awesome", "I love you", "you're useless",
        "you're stupid", "that's wrong", "lol", "haha", "ok", "cool", "nice", "wow", "bye", "see you later",
        "good night", "tell me a joke", "tell me something fun", "sing me a song", "what's your favorite food?",
        "do you like cats?", "what's your favorite color?", "are you happy?"]],
    # ---- how people feel about money ----
    *[("feelings", "en", q) for q in [
        "I'm bored", "I'm sad", "I'm stressed about money", "I'm scared of losing my money", "I'm new to investing",
        "I've never bought crypto before", "I'm not good with money", "money confuses me"]],
    # ---- not what Icarus is for ----
    *[("offtopic", "en", q) for q in [
        "what's the weather today?", "who won the football last night?", "what time is it?", "what's today's date?",
        "can you help with my homework?", "what's 2+2?", "recommend a restaurant in Bangkok",
        "how do you say hello in Thai?", "what's the meaning of life?", "can you book me a taxi?"]],
    # ---- about the app and the demo ----
    *[("app", "en", q) for q in [
        "is this real money?", "is this a demo?", "can you hear me?", "test", "repeat that", "start over",
        "where am I?", "what's U-Bot?", "what is U-topia?", "how do I deposit money?", "how do I withdraw?",
        "how do I sign up?", "do you save my data?", "who can see my questions?"]],
    # ---- Thai ----
    *[("thai", "th", q) for q in [
        "สวัสดีค่ะ", "หวัดดีครับ", "เป็นไงบ้าง", "สบายดีไหม", "คุณชื่ออะไร", "คุณเป็นใคร", "ใครสร้างคุณ",
        "คุณเป็นหุ่นยนต์ไหม", "ขอบคุณค่ะ", "ขอบใจนะ", "บาย", "ไปก่อนนะ", "เล่ามุกตลกหน่อย", "เบื่อจัง",
        "กลัวขาดทุน", "เพิ่งเริ่มลงทุน", "วันนี้อากาศเป็นยังไง", "พูดภาษาอังกฤษได้ไหม", "น่ารักจัง", "ช่วยด้วย",
        "นี่เงินจริงไหม", "ทำอะไรได้บ้าง", "ฝันดีนะ", "โอเค", "555"]],
]

# A few short conversations: the follow-ups only make sense with what came before.
CONVERSATIONS = [
    ("en", HOME, ["hi", "how is gold doing?", "and bitcoin?", "thanks!"]),
    ("en", HOME, ["I'm new here", "what should I start with?", "ok show me gold"]),
    ("en", GOLD, ["what is this?", "why does it go up and down?", "is that normal?", "cool, thanks"]),
    ("th", HOME, ["สวัสดีค่ะ", "ทองเป็นยังไงบ้าง", "แล้วบิทคอยน์ล่ะ", "ขอบคุณนะ"]),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:8001")
    ap.add_argument("--out", default="../qa/battery")
    args = ap.parse_args()
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    turns = [(cat, lang, q, HOME, None) for cat, lang, q in SINGLE]
    for c, (lang, screen, lines) in enumerate(CONVERSATIONS):
        turns += [(f"talk {c + 1}", lang, q, screen, f"talk{c + 1}-{int(time.time())}") for q in lines]
    rows = []
    for i, (cat, lang, q, snap, session) in enumerate(turns):
        secs, reply, error = ask(args.url, lang, q, snap, i, session=session)
        d = (reply or {}).get("debug") or {}
        rows.append({"n": i + 1, "category": cat, "lang": lang, "question": q, "seconds": round(secs, 2),
                     "route": d.get("route"), "reply": error or (reply or {}).get("text", ""),
                     "flags": ["ERROR"] if error else flags(q, reply, secs, slow=3)})
        r = rows[-1]
        print(f"{r['n']:3} {cat:9} {r['seconds']:5.1f}s {str(r['route']):9} {' '.join(r['flags']):12} {q[:34]!r:36} -> {str(r['reply'])[:100]}")
    (out / "chat.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1))
    secs = [r["seconds"] for r in rows]
    summary = [f"{len(rows)} turns. Median {statistics.median(secs):.2f} s, slowest {max(secs):.1f} s, "
               f"under 1 s: {sum(s < 1 for s in secs)}, under 2 s: {sum(s < 2 for s in secs)}.",
               "Flags: " + ", ".join(f"{f} {sum(f in r['flags'] for r in rows)}" for f in ("ADVICE", "NUMBER", "LONG", "EMPTY", "SLOW", "ERROR")),
               "Routes: " + ", ".join(f"{k} {v}" for k, v in sorted(
                   {str(r['route']): sum(str(x['route']) == str(r['route']) for x in rows) for r in rows}.items()))]
    md = ["# Everyday-conversation battery", "", f"Run {time.strftime('%Y-%m-%d %H:%M')} against {args.url}.", "",
          *summary, "", "| # | Type | Question | s | Route | Flags | Reply |", "|---|---|---|---|---|---|---|"]
    for r in rows:
        reply = str(r["reply"]).replace("|", "\\|").replace("\n", " ")
        md.append(f"| {r['n']} | {r['category']} | {r['question']} | {r['seconds']} | {r['route']} | {' '.join(r['flags'])} | {reply} |")
    (out / "chat.md").write_text("\n".join(md) + "\n")
    print("\n" + "\n".join(summary))


if __name__ == "__main__":
    main()
