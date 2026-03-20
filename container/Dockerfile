# NanoCode Agent Container
# This container runs OpenCode agents in isolation

FROM node:20-slim

# Install dependencies for OpenCode
RUN apt-get update && apt-get install -y \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install OpenCode globally
RUN npm install -g opencode-ai

# Create non-root user for security
RUN useradd -m -s /bin/bash agent
USER agent

# Set working directory
WORKDIR /workspace

# Default command
CMD ["opencode", "--help"]
