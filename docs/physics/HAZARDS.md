# Environmental hazards

The deterministic, DOM-free models live in `src/sim/hazards`. The same exposure integrator runs in physics, EVA, landed/prelaunch and orbital rails modes. All exposure state is optional on old version-1 saves and starts at zero (equipment temperature starts at 288 K). Part-owned state follows normal staging/docking; crew dose belongs to the roster and therefore follows EVA/boarding. Full saves and multiplayer deltas carry these fields.

## Pressure and thermal reserve

Catalog parts receive `maxPressure` in pascals: tanks 4 MPa, crew command parts 3 MPa, uncrewed command parts 1 MPa, other parts 2 MPa, unless overridden. Overpressure damage integrates `(pressure / rating - 1) / 30` per second, reaching failure at one. Returning below the rating clears the exposure. Thus Venus crushes an ordinary probe in about four seconds; pressure resistance alone still leaves its electronics vulnerable to ambient heat soak.

Existing skin/interior temperatures and `maxTemp` retain their aerodynamic/reentry behavior. A separate equipment node approaches ambient temperature exponentially. Its limit is the lower of `maxTemp` and `maxOperatingTemp` (defaults: electronics 400 K, crew command 430 K; other parts use `maxTemp`). This distinguishes a reentry-resistant skin from the electronics inside it. The default real-scale time constant is 120 seconds at 9.2 MPa, varying inversely with the square root of pressure. The time constant scales by sqrt(universe length scale), matching orbital/rotation time scaling. Equipment temperatures currently retain their last value in vacuum; the existing bulk/skin thermal model still radiates normally during physics.

Kiln probe and shell: 15 MPa pressure rating, 1600 K skin limit, 400 K equipment limit, 22000-second real-scale equipment time constant. From 288 K at Venus datum, the equipment limit is reached after approximately 6312 seconds (105 minutes) at Real or 1996 seconds (33 minutes) at Standard. Each exposed part needs its own pressure rating; the shell does not magically protect externally attached hardware. The core has 1200 EC for the surface window. Use the core and shell without ordinary low-pressure attachments for a surface survivor.

Gas-giant pressure below the datum follows a hydrostatic dry adiabat using the catalog gas composition, gamma and surface gravity. This replaces World's radius-fraction destruction cutoff. Pressure is capped at 1 TPa for numerical bounds; it is not an interior equation of state. The stellar photosphere is an absorbing high-temperature/high-pressure boundary.

Venus conditions and the limited historical lander lifetime are grounded in [NASA Venus facts](https://science.nasa.gov/venus/venus-facts/). The insulation, damage curves and hardware ratings are original game parameters, not engineering reconstructions of Venera.

## Radiation

Body-fixed dipole-like L-shell Gaussian belts use radius-normalized coordinates. They taper near the atmosphere, away from the equator and outside 30 radii. The environment sums Earth, Jupiter and Saturn contributions even when the vessel is in a moon's SOI. Representative real-scale peak rates:

| Body | Belt location | Rate |
| --- | --- | --- |
| Jupiter | 2.5 radii, with broader secondary belt at 7 radii | 0.05 Gy/s, 0.005 Gy/s |
| Saturn | 3 radii | 0.000002 Gy/s |
| Earth | 1.6 and 4 radii | 0.0000001 and 0.00000002 Gy/s |

Rates scale inversely with sqrt(universe length scale), so an equivalent orbit receives a similar dose across presets. The normal electronics rating is 100 Gy. Half dose doubles command power demand and halves new instrument science yield; full dose disables probe control and instrument operation. Hardware and stored data remain recoverable. Dose is irreversible. HUD accumulated vessel dose is the maximum carried part dose, preserving inherited exposure after docking/staging rather than resetting a vessel counter.

A `radiationShield` module supplies a dose multiplier for the whole connected vessel. Only the best factor applies; vaults do not stack. Bastion avionics provide 0.1; Kiln provides 0.3. Crew dose is accumulated separately with a unit radiation weighting factor and one warning when crossing 0.1 Sv. No career injury/death penalty is applied.

These rates are deliberately calibrated game hazards, not measured transport predictions. Saturn mission exposure and LEO dose are much smaller than the inner Jovian belt. Omitted: particle spectra, magnetic tilt/time variability, South Atlantic Anomaly, solar storms, cosmic background and directional shielding. Physical motivation: [NASA's Europa Clipper radiation protection](https://www.nasa.gov/general/how-nasa-is-protecting-europa-clipper-from-space-radiation/) and [Juno's radiation vault](https://www.jpl.nasa.gov/news/juno-armored-up-to-go-to-jupiter/).

## Sunlight and rails integration

A point-source Sun uses the same float64 segment/sphere occlusion math as comms. Body spheres can eclipse both solar panels and thermal sunlight. A containing datum sphere is clipped to the observer radius so below-datum terrain valleys still have a day/night horizon. Finite solar disks, atmospheric attenuation, terrain mountain shadows and ring shadows are not included. Existing irradiance/distance scaling is preserved; this change introduces eclipses without rebalance of stock solar equipment.

Rails exposure samples the current conic before each SOI change, then the remaining interval. Sampling is at most 300 seconds or 1/64 of a period, capped at 2048 samples per segment for multi-year jumps. Landed heat-soak integration is analytic; moving radiation and eclipse transitions are quadrature approximations. Very large direct time jumps can undersample narrow belts/eclipses. Skin reentry heating remains in physics; existing rails atmosphere stops apply. Solar charging advances on rails, so shadow is not bypassed by time warp. Existing background hibernation is retained: command and reaction-wheel consumption remain physics-only. Applying continuous command demand to rails broke the battery budget of the existing stock Moon return capsule during its unpowered return coast.
