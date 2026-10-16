"""Model-side conversation/profile state; optional local persistence, no server."""
from datetime import date,datetime,timezone
import json
from pathlib import Path
import re

from icarus_core import ROOT,guidance_context,load_profile
from profile_context import extract_explicit_updates,merge_profile,parse_set_command,validate_updates

QUESTIONS = {
    "goal":{"en":"What is this money for?","th":"เงินก้อนนี้มีเป้าหมายอะไร"},
    "horizon_months":{"en":"When will you need this money? You can say: My horizon is 5 years.","th":"ต้องใช้เงินนี้เมื่อไร เช่น ระยะเวลาลงทุน 5 ปี"},
    "essential_money":{"en":"Is this essential money? You can say: This money is essential, or This money is not essential.","th":"เงินนี้จำเป็นต่อค่าใช้จ่ายหรือไม่ เช่น เงินนี้เป็นเงินจำเป็น หรือ เงินนี้ไม่ใช่เงินจำเป็น"},
    "loss_capacity":{"en":"What is your financial loss capacity: low, moderate, or high?","th":"ความสามารถรับผลขาดทุนของคุณอยู่ระดับต่ำ ปานกลาง หรือสูง"},
    "risk_preference":{"en":"What is your willingness to take risk: low, moderate, or high?","th":"ความเต็มใจรับความเสี่ยงของคุณอยู่ระดับต่ำ ปานกลาง หรือสูง"},
}


class ConversationSession:
    def __init__(self,profile_id="new",language="en",today="2026-10-15"):
        load_profile(profile_id)
        if language not in ("en","th"):
            raise ValueError("UNKNOWN_LANGUAGE")
        date.fromisoformat(today)
        self.profile_id,self.language,self.today = profile_id,language,today
        self.updates,self.provenance,self.memory = {},{},[]
        self.turn = 0

    @property
    def profile(self):
        return merge_profile(load_profile(self.profile_id),self.updates)

    def update(self,updates,quotes):
        checked = validate_updates(updates)
        self.updates.update(checked)
        for field,value in checked.items():
            self.provenance[field] = {"value":value,"origin":"user_stated","source_quote":quotes.get(field,""),
                                      "turn":self.turn,"updated_at":datetime.now(timezone.utc).isoformat()}

    def local_reply(self,text,route,status="ok"):
        return {"text":text,"language":self.language,"status":status,"route":route,"model_calls":[],
                "sources":[],"tool_results":{},"numerical_summaries":[],"ui_actions":[],"disclaimer":"",
                "profile_context":self.profile,"profile_provenance":self.provenance,
                "guidance_context":guidance_context(self.profile),"elapsed_seconds":0.0}

    def profile_acknowledgement(self):
        context = guidance_context(self.profile)
        missing = context["missing_for_personalization"]
        text = "Saved your stated context. " if self.language=="en" else "บันทึกข้อมูลที่คุณระบุแล้ว "
        if missing:
            text += QUESTIONS[missing[0]][self.language]
        else:
            text += ("You can now ask about trade-offs or compare assets. These details alone do not establish a suitable allocation."
                     if self.language=="en" else "ตอนนี้ถามเรื่องข้อแลกเปลี่ยนหรือเปรียบเทียบสินทรัพย์ได้ ข้อมูลนี้เพียงอย่างเดียวยังไม่ได้ระบุสัดส่วนที่เหมาะสม")
        return self.local_reply(text,"profile_update")

    def ask(self,message,*,offline=False,model=None,screen_context=None,data_adapter=None):
        from assistant import answer
        self.turn += 1
        text = message.strip()
        try:
            if text.startswith("/lang"):
                if text not in ("/lang en","/lang th"):
                    raise ValueError("USE_LANG_EN_OR_TH")
                self.language = text.split()[1]
                return self.local_reply("Language changed." if self.language=="en" else "เปลี่ยนภาษาแล้ว","language_change")
            if text == "/profile":
                return self.local_reply("Current stated context is shown below." if self.language=="en" else "ข้อมูลปัจจุบันที่คุณระบุแสดงด้านล่าง","profile_view")
            if text == "/reset":
                self.updates,self.provenance,self.memory = {},{},[]
                return self.local_reply("Conversation and stated context reset to the selected fictional profile." if self.language=="en" else "ล้างบทสนทนาและข้อมูลที่ระบุ กลับไปใช้โปรไฟล์สมมติที่เลือก","session_reset")
            if text.startswith("/set"):
                updates = parse_set_command(text)
                self.update(updates,{field:message for field in updates})
                return self.profile_acknowledgement()
            extracted = extract_explicit_updates(message)
            if extracted["updates"]:
                self.update(extracted["updates"],extracted["source_quotes"])
                if not extracted["unrecognized"]:
                    return self.profile_acknowledgement()
            result = answer(message,language=self.language,profile_id=self.profile_id,today=self.today,
                            profile_updates=self.updates,profile_provenance=self.provenance,
                            memory=self.memory,offline=offline,model=model,screen_context=screen_context,data_adapter=data_adapter)
            self.memory.append({"user":message,"assistant":result["text"],"sources":result["sources"],
                                "tool_results":result["tool_results"]})
            self.memory = self.memory[-4:]
            return result
        except ValueError as exc:
            return self.local_reply("I couldn't save that input. Use /set field value with an explicit supported value."
                                    if self.language=="en" else "ยังบันทึกข้อมูลนี้ไม่ได้ ใช้ /set ตามด้วยชื่อฟิลด์และค่าที่รองรับ",
                                    "input_correction",status="invalid_input") | {"error_code":str(exc)}

    def save(self,session_id):
        target = session_path(session_id)
        target.parent.mkdir(parents=True,exist_ok=True)
        data = {"schema_version":1,"profile_id":self.profile_id,"language":self.language,"today":self.today,
                "updates":self.updates,"provenance":self.provenance,"memory":self.memory,"turn":self.turn}
        temp = target.with_suffix(".tmp")
        temp.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding="utf-8")
        temp.replace(target)

    @classmethod
    def load(cls,session_id):
        data = json.loads(session_path(session_id).read_text(encoding="utf-8"))
        if not isinstance(data,dict) or data.get("schema_version") != 1:
            raise ValueError("UNSUPPORTED_SESSION_VERSION")
        state = cls(data["profile_id"],data["language"],data["today"])
        state.updates = validate_updates(data["updates"])
        if type(data.get("turn")) is not int or data["turn"]<0:
            raise ValueError("INVALID_SESSION_TURN")
        state.turn = data["turn"]
        provenance = data.get("provenance")
        if not isinstance(provenance,dict) or set(provenance) != set(state.updates):
            raise ValueError("INVALID_PROFILE_PROVENANCE")
        for field,record in provenance.items():
            if (not isinstance(record,dict) or record.get("value") != state.updates[field]
                or record.get("origin") != "user_stated" or not isinstance(record.get("source_quote"),str)
                or type(record.get("turn")) is not int or not 0 <= record["turn"] <= state.turn):
                raise ValueError("INVALID_PROFILE_PROVENANCE")
        memory = data.get("memory")
        if not isinstance(memory,list) or len(memory)>4:
            raise ValueError("INVALID_SESSION_MEMORY")
        for turn in memory:
            if (not isinstance(turn,dict) or not isinstance(turn.get("user"),str)
                or not isinstance(turn.get("assistant"),str) or not isinstance(turn.get("sources"),list)
                or not isinstance(turn.get("tool_results"),dict)):
                raise ValueError("INVALID_SESSION_MEMORY")
            for source in turn["sources"]:
                if not isinstance(source,dict) or not isinstance(source.get("id"),str) or not isinstance(source.get("data"),dict):
                    raise ValueError("INVALID_SESSION_SOURCE")
        state.provenance,state.memory = provenance,memory
        return state


def session_path(session_id):
    if not isinstance(session_id,str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}",session_id):
        raise ValueError("INVALID_SESSION_ID")
    return ROOT / "results" / "sessions" / f"session_{session_id}.json"


def display_reply(result):
    print("\nIcarus > " + result["text"],flush=True)
    for summary in result.get("numerical_summaries",[]):
        if summary["text"] != result["text"]:
            print(summary["text"],flush=True)
    if result["route"] == "profile_view":
        print(json.dumps({"context":result["profile_context"],"provenance":result["profile_provenance"]},ensure_ascii=False,indent=2))
    if result.get("disclaimer"):
        print(result["disclaimer"])
    urls = list(dict.fromkeys(source["data"].get("source_url") for source in result.get("sources",[]) if source["data"].get("source_url")))
    for url in urls[:3]:
        print("Source: " + url)
    if result.get("status") not in (None,"ok"):
        print("Status: " + result["status"])
    print()
