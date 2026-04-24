web: gunicorn --workers 1 --threads 4 --bind 0.0.0.0:${PORT:-8080} wsgi:app
worker: python collector.py --loop
