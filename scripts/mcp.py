#!/usr/bin/env python3
"""Talk to the MCP servers of this project from the shell.

Usage:
  scripts/mcp.py list <server>                    # tools of one server, with their parameters
  scripts/mcp.py call <server> <tool> '<json>'    # call one tool, print the text result
  scripts/mcp.py check [server ...]               # start each server and list its tools

Servers: those of .mcp.json, plus the keyed ones of setup/services.json whose key is in .env.
"""
import json
import os
import re
import select
import ssl
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CA = "/etc/ssl/cert.pem" if os.path.exists("/etc/ssl/cert.pem") else None
INIT = {"jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"protocolVersion": "2025-06-18", "capabilities": {},
                   "clientInfo": {"name": "trip-planner-check", "version": "1"}}}
LIST = {"jsonrpc": "2.0", "id": 2, "method": "tools/list"}
VAR = re.compile(r"\$\{([A-Za-z0-9_]+)\}")


# ---- configuration -------------------------------------------------------------------------------------------

def load_env(root=ROOT):
    """Read KEY=VALUE lines of <root>/.env (comments, blank lines and surrounding quotes handled)."""
    out = {}
    try:
        with open(os.path.join(root, ".env"), encoding="utf-8") as f:
            lines = f.read().splitlines()
    except OSError:
        return out
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        v = v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        out[k.strip()] = v
    return out


def load_services(root=ROOT):
    with open(os.path.join(root, "setup", "services.json"), encoding="utf-8") as f:
        return json.load(f)["services"]


def render(template, values):
    """Copy a JSON template, replacing ${VAR} in every string with values[VAR] (no shell, no quoting issues)."""
    if isinstance(template, str):
        return VAR.sub(lambda m: values.get(m.group(1), ""), template)
    if isinstance(template, list):
        return [render(x, values) for x in template]
    if isinstance(template, dict):
        return {k: render(v, values) for k, v in template.items()}
    return template


def servers(root=ROOT):
    """name -> config: the keyless servers of .mcp.json plus the keyed ones whose key is present in .env."""
    try:
        with open(os.path.join(root, ".mcp.json"), encoding="utf-8") as f:
            table = dict(json.load(f)["mcpServers"])
    except (OSError, ValueError, KeyError):
        table = {}
    env = load_env(root)
    try:
        svcs = load_services(root)
    except (OSError, ValueError, KeyError):
        svcs = []
    for s in svcs:
        if s.get("mcp_name") and s.get("mcp_json_template") and env.get(s.get("env_var", "")):
            table[s["mcp_name"]] = render(s["mcp_json_template"], env)
    return table


def expand(cfg, env):
    """Replace ${VAR} in a server config using the process environment, then .env values."""
    return render(cfg, {**env, **os.environ})


# ---- transports ----------------------------------------------------------------------------------------------

def http_call(url, msg, headers, sid=None):
    h = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream",
         "MCP-Protocol-Version": "2025-06-18", "User-Agent": "trip-planner-check/1", **headers}
    if sid:
        h["Mcp-Session-Id"] = sid
    req = urllib.request.Request(url, data=json.dumps(msg).encode(), headers=h, method="POST")
    with urllib.request.urlopen(req, timeout=25, context=ssl.create_default_context(cafile=CA)) as r:
        body, sid = r.read().decode(), r.headers.get("Mcp-Session-Id") or sid
    if "data:" in body[:300]:
        body = "\n".join(l[5:].strip() for l in body.splitlines() if l.startswith("data:"))
    return (json.loads(body) if body.strip() else {}), sid


def http_session(cfg):
    url, headers = cfg["url"], cfg.get("headers", {})
    _, sid = http_call(url, INIT, headers)
    try:
        http_call(url, {"jsonrpc": "2.0", "method": "notifications/initialized"}, headers, sid)
    except Exception:
        pass
    return lambda msg: http_call(url, msg, headers, sid)[0], (lambda: None)


def stdio_session(cfg, root=ROOT, init_timeout=180):
    env = {**os.environ, **cfg.get("env", {})}
    p = subprocess.Popen([cfg["command"], *cfg.get("args", [])], cwd=root, env=env, text=True,
                         stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)

    def rpc(msg, timeout=300):
        p.stdin.write(json.dumps(msg) + "\n")
        p.stdin.flush()
        if "id" not in msg:
            return {}
        end = time.time() + timeout
        while time.time() < end:
            if select.select([p.stdout], [], [], 1)[0]:
                line = p.stdout.readline()
                if not line:
                    break
                try:
                    m = json.loads(line)
                except ValueError:
                    continue
                if m.get("id") == msg["id"]:
                    return m
        raise TimeoutError("no answer from the server")

    try:
        rpc(INIT, init_timeout)
        rpc({"jsonrpc": "2.0", "method": "notifications/initialized"})
    except Exception:
        p.kill()
        raise
    return rpc, p.kill


def session(cfg, root=ROOT):
    """(rpc, close) for a server config."""
    cfg = expand(cfg, load_env(root))
    return http_session(cfg) if cfg.get("type") in ("http", "sse") else stdio_session(cfg, root)


# ---- commands ------------------------------------------------------------------------------------------------

def tool_names(cfg, root=ROOT):
    rpc, close = session(cfg, root)
    try:
        res = rpc(LIST)
        return [t["name"] for t in res.get("result", {}).get("tools", [])]
    finally:
        close()


def check(names=(), root=ROOT, out=print):
    """Start each server (or only `names`), print one line each. Returns (ok, total)."""
    table = servers(root)
    todo = [n for n in table if not names or n in names]
    for n in names:
        if n not in table:
            out(f"FAIL {n:<12} unknown server (not in .mcp.json, and no key for it in .env)")
    ok = 0
    for name in todo:
        try:
            tools = tool_names(table[name], root)
            ok += 1
            out(f"OK   {name:<12} {len(tools):>2} tools: {', '.join(tools[:8])}{' ...' if len(tools) > 8 else ''}")
        except Exception as e:  # any failure is a line, never a traceback
            out(f"FAIL {name:<12} {type(e).__name__}: {e}")
    total = len(todo) + len([n for n in names if n not in table])
    out(f"\n{ok}/{total} servers working")
    return ok, total


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] not in ("list", "call", "check"):
        sys.exit(__doc__)
    cmd = argv[0]
    if cmd == "check":
        ok, total = check(argv[1:])
        return 0 if ok == total else 1
    if len(argv) < 2:
        sys.exit(__doc__)
    table = servers()
    if argv[1] not in table:
        sys.exit(f"Unknown server: {argv[1]}. Known: {', '.join(table)}")
    rpc, close = session(table[argv[1]])
    try:
        if cmd == "list":
            for t in rpc(LIST)["result"]["tools"]:
                sch = t.get("inputSchema", {})
                print(f"- {t['name']}  required={sch.get('required', [])}  params={list(sch.get('properties', {}))}")
                print(f"    {(t.get('description') or '').strip()[:300]}")
        else:
            if len(argv) < 3:
                sys.exit(__doc__)
            args = json.loads(argv[3]) if len(argv) > 3 else {}
            res = rpc({"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                       "params": {"name": argv[2], "arguments": args}})
            if "error" in res:
                sys.exit(f"Error: {res['error']}")
            for part in res.get("result", {}).get("content", []):
                print(part.get("text", json.dumps(part)))
    finally:
        close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
