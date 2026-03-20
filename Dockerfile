FROM python:3.11-slim
WORKDIR /app
# Install Node.js for Stacks transaction signing
RUN apt-get update && apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*
# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# Copy everything first
COPY . .
# Install Node dependencies AFTER copy so they aren't overwritten
RUN cd app/services && npm install
EXPOSE 8000
