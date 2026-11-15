"""Shared cartographic boundary: exact point filtering, canonical rows preserved."""
import json
import threading
from pathlib import Path
import h3
from shapely.geometry import Polygon, shape
from shapely import intersects, intersects_xy, prepare

BOUNDARY_PATH = Path(__file__).resolve().parents[1] / 'FRONTEND/NasaAppChallenge2026-Frontend/public/geo/bolivia.json'
FEATURE = json.loads(BOUNDARY_PATH.read_text(encoding='utf-8'))
BOLIVIA = shape(FEATURE['geometry'])
prepare(BOLIVIA)

# FastAPI atiende peticiones en varios hilos. GEOS arma de forma diferida los índices internos de la geometría
# preparada y no es seguro hacerlo desde dos hilos a la vez: provocó un segfault (EXC_BAD_ACCESS en
# PreparedPolygon::intersects) cuando /meta, /predictions y /activity cargaron en paralelo los almacenes.
# Por eso los índices se arman aquí, al importar (un solo hilo), y todo predicado sobre BOLIVIA pasa por el candado.
_GEOS = threading.Lock()
intersects_xy(BOLIVIA, -64.5, -16.5)
intersects(BOLIVIA, Polygon([(-70, -17), (-69, -17), (-69, -16), (-70, -16)]))

def inside_bolivia(longitude, latitude):
    # Includes polygon boundary; supports holes and multipart geometries.
    with _GEOS:
        return intersects_xy(BOLIVIA, longitude, latitude)

def cells_touching_bolivia(cells):
    """Máscara de celdas H3 cuyo hexágono toca Bolivia. La zona piloto cruza a Brasil, donde los archivos
    FIRMS de Bolivia no tienen detecciones: esas celdas no se sirven."""
    hexagons = [Polygon([(lng, lat) for lat, lng in h3.cell_to_boundary(c)]) for c in cells]
    with _GEOS:
        return intersects(BOLIVIA, hexagons)
