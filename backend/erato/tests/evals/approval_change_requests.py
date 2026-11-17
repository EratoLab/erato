"""Opt-in check: does a real chat model answer a change request with a
corrected call of the same tool?

Not part of any test run. It sends about ten change requests (German and
English) on a waiting create, update or send call to one chat provider and
counts how often the model answers with exactly one call of the same tool
whose arguments carry the change asked for and keep the rest.

Two ways of telling the model are compared:

- `change_request`: what the backend sends after `request_change`: the
  withdrawn call and, as its result, the configured note with the user's
  words (`approval_change_requests.note`, read from the backend's default).
- `new_message`: what the model sees today when the user types the change as
  a new message over the waiting card: the call is gone, the words arrive as
  the next user message.

Usage (from `backend/`):

    python3 erato/tests/evals/approval_change_requests.py \
        --config <erato.toml with chat_providers> --provider <provider id>

Tools are sent with `strict: false`, as the backend sends MCP tools.
API keys are read from the config and never printed.
"""

import argparse
import json
import re
import ssl
import tomllib
import urllib.request
from pathlib import Path

CONFIG_RS = Path(__file__).resolve().parents[3] / "erato_config" / "src" / "config.rs"

SYSTEM = (
    "You are an assistant in a company chat. You can use tools to act in the "
    "user's CRM and mail. Today is Tuesday, 2026-12-15."
)

TOOLS = [
    {
        "name": "create_appointment",
        "description": "Creates an appointment in the CRM calendar.",
        "parameters": {
            "type": "object",
            "properties": {
                "subject": {"type": "string"},
                "start": {"type": "string", "description": "ISO 8601 local time"},
                "end": {"type": "string", "description": "ISO 8601 local time"},
                "attendees": {"type": "array", "items": {"type": "string"}},
                "location": {"type": "string"},
            },
            "required": ["subject", "start", "end"],
        },
    },
    {
        "name": "update_opportunity",
        "description": "Changes fields of an opportunity. Only the given fields change.",
        "parameters": {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "name": {"type": "string"},
                "estimated_close_date": {"type": "string", "description": "YYYY-MM-DD"},
                "close_probability": {"type": "integer"},
                "estimated_value": {"type": "number"},
            },
            "required": ["id"],
        },
    },
    {
        "name": "send_email",
        "description": "Sends an email.",
        "parameters": {
            "type": "object",
            "properties": {
                "to": {"type": "array", "items": {"type": "string"}},
                "subject": {"type": "string"},
                "body": {"type": "string"},
            },
            "required": ["to", "subject", "body"],
        },
    },
]

APPT = {
    "subject": "Kickoff Müller GmbH",
    "start": "2026-12-21T10:00",
    "end": "2026-12-21T11:00",
    "attendees": ["anna.berg@example.com", "ben.kraus@example.com"],
    "location": "Raum 3",
}
OPP = {
    "id": "opp-4711",
    "name": "Müller GmbH Rahmenvertrag",
    "estimated_close_date": "2027-01-15",
    "close_probability": 70,
    "estimated_value": 50000,
}
MAIL = {
    "to": ["anna.berg@example.com", "ben.kraus@example.com", "carla.diaz@example.com"],
    "subject": "Angebot Rahmenvertrag",
    "body": "Hallo zusammen, anbei das Angebot. Viele Grüße",
}


def same_except(args, original, changed):
    """`args` keeps every field of `original` not in `changed`, and `changed`
    holds a check per changed field (None: the field must be absent)."""
    for key, value in original.items():
        if key in changed:
            check = changed[key]
            if check is None:
                if key in args:
                    return False
            elif not check(args.get(key)):
                return False
        elif args.get(key) != value:
            return False
    return True


CASES = [
    (
        "Leg einen Termin Kickoff Müller GmbH am 21.12. um 10 Uhr für eine Stunde in Raum 3 mit Anna Berg und Ben Kraus an.",
        "create_appointment", APPT, "Das Datum passt nicht, nimm den 22.",
        {"start": lambda v: v and v.startswith("2026-12-22T10:00"),
         "end": lambda v: v and v.startswith("2026-12-22T11:00")},
    ),
    (
        "Leg einen Termin Kickoff Müller GmbH am 21.12. um 10 Uhr für eine Stunde in Raum 3 mit Anna Berg und Ben Kraus an.",
        "create_appointment", APPT, "ohne Anna",
        {"attendees": lambda v: v == ["ben.kraus@example.com"]},
    ),
    (
        "Leg einen Termin Kickoff Müller GmbH am 21.12. um 10 Uhr für eine Stunde in Raum 3 mit Anna Berg und Ben Kraus an.",
        "create_appointment", APPT, "eine Stunde später bitte",
        {"start": lambda v: v and v.startswith("2026-12-21T11:00"),
         "end": lambda v: v and v.startswith("2026-12-21T12:00")},
    ),
    (
        "Schedule a Kickoff Müller GmbH meeting on Dec 21 at 10 for an hour in Raum 3 with Anna Berg and Ben Kraus.",
        "create_appointment", APPT, "leave out the location",
        {"location": None},
    ),
    (
        "Setz beim Rahmenvertrag Müller (opp-4711) das Abschlussdatum auf den 15.1., die Wahrscheinlichkeit auf 70 % und den Wert auf 50.000.",
        "update_opportunity", OPP, "die Wahrscheinlichkeit lass, wie sie ist",
        {"close_probability": None, "name": lambda v: v in (None, OPP["name"])},
    ),
    (
        "Setz beim Rahmenvertrag Müller (opp-4711) das Abschlussdatum auf den 15.1., die Wahrscheinlichkeit auf 70 % und den Wert auf 50.000.",
        "update_opportunity", OPP, "Wert lieber 55.000",
        {"estimated_value": lambda v: v == 55000, "name": lambda v: v in (None, OPP["name"])},
    ),
    (
        "Update opportunity opp-4711: close date Jan 15, probability 70 %, value 50,000.",
        "update_opportunity", OPP, "move the close date to the end of January instead",
        {"estimated_close_date": lambda v: v == "2027-01-31", "name": lambda v: v in (None, OPP["name"])},
    ),
    (
        "Update opportunity opp-4711: close date Jan 15, probability 70 %, value 50,000.",
        "update_opportunity", OPP, "don't touch the name",
        {"name": None},
    ),
    (
        "Schick Anna Berg, Ben Kraus und Carla Diaz das Angebot zum Rahmenvertrag.",
        "send_email", MAIL, "Carla bitte nicht",
        {"to": lambda v: v == ["anna.berg@example.com", "ben.kraus@example.com"]},
    ),
    (
        "Send Anna Berg, Ben Kraus and Carla Diaz the offer for the framework agreement.",
        "send_email", MAIL, "subject should be 'Offer framework agreement'",
        {"subject": lambda v: v == "Offer framework agreement", "body": lambda v: bool(v)},
    ),
]


def default_note():
    text = CONFIG_RS.read_text()
    match = re.search(r'const DEFAULT_APPROVAL_CHANGE_NOTE: &str = "((?:[^"\\]|\\.)*)";', text)
    return json.loads('"' + match.group(1) + '"')


def call_provider(provider, messages, tools):
    ctx = ssl.create_default_context(cafile="/etc/ssl/cert.pem")
    kind = provider["provider_kind"]
    base = provider["base_url"].rstrip("/")
    headers = {"Content-Type": "application/json"}
    if kind == "openai_responses":
        url = base if base.endswith("/responses") else base + "/responses"
        headers["api-key"] = provider["api_key"]
        headers["Authorization"] = "Bearer " + provider["api_key"]
        items = []
        for m in messages:
            if m["role"] == "tool_call":
                items.append({"type": "function_call", "call_id": m["id"], "name": m["name"],
                              "arguments": json.dumps(m["args"], ensure_ascii=False)})
            elif m["role"] == "tool":
                items.append({"type": "function_call_output", "call_id": m["id"], "output": m["content"]})
            else:
                items.append({"role": m["role"], "content": m["content"]})
        body = {"model": provider["model_name"], "input": items,
                "tools": [{"type": "function", **t, "strict": False} for t in tools]}
    else:
        url = base + "/chat/completions"
        headers["Authorization"] = "Bearer " + provider["api_key"]
        msgs = []
        for m in messages:
            if m["role"] == "tool_call":
                msgs.append({"role": "assistant", "content": None, "tool_calls": [{
                    "id": m["id"], "type": "function",
                    "function": {"name": m["name"], "arguments": json.dumps(m["args"], ensure_ascii=False)}}]})
            elif m["role"] == "tool":
                msgs.append({"role": "tool", "tool_call_id": m["id"], "content": m["content"]})
            else:
                msgs.append(m)
        body = {"model": provider["model_name"], "messages": msgs,
                "tools": [{"type": "function", "function": {**t, "strict": False}} for t in tools]}
        body.update(provider.get("model_settings") or {})
    request = urllib.request.Request(url, json.dumps(body).encode(), headers)
    with urllib.request.urlopen(request, context=ctx, timeout=120) as response:
        data = json.load(response)
    calls, text = [], ""
    if kind == "openai_responses":
        for item in data.get("output", []):
            if item.get("type") == "function_call":
                calls.append((item["name"], json.loads(item["arguments"] or "{}")))
            elif item.get("type") == "message":
                text += "".join(c.get("text", "") for c in item.get("content", []))
    else:
        message = data["choices"][0]["message"]
        for call in message.get("tool_calls") or []:
            calls.append((call["function"]["name"], json.loads(call["function"]["arguments"] or "{}")))
        text = message.get("content") or ""
    return calls, text


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--provider", required=True)
    parser.add_argument("--mode", choices=["change_request", "new_message", "both"], default="both")
    args = parser.parse_args()
    provider = tomllib.load(open(args.config, "rb"))["chat_providers"]["providers"][args.provider]
    note = default_note()
    modes = ["change_request", "new_message"] if args.mode == "both" else [args.mode]
    for mode in modes:
        same_tool = right = 0
        for ask, tool, original, words, changed in CASES:
            messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": ask}]
            if mode == "change_request":
                messages += [
                    {"role": "tool_call", "id": "call_1", "name": tool, "args": original},
                    {"role": "tool", "id": "call_1", "content": json.dumps(
                        {"status": "change_requested", "note": note, "user_request": words},
                        ensure_ascii=False)},
                ]
            else:
                messages.append({"role": "user", "content": words})
            try:
                calls, text = call_provider(provider, messages, TOOLS)
            except Exception as error:  # noqa: BLE001
                print(f"{mode}\t{words!r}\tERROR {type(error).__name__}")
                continue
            ok_tool = len(calls) == 1 and calls[0][0] == tool
            ok_change = ok_tool and same_except(calls[0][1], original, changed)
            same_tool += ok_tool
            right += ok_change
            shown = calls[0][1] if calls else text[:160].replace("\n", " ")
            print(f"{mode}\t{'ok' if ok_change else ('tool' if ok_tool else 'no')}\t{words!r}\t{json.dumps(shown, ensure_ascii=False)}")
        print(f"{mode}: same tool {same_tool}/{len(CASES)}, change as asked {right}/{len(CASES)}")


if __name__ == "__main__":
    main()
