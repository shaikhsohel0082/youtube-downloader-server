#!/bin/bash

# Create bin directory if it doesn't exist
mkdir -p ./bin

# Download yt-dlp binary locally
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o ./bin/yt-dlp

# Make it executable
chmod +x ./bin/yt-dlp

# Install Node.js dependencies
npm install
