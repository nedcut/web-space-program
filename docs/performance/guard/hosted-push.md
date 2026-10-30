# CPU and bundle regression guard

Same runner, 3 interleaved A/A pairs then 3 A/B pairs. Threshold: >15% on operations with A/A range/median <7.5%; noisy and sub-0.1µs operations informational. CPU/RTX proxies do not establish M-series Mac / 120 Hz performance. Not a required check.

| Operation | Base µs | Head µs | Change | A/A spread | Status |
|---|---:|---:|---:|---:|---|
| kernels/ground/earth/pad | 1.528 | 1.596 | 4.4% | 31.8% | informational |
| kernels/hullPoints/28parts | 0.475 | 0.467 | -1.6% | 4.0% | pass |
| kernels/massProperties/28parts | 6.708 | 6.834 | 1.9% | 6.2% | pass |
| render/map/update | 40.153 | 40.593 | 1.1% | 9.4% | informational |
| render/quadtree/place/512 | 24.018 | 23.684 | -1.4% | 16.0% | informational |
| render/quadtree/place/512/moving | 68.553 | 70.833 | 3.3% | 21.7% | informational |
| render/vessel/stock-kestrel | 2.868 | 2.929 | 2.1% | 28.1% | informational |
| render/vessel/stock-selene | 8.373 | 8.415 | 0.5% | 6.7% | pass |
| run/chunk/earth/24 | 563.524 | 555.241 | -1.5% | 8.5% | informational |
| run/chunk/moon/24 | 1443.057 | 1459.477 | 1.1% | 5.0% | pass |
| run/comms/rebuild/20vessels | 29.727 | 35.855 | 20.6% | 24.9% | informational |
| run/deltaV/stock-kestrel | 72.245 | 74.481 | 3.1% | 24.0% | informational |
| run/deltaV/stock-selene | 259.795 | 260.227 | 0.2% | 12.4% | informational |
| run/heightAt/earth | 0.764 | 0.766 | 0.3% | 17.5% | informational |
| run/heightAt/enceladus | 4.672 | 4.714 | 0.9% | 0.9% | pass |
| run/heightAt/europa | 2.309 | 2.213 | -4.2% | 4.1% | pass |
| run/heightAt/gasGiant | 0.035 | 0.035 | 0.0% | 2.9% | informational |
| run/heightAt/iceGiant | 0.037 | 0.035 | -5.4% | 38.9% | informational |
| run/heightAt/icy | 5.388 | 5.396 | 0.1% | 1.2% | pass |
| run/heightAt/io | 2.600 | 2.575 | -1.0% | 29.3% | informational |
| run/heightAt/irregular | 0.117 | 0.120 | 2.6% | 5.8% | pass |
| run/heightAt/lunar | 6.091 | 6.105 | 0.2% | 1.6% | pass |
| run/heightAt/mars | 7.142 | 7.152 | 0.1% | 1.1% | pass |
| run/heightAt/mercury | 5.609 | 5.597 | -0.2% | 1.4% | pass |
| run/heightAt/rocky | 4.253 | 4.264 | 0.3% | 0.7% | pass |
| run/heightAt/star | 0.034 | 0.034 | 0.0% | 3.0% | informational |
| run/heightAt/titan | 1.998 | 1.990 | -0.4% | 1.4% | pass |
| run/heightAt/venus | 3.268 | 3.279 | 0.3% | 6.7% | pass |
| run/isru/absent | 0.698 | 0.727 | 4.2% | 9.7% | informational |
| run/isru/active | 7.499 | 8.217 | 9.6% | 21.6% | informational |
| run/navball/stock-kestrel | 0.750 | 0.740 | -1.3% | 23.3% | informational |
| run/navball/stock-selene | 0.480 | 0.481 | 0.2% | 7.4% | pass |
| run/rails/1e6 | 1392.594 | 1403.491 | 0.8% | 4.7% | pass |
| run/science/context | 0.925 | 0.893 | -3.5% | 12.0% | informational |
| run/science/progression | 1.515 | 1.672 | 10.4% | 12.2% | informational |
| run/tick/stock-kestrel/10parts/atmosphere | 125.785 | 132.356 | 5.2% | 12.7% | informational |
| run/tick/stock-kestrel/10parts/landed | 418.781 | 417.772 | -0.2% | 8.5% | informational |
| run/tick/stock-kestrel/10parts/pad | 38.723 | 40.187 | 3.8% | 21.8% | informational |
| run/tick/stock-kestrel/10parts/vacuum | 77.853 | 72.190 | -7.3% | 16.3% | informational |
| run/tick/stock-selene/28parts/atmosphere | 132.253 | 134.216 | 1.5% | 12.7% | informational |
| run/tick/stock-selene/28parts/landed | 888.194 | 891.092 | 0.3% | 2.1% | pass |
| run/tick/stock-selene/28parts/pad | 32.234 | 33.377 | 3.5% | 32.8% | informational |
| run/tick/stock-selene/28parts/vacuum | 102.843 | 105.382 | 2.5% | 5.3% | pass |
| run/trajectory/map | 18.356 | 18.644 | 1.6% | 24.3% | informational |

| Gzip assets (sum per file) | Base bytes | Head bytes | Change |
|---|---:|---:|---:|
| js | 1095875 | 1095875 | 0 |
| css | 30894 | 30894 | 0 |
