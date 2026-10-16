"""Import the model branch's standalone Python modules at one explicit boundary."""
from pathlib import Path
import sys
import os
from app.config import load_env_file

MODEL_DIR = Path(__file__).resolve().parents[2] / "model"
if os.getenv("ICARUS_MODEL_ENV_FILE"):
    load_env_file(Path(os.environ["ICARUS_MODEL_ENV_FILE"]))
if str(MODEL_DIR) not in sys.path:
    sys.path.insert(0, str(MODEL_DIR))

from data_adapter import SnapshotAdapter  # noqa: E402
from session import ConversationSession  # noqa: E402

__all__ = ["SnapshotAdapter", "ConversationSession"]
