#!/usr/bin/env sh

git clone https://github.com/madroidmaq/mlx-omni-server.git ./vendored/mlx-omni-server

( \
cd ./vendored/mlx-omni-server && \
	uv venv --python 3.13 && . .venv/bin/activate && uv pip install -e . && \
  uv pip install build && \
  python -m build  && \
  uv run uvicorn mlx_omni_server.main:app --reload --host 0.0.0.0 --port 10240 \
)
