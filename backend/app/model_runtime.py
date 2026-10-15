"""Import the model branch's standalone Python modules at one explicit boundary."""
from pathlib import Path
import sys

MODEL_DIR = Path(__file__).resolve().parents[2] / "model"
if str(MODEL_DIR) not in sys.path:
    sys.path.insert(0, str(MODEL_DIR))

from data_adapter import SnapshotAdapter  # noqa: E402
from session import ConversationSession  # noqa: E402

__all__ = ["SnapshotAdapter", "ConversationSession"]
