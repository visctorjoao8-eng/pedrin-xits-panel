"""
Pedrin Xits - Teste de Validacao de Licenca
App: Pedrin Xits (Default)
Owner ID: 3616b50c-8ff3-4629-a89b-11c53f3f3643
Secret: 1facb137182890f342db9067b80c779107c29fb1ff3d595934b6bdb01f51fa1d
"""

import requests
import hashlib
import hmac
import time
import uuid
import json

# Configuracao do app
API_URL = "http://localhost:3000"
APP_NAME = "Pedrin Xits"
OWNER_ID = "3616b50c-8ff3-4629-a89b-11c53f3f3643"
APP_SECRET = "1facb137182890f342db9067b80c779107c29fb1ff3d595934b6bdb01f51fa1d"

# Device fingerprint fixo
DEVICE_FP = None


def get_device_fp():
    global DEVICE_FP
    if DEVICE_FP is None:
        import platform
        hostname = platform.node() or "unknown"
        DEVICE_FP = hashlib.md5(hostname.encode()).hexdigest()[:16].upper()
    return DEVICE_FP


def generate_hmac(license_key, fingerprint, timestamp):
    payload = f"{APP_NAME}|{OWNER_ID}|{license_key}|{fingerprint}|{timestamp}"
    secret_bytes = bytes.fromhex(APP_SECRET)
    signature = hmac.new(secret_bytes, payload.encode(), hashlib.sha256).hexdigest()
    return signature


def check_key(license_key):
    try:
        resp = requests.post(f"{API_URL}/license/check", json={"license_key": license_key}, timeout=10)
        return resp.json()
    except requests.exceptions.JSONDecodeError:
        return {"error": f"Invalid response (status {resp.status_code})"}
    except Exception as e:
        return {"error": str(e)}


def reset_hwid(license_key):
    try:
        resp = requests.post(f"{API_URL}/admin/login", json={"username": "1", "password": "1"}, timeout=10)
        token = resp.json().get("token")
        if not token:
            return False
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        resp = requests.get(f"{API_URL}/admin/keys?limit=9999", headers=headers, timeout=10)
        keys = resp.json().get("keys", [])
        for k in keys:
            if k["key"] == license_key:
                key_id = k["id"]
                requests.post(f"{API_URL}/admin/keys/{key_id}/reset-hwid", headers=headers, json={}, timeout=10)
                return True
        return False
    except:
        return False


def validate_key(license_key):
    fingerprint = get_device_fp()
    timestamp = str(int(time.time()))
    signature = generate_hmac(license_key, fingerprint, timestamp)

    headers = {
        "Content-Type": "application/json",
        "X-Timestamp": timestamp,
        "X-Signature": signature
    }

    body = {
        "license_key": license_key,
        "fingerprint": fingerprint,
        "app_name": APP_NAME,
        "owner_id": OWNER_ID
    }

    print(f"\n  Device FP  : {fingerprint}")
    print(f"  Timestamp  : {timestamp}")

    try:
        resp = requests.post(f"{API_URL}/license/validate", json=body, headers=headers, timeout=10)
        return resp.json()
    except requests.exceptions.JSONDecodeError:
        return {"error": f"Invalid response (status {resp.status_code})"}
    except Exception as e:
        return {"error": str(e)}


def show_key_info(key_info):
    if "error" in key_info:
        print(f"  ERRO: {key_info['error']}")
        return

    if not key_info.get("success", False):
        print(f"  Key invalida.")
        if "message" in key_info:
            print(f"  Mensagem: {key_info['message']}")
        return

    status = key_info.get("status", "N/A")
    status_label = {
        "active": "ATIVA",
        "unused": "NAO USADA",
        "expired": "EXPIRADA",
        "banned": "BANIDA",
        "paused": "PAUSADA"
    }.get(status, status.upper())

    print(f"  Status         : {status_label}")
    print(f"  Client         : {key_info.get('client_name') or 'N/A'}")
    print(f"  Lifetime       : {'Sim' if key_info.get('is_lifetime') else 'Nao'}")
    print(f"  App            : {key_info.get('app_name', 'N/A')}")
    print(f"  Criado em      : {key_info.get('created_at', 'N/A')}")
    print(f"  Ativado em     : {key_info.get('activated_at') or 'Nao ativada'}")
    print(f"  Expira em      : {key_info.get('expires_at') or 'N/A'}")
    print(f"  Dias restantes : {key_info.get('days_remaining') if 'days_remaining' in key_info else 'N/A'}")
    print(f"  Usos totais    : {key_info.get('uses', 0)}")
    print(f"  Pausada        : {'Sim' if key_info.get('paused') else 'Nao'}")


def show_validate_result(result):
    if "error" in result:
        print(f"  ERRO: {result['error']}")
        return

    success = result.get("success", False)
    status = "SUCESSO" if success else "FALHA"
    print(f"  Resultado      : {status}")
    print(f"  Mensagem       : {result.get('message', 'N/A')}")

    if success:
        print(f"  Session Token  : {result.get('session_token', 'N/A')}")
        print(f"  Username       : {result.get('username', 'N/A')}")
        print(f"  App Name       : {result.get('app_name', 'N/A')}")
        if "days_left" in result:
            print(f"  Dias restantes : {result['days_left']}")


if __name__ == "__main__":
    print("\n" + "="*60)
    print(f"  PEDRIN XITS - TESTE DE LICENCA")
    print(f"  Device FP: {get_device_fp()}")
    print("="*60)

    while True:
        print()
        license_key = input("  Digite a licenca (ou 'sair' / 'reset'): ").strip()

        if license_key.lower() == "sair":
            print("\n  Saindo...\n")
            break

        if license_key.lower() == "reset":
            key_to_reset = input("  Qual key resetar? ").strip()
            if key_to_reset:
                if reset_hwid(key_to_reset):
                    print(f"  HWID resetado com sucesso!")
                else:
                    print("  Erro ao resetar.")
            continue

        if not license_key:
            print("  Digite uma licenca valida.")
            continue

        print(f"\n  --- INFORMACOES DA KEY ---")
        key_info = check_key(license_key)
        show_key_info(key_info)

        print(f"\n  --- VALIDACAO ---")
        val_result = validate_key(license_key)
        show_validate_result(val_result)

        print(f"\n  {'='*60}")
