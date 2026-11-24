export interface IgetNetworkConfig {
  network: string;
  api_key?: string | null;
  api_base_url?: string | null;
}

// MTN's network row belongs to Portal-02. Never use its URL or key for iGet.
// Keep the same shared-account key precedence for submission and status checks.
export function resolveIgetConfig(
  network: string,
  configs: IgetNetworkConfig[],
  secret = "",
): { api_base_url: string; api_key: string } {
  if (network === "MTN") {
    const sharedKey = configs.find(c =>
      (c.network === "Telecel" || c.network === "AirtelTigo") && c.api_key
    )?.api_key;
    return {
      api_base_url: "https://iget.onrender.com",
      api_key: (sharedKey || secret).trim()
        .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
        .replace(/\s+/g, "")
        .replace(/[^\x21-\x7E]/g, ""),
    };
  }
  const config = configs.find(c => c.network === network);
  return {
    api_base_url: config?.api_base_url || "",
    api_key: config?.api_key || secret,
  };
}