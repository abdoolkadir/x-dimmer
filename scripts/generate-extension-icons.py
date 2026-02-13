#!/usr/bin/env python3
"""
=============================================================================
X DIMMER — ICON GENERATOR SCRIPT
=============================================================================

PURPOSE:
Generates the Chrome extension icons at 16x16, 48x48, and 128x128 pixel sizes.
These are required by the Chrome Extension manifest for the toolbar icon,
extension management page, and Chrome Web Store listing.

ICON DESIGN:
A crescent moon icon on a dark navy-blue circular background.
The moon symbolizes "dimming" (night mode / reduced brightness).
The background color (#15202B) IS the dim theme color, so the icon
itself is a micro-preview of what the extension does.

The crescent shape uses X's accent blue (#1D9BF0) for brand recognition
and visual connection to X/Twitter's interface.

DEPENDENCIES:
Uses the Pillow (PIL) library for image generation.
Install with: pip3 install Pillow

RUN:
python3 scripts/generate-extension-icons.py
Icons will be saved to the icons/ directory.
"""

import sys
import os
import math

try:
    from PIL import Image, ImageDraw, ImageFilter
except ImportError:
    print("Pillow not installed. Installing now...")
    os.system(f"{sys.executable} -m pip install Pillow")
    from PIL import Image, ImageDraw, ImageFilter


def generate_crescent_moon_icon(size, output_path):
    """
    Generates a crescent moon icon at the specified size.
    
    The icon consists of:
    1. A dark navy circular background (#15202B) — the dim theme color
    2. A crescent moon shape in X's blue (#1D9BF0)
    3. Subtle anti-aliasing for smooth edges
    
    We render at 4x the target size and then downsample with LANCZOS
    resampling for the best possible anti-aliasing at small sizes.
    This is especially important for the 16x16 icon where every pixel matters.
    
    Args:
        size: Target icon size in pixels (e.g., 16, 48, 128)
        output_path: Where to save the PNG file
    """
    # Render at 4x for high-quality downsampling
    # This gives us smooth anti-aliased edges even at 16x16
    render_scale = 4
    render_size = size * render_scale
    
    # Create the canvas with transparency
    image = Image.new('RGBA', (render_size, render_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    
    # --- BACKGROUND CIRCLE ---
    # The circular background uses the dim theme color (#15202B = rgb(21, 32, 43))
    # This reinforces the brand — the icon IS the dim color
    bg_color = (21, 32, 43, 255)  # #15202B fully opaque
    padding = render_size * 0.02  # Tiny padding for the circle
    draw.ellipse(
        [padding, padding, render_size - padding, render_size - padding],
        fill=bg_color
    )
    
    # --- CRESCENT MOON ---
    # Create the crescent by drawing a full circle (the moon)
    # then subtracting a slightly offset circle (the shadow)
    # 
    # X's blue: #1D9BF0 = rgb(29, 155, 240)
    moon_color = (29, 155, 240, 255)
    
    # Moon circle — centered, sized to fit nicely within the background
    center_x = render_size / 2
    center_y = render_size / 2
    moon_radius = render_size * 0.3
    
    # Draw the full moon circle
    draw.ellipse(
        [
            center_x - moon_radius,
            center_y - moon_radius,
            center_x + moon_radius,
            center_y + moon_radius,
        ],
        fill=moon_color
    )
    
    # Shadow circle — offset to the upper-right to create crescent shape
    # The shadow uses the background color to "bite" into the moon
    shadow_offset_x = render_size * 0.12
    shadow_offset_y = -render_size * 0.08
    shadow_radius = moon_radius * 0.82
    
    shadow_center_x = center_x + shadow_offset_x
    shadow_center_y = center_y + shadow_offset_y
    
    draw.ellipse(
        [
            shadow_center_x - shadow_radius,
            shadow_center_y - shadow_radius,
            shadow_center_x + shadow_radius,
            shadow_center_y + shadow_radius,
        ],
        fill=bg_color
    )
    
    # --- SMALL STARS / DOTS (for larger icon sizes) ---
    # Add small decorative dots that look like stars, but only for
    # 48x48 and 128x128 where they'll actually be visible
    if size >= 48:
        star_color = (139, 152, 165, 200)  # #8B98A5 with slight transparency
        
        # Star positions (relative to render_size)
        star_positions = [
            (0.72, 0.28, 0.015),  # (x, y, radius) — upper right
            (0.78, 0.45, 0.010),  # — mid right
            (0.60, 0.22, 0.008),  # — upper area
        ]
        
        for (sx, sy, sr) in star_positions:
            star_x = render_size * sx
            star_y = render_size * sy
            star_r = render_size * sr
            draw.ellipse(
                [star_x - star_r, star_y - star_r, star_x + star_r, star_y + star_r],
                fill=star_color
            )
    
    # --- DOWNSAMPLE ---
    # Resize from 4x render to target size with high-quality resampling
    final_image = image.resize((size, size), Image.LANCZOS)
    
    # Save as PNG with maximum compression
    final_image.save(output_path, 'PNG', optimize=True)
    print(f"  ✓ Generated {size}x{size} icon → {output_path}")


def main():
    """Generate all required icon sizes for the Chrome extension."""
    
    # Determine the icons directory (relative to project root)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    icons_dir = os.path.join(project_root, 'icons')
    
    # Ensure icons directory exists
    os.makedirs(icons_dir, exist_ok=True)
    
    print("🌙 X Dimmer — Generating Extension Icons")
    print("=" * 45)
    
    # Chrome Extension requires these three sizes:
    # - 16x16: Toolbar icon (small, next to the address bar)
    # - 48x48: Extension management page
    # - 128x128: Chrome Web Store listing and install dialog
    icon_sizes = [16, 48, 128]
    
    for size in icon_sizes:
        output_path = os.path.join(icons_dir, f'icon-{size}.png')
        generate_crescent_moon_icon(size, output_path)
    
    print("=" * 45)
    print("✅ All icons generated successfully!")
    print(f"   Icons saved to: {icons_dir}/")


if __name__ == '__main__':
    main()
