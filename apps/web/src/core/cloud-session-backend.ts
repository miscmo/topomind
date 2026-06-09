interface CloudSessionBridgePayload {
  accessToken: string
  refreshToken: string | null
  userId: string | null
}

export async function syncCloudSessionToMain(input: CloudSessionBridgePayload) {
  void input
  return null
}

export async function clearCloudSessionInMain() {
  return null
}
