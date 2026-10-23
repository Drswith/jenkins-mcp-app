export function supportsExtension(bridge, name) {
  const capabilities = bridge.getHostCapabilities?.() ?? {};
  return Boolean(capabilities.experimental?.[name] || capabilities.extensions?.[name]);
}

export function promptTarget(bridge, newConversation = false) {
  const platform = bridge.getHostContext?.()?.platform;
  return newConversation && ["desktop", "web"].includes(platform) && supportsExtension(bridge, "openai/message") ? "new" : "active";
}

export async function sendPrompt(bridge, text, newConversation = false) {
  if (!bridge.getHostCapabilities?.()?.message?.text) throw new Error("宿主不支持发送消息，请复制下方内容到对话");
  const target = promptTarget(bridge, newConversation);
  const result = await bridge.sendMessage({ role: "user", content: [{ type: "text", text }], ...(supportsExtension(bridge, "openai/message") ? { _meta: { "openai/message": { target } } } : {}) }, { timeout: 5000 });
  if (result?.isError) throw new Error("宿主未接受消息，请确认对话状态后再操作");
  return target;
}
