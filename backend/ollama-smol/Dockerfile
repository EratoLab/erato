FROM ollama/ollama:0.5.12

# Pull the image
RUN ollama serve & \
    sleep 5 && \
    ollama pull smollm2:135m && \
    ollama pull nomic-embed-text:137m-v1.5-fp16 && \
    pkill ollama

# Expose the default Ollama port
EXPOSE 11434

# Set the entrypoint to run Ollama
ENTRYPOINT ["ollama"]
CMD ["serve"] 