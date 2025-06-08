FROM ollama/ollama:0.9.0

# Pull the image
RUN ollama serve & \
    sleep 5 && \
    ollama pull qwen3:0.6b && \
    ollama pull nomic-embed-text:137m-v1.5-fp16 && \
    pkill ollama

# Expose the default Ollama port
EXPOSE 11434

# Set the entrypoint to run Ollama
ENTRYPOINT ["ollama"]
CMD ["serve"] 