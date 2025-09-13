#!/bin/bash

# Generate Favicon ICO Script
# This script generates a multi-resolution favicon.ico from an existing favicon.svg

set -e  # Exit on any error

# Check if we're in the site directory
if [ ! -f "package.json" ] || [ ! -d "public" ]; then
    echo "Error: This script must be run from the site directory"
    exit 1
fi

# Check required tools
for tool in rsvg-convert magick; do
    if ! command -v "$tool" &> /dev/null; then
        echo "Error: $tool is not installed."
        case "$tool" in
            "rsvg-convert") echo "  Install with: brew install librsvg" ;;
            "magick") echo "  Install with: brew install imagemagick" ;;
        esac
        exit 1
    fi
done

# Define paths
FAVICON_SVG="public/favicon.svg"
FAVICON_ICO="public/favicon.ico"

# Check if favicon.svg exists
if [ ! -f "$FAVICON_SVG" ]; then
    echo "Error: favicon.svg not found at $FAVICON_SVG"
    echo "Please create favicon.svg manually first."
    exit 1
fi

echo "Generating PNG files in multiple resolutions..."

# Generate PNG files in different sizes
SIZES=(16 32 48 64)
PNG_FILES=()

for size in "${SIZES[@]}"; do
    png_file="public/favicon-${size}.png"
    rsvg-convert -w "$size" -h "$size" "$FAVICON_SVG" -o "$png_file"
    PNG_FILES+=("$png_file")
    echo "Generated ${size}x${size} PNG"
done

echo "Creating multi-resolution ICO file..."

# Create ICO file with all resolutions
magick "${PNG_FILES[@]}" "$FAVICON_ICO"

# Clean up temporary PNG files
echo "Cleaning up temporary files..."
for png_file in "${PNG_FILES[@]}"; do
    rm "$png_file"
done

# Check file sizes
ico_size=$(stat -f%z "$FAVICON_ICO" 2>/dev/null || stat -c%s "$FAVICON_ICO" 2>/dev/null)

echo "Favicon generation complete!"
echo "  - favicon.ico: ${ico_size} bytes (16x16, 32x32, 48x48, 64x64)"
