#pragma once
#define CURL_STATICLIB
#include <windows.h>
#include <string>
#include <vector>
#include <fstream>
#include <shlobj.h>
#include <algorithm>
#include <cctype>
#include <chrono>
#include <sstream>
#include <iomanip>
#include <wbemidl.h>
#include <comdef.h>
#include <sddl.h>
#include <ctime>

#include "../Cfg/curl/curl.h"
#include "../Cfg/nlohmann/json.hpp"

#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "Normaliz.lib")
#pragma comment(lib, "Crypt32.lib")
#pragma comment(lib, "Wldap32.lib")
#pragma comment(lib, "wbemuuid.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "oleaut32.lib")

void Logar(const std::string& mensagem);

// ============================================================
//  KeyStorage
// ============================================================
class KeyStorage {
private:
    const std::string loginFolderPath = "C:\\Program Files (x86)\\PEDRIN_XITS\\1\\2\\3\\4\\5";
    const std::string loginFileName = "hj39vks.txt";

    std::string GetFullPath() const {
        return loginFolderPath + "\\" + loginFileName;
    }

    bool CreateDirectoryRecursive(const std::string& path) {
        size_t pos = 0;
        std::string currentPath;
        while ((pos = path.find('\\', pos)) != std::string::npos) {
            currentPath = path.substr(0, pos);
            if (!currentPath.empty() && currentPath.back() != ':')
                CreateDirectoryA(currentPath.c_str(), NULL);
            pos++;
        }
        return CreateDirectoryA(path.c_str(), NULL) || GetLastError() == ERROR_ALREADY_EXISTS;
    }

public:
    bool SaveKey(const std::string& key) {
        try {
            if (!CreateDirectoryRecursive(loginFolderPath)) return false;
            std::string fullPath = GetFullPath();
            std::ofstream file(fullPath, std::ios::out | std::ios::trunc);
            if (!file.is_open()) return false;
            file << key;
            file.close();
            SetFileAttributesA(fullPath.c_str(), FILE_ATTRIBUTE_HIDDEN);
            return true;
        }
        catch (...) { return false; }
    }

    std::string LoadKey() {
        try {
            std::ifstream file(GetFullPath());
            if (!file.is_open()) return "";
            std::string key;
            std::getline(file, key);
            file.close();
            key.erase(0, key.find_first_not_of(" \t\n\r"));
            auto last = key.find_last_not_of(" \t\n\r");
            if (last != std::string::npos) key.erase(last + 1);
            return key;
        }
        catch (...) { return ""; }
    }

    bool DeleteKey() {
        try {
            return DeleteFileA(GetFullPath().c_str()) || GetLastError() == ERROR_FILE_NOT_FOUND;
        }
        catch (...) { return false; }
    }

    bool HasSavedKey() {
        std::ifstream file(GetFullPath());
        return file.good();
    }
};

inline KeyStorage g_KeyStorage;

// ============================================================
//  PedrinXitsAuth Helper Functions
// ============================================================
namespace PedrinXitsHelpers {

    using json = nlohmann::json;

    static std::string WmiQuery(const std::string& query, const std::wstring& field) {
        HRESULT hres = CoInitializeEx(0, COINIT_MULTITHREADED);
        bool coInit = SUCCEEDED(hres);
        hres = CoInitializeSecurity(NULL, -1, NULL, NULL, RPC_C_AUTHN_LEVEL_DEFAULT,
            RPC_C_IMP_LEVEL_IMPERSONATE, NULL, EOAC_NONE, NULL);

        IWbemLocator* pLoc = NULL;
        hres = CoCreateInstance(CLSID_WbemLocator, 0, CLSCTX_INPROC_SERVER, IID_IWbemLocator, (LPVOID*)&pLoc);
        if (FAILED(hres)) {
            if (coInit) CoUninitialize();
            return "UNKNOWN";
        }

        IWbemServices* pSvc = NULL;
        hres = pLoc->ConnectServer(_bstr_t(L"ROOT\\CIMV2"), NULL, NULL, 0, NULL, 0, 0, &pSvc);
        if (FAILED(hres)) {
            pLoc->Release();
            if (coInit) CoUninitialize();
            return "UNKNOWN";
        }

        hres = CoSetProxyBlanket(pSvc, RPC_C_AUTHN_WINNT, RPC_C_AUTHZ_NONE, NULL,
            RPC_C_AUTHN_LEVEL_CALL, RPC_C_IMP_LEVEL_IMPERSONATE, NULL, EOAC_NONE);

        IEnumWbemClassObject* pEnumerator = NULL;
        hres = pSvc->ExecQuery(bstr_t("WQL"), bstr_t(query.c_str()),
            WBEM_FLAG_FORWARD_ONLY | WBEM_FLAG_RETURN_IMMEDIATELY, NULL, &pEnumerator);

        std::string result = "UNKNOWN";
        if (SUCCEEDED(hres) && pEnumerator) {
            IWbemClassObject* pclsObj = NULL;
            ULONG uReturn = 0;
            while (pEnumerator) {
                HRESULT hr = pEnumerator->Next(WBEM_INFINITE, 1, &pclsObj, &uReturn);
                if (0 == uReturn) break;

                VARIANT vtProp;
                hr = pclsObj->Get(field.c_str(), 0, &vtProp, 0, 0);
                if (SUCCEEDED(hr) && vtProp.vt == VT_BSTR && vtProp.bstrVal != NULL) {
                    _bstr_t bstrPath(vtProp.bstrVal, true);
                    result = (const char*)bstrPath;
                    result.erase(result.find_last_not_of(" \n\r\t") + 1);
                    VariantClear(&vtProp);
                    pclsObj->Release();
                    break;
                }
                VariantClear(&vtProp);
                pclsObj->Release();
            }
            pEnumerator->Release();
        }

        pSvc->Release();
        pLoc->Release();
        if (coInit) CoUninitialize();
        return result;
    }

    static std::string GetWindowsSid() {
        HANDLE hToken = NULL;
        if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &hToken))
            return "UNKNOWN";

        DWORD dwSize = 0;
        GetTokenInformation(hToken, TokenUser, NULL, 0, &dwSize);
        if (dwSize == 0) {
            CloseHandle(hToken);
            return "UNKNOWN";
        }

        std::vector<BYTE> buffer(dwSize);
        PTOKEN_USER pTokenUser = (PTOKEN_USER)buffer.data();
        if (!GetTokenInformation(hToken, TokenUser, pTokenUser, dwSize, &dwSize)) {
            CloseHandle(hToken);
            return "UNKNOWN";
        }

        LPSTR szSid = NULL;
        if (!ConvertSidToStringSidA(pTokenUser->User.Sid, &szSid)) {
            CloseHandle(hToken);
            return "UNKNOWN";
        }

        std::string sid(szSid);
        LocalFree(szSid);
        CloseHandle(hToken);
        return sid;
    }

    static std::string ComputeSha256(const std::string& data) {
        HCRYPTPROV hProv = 0;
        HCRYPTHASH hHash = 0;

        if (!CryptAcquireContextA(&hProv, nullptr, nullptr, PROV_RSA_AES, CRYPT_VERIFYCONTEXT))
            return "";

        if (!CryptCreateHash(hProv, CALG_SHA_256, 0, 0, &hHash)) {
            CryptReleaseContext(hProv, 0);
            return "";
        }

        if (!CryptHashData(hHash, (BYTE*)data.data(), (DWORD)data.size(), 0)) {
            CryptDestroyHash(hHash);
            CryptReleaseContext(hProv, 0);
            return "";
        }

        BYTE hashBuf[32] = {};
        DWORD hashLen = 32;
        if (!CryptGetHashParam(hHash, HP_HASHVAL, hashBuf, &hashLen, 0)) {
            CryptDestroyHash(hHash);
            CryptReleaseContext(hProv, 0);
            return "";
        }

        CryptDestroyHash(hHash);
        CryptReleaseContext(hProv, 0);

        char hex[65] = {};
        for (DWORD i = 0; i < hashLen; i++)
            snprintf(hex + i * 2, 3, "%02x", hashBuf[i]);
        return std::string(hex);
    }

    static std::vector<uint8_t> HexToBytes(const std::string& hex) {
        std::vector<uint8_t> bytes;
        for (size_t i = 0; i < hex.length(); i += 2) {
            std::string byteString = hex.substr(i, 2);
            uint8_t byte = (uint8_t)strtol(byteString.c_str(), NULL, 16);
            bytes.push_back(byte);
        }
        return bytes;
    }

    static std::string ComputeHmac(const std::string& secret_hex, const std::string& payload) {
        std::vector<uint8_t> secretBytes = HexToBytes(secret_hex);

        HCRYPTPROV hProv = 0;
        HCRYPTKEY  hKey = 0;
        HCRYPTHASH hHash = 0;

        if (!CryptAcquireContextA(&hProv, nullptr, nullptr, PROV_RSA_AES, CRYPT_VERIFYCONTEXT))
            return "";

        struct {
            BLOBHEADER hdr;
            DWORD      cbKeySize;
            BYTE       rgbKeyData[256];
        } keyBlob = {};

        keyBlob.hdr.bType = PLAINTEXTKEYBLOB;
        keyBlob.hdr.bVersion = CUR_BLOB_VERSION;
        keyBlob.hdr.reserved = 0;
        keyBlob.hdr.aiKeyAlg = CALG_RC2;
        keyBlob.cbKeySize = (DWORD)min(secretBytes.size(), (size_t)256);
        memcpy(keyBlob.rgbKeyData, secretBytes.data(), keyBlob.cbKeySize);

        if (!CryptImportKey(hProv, (BYTE*)&keyBlob,
            sizeof(BLOBHEADER) + sizeof(DWORD) + keyBlob.cbKeySize,
            0, CRYPT_IPSEC_HMAC_KEY, &hKey)) {
            CryptReleaseContext(hProv, 0);
            return "";
        }

        if (!CryptCreateHash(hProv, CALG_HMAC, hKey, 0, &hHash)) {
            CryptDestroyKey(hKey);
            CryptReleaseContext(hProv, 0);
            return "";
        }

        HMAC_INFO hmacInfo = {};
        hmacInfo.HashAlgid = CALG_SHA_256;
        CryptSetHashParam(hHash, HP_HMAC_INFO, (BYTE*)&hmacInfo, 0);
        CryptHashData(hHash, (BYTE*)payload.data(), (DWORD)payload.size(), 0);

        BYTE hashBuf[32] = {};
        DWORD hashLen = 32;
        CryptGetHashParam(hHash, HP_HASHVAL, hashBuf, &hashLen, 0);

        CryptDestroyHash(hHash);
        CryptDestroyKey(hKey);
        CryptReleaseContext(hProv, 0);

        char hex[65] = {};
        for (DWORD i = 0; i < hashLen; i++)
            snprintf(hex + i * 2, 3, "%02x", hashBuf[i]);
        return std::string(hex);
    }

    static std::string GenerateFingerprint() {
        std::string cpuId = WmiQuery("SELECT ProcessorId FROM Win32_Processor", L"ProcessorId");
        std::string diskSerial = WmiQuery("SELECT SerialNumber FROM Win32_DiskDrive WHERE MediaType LIKE '%Fixed%'", L"SerialNumber");
        std::string motherboardSerial = WmiQuery("SELECT SerialNumber FROM Win32_BaseBoard", L"SerialNumber");
        std::string windowsSid = GetWindowsSid();

        std::string rawFingerprint = "cpu=" + cpuId + "|disk=" + diskSerial + "|mb=" + motherboardSerial + "|sid=" + windowsSid;
        return ComputeSha256(rawFingerprint);
    }

    static size_t write_callback(void* contents, size_t size, size_t nmemb, void* userp) {
        ((std::string*)userp)->append((char*)contents, size * nmemb);
        return size * nmemb;
    }

    static time_t ParseISO8601(const std::string& iso_date) {
        std::tm tm = {};
        std::istringstream ss(iso_date);
        ss >> std::get_time(&tm, "%Y-%m-%dT%H:%M:%S");
        if (ss.fail()) return 0;
        return _mkgmtime(&tm);
    }

} // namespace PedrinXitsHelpers

// ============================================================
//  c_api - Interface principal
//  Conecta ao servidor backend do Pedrin Xits
// ============================================================
class c_api {
private:
    using json = nlohmann::json;

    std::string app_name = "Pedrin Xits";
    std::string owner_id = "3616b50c-8ff3-4629-a89b-11c53f3f3643";
    std::string app_secret = "1facb137182890f342db9067b80c779107c29fb1ff3d595934b6bdb01f51fa1d";
    // ============================================================
    //  ALTERE AQUI: URL do seu servidor backend
    //  Se estiver rodando localmente: http://localhost:3000
    //  Se hospedado, coloque a URL pública: https://seu-dominio.com
    // ============================================================
    std::string api_url = "http://localhost:3000";

public:
    struct stc_client {
        std::string username;
        std::string hwid;
        std::string session_token;
        struct stc_sub_type {
            bool active = false;
            std::string expire_date;
            bool is_lifetime = false;
        } sub_type;
    } client;

    struct response_t {
        bool success = false;
        std::string message;
    } response;

    c_api() {
        curl_global_init(CURL_GLOBAL_DEFAULT);
    }

    ~c_api() {
        curl_global_cleanup();
    }

    inline std::string SmartLogin(const std::string& key) {
        if (key.empty()) {
            response = { false, "Key vazia." };
            return "Key vazia.";
        }

        std::string fingerprint = PedrinXitsHelpers::GenerateFingerprint();
        auto now = std::chrono::system_clock::now();
        auto epoch = std::chrono::duration_cast<std::chrono::seconds>(now.time_since_epoch()).count();
        std::string timestamp = std::to_string(epoch);

        // Payload: appName|ownerId|key|fingerprint|timestamp
        std::string payload = app_name + "|" + owner_id + "|" + key + "|" + fingerprint + "|" + timestamp;
        std::string signature = PedrinXitsHelpers::ComputeHmac(app_secret, payload);

        if (signature.empty()) {
            response = { false, "Erro ao gerar assinatura." };
            return "Erro ao gerar assinatura.";
        }

        // JSON body
        json body;
        body["license_key"] = key;
        body["fingerprint"] = fingerprint;
        body["app_name"] = app_name;
        body["owner_id"] = owner_id;
        std::string json_body = body.dump();

        // HTTP POST
        std::string url = api_url + "/license/validate";
        std::string resp_body;

        CURL* hnd = curl_easy_init();
        if (!hnd) {
            response = { false, "Erro ao inicializar conexao." };
            return "Erro ao inicializar conexao.";
        }

        struct curl_slist* headers = nullptr;
        headers = curl_slist_append(headers, "Content-Type: application/json");
        headers = curl_slist_append(headers, ("x-timestamp: " + timestamp).c_str());
        headers = curl_slist_append(headers, ("x-signature: " + signature).c_str());

        curl_easy_setopt(hnd, CURLOPT_URL, url.c_str());
        curl_easy_setopt(hnd, CURLOPT_POST, 1L);
        curl_easy_setopt(hnd, CURLOPT_HTTPHEADER, headers);
        curl_easy_setopt(hnd, CURLOPT_POSTFIELDS, json_body.c_str());
        curl_easy_setopt(hnd, CURLOPT_POSTFIELDSIZE, (long)json_body.size());
        curl_easy_setopt(hnd, CURLOPT_WRITEFUNCTION, PedrinXitsHelpers::write_callback);
        curl_easy_setopt(hnd, CURLOPT_WRITEDATA, &resp_body);
        curl_easy_setopt(hnd, CURLOPT_SSL_VERIFYPEER, 0L);
        curl_easy_setopt(hnd, CURLOPT_SSL_VERIFYHOST, 0L);
        curl_easy_setopt(hnd, CURLOPT_TIMEOUT, 15L);
        curl_easy_setopt(hnd, CURLOPT_NOSIGNAL, 1L);

        CURLcode ret = curl_easy_perform(hnd);
        long http_code = 0;
        curl_easy_getinfo(hnd, CURLINFO_RESPONSE_CODE, &http_code);

        curl_slist_free_all(headers);
        curl_easy_cleanup(hnd);

        if (ret != CURLE_OK) {
            response = { false, "Erro de conexao com o servidor." };
            return "Erro de conexao com o servidor.";
        }

        if (resp_body.empty()) {
            response = { false, "Servidor nao respondeu." };
            Logar("[PedrinXits] Resposta vazia");
            return "Servidor nao respondeu.";
        }

        Logar("[PedrinXits] HTTP " + std::to_string(http_code) + ": " + resp_body);

        // Parse JSON
        try {
            json j = json::parse(resp_body);

            bool ok = false;
            if (j.contains("success")) {
                if (j["success"].is_boolean())
                    ok = j["success"].get<bool>();
                else if (j["success"].is_string())
                    ok = (j["success"].get<std::string>() == "true");
            }

            if (ok) {
                client.username = j.value("username", key);
                client.session_token = j.value("session_token", "");
                client.sub_type.expire_date = j.value("expires_at", "");
                client.sub_type.active = true;

                // Verificar lifetime
                try {
                    if (client.sub_type.expire_date == "lifetime" || client.sub_type.expire_date.empty()) {
                        client.sub_type.is_lifetime = true;
                    } else {
                        time_t exp = PedrinXitsHelpers::ParseISO8601(client.sub_type.expire_date);
                        if (exp == 0) exp = (time_t)std::stoll(client.sub_type.expire_date);
                        time_t now_t = std::time(nullptr);
                        double diff = difftime(exp, now_t);
                        client.sub_type.is_lifetime = (diff > (500.0 * 86400.0));
                    }
                }
                catch (...) {
                    // Se expires_at é "lifetime", marcar como lifetime
                    if (client.sub_type.expire_date == "lifetime")
                        client.sub_type.is_lifetime = true;
                }

                response = { true, "success" };
                Logar("[PedrinXits] Login OK!");
                return "success";
            }

            // Traduzir mensagem de erro
            std::string msg = j.value("message", "Key invalida.");
            Logar("[PedrinXits] Mensagem original: " + msg);

            std::string msg_lower = msg;
            std::transform(msg_lower.begin(), msg_lower.end(), msg_lower.begin(), ::tolower);

            if (msg_lower.find("invalid") != std::string::npos)
                msg = "Key invalida.";
            else if (msg_lower.find("license") != std::string::npos && msg_lower.find("key") != std::string::npos)
                msg = "Key invalida.";
            else if (msg_lower.find("expired") != std::string::npos)
                msg = "Key expirada.";
            else if (msg_lower.find("not found") != std::string::npos)
                msg = "Key invalida.";
            else if (msg_lower.find("banned") != std::string::npos || msg_lower.find("blocked") != std::string::npos)
                msg = "Key banida.";
            else if (msg_lower.find("hwid") != std::string::npos || msg_lower.find("fingerprint") != std::string::npos)
                msg = "Reset Hwid.";
            else if (msg_lower.find("paused") != std::string::npos)
                msg = "Key pausada.";

            Logar("[PedrinXits] Mensagem traduzida: " + msg);
            response = { false, msg };
            return msg;

        }
        catch (json::parse_error& e) {
            Logar("[PedrinXits] Erro JSON: " + std::string(e.what()));
            response = { false, "Erro ao processar resposta do servidor." };
            return "Erro ao processar resposta do servidor.";
        }
    }

    std::string get_expiry_text() {
        if (!client.sub_type.active) return "Sem assinatura";
        if (client.sub_type.is_lifetime) return "Lifetime";
        if (client.sub_type.expire_date.empty() || client.sub_type.expire_date == "lifetime") return "Lifetime";

        try {
            time_t exp = PedrinXitsHelpers::ParseISO8601(client.sub_type.expire_date);
            if (exp == 0) exp = (time_t)std::stoll(client.sub_type.expire_date);

            time_t now_t = std::time(nullptr);
            double diff = difftime(exp, now_t);

            if (diff <= 0) return "Expirada";

            int total = (int)diff;
            int days = total / 86400;
            int hours = (total % 86400) / 3600;
            int minutes = (total % 3600) / 60;

            char buf[64];
            if (days > 0)
                snprintf(buf, sizeof(buf), "%dd %02dh %02dm", days, hours, minutes);
            else
                snprintf(buf, sizeof(buf), "%02dh %02dm", hours, minutes);
            return std::string(buf);
        }
        catch (...) {
            return "Erro";
        }
    }
};

inline c_api g_Api;

inline void ApplyAuthFromApi() {
    strncpy_s(Auth.Usuario, sizeof(Auth.Usuario),
        g_Api.client.username.c_str(), _TRUNCATE);
    Auth.Autenticado = true;
    Auth.OverlayView = true;
    Auth.AtivarFuncoes = true;
    Auth.Attached = true;

    if (g_Api.client.sub_type.is_lifetime) {
        Auth.dias_restantes = 99999;
    }
    else {
        if (!g_Api.client.sub_type.expire_date.empty()) {
            try {
                time_t exp = PedrinXitsHelpers::ParseISO8601(g_Api.client.sub_type.expire_date);
                if (exp == 0) exp = (time_t)std::stoll(g_Api.client.sub_type.expire_date);
                time_t now_t = std::time(nullptr);
                double diff = difftime(exp, now_t);
                Auth.dias_restantes = (diff > 0) ? (int)(diff / 86400.0) + 1 : 0;
            }
            catch (...) { Auth.dias_restantes = 0; }
        }
    }
}