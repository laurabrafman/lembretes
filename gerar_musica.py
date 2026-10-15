"""Gera a musiquinha.wav (um jingle curtinho) usando só a biblioteca padrão."""
import math, struct, wave, os

TAXA = 44100
# (frequência em Hz, duração em segundos) — 0 = pausa
NOTAS = [
    (523.25, 0.12), (659.25, 0.12), (783.99, 0.12), (1046.50, 0.25),
    (0, 0.08),
    (783.99, 0.12), (1046.50, 0.40),
]

def tom(freq, dur):
    n = int(TAXA * dur)
    for i in range(n):
        if freq == 0:
            yield 0.0
            continue
        t = i / TAXA
        env = min(1.0, i / 400) * math.exp(-3.5 * t / dur)  # ataque rápido + decaimento suave
        som = math.sin(2 * math.pi * freq * t) + 0.3 * math.sin(4 * math.pi * freq * t)
        yield 0.45 * env * som

saida = os.path.join(os.path.dirname(os.path.abspath(__file__)), "musicas", "musiquinha.wav")
os.makedirs(os.path.dirname(saida), exist_ok=True)
with wave.open(saida, "w") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(TAXA)
    frames = b"".join(struct.pack("<h", int(max(-1, min(1, s)) * 32767))
                      for f, d in NOTAS for s in tom(f, d))
    w.writeframes(frames)
print("Gerado:", saida)
