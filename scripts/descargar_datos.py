"""Descarga los datos que no están en git (2025 y Modelo A) y, opcionalmente, los modelos entrenados.

Uso (desde cualquier carpeta, con cualquier Python 3.8+; no necesita librerías externas):
  python scripts/descargar_datos.py              datos para correr la app (~50 MB)
  python scripts/descargar_datos.py --modelos    además los modelos entrenados (~60 MB)
  python scripts/descargar_datos.py --forzar     vuelve a descargar aunque ya estén

Los archivos vienen del release DATOS_TAG del repositorio en GitHub. Cada zip se verifica con su huella SHA-256
antes de descomprimirse, así todo el equipo usa exactamente los mismos datos.

  firesight-datos-v1.zip     data/processed/*_2025*      observatorio 2025 (4 productos FIRMS, Standard Processing)
                             data/models/*_2025.parquet  predicción 2025 (año de prueba del Modelo B)
                             data/models/harmonization_* Modelo A: discrepancia diaria 2024-2025 y serie 2001-2025
  firesight-modelos-v1.zip   data/firesight/models/      fire_predictor.joblib (Modelo B), harmonizer.joblib y
                                                         harmonizer_lgbm.txt (Modelo A). Solo para exportar años
                                                         nuevos: usar Python 3.8 + firesight/requirements-py38.txt
                                                         (con scikit-learn nuevo el Modelo B da resultados equivocados)
"""
import argparse
import hashlib
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = 'OddALaCream/T-Pentagron'
DATOS_TAG = 'datos-2025-v1'
URL = 'https://github.com/{repo}/releases/download/{tag}/{name}'
BUNDLES = {
    'datos': ('firesight-datos-v1.zip', 'b4c695ea9ceb52fa7a3411871ab62f4c4c7cc736ad114362a0efcb534d37db6d',
              ('data/processed/', 'data/models/')),
    'modelos': ('firesight-modelos-v1.zip', '09bc634cddc0e71b89b42307843149ff8684f27d9d7ce617c95d58d75b45e783',
                ('data/firesight/models/',)),
}


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def bajar(url, dest):
    with urllib.request.urlopen(url, timeout=120) as r, open(dest, 'wb') as f:
        total = int(r.headers.get('Content-Length') or 0)
        hecho = 0
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
            hecho += len(chunk)
            if total:
                print(f'\r  {hecho / 1048576:5.1f} / {total / 1048576:.1f} MB', end='', flush=True)
    print()


def instalar(clave, forzar):
    name, esperado, carpetas = BUNDLES[clave]
    with tempfile.TemporaryDirectory() as tmp:
        zpath = Path(tmp) / name
        print(f'{name}: descargando del release {DATOS_TAG}')
        bajar(URL.format(repo=REPO, tag=DATOS_TAG, name=name), zpath)
        real = sha256(zpath)
        if real != esperado:
            raise SystemExit(f'{name}: la huella SHA-256 no coincide ({real}); no se descomprime nada')
        with zipfile.ZipFile(zpath) as z:
            miembros = z.namelist()
            # solo rutas relativas dentro de las carpetas esperadas (nada de ../ ni rutas absolutas)
            malas = [m for m in miembros if m.startswith('/') or '..' in Path(m).parts or not m.startswith(carpetas)]
            if malas:
                raise SystemExit(f'{name}: rutas inesperadas en el zip: {malas[:3]}')
            for m in miembros:
                destino = ROOT / m
                if destino.exists() and not forzar:
                    print(f'  ya existe, se conserva: {m}')
                    continue
                destino.parent.mkdir(parents=True, exist_ok=True)
                destino.write_bytes(z.read(m))
                print(f'  {m}')
    print(f'{name}: listo (SHA-256 verificado)')


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    p.add_argument('--modelos', action='store_true', help='también los modelos entrenados (~60 MB)')
    p.add_argument('--forzar', action='store_true', help='reemplaza los archivos que ya existan')
    a = p.parse_args(argv)
    instalar('datos', a.forzar)
    if a.modelos:
        instalar('modelos', a.forzar)
    print('Reiniciar el backend para que detecte los datos nuevos.')


if __name__ == '__main__':
    sys.exit(main())
