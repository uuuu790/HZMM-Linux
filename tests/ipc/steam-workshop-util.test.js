import { describe, it, expect } from 'vitest'
import {
  buildBrowseUrl, parseWorkshopIds, buildDetailsBody,
  adaptWorkshopItem, mergeDetails, STEAM_WORKSHOP_APP_ID,
} from '../../src/main/ipc/steam-workshop-util.js'

describe('buildBrowseUrl', () => {
  it('maps trend with a 7-day window and the app id', () => {
    const u = buildBrowseUrl({ sort: 'trend', page: 1 })
    expect(u).toContain(`appid=${STEAM_WORKSHOP_APP_ID}`)
    expect(u).toContain('browsesort=trend')
    expect(u).toContain('actualsort=trend')
    expect(u).toContain('days=7')
    expect(u).toContain('p=1')
  })
  it('maps toprated without a day window', () => {
    const u = buildBrowseUrl({ sort: 'toprated', page: 2 })
    expect(u).toContain('browsesort=toprated')
    expect(u).not.toContain('days=')
    expect(u).toContain('p=2')
  })
  it('url-encodes the search text', () => {
    const u = buildBrowseUrl({ sort: 'mostrecent', search: 'calamity mod' })
    expect(u).toContain('searchtext=calamity+mod')
  })
  it('falls back to trend for an unknown sort', () => {
    expect(buildBrowseUrl({ sort: 'bogus' })).toContain('browsesort=trend')
  })
})

describe('parseWorkshopIds', () => {
  it('extracts ordered unique ids from filedetails links', () => {
    const html = `
      <a href="https://steamcommunity.com/sharedfiles/filedetails/?id=111">A</a>
      <a href="/sharedfiles/filedetails/?id=222">B</a>
      <a href="/sharedfiles/filedetails/?id=111">dup</a>`
    expect(parseWorkshopIds(html)).toEqual(['111', '222'])
  })
  it('returns [] when there are no matches', () => {
    expect(parseWorkshopIds('<div>none</div>')).toEqual([])
    expect(parseWorkshopIds('')).toEqual([])
  })
})

describe('buildDetailsBody', () => {
  it('builds itemcount + indexed publishedfileids', () => {
    const body = buildDetailsBody(['10', '20'])
    expect(body).toContain('itemcount=2')
    expect(body).toContain('publishedfileids%5B0%5D=10')
    expect(body).toContain('publishedfileids%5B1%5D=20')
  })
})

describe('adaptWorkshopItem', () => {
  const raw = {
    result: 1, publishedfileid: '2831752947', title: 'LuiAFK Reborn',
    preview_url: 'https://img/x', subscriptions: 2070424, favorited: 50091,
    views: 1019127, file_size: 3736327, time_updated: 1715710825, time_created: 1600000000,
    tags: [{ tag: 'quality of life' }, { tag: '1.4.4' }], description: '[h1]Hi[/h1]',
  }
  it('maps all fields and builds the url', () => {
    const a = adaptWorkshopItem(raw)
    expect(a.id).toBe('2831752947')
    expect(a.title).toBe('LuiAFK Reborn')
    expect(a.subscriptions).toBe(2070424)
    expect(a.tags).toEqual(['quality of life', '1.4.4'])
    expect(a.descriptionBBCode).toBe('[h1]Hi[/h1]')
    expect(a.url).toBe('https://steamcommunity.com/sharedfiles/filedetails/?id=2831752947')
  })
  it('returns null when result !== 1 or input missing', () => {
    expect(adaptWorkshopItem({ ...raw, result: 9 })).toBeNull()
    expect(adaptWorkshopItem(null)).toBeNull()
  })
  it('tolerates missing optional fields', () => {
    const a = adaptWorkshopItem({ result: 1, publishedfileid: '5' })
    expect(a.tags).toEqual([])
    expect(a.subscriptions).toBe(0)
    expect(a.title).toBe('')
  })
})

describe('mergeDetails', () => {
  it('returns items in browse order and drops unusable ones', () => {
    const ids = ['2', '1', '3']
    const details = [
      { result: 1, publishedfileid: '1', title: 'one' },
      { result: 1, publishedfileid: '2', title: 'two' },
      { result: 9, publishedfileid: '3', title: 'gone' },
    ]
    const merged = mergeDetails(ids, details)
    expect(merged.map((m) => m.id)).toEqual(['2', '1']) // '3' dropped (result 9)
    expect(merged[0].title).toBe('two')
  })
})
