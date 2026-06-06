import { describe, it, expect } from 'vitest'
import { UI_TEXT } from '../../src/renderer/src/constants/i18n/index.js'

const LANGUAGES = Object.keys(UI_TEXT)
const REFERENCE_LANG = 'zh-TW'

describe('i18n completeness', () => {
  it('has all expected languages', () => {
    expect(LANGUAGES).toContain('zh-TW')
    expect(LANGUAGES).toContain('en')
    expect(LANGUAGES).toContain('ja')
    expect(LANGUAGES).toContain('ko')
    expect(LANGUAGES).toContain('ru')
    expect(LANGUAGES).toContain('de')
    expect(LANGUAGES).toContain('fr')
    expect(LANGUAGES.length).toBe(7)
  })

  const referenceKeys = Object.keys(UI_TEXT[REFERENCE_LANG]).sort()

  for (const lang of Object.keys(UI_TEXT)) {
    if (lang === REFERENCE_LANG) continue

    describe(`${lang} vs ${REFERENCE_LANG}`, () => {
      const langKeys = Object.keys(UI_TEXT[lang]).sort()

      it('has no missing keys', () => {
        const missing = referenceKeys.filter(k => !langKeys.includes(k))
        expect(missing, `${lang} is missing keys: ${missing.join(', ')}`).toEqual([])
      })

      it('has no extra keys', () => {
        const extra = langKeys.filter(k => !referenceKeys.includes(k))
        expect(extra, `${lang} has extra keys: ${extra.join(', ')}`).toEqual([])
      })

      it('has no empty string values', () => {
        const empty = langKeys.filter(k => UI_TEXT[lang][k] === '')
        expect(empty, `${lang} has empty values: ${empty.join(', ')}`).toEqual([])
      })
    })
  }
})
