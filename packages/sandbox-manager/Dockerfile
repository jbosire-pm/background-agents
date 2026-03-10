FROM python:3.12-slim

WORKDIR /app

COPY packages/sandbox-manager/pyproject.toml ./
RUN pip install --no-cache-dir .

COPY packages/sandbox-manager/src/ ./src/

EXPOSE 8000

ENV PYTHONUNBUFFERED=1

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
