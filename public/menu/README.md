# Saturn title-screen portrait

`saturn.webp` is original art exported from this game's planetary renderer at
3840 × 2400, using Ultra sphere/ring tessellation, native resolution, MSAA and
SMAA. The moon surface maps use 1024-pixel bakes because the moons are small in
this composition. No external imagery or third-party game art is used.

To regenerate, run `npm run dev`, open `/scripts/art/menu-portrait.html`, wait
for the export button, and save its download as `public/menu/saturn.webp`.
The exporter freezes time and waits for the surface bakes before encoding WebP
at quality 0.95. The menu displays the still with a right-aligned cover crop;
it does not create a WebGL context or run an animation loop. The asset is
included in the existing PWA precache for offline play.
