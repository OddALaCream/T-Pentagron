"""Prueba anti-fuga: modificar datos posteriores a t no debe cambiar ninguna feature en t."""
import numpy as np

from firesight.common import days_since, nbr_sum, past_sum


def test_rolling_features_are_causal():
    rng = np.random.default_rng(0)
    a = rng.poisson(0.3, size=(5, 60)).astype(np.float32)
    nbr = np.array([[1, -1], [0, 2], [1, 3], [2, 4], [3, -1]])
    t = 40
    b = a.copy()
    b[:, t + 1:] = rng.poisson(5, size=(5, 60 - t - 1))  # alterar el futuro
    for fn in (lambda x: past_sum(x, 7), lambda x: past_sum(x, 30, True), lambda x: past_sum(x, 3, True),
               lambda x: days_since(x > 0), lambda x: past_sum(nbr_sum(x, nbr), 7, True)):
        assert np.allclose(fn(a)[:, :t + 1], fn(b)[:, :t + 1])


def test_past_sum_values():
    a = np.arange(10, dtype=np.float32)[None, :]
    assert past_sum(a, 3)[0, 5] == 2 + 3 + 4          # [t-3, t-1]
    assert past_sum(a, 3, True)[0, 5] == 3 + 4 + 5    # [t-2, t]


if __name__ == "__main__":
    test_rolling_features_are_causal(); test_past_sum_values(); print("OK: features causales")
