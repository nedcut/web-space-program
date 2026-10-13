/** Pre-rendered with our planetary renderer; the menu needs no WebGL context or animation loop. */
export function MenuBackdrop() {
  return <img
    src={`${import.meta.env.BASE_URL}menu/saturn.webp`}
    alt=""
    aria-hidden="true"
    className="fullscreen menu-backdrop"
    width={3840}
    height={2400}
    fetchPriority="high"
    draggable={false}
  />;
}
