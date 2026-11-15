"""Baseline estadístico de armonización (en módulo propio para que harmonizer.joblib sea portable)."""
import numpy as np


class SeasonalRatioBaseline:
    def fit(self, M, V, month, w):
        self.k, self.c = {}, {}
        gk = gc = None
        pos = M > 0
        gk = (w[pos] * V[pos]).sum() / max((w[pos] * M[pos]).sum(), 1e-9)
        gc = (w[~pos] * V[~pos]).sum() / max(w[~pos].sum(), 1e-9)
        for mo in range(1, 13):
            s = month == mo
            p, z = s & pos, s & ~pos
            self.k[mo] = (w[p] * V[p]).sum() / (w[p] * M[p]).sum() if (w[p] * M[p]).sum() > 20 else gk
            self.c[mo] = (w[z] * V[z]).sum() / w[z].sum() if w[z].sum() > 100 else gc
        return self

    def predict(self, M, month):
        k = np.vectorize(self.k.get)(month.astype(int))
        c = np.vectorize(self.c.get)(month.astype(int))
        return np.where(M > 0, k * M, c)
