#!/bin/bash

echo "Creating bin directory..."
mkdir -p bin

echo "Downloading yt-dlp..."
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o bin/yt-dlp

echo "Making yt-dlp executable..."
chmod +x bin/yt-dlp

echo "yt-dlp setup complete:"
ls -la bin/
./bin/yt-dlp --version
