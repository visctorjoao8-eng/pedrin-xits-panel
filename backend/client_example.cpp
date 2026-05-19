/*
 * ============================================================
 *  Pedrin Xits - Auth Client (C++)
 *  Exemplo de como conectar ao servidor de licenças
 * ============================================================
 * 
 *  Dependências:
 *  - libcurl (para requisições HTTP)
 *  - nlohmann/json (para JSON) - https://github.com/nlohmann/json
 *  - OpenSSL (para HMAC-SHA256)
 * 
 *  Compilar (MSVC):
 *    cl /EHsc client_example.cpp /I"path\to\json\include" /link libcurl.lib libssl.lib libcrypto.lib
 * 
 *  Compilar (MinGW):
 *    g++ -o client client_example.cpp -lcurl -lssl -lcrypto -std=c++17
 * ============================================================
 */

#include <iostream>
#include <string>
#include <ctime>
#include <sstream>
#include <iomanip>
#include <random>
#include <curl/curl.h>
#include <openssl/hmac.h>
#include <openssl/evp.h>

// ============================================================
//  CONFIGURAÇÃO - Altere para o seu servidor
// ============================================================
const std::string SERVER_URL   = "https://pedrin-xits-panel.onrender.com";
const std::string APP_NAME     = "Pedrin Xits";
const std::string OWNER_ID     = "3616b50c-8ff3-4629-a89b-11c53f3f3643";
const std::string APP_SECRET   = "1facb137182890f342db9067b80c779107c29fb1ff3d595934b6bdb01f51fa1d"; // hex

// ============================================================
//  Callback do libcurl
// ============================================================
static size_t WriteCallback(void* contents, size_t size, size_t nmemb, std::string* userp) {
    userp->append((char*)contents, size * nmemb);
    return size * nmemb;
}

// ============================================================
//  Obter HWID (Hardware ID) - Exemplo simples
// ============================================================
std::string getHWID() {
    // Windows: usar volume serial number
    #ifdef _WIN32
    char volumeName[MAX_PATH + 1] = { 0 };
    char fileSystemName[MAX_PATH + 1] = { 0 };
    DWORD serialNumber = 0;
    DWORD maxComponentLen = 0;
    DWORD fileSystemFlags = 0;

    if (GetVolumeInformationA("C:\\", volumeName, MAX_PATH, &serialNumber,
        &maxComponentLen, &fileSystemFlags, fileSystemName, MAX_PATH)) {
        std::stringstream ss;
        ss << std::hex << std::uppercase << serialNumber;
        return ss.str();
    }
    #endif
    
    // Fallback: gerar ID aleatório e salvar
    return "HWID-UNKNOWN";
}

// ============================================================
//  Gerar timestamp atual em milissegundos
// ============================================================
std::string getTimestamp() {
    auto now = std::chrono::system_clock::now();
    auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(now.time_since_epoch()).count();
    return std::to_string(ms);
}

// ============================================================
//  HMAC-SHA256 (compatível com o servidor Node.js)
// ============================================================
std::string hmacSHA256(const std::string& key_hex, const std::string& message) {
    // Converter hex para bytes
    std::vector<unsigned char> key_bytes;
    for (size_t i = 0; i < key_hex.length(); i += 2) {
        std::string byte = key_hex.substr(i, 2);
        key_bytes.push_back((unsigned char)strtol(byte.c_str(), nullptr, 16));
    }

    unsigned char* digest;
    unsigned int len = EVP_MAX_MD_SIZE;
    digest = (unsigned char*)malloc(len);

    HMAC(EVP_sha256(), key_bytes.data(), (int)key_bytes.size(),
         (unsigned char*)message.c_str(), message.length(),
         digest, &len);

    std::stringstream ss;
    for (unsigned int i = 0; i < len; i++) {
        ss << std::hex << std::setfill('0') << std::setw(2) << (int)digest[i];
    }
    free(digest);
    return ss.str();
}

// ============================================================
//  Requisição HTTP POST com JSON
// ============================================================
struct HttpResponse {
    int status;
    std::string body;
};

HttpResponse httpPost(const std::string& url, const std::string& jsonBody,
                      const std::vector<std::string>& extraHeaders = {}) {
    HttpResponse response = {0, ""};
    CURL* curl = curl_easy_init();
    
    if (!curl) {
        std::cerr << "[ERRO] Falha ao inicializar libcurl" << std::endl;
        return response;
    }

    struct curl_slist* headers = NULL;
    headers = curl_slist_append(headers, "Content-Type: application/json");
    
    for (const auto& h : extraHeaders) {
        headers = curl_slist_append(headers, h.c_str());
    }

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, jsonBody.c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response.body);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 10L);

    CURLcode res = curl_easy_perform(curl);
    if (res == CURLE_OK) {
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &response.status);
    } else {
        std::cerr << "[ERRO] curl falhou: " << curl_easy_strerror(res) << std::endl;
    }

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);
    return response;
}

// ============================================================
//  Parse simples de JSON (sem biblioteca externa)
//  Para projetos reais, use nlohmann/json
// ============================================================
std::string jsonGetString(const std::string& json, const std::string& key) {
    std::string search = "\"" + key + "\"";
    size_t pos = json.find(search);
    if (pos == std::string::npos) return "";
    
    pos = json.find(":", pos);
    if (pos == std::string::npos) return "";
    pos++;
    
    while (pos < json.length() && (json[pos] == ' ' || json[pos] == '\t')) pos++;
    
    if (json[pos] == '"') {
        pos++;
        size_t end = json.find("\"", pos);
        return json.substr(pos, end - pos);
    } else {
        size_t end = json.find_first_of(",}", pos);
        std::string val = json.substr(pos, end - pos);
        // trim
        while (!val.empty() && val.back() == ' ') val.pop_back();
        return val;
    }
}

bool jsonGetBool(const std::string& json, const std::string& key) {
    return jsonGetString(json, key) == "true";
}

// ============================================================
//  Resultado da validação
// ============================================================
struct LicenseResult {
    bool success;
    std::string message;
    std::string sessionToken;
    std::string expiresAt;
    std::string username;
};

// ============================================================
//  Validar licença no servidor
// ============================================================
LicenseResult validateLicense(const std::string& licenseKey) {
    LicenseResult result = {false, "", "", "", ""};
    
    std::string hwid = getHWID();
    std::string timestamp = getTimestamp();
    std::string signature = "";
    
    // Gerar HMAC se APP_SECRET estiver configurado
    if (!APP_SECRET.empty()) {
        // Payload: app_name|owner_id|key|fingerprint|timestamp
        std::string payload = APP_NAME + "|" + OWNER_ID + "|" + licenseKey + "|" + hwid + "|" + timestamp;
        signature = hmacSHA256(APP_SECRET, payload);
    }
    
    // Montar JSON
    std::string json = "{"
        "\"license_key\":\"" + licenseKey + "\","
        "\"fingerprint\":\"" + hwid + "\","
        "\"app_name\":\"" + APP_NAME + "\","
        "\"owner_id\":\"" + OWNER_ID + "\""
        "}";
    
    // Headers extras
    std::vector<std::string> headers;
    headers.push_back("x-timestamp: " + timestamp);
    if (!signature.empty()) {
        headers.push_back("x-signature: " + signature);
    }
    
    // Enviar requisição
    std::string url = SERVER_URL + "/license/validate";
    HttpResponse resp = httpPost(url, json, headers);
    
    std::cout << "[DEBUG] Status: " << resp.status << std::endl;
    std::cout << "[DEBUG] Response: " << resp.body << std::endl;
    
    // Parse resposta
    result.success = jsonGetBool(resp.body, "success");
    result.message = jsonGetString(resp.body, "message");
    result.sessionToken = jsonGetString(resp.body, "session_token");
    result.expiresAt = jsonGetString(resp.body, "expires_at");
    result.username = jsonGetString(resp.body, "username");
    
    return result;
}

// ============================================================
//  MAIN - Exemplo de uso
// ============================================================
int main() {
    curl_global_init(CURL_GLOBAL_ALL);
    
    std::string licenseKey;
    
    std::cout << "=====================================" << std::endl;
    std::cout << "  Pedrin Xits - Auth Client" << std::endl;
    std::cout << "=====================================" << std::endl;
    std::cout << std::endl;
    std::cout << "Digite sua license key: ";
    std::getline(std::cin, licenseKey);
    
    if (licenseKey.empty()) {
        std::cerr << "[ERRO] License key vazia!" << std::endl;
        return 1;
    }
    
    std::cout << "\n[INFO] Validando licenca..." << std::endl;
    std::cout << "[INFO] HWID: " << getHWID() << std::endl;
    
    LicenseResult result = validateLicense(licenseKey);
    
    if (result.success) {
        std::cout << "\n=====================================" << std::endl;
        std::cout << "  LICENCA VALIDA!" << std::endl;
        std::cout << "=====================================" << std::endl;
        std::cout << "  Mensagem: " << result.message << std::endl;
        std::cout << "  Token:    " << result.sessionToken << std::endl;
        std::cout << "  Expira:   " << result.expiresAt << std::endl;
        std::cout << "=====================================" << std::endl;
        
        // Aqui você continuaria com o programa principal
        // ...
        
    } else {
        std::cout << "\n=====================================" << std::endl;
        std::cout << "  LICENCA INVALIDA!" << std::endl;
        std::cout << "=====================================" << std::endl;
        std::cout << "  Erro: " << result.message << std::endl;
        std::cout << "=====================================" << std::endl;
        
        // Fechar programa ou pedir nova key
        system("pause");
        return 1;
    }
    
    curl_global_cleanup();
    
    std::cout << "\nPressione Enter para sair...";
    std::cin.get();
    return 0;
}