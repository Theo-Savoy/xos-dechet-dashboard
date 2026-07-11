const VERSION = "v1";
const ADDITIONAL_DATA = new TextEncoder().encode("xos:salesforce-refresh-token:v1");

function encryptionKeyBytes() {
  const encoded = process.env.SF_TOKEN_ENCRYPTION_KEY || "";
  const bytes = Buffer.from(encoded, "base64");
  if (!encoded || bytes.length !== 32 || bytes.toString("base64") !== encoded) {
    throw new Error("sf_token_encryption_key_invalid");
  }
  return bytes;
}

async function encryptionKey() {
  return crypto.subtle.importKey("raw", encryptionKeyBytes(), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptRefreshToken(refreshToken) {
  if (typeof refreshToken !== "string" || !refreshToken) throw new Error("sf_refresh_token_invalid");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: ADDITIONAL_DATA },
    await encryptionKey(),
    new TextEncoder().encode(refreshToken),
  );
  return [VERSION, Buffer.from(iv).toString("base64url"), Buffer.from(ciphertext).toString("base64url")].join(".");
}

export async function decryptRefreshToken(encrypted) {
  const [version, ivPart, ciphertextPart, extra] = String(encrypted || "").split(".");
  if (version !== VERSION || !ivPart || !ciphertextPart || extra) throw new Error("sf_refresh_token_ciphertext_invalid");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: Buffer.from(ivPart, "base64url"), additionalData: ADDITIONAL_DATA },
    await encryptionKey(),
    Buffer.from(ciphertextPart, "base64url"),
  );
  return new TextDecoder().decode(plaintext);
}
