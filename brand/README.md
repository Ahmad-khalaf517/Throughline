# Throughline logo kit

The mark is redrawn from the supplied Throughline promotion: two rust-colored endpoints connected by a dotted line. The full wordmark uses the same spacing and weight. Use the horizontal logo when there is room, and the mark alone for small or square placements.

| Placement                          | File                                                       | Size                            |
| ---------------------------------- | ---------------------------------------------------------- | ------------------------------- |
| Website, app, marketing navigation | `public/brand/logo-horizontal.svg`                         | Vector                          |
| Dark backgrounds                   | `public/brand/logo-horizontal-inverse.svg`                 | Vector                          |
| Small mark                         | `public/brand/logo-mark.svg`                               | Vector                          |
| Favicon                            | `src/app/favicon.ico`, `src/app/icon.svg`                  | 16, 32, 48 px; vector           |
| Apple touch icon                   | `src/app/apple-icon.png`                                   | 180 × 180                       |
| Email header                       | `public/brand/email-logo.png`                              | 940 × 128 (display at 235 × 32) |
| App icon exports                   | `exports/app-icon-192.png`, `exports/app-icon-512.png`     | 192, 512 px                     |
| Social profile                     | `exports/social-avatar-800.png`                            | 800 × 800                       |
| Link sharing                       | `src/app/opengraph-image.png`, `src/app/twitter-image.png` | 1200 × 630                      |
| Square promotion                   | `exports/social-post-1080.png`                             | 1080 × 1080                     |
| Story promotion                    | `exports/social-story-1080x1920.png`                       | 1080 × 1920                     |
| Wide promotion                     | `exports/social-banner-1500x500.png`                       | 1500 × 500                      |

The `exports/` folder also includes transparent PNGs of the mark and both wordmark colors. Do not stretch or recolor the supplied exports. Allow clear space around the logo equal to at least one endpoint diameter.

The website uses the SVGs in `public/brand`. Next.js serves the favicon, touch icon, and share images from `src/app`. The two live Supabase email templates use an inline HTML version of the same mark, so they remain visible when email clients block remote images. Matching versioned templates are in `brand/email/`. The PNG at `public/brand/email-logo.png` is for other email systems that allow a hosted image.

To regenerate the assets after a logo change, edit `scripts/export-brand-assets.py`, install Pillow and CairoSVG in Python, then run `python scripts/export-brand-assets.py` from the repository root. The script writes every SVG and PNG listed above.
