"""Shared cartographic boundary: exact point filtering, canonical rows preserved."""
import json
from pathlib import Path
from shapely.geometry import shape
from shapely import intersects_xy, prepare

BOUNDARY_PATH = Path(__file__).resolve().parents[1] / 'FRONTEND/NasaAppChallenge2026-Frontend/public/geo/bolivia.json'
FEATURE = json.loads(BOUNDARY_PATH.read_text(encoding='utf-8'))
BOLIVIA = shape(FEATURE['geometry'])
prepare(BOLIVIA)

def inside_bolivia(longitude, latitude):
    # Includes polygon boundary; supports holes and multipart geometries.
    return intersects_xy(BOLIVIA, longitude, latitude)
