FROM ubuntu:26.04

# Install common utilities
RUN apt-get update && apt-get install -y \
    software-properties-common \
    python-is-python3 \
    python3 \
    python3-pip \
    bash \
    curl \
    findutils \
    git \
    unzip \
    npm \
    && rm -rf /var/lib/apt/lists/*

USER ubuntu

# Install opencode
RUN npm config set prefix '~/.local/'
RUN npm i -g opencode-ai@latest
RUN mkdir -p ~/.local/share/opencode

# Install TypeScript & Electron
RUN npm i -g typescript@latest
RUN npm i -g electron@latest

# Set working directory
WORKDIR /workspace

# Copy the rest of the code
COPY . /workspace

# Default shell
CMD ["bash"]