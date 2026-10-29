import { parseKeyPost, takeNewKeys } from '../lib/org-key-post'
import { stepOrgKeys } from '../lib/org-keys'
import { leaveOrg, rereadOrg, type OrgTabEnv, type OrgTabHost } from './org-tab'

/** Takes a post of the surface module, which is untrusted data: applies each key not seen before to the view, then does what the keys asked of the tab, stopping at the key that leaves it. */
export async function applyOrgKeys(org: OrgTabEnv, host: OrgTabHost, data: unknown): Promise<void> {
  const post = parseKeyPost(data)
  if (post === null) return
  const store = org.store()
  const taken = takeNewKeys(store.vi, post)
  Object.assign(store.vi, taken.vi)
  const effects = stepOrgKeys(store, taken.keys)
  await host.redraw()
  for (const effect of effects) {
    if (effect === 'inbox') return leaveOrg(org, host)
    if (effect === 'reread') rereadOrg(org)
    else if (effect === 'older' && store.olderCursor !== null) await org.feed.loadOlder(store.olderCursor)
  }
}
