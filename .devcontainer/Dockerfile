FROM ubuntu:26.04

# Install common utilities
RUN apt-get update && apt-get install -y software-properties-common \
    && add-apt-repository -y ppa:xtradeb/apps
RUN apt-get install -y \
    python-is-python3 \
    python3 \
    python3-pip \
    bash \
    curl \
    findutils \
    git \
    unzip \
    npm \
    chromium \
    rustup \
    build-essential \
    openssl \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

USER ubuntu

# Install opencode
RUN npm config set prefix '~/.local/'
RUN npm i -g opencode-ai@latest
RUN mkdir -p ~/.local/share/opencode

# Update Rust
RUN rustup default stable
RUN rustup update

# Install tokensave
RUN cargo install tokensave

# Install rtk
RUN cargo install --git https://github.com/rtk-ai/rtk

# Install opencode hooks
ENV PATH="${PATH}:/home/ubuntu/.cargo/bin/"
RUN tokensave install --agent opencode
RUN rtk init --global --opencode

# Set working directory
WORKDIR /workspace

# Copy the rest of the code
COPY . /workspace

# Default shell
CMD ["bash"]
