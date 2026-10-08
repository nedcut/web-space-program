/** Local vertical estimate, constant gravity/thrust, no drag. Not a terrain-path prediction. */
export function landingReadout(agl: number, verticalSpeed: number, gravity: number, acceleration: number, fuelSeconds = Infinity) {
  const speed = Math.max(0, -verticalSpeed), height = Math.max(0, agl);
  const net = acceleration - gravity;
  const stopTime = net > 0 ? speed / net : Infinity;
  const stopDistance = net > 0 ? speed * speed / (2 * net) : Infinity;
  const canStop = speed === 0 || (stopDistance <= height && stopTime <= fuelSeconds);
  const ballisticTime = speed > 0 || gravity > 0
    ? 2 * height / (speed + Math.sqrt(speed * speed + 2 * gravity * height)) : Infinity;
  // Time to contact if maximum available braking continues; Infinity means a stop above ground.
  const a = gravity - acceleration;
  const discriminant = speed * speed + 2 * a * height;
  const impactTime = canStop ? Infinity : stopTime > fuelSeconds ? ballisticTime
    : discriminant >= 0 && speed + Math.sqrt(discriminant) > 0 ? 2 * height / (speed + Math.sqrt(discriminant)) : ballisticTime;
  return { canStop, stopDistance, stopTime, ballisticTime, impactTime };
}
