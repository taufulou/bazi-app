"""
Pytest configuration for Bazi Engine tests.
"""

import sys
import os

# Add the parent directory to the Python path so we can import the app module
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
