# Orion model probe

The full assistant prototype, profile/session commands, factual tools, and conversation demos are documented in [START_HERE.md](START_HERE.md). This file describes the original gateway capability probe.

Standalone model integration, not a backend. Python 3.12 is available in this workspace; no additional packages are required.

Gateway base URL is confirmed from user-supplied Orion documentation: `https://api.orion.cmkl.ai/v1`. The pasted completion example selects `Mango 1.5-9B`; it does not confirm the exact API identifier for Qwen. List gateway models or copy the Qwen-selected example before setting the model.

Set the key securely for the current PowerShell process, without putting it in shell history:

Alternatively, edit `model/.env` and fill in `ICARUS_LLM_API_KEY` and the exact `ICARUS_LLM_MODEL`. The probe automatically reads the `.env` beside the script, regardless of your working directory. Existing process environment variables take precedence. This supports plain or quoted `KEY=value` lines and full-line comments; it does not interpolate variables. The file is excluded by `model/.gitignore`. Never share its contents.

With the `.env` key filled in, run `python D:\Uhackathon\model\orion_probe.py --probe models` to find the model ID, then fill that in and run `python D:\Uhackathon\model\orion_probe.py --probe all --lang both`.

```powershell
$orionSecret = Read-Host 'Orion API key' -AsSecureString
$env:ICARUS_LLM_API_KEY = [System.Net.NetworkCredential]::new('', $orionSecret).Password
Remove-Variable orionSecret
python D:\Uhackathon\model\orion_probe.py --probe models
```

If `/models` is unsupported, use the exact model string from the portal's Qwen-selected curl example. Set it locally:

```powershell
$env:ICARUS_LLM_MODEL = Read-Host 'Exact model ID'
python D:\Uhackathon\model\orion_probe.py --probe basic
python D:\Uhackathon\model\orion_probe.py --probe thai
python D:\Uhackathon\model\orion_probe.py --probe numbers
python D:\Uhackathon\model\orion_probe.py --probe tools
python D:\Uhackathon\model\orion_probe.py --probe json
```

All assistant probes now default to matched English and Thai cases. Machine-readable tool names and IDs remain unchanged across languages. Select one language or run the full bilingual suite:

```powershell
python D:\Uhackathon\model\orion_probe.py --probe basic --lang en
python D:\Uhackathon\model\orion_probe.py --probe basic --lang th
python D:\Uhackathon\model\orion_probe.py --probe all --lang both
```

Basic/numbers/JSON each make one completion request per language; tools normally makes two per language. The full bilingual suite normally makes ten completion requests. Requests consume quota. Failed cases are labeled and the suite continues, then exits with failure if any case failed. No automatic retries. The older `--probe thai` remains an alias for the Thai basic case. JSON mode and tool calling are independent optional capabilities; rejection of either does not mean basic chat is broken. Tools are local synthetic fixtures and cannot execute transactions.

Both language answers need human review for financial accuracy and natural wording. Matching prompts do not prove language quality or numerical fidelity automatically.

Authenticated Orion testing confirmed model ID `Qwen 3.8-27B-NVFP4`, bilingual tool calling, and JSON-object mode. Initial 512-token requests exhausted the Thai numerical response budget and truncated a Thai tool answer. The probe now allows 1,536 completion tokens (including any reasoning), requests concise prose, and treats token-limit stops and empty answers as failures. Latency and financial quality remain case-dependent.

The timings are complete HTTP-response durations, not first-token latency. This does not benchmark production concurrency, streaming, or voice. Read the answers to assess factual and numerical correctness. A completed tool cycle establishes protocol behavior, not financial suitability.

No live probes were run during setup because no key was provided to the process. Syntax and CLI checks do not establish provider compatibility. A future production adapter may need to preserve additional provider-specific assistant fields for tool cycles; test the actual model.

Remove the key from the process when done:

```powershell
Remove-Item Env:ICARUS_LLM_API_KEY
```
