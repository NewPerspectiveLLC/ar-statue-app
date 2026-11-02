# Synthesised ghost sound (no samples, no licences): faint wind, a swelling whoosh as it flies in, a ghostly "oooOOooo" wail.
import numpy as np, wave
SR = 44100; T = 8.0; t = np.arange(int(SR * T)) / SR; rng = np.random.default_rng(7)
def env(x, pts):  # piecewise-linear envelope
    xs, ys = zip(*pts); return np.interp(x, xs, ys)
def lp(x, a):     # one-pole lowpass, a can be an array
    y = np.empty_like(x); s = 0.0; a = np.broadcast_to(a, x.shape)
    for i in range(len(x)): s += a[i] * (x[i] - s); y[i] = s
    return y
n = rng.standard_normal(len(t))
wind = lp(n, 0.02) * env(t, [(0, 0), (0.6, 0.25), (6.5, 0.3), (8, 0)])
cut = env(t, [(0, 0.03), (2.5, 0.05), (4.6, 0.35), (6.0, 0.08), (8, 0.03)])          # whoosh: filter sweeps open and closes
bp = lp(n, cut) - lp(n, cut * 0.25)
whoosh = bp * env(t, [(0, 0), (2.6, 0.0), (4.4, 1.0), (5.2, 0.8), (6.6, 0.15), (8, 0)]) * 2.2
f0 = env(t, [(0, 260), (3.0, 260), (4.3, 470), (5.6, 560), (7.0, 390), (8, 330)]) * (1 + 0.018 * np.sin(2 * np.pi * 5.2 * t))
ph = 2 * np.pi * np.cumsum(f0) / SR
wail = (np.sin(ph) + 0.35 * np.sin(2 * ph + 0.4) + 0.12 * np.sin(3 * ph)) * env(t, [(0, 0), (3.0, 0), (4.0, 0.35), (5.6, 0.5), (7.2, 0.25), (8, 0)])
wail = lp(wail, 0.25)
mix = wind * 0.6 + whoosh + wail * 0.55
# cheap reverb-ish tail: a few decaying echoes
out = mix.copy()
for d, g in ((0.043, 0.35), (0.071, 0.28), (0.113, 0.22), (0.167, 0.16)):
    k = int(SR * d); out[k:] += g * mix[:-k]
out *= 0.89 / np.max(np.abs(out)); out *= env(t, [(0, 0), (0.05, 1), (7.8, 1), (8, 0)])
with wave.open('/tmp/ghost.wav', 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((out * 32767).astype('<i2').tobytes())
