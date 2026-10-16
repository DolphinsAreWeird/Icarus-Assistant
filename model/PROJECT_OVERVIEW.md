# Icarus model prototype

English/Thai crypto-app assistant, evidence retrieval, deterministic financial tools, experimental risk baselines, and a validated app-data adapter. This repository candidate contains the model/data-processing work, not a website or trading backend.

Start with [model/START_HERE.md](START_HERE.md). Integration contracts are in [model/INTEGRATION.md](INTEGRATION.md).

Python's standard library is sufficient. The live assistant uses a private Orion API key in ignored `model/.env`; do not overwrite an existing configured file. `model/.env.example` is the public template.

```powershell
python -m unittest discover -s model/tests -v
python model/assistant.py --interactive --lang en --session demo
```

Offline calculations use synthetic app/account fixtures or downloaded real historical USDT data, each explicitly labeled. The financial-guidance policy and Thai wording are drafts for Luka and First to review. No execution/custody integration or production authentication is present.
