import { describe, it, expect } from 'vitest'
import { mainText } from '../../src/main/services/main-text'
import { UI_TEXT } from '../../src/renderer/src/constants/i18n/index.js'

// The tray menu and native dialogs are translated in the main process; every
// language the renderer offers must have them too.
describe('mainText', () => {
  const fields = Object.keys(mainText('en'))

  for (const lang of Object.keys(UI_TEXT)) {
    it(`has every string for ${lang}`, () => {
      const text = mainText(lang)
      for (const field of fields) {
        expect(text[field], `${lang}.${field}`).toBeTruthy()
      }
      if (lang !== 'en') expect(text).not.toBe(mainText('en'))
    })
  }

  it('falls back to English for an unknown locale', () => {
    expect(mainText('xx')).toBe(mainText('en'))
  })
})
