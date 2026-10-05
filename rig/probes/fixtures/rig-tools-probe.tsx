import type { Register } from 'claude-code'

export const register: Register = (on) => {
  on('session.start', async ($) => {
    await listTools($)
  })
}

async function listTools($: any) {
  const out = await $.env.get('CC_RIG_TOOLS_OUT')
  await $.clock.sleep(15000)
  const tools = await $.tool.list()
  await $.fs.write(out, JSON.stringify(tools.map((t: any) => t.name)))
}
