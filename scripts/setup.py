#!/usr/bin/env python3
"""Guided first-launch setup, driven by Claude (see CLAUDE.md > First launch).

Usage:
  setup.py status [--json]     check prerequisites and servers; installs nothing. Exit 2 if something required is missing
  setup.py services            list the optional services by group (keyless, keyed, connector, browser)
  setup.py add-key <id>        read an API key on stdin, save it in .env (mode 600) and register the server with Claude
  setup.py done                record that setup is finished (.setup/state.json)
  setup.py hook                one line for the SessionStart hook

Exit codes: 0 ok, 1 usage or failure, 2 a required prerequisite is missing, 3 `claude` not installed (key saved).
Keys are only ever read from stdin and never printed.
"""
import argparse
import datetime
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import sysconfig
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mcp  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NEEDED = "SETUP_NEEDED: run the guided setup (see CLAUDE.md › First launch, with the start skill) before anything else."
GROUPS = ("keyless", "keyed", "connector", "browser")
WSL_NOTE = "Run this inside your WSL (Linux) terminal."
NEW_TERMINAL = "Then open a new terminal window, so the new command is found."
NODE_PAGE = "https://nodejs.org/en/download"
PYTHON_PAGE_MAC = "https://www.python.org/downloads/macos/"
UV_CURL = "curl -LsSf https://astral.sh/uv/install.sh | sh"   # docs.astral.sh/uv/getting-started/installation (checked 2026-11-07)
CLAUDE_CURL = "curl -fsSL https://claude.ai/install.sh | bash"
PIP_USER = "python3 -m pip install --user Pillow"
BREW_PATHS = ("/opt/homebrew/bin/brew", "/usr/local/bin/brew")

# id -> (label, minimum); the install commands come from install_cmds() (they depend on what this computer has)
PREREQS = [
    ("node", "Node.js", (18,)),
    ("uv", "uv", None),
    ("python", "Python", (3, 9)),
    ("pillow", "Pillow", None),
    ("claude", "Claude Code", None),
]


def detect_platform():
    if sys.platform == "darwin":
        return "macos"
    if sys.platform.startswith("linux"):
        return "wsl" if "microsoft" in platform.release().lower() else "linux"
    return "windows"


def tool_version(name):
    """Output of `<name> --version`, or '' when it cannot be read."""
    p = subprocess.run([name, "--version"], capture_output=True, text=True, timeout=20)
    return (p.stdout or p.stderr or "").strip()


def importable(module, timeout=30):
    """True when a plain `python3` (this interpreter, WITHOUT -I) can import `module`.

    Checked in a child process on purpose: `python3 -I scripts/setup.py` hides the user site-packages, where
    `pip install --user` puts a module, so an in-process check would report it missing forever."""
    try:
        p = subprocess.run([sys.executable, "-c", f"import {module}"], capture_output=True, text=True, timeout=timeout)
    except (subprocess.TimeoutExpired, OSError):
        return False
    return p.returncode == 0


def has_pillow():
    return importable("PIL")


def parse_version(text):
    m = re.search(r"(\d+)\.(\d+)(?:\.(\d+))?", text or "")
    return tuple(int(x) for x in m.groups() if x is not None) if m else None


def python_version():
    """(major, minor, micro) of the python3 running the scripts."""
    return tuple(sys.version_info[:3])


def has_brew():
    """True when Homebrew is installed (it is never required: it only changes the suggested commands)."""
    return bool(shutil.which("brew")) or any(os.path.exists(p) for p in BREW_PATHS)


def python_is_brew(exe=None):
    """True when python3 is a Homebrew Python: there `pip install --user` is refused, `brew install pillow` works."""
    real = os.path.realpath(exe or sys.executable)
    return "/Cellar/" in real or real.startswith("/opt/homebrew/")


def externally_managed():
    """True when this Python refuses pip installs outside a virtual environment (PEP 668, e.g. recent Debian/Ubuntu)."""
    try:
        return os.path.isfile(os.path.join(sysconfig.get_path("stdlib"), "EXTERNALLY-MANAGED"))
    except Exception:  # noqa: BLE001 - unknown means "no"
        return False


def environment():
    return {"brew": has_brew(), "brew_python": python_is_brew(), "managed": externally_managed()}


def install_cmds(pid, env):
    """{macos, linux, wsl}: how to install `pid` on this computer. On a Mac, Homebrew only when it is already there."""
    brew = bool(env.get("brew"))
    if pid == "node":
        mac = f"Download the macOS installer (LTS) from {NODE_PAGE} and open it. {NEW_TERMINAL}"
        if brew:
            mac = f"brew install node   (or the macOS installer from {NODE_PAGE}). {NEW_TERMINAL}"
        lin = (f"Node.js 18 or newer from {NODE_PAGE} (choose Linux, then nvm or the prebuilt binary; NodeSource also "
               f"works): the nodejs package of apt is often older than 18. {NEW_TERMINAL}")
    elif pid == "uv":
        mac = lin = f"{UV_CURL}   {NEW_TERMINAL}"
        if brew:
            mac = f"brew install uv   (or: {UV_CURL}). {NEW_TERMINAL}"
    elif pid == "python":
        mac = f"Install Python 3 from {PYTHON_PAGE_MAC} (the macOS installer). {NEW_TERMINAL}"
        lin = "sudo apt install python3  (Debian/Ubuntu) or sudo dnf install python3  (Fedora)"
    elif pid == "pillow":
        mac = "brew install pillow" if brew and env.get("brew_python") else PIP_USER
        lin = ("sudo apt install python3-pil  (Debian/Ubuntu) or sudo dnf install python3-pillow  (Fedora)"
               if env.get("managed") else f"{PIP_USER}  (or: sudo apt install python3-pil)")
    else:  # claude
        mac = lin = CLAUDE_CURL
    return {"macos": mac, "linux": lin, "wsl": lin}


def check_prereq(pid, label, minimum, env=None):
    """One prerequisite -> dict. Never raises."""
    item = {"id": pid, "name": label, "status": "missing", "version": "", "install": {}}
    try:
        item["install"] = install_cmds(pid, env or {})
        if pid == "python":
            v = python_version()
            item["version"] = ".".join(str(x) for x in v)
            item["status"] = "ok" if tuple(v[:2]) >= minimum else "old"
        elif pid == "pillow":
            item["status"] = "ok" if has_pillow() else "missing"
        elif shutil.which(pid):
            item["status"] = "ok"
            if minimum or pid in ("node",):
                ver = tool_version(pid)
                item["version"] = ver
                parsed = parse_version(ver)
                if minimum and (parsed is None or parsed[:len(minimum)] < minimum):
                    item["status"] = "old"
    except Exception as e:  # a failing check is a result, not a crash
        item["status"] = "missing"
        item["version"] = f"check failed: {type(e).__name__}"
    return item


def load_services(root):
    return mcp.load_services(root)


def load_state(root):
    try:
        with open(os.path.join(root, ".setup", "state.json"), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def server_states(root):
    env = mcp.load_env(root)
    out = []
    try:
        svcs = load_services(root)
        with open(os.path.join(root, ".mcp.json"), encoding="utf-8") as f:
            keyless = set(json.load(f)["mcpServers"])
    except Exception:
        return out
    for s in svcs:
        if s["group"] == "keyless":
            out.append({"id": s["id"], "group": "keyless", "state": "configured" if s.get("mcp_name") in keyless else "missing"})
        elif s["group"] == "keyed":
            out.append({"id": s["id"], "group": "keyed", "state": "key in .env" if env.get(s["env_var"]) else "no key"})
    return out


def cmd_status(args, root):
    plat = detect_platform()
    try:
        env = environment()
    except Exception:  # noqa: BLE001 - the suggestions fall back to the plain installers
        env = {}
    items = [check_prereq(pid, label, minimum, env) for pid, label, minimum in PREREQS]
    missing = [i for i in items if i["status"] != "ok"]
    if args.json:
        print(json.dumps({"platform": plat, "homebrew": bool(env.get("brew")), "prerequisites": items,
                          "servers": server_states(root)}, indent=2))
        return 2 if missing else 0
    print(f"Platform: {plat}")
    for i in items:
        print(f"  {i['id']:<8} {i['status']:<8} {i['version']}".rstrip())
    for i in missing:
        cmd = i["install"].get(plat) or i["install"].get("linux", "")
        extra = ("  " + WSL_NOTE) if plat == "wsl" else ""
        if plat == "windows":
            cmd, extra = i["install"].get("linux", ""), "  On Windows, use WSL (https://learn.microsoft.com/windows/wsl/install) and run this inside it."
        print(f"\nInstall {i['name']} ({i['status']}):\n  {cmd}{extra}")
    print("\nServers:")
    for s in server_states(root):
        print(f"  {s['id']:<20} {s['group']:<8} {s['state']}")
    if missing:
        if [i["id"] for i in missing] == ["pillow"]:
            print("\nOnly Pillow is missing: everything works without it except the photos.")
        print("\nSomething required is missing. Install it as shown above, then run status again.")
        return 2
    print("\nAll prerequisites are in place.")
    return 0


def cmd_services(args, root):
    svcs = load_services(root)
    for g in GROUPS:
        print(f"\n[{g}]")
        for s in svcs:
            if s["group"] == g:
                print(f"- {s['id']}: {s['name']} - {s['what_for']}")
                print(f"    free: {s['free_tier']} (checked: {s['verified']})")
                print(f"    link: {s['signup_url']}")
                if s.get("tool_hint"):
                    print(f"    already on when a tool ends with: __{s['tool_hint']}")
                for n, step in enumerate(s.get("steps", []), 1):
                    print(f"    {n}. {step}")
    return 0


def write_env(root, var, value):
    """Update or append VAR=value in <root>/.env atomically, mode 600, other lines untouched."""
    path = os.path.join(root, ".env")
    try:
        lines = open(path, encoding="utf-8").read().splitlines()
    except OSError:
        lines = []
    new, done = [], False
    for line in lines:
        if line.split("=", 1)[0].strip() == var and "=" in line:
            if not done:
                new.append(f"{var}={value}")
            done = True
        else:
            new.append(line)
    if not done:
        new.append(f"{var}={value}")
    fd, tmp = tempfile.mkstemp(dir=root, prefix=".env.")
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write("\n".join(new) + "\n")
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise
    os.chmod(path, 0o600)


def scrub(text, secret):
    return (text or "").replace(secret, "<hidden>")


def cmd_add_key(args, root):
    svc = next((s for s in load_services(root) if s["id"] == args.service and s["group"] == "keyed"), None)
    if not svc:
        ids = ", ".join(s["id"] for s in load_services(root) if s["group"] == "keyed")
        print(f"Unknown keyed service: {args.service}. Known: {ids}", file=sys.stderr)
        return 1
    key = (sys.stdin.readline() or "").strip()
    if not key:
        print("No key received on stdin. Pipe it in: the key is never taken from the command line.", file=sys.stderr)
        return 1
    write_env(root, svc["env_var"], key)
    print(f"Saved {svc['env_var']} in .env (private, mode 600).")
    payload = json.dumps(mcp.render(svc["mcp_json_template"], {svc["env_var"]: key}))
    if not shutil.which("claude"):
        shown = json.dumps(mcp.render(svc["mcp_json_template"], {svc["env_var"]: "<your key>"}))
        print("`claude` is not installed yet. Once it is, run:")
        print(f"  claude mcp add-json --scope local {svc['mcp_name']} '{shown}'")
        return 3
    try:
        subprocess.run(["claude", "mcp", "remove", "--scope", "local", svc["mcp_name"]],
                       capture_output=True, text=True, timeout=60)
        p = subprocess.run(["claude", "mcp", "add-json", "--scope", "local", svc["mcp_name"], payload],
                           capture_output=True, text=True, timeout=120)
    except Exception as e:
        print(f"Could not run claude: {type(e).__name__}", file=sys.stderr)
        return 1
    if p.returncode != 0:
        print(f"`claude mcp add-json` failed: {scrub(p.stderr or p.stdout, key).strip()[:300]}", file=sys.stderr)
        return 1
    print(f"Registered server '{svc['mcp_name']}' for this project (stored outside the repository).")
    try:
        names = mcp.tool_names(mcp.render(svc["mcp_json_template"], {svc["env_var"]: key}), root)
        print(f"Test: OK, {len(names)} tools.")
    except Exception as e:
        print(f"Test: could not reach the server ({type(e).__name__}); check the key, then restart Claude Code.")
    print("Restart Claude Code (or type /mcp) to load the new server.")
    return 0


def cmd_done(args, root):
    env = mcp.load_env(root)
    enabled = []
    for s in load_services(root):
        if s["group"] == "keyed" and env.get(s["env_var"]):
            enabled.append(s["id"])
    os.makedirs(os.path.join(root, ".setup"), exist_ok=True)
    state = {"date": datetime.date.today().isoformat(), "services_enabled": enabled}
    with open(os.path.join(root, ".setup", "state.json"), "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)
        f.write("\n")
    print(f"Setup recorded for {state['date']}.")
    return 0


def active_slug(root):
    try:
        d = os.environ.get("TRIP_DIR")
        if d:
            return os.path.basename(os.path.normpath(d)) or "none"
        with open(os.path.join(root, "trips", ".current"), encoding="utf-8") as f:
            slug = f.read().strip()
        return slug if slug and os.path.isfile(os.path.join(root, "trips", slug, "trip.json")) else "none"
    except OSError:
        return "none"


def cmd_hook(args, root):
    st = load_state(root)
    if not st:
        print(NEEDED)
    else:
        print(f"Setup done {st.get('date', 'unknown')}. Active trip: {active_slug(root)}. Load the start skill.")
    return 0


def main(argv=None, root=ROOT):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    st = sub.add_parser("status")
    st.add_argument("--json", action="store_true")
    sub.add_parser("services")
    ak = sub.add_parser("add-key")
    ak.add_argument("service")
    sub.add_parser("done")
    sub.add_parser("hook")
    try:
        args = ap.parse_args(argv)
    except SystemExit as e:
        return e.code if isinstance(e.code, int) else 1
    fn = {"status": cmd_status, "services": cmd_services, "add-key": cmd_add_key, "done": cmd_done, "hook": cmd_hook}[args.cmd]
    try:
        return fn(args, root)
    except Exception as e:  # never a traceback for the user
        print(f"setup.py {args.cmd} failed: {type(e).__name__}: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
