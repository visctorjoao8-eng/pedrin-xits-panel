"""
============================================================
 Pedrin Xits - Auth Client (Python)
 Validação de licença para proteção de software
============================================================
"""

import json
import hashlib
import hmac
import time
import uuid
import platform
import subprocess
import urllib.request
import urllib.error
import sys
import os

# ============================================================
#  CONFIGURAÇÃO
# ============================================================
SERVER_URL = "http://localhost:3000"
APP_NAME   = "Pedrin Xits"
OWNER_ID   = "3616b50c-8ff3-4629-a89b-11c53f3f3643"
APP_SECRET = "1facb137182890f342db9067b80c779107c29fb1ff3d595934b6bdb01f51fa1d"  # hex


# ============================================================
#  HWID - Identificador único do computador
# ============================================================
def get_hwid():
    """Obtém um ID único baseado no hardware do computador."""
    try:
        if platform.system() == "Windows":
            # Serial number do disco C:
            result = subprocess.check_output(
                "wmic diskdrive get serialnumber", shell=True, stderr=subprocess.DEVNULL
            ).decode("utf-8", errors="ignore")
            lines = [l.strip() for l in result.split("\n") if l.strip() and l.strip() != "SerialNumber"]
            if lines:
                return lines[0].strip()
            
            # Fallback: Volume serial
            result = subprocess.check_output(
                "vol C:", shell=True, stderr=subprocess.DEVNULL
            ).decode("utf-8", errors="ignore")
            for part in result.split():
                if len(part) == 9 and part.count("-") == 1:
                    return part.replace("-", "")
        else:
            # Linux/Mac: machine-id
            paths = ["/etc/machine-id", "/var/lib/dbus/machine-id"]
            for p in paths:
                if os.path.exists(p):
                    with open(p, "r") as f:
                        return f.read().strip()
    except Exception:
        pass
    
    # Fallback: baseado no hostname + username
    return hashlib.md5(
        (platform.node() + os.getlogin()).encode()
    ).hexdigest()[:16].upper()


# ============================================================
#  HMAC-SHA256
# ============================================================
def hmac_sha256(key_hex, message):
    """Gera HMAC-SHA256 usando chave em hexadecimal."""
    key_bytes = bytes.fromhex(key_hex)
    return hmac.new(key_bytes, message.encode(), hashlib.sha256).hexdigest()


# ============================================================
#  Timestamp atual em milissegundos
# ============================================================
def get_timestamp():
    return str(int(time.time() * 1000))


# ============================================================
#  Requisição HTTP POST
# ============================================================
def http_post(url, data, headers=None):
    """Faz uma requisição POST e retorna (status_code, response_body)."""
    try:
        json_data = json.dumps(data).encode("utf-8")
        req = urllib.request.Request(url, data=json_data, method="POST")
        req.add_header("Content-Type", "application/json")
        
        if headers:
            for key, value in headers.items():
                req.add_header(key, value)
        
        with urllib.request.urlopen(req, timeout=10) as response:
            body = response.read().decode("utf-8")
            return response.status, json.loads(body)
    
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore")
        try:
            return e.code, json.loads(body)
        except:
            return e.code, {"success": False, "message": body}
    
    except urllib.error.URLError as e:
        return 0, {"success": False, "message": f"Erro de conexão: {e.reason}"}
    
    except Exception as e:
        return 0, {"success": False, "message": str(e)}


# ============================================================
#  Validar licença no servidor
# ============================================================
def validate_license(license_key):
    """
    Envia a license key para o servidor e retorna o resultado.
    
    Returns:
        dict: {success, message, session_token, expires_at, username}
    """
    hwid = get_hwid()
    timestamp = get_timestamp()
    
    # Gerar HMAC
    payload = f"{APP_NAME}|{OWNER_ID}|{license_key}|{hwid}|{timestamp}"
    signature = hmac_sha256(APP_SECRET, payload)
    
    # Dados da requisição
    data = {
        "license_key": license_key,
        "fingerprint": hwid,
        "app_name": APP_NAME,
        "owner_id": OWNER_ID
    }
    
    # Headers com HMAC
    headers = {
        "x-timestamp": timestamp,
        "x-signature": signature
    }
    
    # Enviar requisição
    url = f"{SERVER_URL}/license/validate"
    status, response = http_post(url, data, headers)
    
    return response


# ============================================================
#  MENU PRINCIPAL
# ============================================================
def clear_screen():
    os.system("cls" if platform.system() == "Windows" else "clear")


def print_banner():
    print("=" * 50)
    print("   PEDRIN XITS - Auth Client v1.0")
    print("=" * 50)
    print()


def print_valid(result):
    print()
    print("=" * 50)
    print("   ✅ LICENÇA VÁLIDA!")
    print("=" * 50)
    print(f"   Mensagem : {result.get('message', '-')}")
    print(f"   Token    : {result.get('session_token', '-')}")
    print(f"   Expira   : {result.get('expires_at', '-')}")
    print(f"   Username : {result.get('username', '-')}")
    print("=" * 50)


def print_invalid(result):
    print()
    print("=" * 50)
    print("   ❌ LICENÇA INVÁLIDA!")
    print("=" * 50)
    print(f"   Erro: {result.get('message', 'Erro desconhecido')}")
    print("=" * 50)


def save_license(key, token):
    """Salva a licença localmente."""
    data = {"license_key": key, "session_token": token}
    config_dir = os.path.join(os.path.expanduser("~"), ".pedrin_xits")
    os.makedirs(config_dir, exist_ok=True)
    config_path = os.path.join(config_dir, "license.json")
    with open(config_path, "w") as f:
        json.dump(data, f)


def load_license():
    """Carrega licença salva localmente."""
    config_dir = os.path.join(os.path.expanduser("~"), ".pedrin_xits")
    config_path = os.path.join(config_dir, "license.json")
    if os.path.exists(config_path):
        with open(config_path, "r") as f:
            return json.load(f)
    return None


# ============================================================
#  MAIN
# ============================================================
def main():
    clear_screen()
    print_banner()
    
    # Verificar se já tem licença salva
    saved = load_license()
    if saved:
        print(f"Licença salva encontrada: {saved['license_key'][:8]}...")
        choice = input("Usar licença salva? (S/n): ").strip().lower()
        if choice != "n":
            license_key = saved["license_key"]
        else:
            license_key = input("Digite sua license key: ").strip()
    else:
        license_key = input("Digite sua license key: ").strip()
    
    if not license_key:
        print("\n[ERRO] License key vazia!")
        input("\nPressione Enter para sair...")
        sys.exit(1)
    
    hwid = get_hwid()
    print(f"\n[INFO] HWID: {hwid}")
    print(f"[INFO] Servidor: {SERVER_URL}")
    print(f"[INFO] Validando licença...\n")
    
    # Validar
    result = validate_license(license_key)
    
    if result.get("success"):
        print_valid(result)
        save_license(license_key, result.get("session_token", ""))
        
        print("\n✅ Autenticação bem-sucedida!")
        print("Iniciando aplicação...\n")
        
        # ====================================================
        #  AQUI VOCÊ INICIA SEU PROGRAMA PRINCIPAL
        # ====================================================
        # Exemplo:
        # import seu_programa
        # seu_programa.main()
        #
        # Ou simplesmente continue o código aqui...
        # ====================================================
        
        input("\nPressione Enter para sair...")
        sys.exit(0)
    
    else:
        print_invalid(result)
        input("\nPressione Enter para sair...")
        sys.exit(1)


if __name__ == "__main__":
    main()