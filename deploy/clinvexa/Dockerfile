FROM python:3.13-slim

WORKDIR /app

COPY clinvexa /app/clinvexa
COPY skills/clinvexa /app/skills/clinvexa
COPY hermes_constants.py /app/hermes_constants.py
COPY tools /app/tools

RUN python -m pip install --no-cache-dir /app/clinvexa

EXPOSE 8001

CMD ["uvicorn", "clinvexa.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8001"]
