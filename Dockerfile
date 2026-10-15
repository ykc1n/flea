FROM python:3.12-slim
WORKDIR /app
COPY flea flea
COPY web web
COPY worker worker
COPY scripts scripts
RUN useradd --uid 10001 --create-home flea && mkdir /app/data && chown flea:flea /app/data
USER flea
EXPOSE 8080
CMD ["python3", "-m", "flea.server", "--host", "0.0.0.0"]
