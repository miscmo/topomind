interface SampleViewProps {
  pluginId: string
  activationReason: string
  workspaceId: string | null
}

export function SampleView({ pluginId, activationReason, workspaceId }: SampleViewProps) {
  return (
    <section style={{ padding: 16 }}>
      <h2>开发测试插件</h2>
      <p>pluginId: {pluginId}</p>
      <p>activationReason: {activationReason}</p>
      <p>workspaceId: {workspaceId || '未设置'}</p>
      <p style={{ marginTop: 24, color: '#666' }}>
        此插件通过 Host API 与宿主交互，没有直接访问宿主内部模块或 IPC。
      </p>
    </section>
  )
}
