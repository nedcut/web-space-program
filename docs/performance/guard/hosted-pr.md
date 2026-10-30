# CPU and bundle regression guard

Same runner, 3 interleaved A/A pairs then 3 A/B pairs. Threshold: >15% on operations with A/A range/median <7.5%; noisy and sub-0.1µs operations informational. CPU/RTX proxies do not establish M-series Mac / 120 Hz performance. Not a required check.

| Operation | Base µs | Head µs | Change | A/A spread | Status |
|---|---:|---:|---:|---:|---|
| kernels/ground/earth/pad | 2.030 | 1.965 | -3.2% | 45.6% | informational |
| kernels/hullPoints/28parts | 0.585 | 0.602 | 2.9% | 10.0% | informational |
| kernels/massProperties/28parts | 9.252 | 8.814 | -4.7% | 7.4% | pass |
| render/map/update | 67.671 | 67.893 | 0.3% | 3.7% | pass |
| render/quadtree/place/512 | 33.662 | 35.790 | 6.3% | 13.0% | informational |
| render/quadtree/place/512/moving | 89.131 | 90.249 | 1.3% | 10.5% | informational |
| render/vessel/stock-kestrel | 3.344 | 3.338 | -0.2% | 44.6% | informational |
| render/vessel/stock-selene | 10.966 | 11.060 | 0.9% | 6.3% | pass |
| run/chunk/earth/24 | 731.364 | 744.847 | 1.8% | 7.4% | pass |
| run/chunk/moon/24 | 1892.987 | 1879.124 | -0.7% | 1.0% | pass |
| run/comms/rebuild/20vessels | 41.562 | 36.415 | -12.4% | 47.3% | informational |
| run/deltaV/stock-kestrel | 104.694 | 101.376 | -3.2% | 12.4% | informational |
| run/deltaV/stock-selene | 348.361 | 358.489 | 2.9% | 7.4% | pass |
| run/heightAt/earth | 0.991 | 0.989 | -0.2% | 34.6% | informational |
| run/heightAt/enceladus | 5.365 | 5.368 | 0.1% | 2.0% | pass |
| run/heightAt/europa | 2.591 | 2.614 | 0.9% | 3.1% | pass |
| run/heightAt/gasGiant | 0.047 | 0.048 | 2.1% | 2.1% | informational |
| run/heightAt/iceGiant | 0.050 | 0.049 | -2.0% | 6.1% | informational |
| run/heightAt/icy | 6.168 | 6.180 | 0.2% | 0.5% | pass |
| run/heightAt/io | 3.160 | 3.184 | 0.8% | 3.2% | pass |
| run/heightAt/irregular | 0.160 | 0.165 | 3.1% | 9.4% | informational |
| run/heightAt/lunar | 6.975 | 6.997 | 0.3% | 0.7% | pass |
| run/heightAt/mars | 8.196 | 8.108 | -1.1% | 1.5% | pass |
| run/heightAt/mercury | 6.367 | 6.395 | 0.4% | 0.8% | pass |
| run/heightAt/rocky | 4.879 | 4.861 | -0.4% | 0.2% | pass |
| run/heightAt/star | 0.045 | 0.046 | 2.2% | 2.2% | informational |
| run/heightAt/titan | 2.448 | 2.444 | -0.2% | 18.1% | informational |
| run/heightAt/venus | 3.856 | 3.848 | -0.2% | 0.7% | pass |
| run/isru/absent | 0.922 | 0.874 | -5.2% | 6.5% | pass |
| run/isru/active | 10.082 | 9.828 | -2.5% | 59.6% | informational |
| run/navball/stock-kestrel | 1.062 | 0.972 | -8.5% | 55.1% | informational |
| run/navball/stock-selene | 0.613 | 0.627 | 2.3% | 43.8% | informational |
| run/rails/1e6 | 1793.000 | 1798.121 | 0.3% | 3.2% | pass |
| run/science/context | 1.221 | 1.181 | -3.3% | 9.6% | informational |
| run/science/progression | 1.837 | 1.844 | 0.4% | 15.3% | informational |
| run/tick/stock-kestrel/10parts/atmosphere | 170.517 | 179.837 | 5.5% | 6.9% | pass |
| run/tick/stock-kestrel/10parts/landed | 539.915 | 548.572 | 1.6% | 17.3% | informational |
| run/tick/stock-kestrel/10parts/pad | 52.576 | 56.449 | 7.4% | 29.6% | informational |
| run/tick/stock-kestrel/10parts/vacuum | 103.038 | 117.120 | 13.7% | 13.6% | informational |
| run/tick/stock-selene/28parts/atmosphere | 184.771 | 183.968 | -0.4% | 4.8% | pass |
| run/tick/stock-selene/28parts/landed | 1147.523 | 1154.864 | 0.6% | 1.6% | pass |
| run/tick/stock-selene/28parts/pad | 54.230 | 48.917 | -9.8% | 12.9% | informational |
| run/tick/stock-selene/28parts/vacuum | 145.326 | 144.179 | -0.8% | 3.3% | pass |
| run/trajectory/map | 24.471 | 25.761 | 5.3% | 51.6% | informational |

| Gzip assets (sum per file) | Base bytes | Head bytes | Change |
|---|---:|---:|---:|
| js | 1095875 | 1095875 | 0 |
| css | 30894 | 30894 | 0 |
