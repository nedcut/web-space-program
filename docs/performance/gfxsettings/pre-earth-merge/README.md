These production timings were captured at graphics revision `f1ed9e6b` before integrating main's real Earth
geography (`8e91a05d`). RTX 3060 Ti, ANGLE/D3D11, DPR 2, 1470×920 CSS, adaptive off, 15 s warmup + 10 s
recording, shared machine/GPU. The pad High run was especially contended (20.39 ms final smoothed GPU timer,
16.1 fps); do not infer a monotonic cost ranking from the four non-interleaved samples. The graphics controls
and Ultra's terrain activation fix are included. Final merged-code timings are stored one directory above.
