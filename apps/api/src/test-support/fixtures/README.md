# Synthetic private-media fixtures

These files contain a generated 120 × 80 red/blue pattern, never customer data.
`source.png` was generated with sharp 0.35.5. JPEG fixtures were encoded from
that pattern with sharp; `oriented-source.jpg` carries EXIF orientation 6.
HEIC fixtures were encoded with libheif `heif-enc` 1.15.1 in an isolated Debian
container. `valid.heif` retains the HEVC payload and uses the `mif1` major brand.
`multiple.heic` contains two images. `oriented.heic` retains EXIF orientation 6;
the decoder test checks both rotated dimensions and red/blue pixel placement.

Tests also generate WebP, animated WebP, oversized pixel inputs, and malformed or
truncated bytes at runtime. The browser uses `valid.jpg`; the older unrelated web
fixture is too truncated for full image validation and remains unchanged.

| File                  | SHA-256                                                            |
| --------------------- | ------------------------------------------------------------------ |
| `multiple.heic`       | `84c29c0cb06ce3c3cb0cbbc1f379ea8bfa519f1f408bdc68542e869aee2882fa` |
| `oriented-source.jpg` | `ea1d6c1f5f8e034f8adcf8a7c3351105b4d128c975789add3453f5e10b84bf7c` |
| `oriented.heic`       | `eacf83569343df67597bc403fcc394c49b50fca5183a38719acc0b26c1cdbec2` |
| `source.png`          | `651845d78cf73aa606fe61e5fc3f52d387a1142b1464d4a6461d5113ffd9aec0` |
| `valid.heic`          | `8ff6ec6c67dbc59456886c9f6332dd19560c6ea15e1d8bb89107dbf0d3ca354f` |
| `valid.heif`          | `95573514d0b285eb21577b86081996645f760eb99cd526e28525d8a3e8f342c9` |
| `valid.jpg`           | `01f6057e366ac460583ae86a3e6a0df040c90539d494a7259b7404238aa4b766` |
