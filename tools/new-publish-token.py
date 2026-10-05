"""Generates a new RomHack Hub admin token for publishing (see docs/publishing.md).

Run it yourself, in your own terminal -- it asks for the account's email,
password and authenticator code there, sends them only to
www.emulatornds.online, and writes the token to
.secrets/romhackhub-admin-token.txt. Nothing is printed or stored besides
that file.

    python tools/new-publish-token.py
"""
import getpass
import json
import pathlib
import urllib.error
import urllib.request

BASE = "https://www.emulatornds.online"
LABEL = "multiemu publicación"
TOKEN_FILE = pathlib.Path(__file__).resolve().parent.parent / ".secrets" / "romhackhub-admin-token.txt"


def post(path, payload):
    request = urllib.request.Request(
        BASE + path,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": "multiemu-publish-token"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", "replace")
        raise SystemExit(f"El servidor respondió {error.code}: {body}")


email = input("Correo de la cuenta: ").strip()
password = getpass.getpass("Contraseña (no se muestra): ")
result = post("/api/auth/token", {"email": email, "password": password, "label": LABEL})
if result.get("requiresTotp"):
    code = input("Código de la app de autenticación: ").strip()
    result = post("/api/auth/token/verify", {"pendingToken": result["pendingToken"], "code": code, "label": LABEL})

token = result.get("token")
if not token:
    raise SystemExit("No llegó ningún token; revisa los datos e inténtalo de nuevo.")
TOKEN_FILE.parent.mkdir(exist_ok=True)
TOKEN_FILE.write_text(token, encoding="utf-8")
print(f"Listo: token guardado en {TOKEN_FILE} (cuenta {result.get('username', '?')}).")
