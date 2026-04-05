import sys
from unittest.mock import MagicMock

# Mock dependencies with internet side effects
sys.modules['requests'] = MagicMock()
sys.modules['flask'] = MagicMock()

try:
    import app
    print("app module imported successfully!")
except Exception as e:
    print(f"Error importing app: {e}")
    sys.exit(1)
