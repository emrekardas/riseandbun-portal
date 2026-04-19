import "server-only";

export function isMockMode(): boolean {
  return process.env.MOCK_ORDERS === "1" || process.env.MOCK_ORDERS === "true";
}
