export const BANNED = /kerbal|kerbin|jebediah|rockomax|kerbodyne|probodobodyne|mainsail|poodle|terrier|reliant|swivel|stayputnik|okto|mun\b/i;

/**
 * Wider denylist of names/terms that belong to another game's universe or UI naming. Applied to the code a player can
 * read (comments stripped) by tests/original-names.test.ts. Real-world names (NASA, Apollo, Saturn...) are fine.
 */
export const BANNED_NAMES = new RegExp([
  'kerbal', 'kerbin', 'kerbol', 'kerbodyne', 'kerman', 'minmus', '\\bMun\\b', '\\bDuna\\b', '\\bJool\\b', '\\bLaythe\\b', '\\bTylo\\b', '\\bEeloo\\b',
  'jebediah', 'valentina', 'bill\\s?kerman', 'mystery goo', 'science jr', 'mechjeb', 'kerbal engineer', 'kraken',
  'LV-T\\d', 'LV-N\\b', 'TT-38', 'TR-18', 'FL-T\\d', 'Mk1\\b', 'Mk2\\b', 'Mk3\\b', 'Mk16', 'rockomax', 'oscar-b', 'stayputnik', 'probodobodyne', 'clamp-o-tron',
  'hecs\\b', 'mainsail', 'poodle', 'terrier', 'reliant', 'swivel', 'thumper', 'kickback', 'hammer\\b', '\\bflea\\b', 'okto\\b', '\\bsquad\\b',
  'vehicle assembly', 'spaceplane hangar', 'tracking station', 'research (and|&) development', 'astronaut complex',
  '\\bKSC\\b', '\\bKSP\\b',
].join('|'), 'i');
