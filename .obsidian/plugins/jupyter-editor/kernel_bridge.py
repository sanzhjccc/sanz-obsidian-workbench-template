"""JSON-lines bridge between Obsidian and a real Jupyter kernel.

The bridge runs with the Python interpreter selected in Jupyter Editor. It
starts ipykernel through jupyter_client, forwards execution messages as JSON,
and keeps the kernel alive so variables persist between notebook cells.
"""

from __future__ import annotations

import json
import os
import signal
import sys
import traceback
from typing import Any, Dict


def emit(payload: Dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False, default=str), flush=True)


def main() -> int:
    try:
        from jupyter_client import KernelManager
    except Exception as exc:
        emit(
            {
                "event": "fatal",
                "message": "当前 Python 环境缺少 jupyter_client 或 ipykernel",
                "detail": str(exc),
            }
        )
        return 2

    manager = KernelManager(kernel_name="python3")
    # Force the kernel to use this bridge's interpreter instead of a global
    # kernelspec that may point at another virtual environment.
    manager.kernel_spec.argv = [
        sys.executable,
        "-m",
        "ipykernel_launcher",
        "-f",
        "{connection_file}",
    ]
    client = None

    def interrupt_kernel(_signum: int, _frame: Any) -> None:
        try:
            manager.interrupt_kernel()
            emit({"event": "interrupted"})
        except Exception as exc:  # pragma: no cover - depends on OS signal state
            emit({"event": "bridge_error", "message": f"中断内核失败：{exc}"})

    signal.signal(signal.SIGINT, interrupt_kernel)

    try:
        manager.start_kernel(cwd=os.getcwd())
        client = manager.client()
        client.start_channels()
        client.wait_for_ready(timeout=30)
        emit(
            {
                "event": "ready",
                "python": sys.executable,
                "python_version": sys.version.split()[0],
                "pid": getattr(manager.provisioner, "pid", None),
            }
        )

        for raw_line in sys.stdin:
            line = raw_line.strip()
            if not line:
                continue
            try:
                request = json.loads(line)
            except json.JSONDecodeError as exc:
                emit({"event": "bridge_error", "message": f"无效 JSON：{exc}"})
                continue

            action = request.get("action")
            request_id = request.get("id")
            if action == "shutdown":
                emit({"event": "stopping"})
                break
            if action != "execute":
                emit(
                    {
                        "id": request_id,
                        "event": "bridge_error",
                        "message": f"未知操作：{action}",
                    }
                )
                continue

            code = request.get("code", "")
            try:
                message_id = client.execute(
                    code,
                    allow_stdin=False,
                    stop_on_error=False,
                    store_history=True,
                )
                execution_count = None
                status = "ok"

                while True:
                    message = client.get_iopub_msg(timeout=120)
                    parent_id = message.get("parent_header", {}).get("msg_id")
                    if parent_id != message_id:
                        continue
                    message_type = message.get("header", {}).get("msg_type", "")
                    content = message.get("content", {})

                    if message_type == "status" and content.get("execution_state") == "idle":
                        break
                    if message_type == "execute_input":
                        execution_count = content.get("execution_count")
                    if message_type == "error":
                        status = "error"

                    if message_type in {
                        "stream",
                        "display_data",
                        "execute_result",
                        "update_display_data",
                        "error",
                        "clear_output",
                    }:
                        emit(
                            {
                                "id": request_id,
                                "event": "output",
                                "msg_type": message_type,
                                "content": content,
                            }
                        )

                emit(
                    {
                        "id": request_id,
                        "event": "done",
                        "status": status,
                        "execution_count": execution_count,
                    }
                )
            except KeyboardInterrupt:
                emit(
                    {
                        "id": request_id,
                        "event": "done",
                        "status": "abort",
                        "execution_count": None,
                    }
                )
            except Exception as exc:
                emit(
                    {
                        "id": request_id,
                        "event": "done",
                        "status": "error",
                        "execution_count": None,
                        "message": str(exc),
                        "traceback": traceback.format_exc(),
                    }
                )
    except Exception as exc:
        emit(
            {
                "event": "fatal",
                "message": f"Jupyter 内核启动失败：{exc}",
                "detail": traceback.format_exc(),
            }
        )
        return 1
    finally:
        if client is not None:
            try:
                client.stop_channels()
            except Exception:
                pass
        try:
            if manager.has_kernel:
                manager.shutdown_kernel(now=True)
        except Exception:
            pass

    emit({"event": "stopped"})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
